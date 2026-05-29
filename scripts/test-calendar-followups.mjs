import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = 3099;
const baseUrl = `http://localhost:${port}`;
const dbPath = join(tmpdir(), `amanda-calendar-followups-${Date.now()}.json`);
const emptyDb = {
  agentMemoryByUser: {},
  businessDataByUser: {},
  connectorsByUser: {},
  connectorTokensByUser: {},
  integrationsByUser: {},
  oauthStates: {},
  sessions: [],
  settingsByUser: {},
  tasksByUser: {},
  transcriptsByUser: {},
  users: [],
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function extractCookie(response) {
  const setCookie = response.headers.get("set-cookie") || "";
  return setCookie.split(";")[0];
}

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not boot within ${timeoutMs}ms.`);
}

async function postJson(url, body, cookie = "") {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  return { json, response };
}

async function getJson(url, cookie = "") {
  const response = await fetch(url, {
    headers: cookie ? { cookie } : {},
  });
  const json = await response.json();
  return { json, response };
}

async function signup(index) {
  const email = `amanda-calendar-test-${index}-${Date.now()}@example.com`;
  const { json, response } = await postJson(`${baseUrl}/api/auth/signup`, {
    company: `Amanda Calendar Test ${index}`,
    email,
    name: `Calendar Tester ${index}`,
    password: "password123",
  });
  assert(response.status === 201, `Signup ${index} failed with ${response.status}.`);
  return {
    cookie: extractCookie(response),
    email,
    user: json.user,
  };
}

async function voice(cookie, transcript) {
  const { json, response } = await postJson(`${baseUrl}/api/voice/respond`, {
    requestId: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    transcript,
  }, cookie);
  assert(response.status === 200, `Voice request failed for "${transcript}" with ${response.status}.`);
  return json;
}

async function approvals(cookie) {
  const { json, response } = await getJson(`${baseUrl}/api/approval-requests`, cookie);
  assert(response.status === 200, `Approval list failed with ${response.status}.`);
  return json.approvalRequests || [];
}

function assertNotGenericReply(reply) {
  assert(
    !/recent workspace context|operations request/i.test(reply),
    `Reply fell back to generic workspace text: ${reply}`,
  );
}

async function run() {
  await writeFile(dbPath, JSON.stringify(emptyDb, null, 2), "utf8");
  process.env.AMANDA_DB_PATH = dbPath;
  process.env.AMANDA_DEBUG_VOICE = "true";
  process.env.AMANDA_SKIP_LISTEN = "true";
  process.env.NODE_ENV = "development";
  process.env.PORT = String(port);

  const { server } = await import("../server.js");

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, () => {
        server.off("error", reject);
        resolve();
      });
    });
    await waitForServer(`${baseUrl}/api/health`);

    const user1 = await signup(1);
    const readToday = await voice(user1.cookie, "Check my calendar today.");
    assert(readToday.agent.intent === "calendar_today", `Expected calendar_today, got ${readToday.agent.intent}.`);
    assert(readToday.agent.routedTo === "calendar.today", `Expected calendar.today route, got ${readToday.agent.routedTo}.`);
    assert(readToday.agent.intent !== "calendar_followup_needs_target", "Calendar read must not route as follow-up-needs-target.");

    const readTomorrow = await voice(user1.cookie, "What meetings do I have tomorrow?");
    assert(readTomorrow.agent.intent === "calendar_tomorrow", `Expected calendar_tomorrow, got ${readTomorrow.agent.intent}.`);

    const freeSlots = await voice(user1.cookie, "Find free slots tomorrow.");
    assert(freeSlots.agent.intent === "calendar_find_slots", `Expected calendar_find_slots, got ${freeSlots.agent.intent}.`);

    const first = await voice(user1.cookie, "Schedule a supplier meeting tomorrow at 10am.");
    const firstApprovals = await approvals(user1.cookie);
    assert(first.agent.intent === "calendar_prepare_event", `Expected initial calendar intent, got ${first.agent.intent}.`);
    assert(firstApprovals.length === 1, `Expected 1 approval after initial schedule, got ${firstApprovals.length}.`);
    const firstApprovalId = firstApprovals[0].id;

    const newIncompleteSchedule = await voice(user1.cookie, "Schedule a meeting tomorrow.");
    const afterIncompleteScheduleApprovals = await approvals(user1.cookie);
    assert(newIncompleteSchedule.agent.intent === "calendar_prepare_event", `Expected new schedule intent, got ${newIncompleteSchedule.agent.intent}.`);
    assert(/what time should i schedule/i.test(newIncompleteSchedule.reply), `Expected missing-time clarification, got ${newIncompleteSchedule.reply}.`);
    assert(!/already prepared/i.test(newIncompleteSchedule.reply), `New schedule was hijacked by pending approval: ${newIncompleteSchedule.reply}.`);
    assert(afterIncompleteScheduleApprovals.length === 1, `Expected no approval update/create for incomplete new schedule, got ${afterIncompleteScheduleApprovals.length}.`);

    const second = await voice(user1.cookie, "location is at Lagos State");
    const secondApprovals = await approvals(user1.cookie);
    assert(second.agent.intent === "calendar_prepare_event_followup", `Expected follow-up intent, got ${second.agent.intent}.`);
    assert(second.agent.usedFollowUpContext === true, "Expected follow-up context to be used.");
    assert(second.agent.followUpType === "location", `Expected location follow-up type, got ${second.agent.followUpType}.`);
    assert(second.agent.calendarParser?.location === "Lagos State", `Expected parsed location Lagos State, got ${JSON.stringify(second.agent.calendarParser)}.`);
    assert(second.agent.approval?.updatedExisting === true, "Expected existing approval to be updated.");
    assert(second.agent.approval?.deduped === true, "Expected approval update to be deduped.");
    assert(secondApprovals.length === 1, `Expected 1 approval after location update, got ${secondApprovals.length}.`);
    assert(secondApprovals[0].id === firstApprovalId, "Expected location update to modify the existing approval.");
    assert(secondApprovals[0].payload.location === "Lagos State", `Expected location to update on approval payload, got ${secondApprovals[0].payload.location}.`);
    assertNotGenericReply(second.reply);

    const user2 = await signup(2);
    const third = await voice(user2.cookie, "Schedule a meeting tomorrow.");
    assert(third.agent.intent === "calendar_prepare_event", `Expected schedule intent, got ${third.agent.intent}.`);
    const fourth = await voice(user2.cookie, "3pm.");
    assert(fourth.agent.intent === "calendar_prepare_event_followup", `Expected time follow-up intent, got ${fourth.agent.intent}.`);
    assert(fourth.agent.usedFollowUpContext === true, "Expected time follow-up to use calendar context.");
    assertNotGenericReply(fourth.reply);
    const fifth = await voice(user2.cookie, "location is Lagos State.");
    const user2Approvals = await approvals(user2.cookie);
    assert(fifth.agent.intent === "calendar_prepare_event_followup", `Expected location follow-up intent, got ${fifth.agent.intent}.`);
    assert(fifth.agent.usedFollowUpContext === true, "Expected location follow-up to use calendar context.");
    assert(user2Approvals.length === 1, `Expected one approval after schedule/time/location sequence, got ${user2Approvals.length}.`);
    assert(user2Approvals[0].payload.location === "Lagos State", `Expected final location Lagos State, got ${user2Approvals[0].payload.location}.`);
    assert(/Meeting/i.test(user2Approvals[0].payload.title || ""), `Expected generic Meeting title, got ${user2Approvals[0].payload.title}.`);
    assertNotGenericReply(fifth.reply);

    const user3 = await signup(3);
    const sixth = await voice(user3.cookie, "location is at Lagos State");
    const user3Approvals = await approvals(user3.cookie);
    assert(sixth.agent.intent === "calendar_followup_needs_target", `Expected no-context follow-up intent, got ${sixth.agent.intent}.`);
    assert(sixth.agent.usedFollowUpContext === false, "Expected no calendar follow-up context for location-only input.");
    assert(/what should i apply that location or time update to/i.test(sixth.reply), `Expected clarifying reply, got ${sixth.reply}.`);
    assert(user3Approvals.length === 0, `Expected 0 approvals for location-only input without context, got ${user3Approvals.length}.`);
    assertNotGenericReply(sixth.reply);

    const user4 = await signup(4);
    const seventh = await voice(user4.cookie, "Schedule a product review Friday at 2pm for 1 hour at Ikeja office.");
    const user4Approvals = await approvals(user4.cookie);
    assert(seventh.agent.intent === "calendar_prepare_event", `Expected calendar prepare intent, got ${seventh.agent.intent}.`);
    assert(user4Approvals.length === 1, `Expected 1 approval for complete product review schedule, got ${user4Approvals.length}.`);
    assert(user4Approvals[0].payload.title === "Product review", `Expected Product review title, got ${user4Approvals[0].payload.title}.`);
    assert(Number(user4Approvals[0].payload.durationMinutes) === 60, `Expected 60 minute duration, got ${user4Approvals[0].payload.durationMinutes}.`);
    assert(user4Approvals[0].payload.location === "Ikeja office", `Expected Ikeja office location, got ${user4Approvals[0].payload.location}.`);

    console.log("Calendar follow-up routing tests passed.");
  } finally {
    try {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    } catch {}
    await rm(dbPath, { force: true });
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
