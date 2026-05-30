import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveConnectorToken } from "../src/connectors/google-calendar.js";
import { createGmailDraft } from "../src/connectors/gmail.js";

const port = 3098;
const baseUrl = `http://localhost:${port}`;
const dbPath = join(tmpdir(), `amanda-gmail-readonly-${Date.now()}.json`);
const nativeFetch = global.fetch;
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
  const json = await response.json().catch(() => ({}));
  return { json, response };
}

async function getJson(url, cookie = "") {
  const response = await fetch(url, {
    headers: cookie ? { cookie } : {},
  });
  const json = await response.json().catch(() => ({}));
  return { json, response };
}

async function signup(index) {
  const email = `amanda-gmail-test-${index}-${Date.now()}@example.com`;
  const { json, response } = await postJson(`${baseUrl}/api/auth/signup`, {
    company: `Amanda Gmail Test ${index}`,
    email,
    name: `Gmail Tester ${index}`,
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

async function approvalRequests(cookie) {
  const { json, response } = await getJson(`${baseUrl}/api/approval-requests`, cookie);
  assert(response.status === 200, `Approval request fetch failed with ${response.status}.`);
  return json.approvalRequests || [];
}

async function gmailDrafts(cookie) {
  const { json, response } = await getJson(`${baseUrl}/api/gmail/drafts`, cookie);
  assert(response.status === 200, `Gmail draft fetch failed with ${response.status}.`);
  return json.drafts || [];
}

async function approveApproval(cookie, id) {
  return postJson(`${baseUrl}/api/approval-requests/${id}/approve`, {}, cookie);
}

async function rejectApproval(cookie, id) {
  return postJson(`${baseUrl}/api/approval-requests/${id}/reject`, {}, cookie);
}

async function fetchManual(url, cookie = "") {
  return fetch(url, {
    headers: cookie ? { cookie } : {},
    redirect: "manual",
  });
}

function oauthStateFromLocation(location) {
  const parsed = new URL(location);
  return parsed.searchParams.get("state");
}

async function connectGmailThroughCallback(cookie, tokenPayload) {
  const connectResponse = await fetchManual(`${baseUrl}/api/connectors/gmail/connect`, cookie);
  const location = oauthLocation(connectResponse);
  assert(connectResponse.status === 302, `Expected Gmail connect redirect, got ${connectResponse.status}.`);
  const state = oauthStateFromLocation(location);
  assert(state, "Expected Gmail OAuth state.");
  await withMockFetch(async (url) => {
    const href = String(url);
    if (href.startsWith(baseUrl)) {
      return nativeFetch(url, { redirect: "manual" });
    }
    if (href.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify(tokenPayload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`Unexpected fetch in Gmail callback test: ${href}`);
  }, async () => {
    const callback = await fetchManual(`${baseUrl}/api/connectors/gmail/callback?code=fake-code&state=${encodeURIComponent(state)}`);
    assert(callback.status === 302, `Expected Gmail callback redirect, got ${callback.status}.`);
    assert((callback.headers.get("location") || "").includes("/connectors?connected=gmail"), "Expected Gmail callback success redirect.");
  });
}

async function syncGmailViaApi(cookie) {
  return syncGmailViaApiWithFixtures(cookie, [
    {
      id: "msg_quote",
      from: "customer@example.com",
      subject: "Bulk order inquiry",
      snippet: "Hi, I want a quote for 50 units next week.",
      threadId: "thread_quote",
    },
    {
      id: "msg_complaint",
      from: "buyer@example.com",
      subject: "Delivery issue with last shipment",
      snippet: "There is a delivery issue and I need help urgently.",
      threadId: "thread_complaint",
    },
  ]);
}

function buildImportantGmailFixtures() {
  return [
    {
      id: "msg_001",
      from: "tunde@example.com",
      subject: "Bulk order inquiry for 50 units",
      snippet: "Please send your pricing and delivery timeline.",
      threadId: "thread_001",
    },
    {
      id: "msg_002",
      from: "amaka@example.com",
      subject: "Customer complaint about damaged item",
      snippet: "My delivery arrived damaged and I need help.",
      threadId: "thread_002",
    },
    {
      id: "msg_003",
      from: "bookings@example.com",
      subject: "Booking request for next Tuesday",
      snippet: "Can we book a consultation next Tuesday afternoon?",
      threadId: "thread_003",
    },
    {
      id: "msg_004",
      from: "partnerships@example.com",
      subject: "Partnership proposal for your brand",
      snippet: "We would like to discuss a partnership opportunity.",
      threadId: "thread_004",
    },
    {
      id: "msg_005",
      from: "finance@example.com",
      subject: "Invoice follow up",
      snippet: "Following up on the invoice and payment timing.",
      threadId: "thread_005",
    },
    {
      id: "msg_006",
      from: "supporter@example.com",
      subject: "Support request for delayed delivery",
      snippet: "The order is delayed and the customer needs an update.",
      threadId: "thread_006",
    },
    {
      id: "msg_007",
      from: "pricing@example.com",
      subject: "Pricing question for larger quantity",
      snippet: "What is your price for 200 units?",
      threadId: "thread_007",
    },
    {
      id: "msg_008",
      from: "newsletter@example.com",
      subject: "Weekly digest",
      snippet: "Your weekly product digest and updates.",
      threadId: "thread_008",
      labels: ["INBOX"],
    },
    {
      id: "msg_009",
      from: "team@example.com",
      subject: "Internal note",
      snippet: "Just sharing a quick internal update.",
      threadId: "thread_009",
      labels: ["INBOX"],
    },
    {
      id: "msg_010",
      from: "events@example.com",
      subject: "Webinar invite",
      snippet: "Join our webinar next week.",
      threadId: "thread_010",
      labels: ["INBOX"],
    },
    {
      id: "msg_011",
      from: "ads@example.com",
      subject: "Promotional offer",
      snippet: "Special offer just for you.",
      threadId: "thread_011",
      labels: ["INBOX"],
    },
    {
      id: "msg_012",
      from: "updates@example.com",
      subject: "Platform updates",
      snippet: "Minor platform updates this week.",
      threadId: "thread_012",
      labels: ["INBOX"],
    },
  ];
}

async function syncGmailViaApiWithFixtures(cookie, fixtures = []) {
  return withMockFetch(async (url, options = {}) => {
    const href = String(url);
    if (href.startsWith(baseUrl)) {
      return nativeFetch(url, options);
    }
    if (href.includes("/gmail/v1/users/me/messages?")) {
      return new Response(JSON.stringify({
        messages: fixtures.map((item) => ({ id: item.id, threadId: item.threadId || `${item.id}_thread` })),
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const fixture = fixtures.find((item) => href.includes(`/gmail/v1/users/me/messages/${item.id}`));
    if (fixture) {
      return new Response(JSON.stringify({
        id: fixture.id,
        internalDate: String(fixture.internalDate || Date.now()),
        labelIds: fixture.labels || ["INBOX", "UNREAD"],
        payload: {
          headers: [
            { name: "From", value: fixture.from || "customer@example.com" },
            { name: "To", value: fixture.to || "owner@example.com" },
            { name: "Subject", value: fixture.subject || "(No subject)" },
          ],
        },
        snippet: fixture.snippet || "",
        threadId: fixture.threadId || `${fixture.id}_thread`,
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected fetch in Gmail sync test: ${href}`);
  }, async () => {
    const { json, response } = await postJson(`${baseUrl}/api/connectors/gmail/sync`, {}, cookie);
    assert(response.status === 200, `Expected Gmail sync API to succeed, got ${response.status}.`);
    return json;
  });
}

async function withMockFetch(mock, fn) {
  const originalFetch = global.fetch;
  global.fetch = mock;
  try {
    return await fn();
  } finally {
    global.fetch = originalFetch;
  }
}

function oauthLocation(response) {
  return response.headers.get("location") || "";
}

async function run() {
  await writeFile(dbPath, JSON.stringify(emptyDb, null, 2), "utf8");

  process.env.AMANDA_DB_PATH = dbPath;
  process.env.AMANDA_DEBUG_VOICE = "true";
  process.env.AMANDA_SKIP_LISTEN = "true";
  process.env.AMANDA_TOKEN_SECRET = "test-token-secret";
  process.env.NODE_ENV = "development";
  process.env.PORT = String(port);
  process.env.AMANDA_DEMO_MODE = "false";

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

    const realUser = await signup(1);

    process.env.GOOGLE_CLIENT_ID = "";
    process.env.GOOGLE_CLIENT_SECRET = "";
    process.env.GOOGLE_REDIRECT_URI = "";
    process.env.GMAIL_REDIRECT_URI = "";
    process.env.GMAIL_SCOPES = "";
    let response = await fetchManual(`${baseUrl}/api/connectors/gmail/connect`, realUser.cookie);
    let payload = await response.json();
    assert(response.status === 400, `Expected missing-env Gmail connect error, got ${response.status}.`);
    assert(Array.isArray(payload.missingEnv), "Expected missingEnv array for Gmail setup error.");
    assert(payload.missingEnv.includes("GOOGLE_CLIENT_ID"), "Expected missing GOOGLE_CLIENT_ID.");
    assert(payload.missingEnv.includes("GOOGLE_CLIENT_SECRET"), "Expected missing GOOGLE_CLIENT_SECRET.");
    assert(payload.missingEnv.includes("GMAIL_REDIRECT_URI"), "Expected missing GMAIL_REDIRECT_URI.");
    assert(payload.missingEnv.includes("GMAIL_SCOPES"), "Expected missing GMAIL_SCOPES.");
    assert(!JSON.stringify(payload).includes("secret"), "Setup error should not expose secrets.");

    process.env.GOOGLE_CLIENT_ID = "fake-google-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "fake-google-client-secret";
    process.env.GOOGLE_REDIRECT_URI = `${baseUrl}/api/connectors/google_calendar/callback`;
    process.env.GMAIL_REDIRECT_URI = `${baseUrl}/api/connectors/gmail/callback`;
    process.env.GMAIL_SCOPES = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose";
    response = await fetchManual(`${baseUrl}/api/connectors/gmail/connect`, realUser.cookie);
    const location = oauthLocation(response);
    assert(response.status === 302, `Expected Gmail connect redirect, got ${response.status}.`);
    assert(location.includes("accounts.google.com"), "Expected Google OAuth redirect URL.");
    assert(location.includes(encodeURIComponent("https://www.googleapis.com/auth/gmail.readonly")), "Expected gmail.readonly scope in OAuth URL.");
    assert(location.includes(encodeURIComponent("https://www.googleapis.com/auth/gmail.compose")), "Expected gmail.compose scope in OAuth URL.");
    assert(location.includes("access_type=offline"), "Expected offline access in OAuth URL.");
    assert(location.includes("prompt=consent"), "Expected consent prompt in OAuth URL.");
    assert(location.includes("state="), "Expected OAuth state parameter.");
    assert(!location.includes("fake-google-client-secret"), "OAuth URL must not expose the client secret.");

    process.env.GMAIL_SCOPES = "https://www.googleapis.com/auth/gmail.readonly";
    await connectGmailThroughCallback(realUser.cookie, {
      access_token: "read-only-access-token",
      expires_in: 3600,
      refresh_token: "read-only-refresh-token",
      scope: "https://www.googleapis.com/auth/gmail.readonly",
    });

    const syncResult = await syncGmailViaApi(realUser.cookie);
    assert(syncResult.sync?.messagesSynced === 2, `Expected 2 synced Gmail messages, got ${syncResult.sync?.messagesSynced}.`);
    assert(syncResult.sync?.unreadCount === 2, `Expected 2 unread Gmail messages, got ${syncResult.sync?.unreadCount}.`);

    const sessionDebug = await getJson(`${baseUrl}/api/session/debug`, realUser.cookie);
    assert(sessionDebug.response.status === 200, `Expected session debug to succeed, got ${sessionDebug.response.status}.`);
    assert(sessionDebug.json.gmailConnected === true, "Expected Gmail to be connected for the active workspace.");
    assert(sessionDebug.json.gmailMessagesCount === 2, `Expected 2 Gmail messages in session debug, got ${sessionDebug.json.gmailMessagesCount}.`);

    const summaryReply = await voice(realUser.cookie, "Summarize my unread emails.");
    assert(summaryReply.agent.intent === "gmail_summarize_unread", `Expected gmail_summarize_unread intent, got ${summaryReply.agent.intent}.`);
    assert(/unread email/i.test(summaryReply.reply), `Expected unread email summary reply, got ${summaryReply.reply}.`);

    const quoteReply = await voice(realUser.cookie, "Find quote requests.");
    assert(quoteReply.agent.intent === "gmail_quote_requests", `Expected gmail_quote_requests intent, got ${quoteReply.agent.intent}.`);
    assert(/quote|pricing/i.test(quoteReply.reply), `Expected quote-request response, got ${quoteReply.reply}.`);

    const senderSearchReply = await voice(realUser.cookie, "Find emails from customer@example.com.");
    assert(senderSearchReply.agent.intent === "gmail_search_sender", `Expected gmail_search_sender intent, got ${senderSearchReply.agent.intent}.`);
    assert(senderSearchReply.agent.gmail?.resultCount >= 1, "Expected sender search results.");
    assert(/customer@example.com|Bulk order inquiry/i.test(senderSearchReply.reply), `Expected sender search reply, got ${senderSearchReply.reply}.`);

    const summarizeSenderReply = await voice(realUser.cookie, "Summarize emails from customer@example.com.");
    assert(summarizeSenderReply.agent.intent === "gmail_summarize_sender", `Expected gmail_summarize_sender intent, got ${summarizeSenderReply.agent.intent}.`);
    assert(/latest is|recent email/i.test(summarizeSenderReply.reply), `Expected sender summary reply, got ${summarizeSenderReply.reply}.`);

    const keywordSearchReply = await voice(realUser.cookie, "Find emails about bulk order.");
    assert(keywordSearchReply.agent.intent === "gmail_search_keyword", `Expected gmail_search_keyword intent, got ${keywordSearchReply.agent.intent}.`);
    assert(keywordSearchReply.agent.gmail?.resultCount >= 1, "Expected keyword search results.");
    assert(/bulk order/i.test(keywordSearchReply.reply), `Expected keyword search reply, got ${keywordSearchReply.reply}.`);

    const draftReply = await voice(realUser.cookie, "Draft replies for important emails.");
    assert(draftReply.agent.intent === "gmail_draft_replies", `Expected gmail_draft_replies intent, got ${draftReply.agent.intent}.`);
    assert(draftReply.drafts.length >= 1, "Expected at least one local Gmail draft.");
    assert(/compose permission enabled|draft creation/i.test(draftReply.reply), `Expected compose-permission guidance, got ${draftReply.reply}.`);
    assert(draftReply.agent.gmail?.importantMessagesFound >= 1, "Expected Gmail debug count for important messages.");
    assert(draftReply.agent.gmail?.draftsCreated >= 1, "Expected Gmail debug count for drafts created.");
    assert(draftReply.agent.gmail?.approvalRequestsCreated >= 1, "Expected Gmail debug count for approval requests created.");

    const approvals = await approvalRequests(realUser.cookie);
    const gmailDraftApprovals = approvals.filter(
      (item) => item.connectorId === "gmail" && item.action === "create_gmail_draft",
    );
    assert(gmailDraftApprovals.length >= 1, "Expected Gmail draft approval items.");
    assert(
      gmailDraftApprovals.every((item) => item.payload?.draftId && item.status === "pending"),
      "Expected pending Gmail draft review approvals linked to local drafts.",
    );

    const persistedDrafts = await gmailDrafts(realUser.cookie);
    assert(persistedDrafts.length >= 1, "Expected persisted Gmail local drafts.");
    assert(
      persistedDrafts.some((draft) => draft.status === "needs_approval" && draft.approvalRequestId),
      "Expected a Gmail draft needing approval with a linked approval request.",
    );

    const approveId = gmailDraftApprovals[0].id;
    const approveResult = await approveApproval(realUser.cookie, approveId);
    assert(approveResult.response.status === 409, `Expected Gmail draft approve to fail without compose scope, got ${approveResult.response.status}.`);
    assert(
      /compose permission/i.test(approveResult.json.error || ""),
      `Expected missing compose error, got ${approveResult.json.error}.`,
    );

    const approvalsAfterApprove = await approvalRequests(realUser.cookie);
    const approvedItem = approvalsAfterApprove.find((item) => item.id === approveId);
    assert(approvedItem?.status === "pending", `Expected pending status after failed Gmail draft creation, got ${approvedItem?.status}.`);

    const draftsAfterApprove = await gmailDrafts(realUser.cookie);
    const approvedDraft = draftsAfterApprove.find((draft) => draft.id === gmailDraftApprovals[0].payload?.draftId);
    assert(approvedDraft?.status === "needs_approval", `Expected draft to remain needs_approval, got ${approvedDraft?.status}.`);
    assert(!approvedDraft?.gmailDraftId, "Expected no real Gmail draft ID when compose scope is missing.");

    const singleDraftReply = await voice(realUser.cookie, "Draft a reply to the delivery issue email.");
    assert(
      singleDraftReply.agent.intent === "gmail_draft_single_reply",
      `Expected gmail_draft_single_reply intent, got ${singleDraftReply.agent.intent}.`,
    );
    assert(/Approval Queue|compose permission/i.test(singleDraftReply.reply), `Expected Gmail draft review reply, got ${singleDraftReply.reply}.`);

    const latestSenderDraftReply = await voice(realUser.cookie, "Draft a reply to the latest email from customer@example.com.");
    assert(
      latestSenderDraftReply.agent.intent === "gmail_draft_reply_to_sender",
      `Expected gmail_draft_reply_to_sender intent, got ${latestSenderDraftReply.agent.intent}.`,
    );
    assert(
      latestSenderDraftReply.agent.gmail?.approvalRequestsCreated >= 1,
      "Expected a Gmail approval request for the latest sender draft.",
    );
    assert(/Approval Queue/i.test(latestSenderDraftReply.reply), `Expected latest sender draft review reply, got ${latestSenderDraftReply.reply}.`);

    const approvalsBeforeReject = await approvalRequests(realUser.cookie);
    const pendingRejectItem = approvalsBeforeReject.find(
      (item) =>
        item.connectorId === "gmail" &&
        item.action === "create_gmail_draft" &&
        item.id !== approveId &&
        item.status === "pending",
    );
    assert(pendingRejectItem, "Expected a pending Gmail draft review to reject.");

    const rejectResult = await rejectApproval(realUser.cookie, pendingRejectItem.id);
    assert(rejectResult.response.status === 200, `Expected Gmail draft reject to succeed, got ${rejectResult.response.status}.`);
    assert(
      /No email was sent/i.test(rejectResult.json.message || ""),
      `Expected safe reject message, got ${rejectResult.json.message}.`,
    );

    const approvalsAfterReject = await approvalRequests(realUser.cookie);
    const rejectedItem = approvalsAfterReject.find((item) => item.id === pendingRejectItem.id);
    assert(rejectedItem?.status === "rejected", `Expected rejected status, got ${rejectedItem?.status}.`);

    const draftsAfterReject = await gmailDrafts(realUser.cookie);
    const rejectedDraft = draftsAfterReject.find((draft) => draft.id === pendingRejectItem.payload?.draftId);
    assert(rejectedDraft?.status === "rejected", `Expected draft rejected status, got ${rejectedDraft?.status}.`);

    const sendReply = await voice(realUser.cookie, "Send the email.");
    assert(sendReply.agent.intent === "gmail_send_blocked", `Expected gmail_send_blocked intent, got ${sendReply.agent.intent}.`);
    assert(/cannot send emails yet|create Gmail drafts after approval/i.test(sendReply.reply), `Expected blocked Gmail send reply, got ${sendReply.reply}.`);

    const attentionReply = await voice(realUser.cookie, "Amanda, what needs my attention today?");
    assert(attentionReply.agent.intent === "attention_summary", `Expected attention_summary intent, got ${attentionReply.agent.intent}.`);
    assert(/email|gmail|quote|complaint/i.test(attentionReply.reply), `Expected Gmail-aware attention reply, got ${attentionReply.reply}.`);

    const noImportantUser = await signup(2);
    await connectGmailThroughCallback(noImportantUser.cookie, {
      access_token: "readonly-access-token-2",
      expires_in: 3600,
      refresh_token: "readonly-refresh-token-2",
      scope: "https://www.googleapis.com/auth/gmail.readonly",
    });
    await syncGmailViaApiWithFixtures(noImportantUser.cookie, [
      {
        id: "msg_newsletter",
        from: "newsletter@example.com",
        subject: "Weekly digest",
        snippet: "Your weekly product digest and updates.",
        labels: ["INBOX"],
        threadId: "thread_newsletter",
      },
    ]);
    const noImportantReply = await voice(noImportantUser.cookie, "Draft replies for important emails.");
    assert(noImportantReply.agent.intent === "gmail_draft_replies", `Expected gmail_draft_replies intent for no-important case, got ${noImportantReply.agent.intent}.`);
    assert(noImportantReply.agent.gmail?.draftsCreated === 0, "Expected no drafts to be created for low-priority Gmail sync.");
    assert(/did not find any important gmail messages/i.test(noImportantReply.reply), `Expected honest no-important reply, got ${noImportantReply.reply}.`);

    const importantUser = await signup(3);
    await connectGmailThroughCallback(importantUser.cookie, {
      access_token: "read-only-access-token-3",
      expires_in: 3600,
      refresh_token: "read-only-refresh-token-3",
      scope: "https://www.googleapis.com/auth/gmail.readonly",
    });
    await syncGmailViaApiWithFixtures(importantUser.cookie, buildImportantGmailFixtures());
    const beforeImportantDebug = await getJson(`${baseUrl}/api/session/debug`, importantUser.cookie);
    assert(beforeImportantDebug.json.gmailConnected === true, "Expected Gmail to be connected for the important-message workspace.");
    assert(beforeImportantDebug.json.gmailMessagesCount === 12, `Expected 12 Gmail messages, got ${beforeImportantDebug.json.gmailMessagesCount}.`);
    assert(beforeImportantDebug.json.importantGmailMessagesCount >= 7, `Expected at least 7 important Gmail messages, got ${beforeImportantDebug.json.importantGmailMessagesCount}.`);
    assert(beforeImportantDebug.json.gmailDraftsCount === 0, `Expected 0 drafts before drafting, got ${beforeImportantDebug.json.gmailDraftsCount}.`);
    assert(beforeImportantDebug.json.pendingGmailApprovalCount === 0, `Expected 0 pending Gmail approvals before drafting, got ${beforeImportantDebug.json.pendingGmailApprovalCount}.`);

    for (const phrase of [
      "Draft replies for important emails.",
      "Draft replies for important Gmail emails.",
      "Create replies for important Gmail emails.",
      "Write replies for important Gmail emails.",
      "Create replies for important emails.",
      "Write replies for important emails.",
      "Draft important emails.",
      "Draught important emails.",
      "Draft important Gmail.",
      "Prepare important emails.",
    ]) {
      const routedReply = await voice(importantUser.cookie, phrase);
      assert(routedReply.agent.intent === "gmail_draft_replies", `Expected gmail_draft_replies intent for "${phrase}", got ${routedReply.agent.intent}.`);
      assert(routedReply.agent.routedTo === "gmail.draftRepliesForImportantEmails", `Expected Gmail draft tool route for "${phrase}", got ${routedReply.agent.routedTo}.`);
    }

    const importantDraftReply = await voice(importantUser.cookie, "Draft replies for important emails.");
    assert(importantDraftReply.agent.intent === "gmail_draft_replies", `Expected gmail_draft_replies intent, got ${importantDraftReply.agent.intent}.`);
    assert(importantDraftReply.agent.gmail?.syncedMessagesCount === 12, `Expected syncedMessagesCount 12, got ${importantDraftReply.agent.gmail?.syncedMessagesCount}.`);
    assert(importantDraftReply.agent.gmail?.importantCandidatesCount >= 7, `Expected at least 7 important candidates, got ${importantDraftReply.agent.gmail?.importantCandidatesCount}.`);
    assert(importantDraftReply.agent.gmail?.draftableMessagesCount >= 7, `Expected at least 7 draftable Gmail messages, got ${importantDraftReply.agent.gmail?.draftableMessagesCount}.`);
    assert(importantDraftReply.agent.gmail?.draftsCreated >= 1, "Expected one or more Gmail drafts to be created.");
    assert(importantDraftReply.agent.gmail?.approvalRequestsCreated >= 1, "Expected one or more Gmail approval requests to be created.");
    assert(/Approval Queue/i.test(importantDraftReply.reply), `Expected approval queue reply, got ${importantDraftReply.reply}.`);

    const afterImportantDebug = await getJson(`${baseUrl}/api/session/debug`, importantUser.cookie);
    assert(afterImportantDebug.json.gmailDraftsCount >= 1, `Expected drafts after drafting, got ${afterImportantDebug.json.gmailDraftsCount}.`);
    assert(afterImportantDebug.json.pendingGmailApprovalCount >= 1, `Expected pending Gmail approvals after drafting, got ${afterImportantDebug.json.pendingGmailApprovalCount}.`);

    const importantApprovals = await approvalRequests(importantUser.cookie);
    const importantGmailApprovals = importantApprovals.filter(
      (item) => item.connectorId === "gmail" && item.action === "create_gmail_draft" && item.status === "pending",
    );
    assert(importantGmailApprovals.length >= 1, "Expected pending Gmail draft approvals for important messages.");

    const latestEmailReply = await voice(importantUser.cookie, "Draft a reply to the latest Gmail email.");
    assert(latestEmailReply.agent.intent === "gmail_draft_latest_email", `Expected gmail_draft_latest_email intent, got ${latestEmailReply.agent.intent}.`);
    assert(latestEmailReply.agent.gmail?.draftsCreated === 1, `Expected one latest-email draft, got ${latestEmailReply.agent.gmail?.draftsCreated}.`);
    assert(latestEmailReply.agent.gmail?.approvalRequestsCreated === 1, `Expected one latest-email approval request, got ${latestEmailReply.agent.gmail?.approvalRequestsCreated}.`);
    assert(/Approval Queue/i.test(latestEmailReply.reply), `Expected latest Gmail email draft reply, got ${latestEmailReply.reply}.`);

    const latestEmailCreateReply = await voice(importantUser.cookie, "Create a reply for the latest Gmail email.");
    assert(latestEmailCreateReply.agent.intent === "gmail_draft_latest_email", `Expected gmail_draft_latest_email intent for latest create phrase, got ${latestEmailCreateReply.agent.intent}.`);
    assert(latestEmailCreateReply.agent.gmail?.draftsCreated === 1, `Expected one latest-email draft for create phrase, got ${latestEmailCreateReply.agent.gmail?.draftsCreated}.`);

    const latestPhraseUser = await signup(4);
    await connectGmailThroughCallback(latestPhraseUser.cookie, {
      access_token: "read-only-access-token-4",
      expires_in: 3600,
      refresh_token: "read-only-refresh-token-4",
      scope: "https://www.googleapis.com/auth/gmail.readonly",
    });
    await syncGmailViaApiWithFixtures(latestPhraseUser.cookie, buildImportantGmailFixtures());
    const beforeLatestPhraseDebug = await getJson(`${baseUrl}/api/session/debug`, latestPhraseUser.cookie);
    assert(beforeLatestPhraseDebug.json.gmailDraftsCount === 0, `Expected 0 latest-phrase drafts before drafting, got ${beforeLatestPhraseDebug.json.gmailDraftsCount}.`);
    assert(beforeLatestPhraseDebug.json.pendingGmailApprovalCount === 0, `Expected 0 latest-phrase approvals before drafting, got ${beforeLatestPhraseDebug.json.pendingGmailApprovalCount}.`);

    for (const phrase of [
      "Draught latest email.",
      "Draft latest email.",
      "Draft last email.",
      "Draught last email.",
      "Prepare latest email.",
      "Reply latest email.",
      "Create Gmail draft.",
      "Email draft.",
      "Gmail draft.",
    ]) {
      const phraseReply = await voice(latestPhraseUser.cookie, phrase);
      assert(phraseReply.agent.intent === "gmail_draft_latest_email", `Expected gmail_draft_latest_email intent for "${phrase}", got ${phraseReply.agent.intent}.`);
      assert(phraseReply.agent.routedTo === "gmail.draftLatestEmail", `Expected Gmail latest draft route for "${phrase}", got ${phraseReply.agent.routedTo}.`);
      assert(phraseReply.agent.gmail?.latestMessageFound === true, `Expected latestMessageFound=true for "${phrase}".`);
      assert(phraseReply.agent.gmail?.draftsCreated === 1, `Expected one latest-email draft for "${phrase}", got ${phraseReply.agent.gmail?.draftsCreated}.`);
      assert(phraseReply.agent.gmail?.approvalRequestsCreated === 1, `Expected one latest-email approval for "${phrase}", got ${phraseReply.agent.gmail?.approvalRequestsCreated}.`);
      assert(/Approval Queue/i.test(phraseReply.reply), `Expected Approval Queue reply for "${phrase}", got ${phraseReply.reply}.`);
    }

    const afterLatestPhraseDebug = await getJson(`${baseUrl}/api/session/debug`, latestPhraseUser.cookie);
    assert(afterLatestPhraseDebug.json.gmailDraftsCount >= 1, `Expected latest-phrase drafts after drafting, got ${afterLatestPhraseDebug.json.gmailDraftsCount}.`);
    assert(afterLatestPhraseDebug.json.pendingGmailApprovalCount >= 1, `Expected latest-phrase approvals after drafting, got ${afterLatestPhraseDebug.json.pendingGmailApprovalCount}.`);
    const latestPhraseApprovals = await approvalRequests(latestPhraseUser.cookie);
    const latestPhraseGmailApproval = latestPhraseApprovals.find(
      (item) => item.connectorId === "gmail" && item.action === "create_gmail_draft" && item.status === "pending",
    );
    assert(latestPhraseGmailApproval, "Expected latest-phrase Gmail draft approval to appear in the Approval Queue.");
    assert(latestPhraseGmailApproval.payload?.bodyPreview, "Expected latest-phrase approval to include bodyPreview.");
    assert(!latestPhraseGmailApproval.payload?.body, "Expected latest-phrase approval payload not to expose full draft body.");

    const composeDb = { ...emptyDb, connectorTokensByUser: {} };
    saveConnectorToken(composeDb, "user_compose", "gmail", {
      access_token: "compose-access-token",
      expires_in: 3600,
      refresh_token: "compose-refresh-token",
      scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose",
    });
    await withMockFetch(async (url, options = {}) => {
      const href = String(url);
      if (href.includes("/gmail/v1/users/me/drafts")) {
        const requestBody = JSON.parse(options.body);
        assert(requestBody?.message?.raw, "Expected Gmail draft request to include a raw message.");
        return new Response(JSON.stringify({
          id: "gmail_draft_provider_001",
          message: {
            id: "gmail_message_provider_001",
            threadId: "gmail_thread_provider_001",
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected fetch in Gmail draft creation test: ${href}`);
    }, async () => {
      const created = await createGmailDraft(composeDb, "user_compose", {
        body: "Hello, thank you for reaching out.",
        subject: "Re: Bulk order inquiry",
        to: "customer@example.com",
      });
      assert(created.draftId === "gmail_draft_provider_001", `Expected Gmail draft id, got ${created.draftId}.`);
      assert(created.messageId === "gmail_message_provider_001", `Expected Gmail message id, got ${created.messageId}.`);
      assert(created.threadId === "gmail_thread_provider_001", `Expected Gmail thread id, got ${created.threadId}.`);
    });

    console.log("Gmail read-only routing tests passed.");
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
