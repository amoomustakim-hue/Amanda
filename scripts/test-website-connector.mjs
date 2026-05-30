import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getUnifiedAttentionSummary } from "../src/agent/attention-engine.js";
import { routeIntent } from "../src/agent/intent-router.js";

const port = 3097;
const baseUrl = `http://localhost:${port}`;
const dbPath = join(tmpdir(), `amanda-website-connector-${Date.now()}.json`);
const DEMO_SECRET = "test-website-secret-001";

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
  if (!condition) throw new Error(message);
}

function extractCookie(response) {
  const setCookie = response.headers.get("set-cookie") || "";
  return setCookie.split(";")[0];
}

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not boot within ${timeoutMs}ms.`);
}

async function postJson(url, body, cookie = "") {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    method: "POST",
  });
  return response;
}

async function postWebhook(url, body, secret = "") {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      ...(secret ? { "x-amanda-website-secret": secret } : {}),
    },
    method: "POST",
  });
  return response;
}

async function getJson(url, cookie = "") {
  const response = await fetch(url, {
    headers: cookie ? { cookie } : {},
  });
  return response;
}

async function patchJson(url, body, cookie = "") {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    method: "PATCH",
  });
  return response;
}

// ─── Unit tests (no server needed) ──────────────────────────────────────────

function testVoiceRouting() {
  const cases = [
    ["What happened on my website today?", "website_events"],
    ["Check website events.", "website_events"],
    ["Show website leads.", "website_events"],
    ["Show abandoned checkouts.", "website_abandoned_checkouts"],
    ["Any failed payments?", "website_failed_payments"],
    ["Any delivery complaints?", "website_complaints"],
    ["Show high value website leads.", "website_high_value_leads"],
    ["Website summary.", "website_summary"],
  ];
  for (const [phrase, expected] of cases) {
    const result = routeIntent(phrase);
    assert(
      result.intent === expected,
      `Expected "${phrase}" → "${expected}", got "${result.intent}"`,
    );
  }
}

async function testAttentionEngineWebsiteSignals() {
  const now = new Date("2026-05-30T10:00:00.000Z");
  const businessData = {
    websiteEvents: [
      {
        createdAt: "2026-05-30T09:00:00.000Z",
        currency: "NGN",
        customerName: "Tunde Ade",
        email: "tunde@example.com",
        id: "web_evt_001",
        message: "Customer added a high-value bundle to cart but did not complete checkout.",
        priority: "high",
        product: "Premium Sneakers Bundle",
        source: "mock_ecommerce_website",
        status: "new",
        type: "abandoned_checkout",
        value: 500000,
      },
      {
        createdAt: "2026-05-30T08:30:00.000Z",
        currency: "NGN",
        customerName: "Mariam Bello",
        email: "mariam@example.com",
        id: "web_evt_002",
        message: "Payment failed for order.",
        priority: "high",
        source: "mock_ecommerce_website",
        status: "new",
        type: "failed_payment",
        value: 150000,
      },
      {
        createdAt: "2026-05-30T07:00:00.000Z",
        currency: "NGN",
        customerName: "Emeka Nwachukwu",
        email: "emeka@example.com",
        id: "web_evt_003",
        message: "New order placed.",
        priority: "medium",
        source: "mock_ecommerce_website",
        status: "new",
        type: "new_order",
        value: 45000,
      },
    ],
  };

  const summary = await getUnifiedAttentionSummary("user_test", {
    businessData,
    now,
    useGemini: false,
  });

  assert(
    summary.items.some((item) => item.type === "website_abandoned_checkout"),
    "Expected website_abandoned_checkout attention item.",
  );
  assert(
    summary.items.some((item) => item.type === "website_failed_payment"),
    "Expected website_failed_payment attention item.",
  );
  assert(
    summary.items.some((item) => item.source === "website"),
    "Expected at least one item with source=website.",
  );

  const abandoned = summary.items.find((item) => item.type === "website_abandoned_checkout");
  const failed = summary.items.find((item) => item.type === "website_failed_payment");
  assert(abandoned.score >= failed.score, "Abandoned checkout (₦500k) should score >= failed_payment (₦150k).");
  assert(abandoned.score === 92, `Expected abandoned_checkout score=92, got ${abandoned.score}.`);
  assert(failed.score === 88, `Expected failed_payment score=88, got ${failed.score}.`);

  const serialized = JSON.stringify(summary);
  assert(!serialized.includes("SECRET"), "No secrets in attention summary.");
}

// ─── Integration tests (requires running server) ─────────────────────────────

async function runIntegrationTests() {
  let serverProcess;
  try {
    await writeFile(dbPath, JSON.stringify(emptyDb));
    const { spawn } = await import("node:child_process");
    serverProcess = spawn("node", ["server.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AMANDA_DB_PATH: dbPath,
        AMANDA_SKIP_LISTEN: "false",
        NODE_ENV: "development",
        PORT: String(port),
        WEBSITE_CONNECTOR_SECRET: DEMO_SECRET,
      },
      stdio: "pipe",
    });

    serverProcess.stderr.on("data", () => {});
    serverProcess.stdout.on("data", () => {});
    await waitForServer(`${baseUrl}/api/health`);

    // Sign up a test user
    const signupRes = await postJson(`${baseUrl}/api/auth/signup`, {
      company: "Website Test Co",
      email: `website-test-${Date.now()}@example.com`,
      name: "Website Tester",
      password: "Test1234!",
    });
    assert(signupRes.ok || signupRes.status === 302, `Signup failed: ${signupRes.status}`);
    const cookie = extractCookie(signupRes);
    assert(cookie.includes("Amanda_session"), "Expected session cookie after signup.");

    // Test 1: POST valid abandoned_checkout event via session
    const postRes = await postJson(
      `${baseUrl}/api/connectors/website/events`,
      {
        currency: "NGN",
        customerName: "Tunde Ade",
        email: "tunde@example.com",
        message: "Customer added a high-value bundle to cart but did not complete checkout.",
        product: "Premium Sneakers Bundle",
        source: "mock_ecommerce_website",
        type: "abandoned_checkout",
        value: 500000,
      },
      cookie,
    );
    assert(postRes.status === 201, `Expected 201, got ${postRes.status}`);
    const postData = await postRes.json();
    assert(postData.ok === true, "Expected ok:true on event POST.");
    assert(postData.event.type === "abandoned_checkout", "Event type stored correctly.");
    assert(postData.event.priority === "high", "Priority derived as high for ₦500k abandoned_checkout.");
    assert(postData.event.value === 500000, "Value stored correctly.");
    assert(!JSON.stringify(postData).includes(DEMO_SECRET), "Secret not in event response.");
    const savedEventId = postData.event.id;

    // Test 2: GET events returns stored event
    const getRes = await getJson(`${baseUrl}/api/connectors/website/events`, cookie);
    assert(getRes.ok, `GET events failed: ${getRes.status}`);
    const getData = await getRes.json();
    assert(getData.ok === true, "Expected ok:true on GET events.");
    assert(Array.isArray(getData.events) && getData.events.length >= 1, "Expected at least one event.");
    const fetched = getData.events.find((e) => e.id === savedEventId);
    assert(fetched, "Stored event appears in GET response.");
    assert(fetched.status === "new", "Event starts with status=new.");

    // Test 3: GET summary returns correct counts
    const summaryRes = await getJson(`${baseUrl}/api/connectors/website/summary`, cookie);
    assert(summaryRes.ok, `GET summary failed: ${summaryRes.status}`);
    const summaryData = await summaryRes.json();
    assert(summaryData.ok === true, "Expected ok:true on GET summary.");
    assert(summaryData.summary.total >= 1, "Summary total >= 1.");
    assert(summaryData.summary.abandonedCheckouts >= 1, "Summary shows abandonedCheckouts.");
    assert(summaryData.summary.highPriority >= 1, "Summary shows highPriority >= 1.");
    assert(summaryData.summary.totalPotentialValue >= 500000, "Total potential value >= 500000.");

    // Test 4: PATCH status to reviewed
    const patchRes = await patchJson(
      `${baseUrl}/api/connectors/website/events/${savedEventId}`,
      { status: "reviewed" },
      cookie,
    );
    assert(patchRes.ok, `PATCH failed: ${patchRes.status}`);
    const patchData = await patchRes.json();
    assert(patchData.ok === true, "Expected ok:true on PATCH.");
    assert(patchData.event.status === "reviewed", "Status updated to reviewed.");

    // Test 5: Invalid type rejected
    const badTypeRes = await postJson(
      `${baseUrl}/api/connectors/website/events`,
      { type: "malicious_action", customerName: "Hacker" },
      cookie,
    );
    assert(badTypeRes.status === 400, `Expected 400 for invalid type, got ${badTypeRes.status}`);
    const badTypeData = await badTypeRes.json();
    assert(badTypeData.ok === false, "Expected ok:false for invalid type.");

    // Test 6: Webhook secret auth (no session, correct secret)
    const webhookRes = await postWebhook(
      `${baseUrl}/api/connectors/website/events`,
      {
        currency: "NGN",
        customerName: "Mariam Bello",
        email: "mariam@example.com",
        message: "Payment failed.",
        source: "mock_ecommerce_website",
        type: "failed_payment",
        value: 150000,
      },
      DEMO_SECRET,
    );
    assert(webhookRes.status === 201, `Webhook POST failed: ${webhookRes.status}`);
    const webhookData = await webhookRes.json();
    assert(webhookData.ok === true, "Webhook event accepted.");
    assert(webhookData.event.priority === "high", "Failed payment derived as high priority.");
    assert(!JSON.stringify(webhookData).includes(DEMO_SECRET), "Secret not in webhook response.");

    // Test 7: Wrong webhook secret rejected
    const badSecretRes = await postWebhook(
      `${baseUrl}/api/connectors/website/events`,
      { type: "new_order", customerName: "Test" },
      "wrong-secret",
    );
    assert(badSecretRes.status === 401, `Expected 401 for wrong secret, got ${badSecretRes.status}`);

    // Test 8: PATCH invalid status rejected
    const badStatusRes = await patchJson(
      `${baseUrl}/api/connectors/website/events/${savedEventId}`,
      { status: "deleted" },
      cookie,
    );
    assert(badStatusRes.status === 400, `Expected 400 for invalid status, got ${badStatusRes.status}`);

    // Test 9: GET events with query params
    const filteredRes = await getJson(
      `${baseUrl}/api/connectors/website/events?priority=high&type=failed_payment`,
      cookie,
    );
    assert(filteredRes.ok, "Filtered GET failed.");
    const filteredData = await filteredRes.json();
    for (const e of filteredData.events) {
      assert(e.priority === "high", "All filtered events are high priority.");
      assert(e.type === "failed_payment", "All filtered events are failed_payment.");
    }

  } finally {
    if (serverProcess) serverProcess.kill();
    await rm(dbPath, { force: true });
  }
}

// ─── Run all tests ───────────────────────────────────────────────────────────

testVoiceRouting();
await testAttentionEngineWebsiteSignals();
await runIntegrationTests();

console.log("Website connector tests passed.");
