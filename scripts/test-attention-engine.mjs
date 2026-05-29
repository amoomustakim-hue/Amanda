import { getUnifiedAttentionSummary } from "../src/agent/attention-engine.js";
import { routeIntent } from "../src/agent/intent-router.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function buildBusinessData() {
  return {
    actionLogs: [],
    approvalRequests: [
      {
        action: "create_event",
        connectorId: "google_calendar",
        createdAt: "2026-05-29T08:00:00.000Z",
        id: "approval_calendar_001",
        payload: {
          title: "Supplier meeting",
        },
        riskLevel: "medium",
        status: "pending",
        summary: "Create calendar event: Supplier meeting",
      },
      {
        action: "create_gmail_draft",
        connectorId: "gmail",
        createdAt: "2026-05-29T08:15:00.000Z",
        id: "approval_gmail_001",
        payload: {
          bodyPreview: "Hello Tunde, thanks for reaching out.",
          draftId: "gmail_draft_001",
          subject: "Re: Bulk order inquiry",
        },
        riskLevel: "low",
        status: "pending",
        summary: "Create Gmail draft: Re: Bulk order inquiry",
      },
    ],
    calendarEvents: [
      {
        createdAt: "2026-05-29T07:00:00.000Z",
        id: "calendar_event_001",
        location: "Lekki office",
        start: "2026-05-29T10:30:00.000Z",
        title: "Supplier meeting",
      },
    ],
    gmailDrafts: [
      {
        connectorId: "gmail",
        createdAt: "2026-05-29T08:10:00.000Z",
        id: "gmail_draft_001",
        messageId: "gmail_msg_001",
        status: "needs_approval",
        subject: "Re: Bulk order inquiry",
        to: "tunde@example.com",
      },
    ],
    gmailMessages: [
      {
        bodyPreview: "Customer asked for pricing. SECRET_FULL_BODY_SHOULD_NOT_LEAK",
        category: "quote_request",
        from: "Tunde <tunde@example.com>",
        id: "gmail_msg_001",
        needsReply: true,
        priority: "high",
        receivedAt: "2026-05-29T07:30:00.000Z",
        snippet: "Customer asked for pricing and delivery timeline.",
        status: "unread",
        subject: "Bulk order inquiry",
      },
    ],
    tasks: [
      {
        createdAt: "2026-05-28T09:00:00.000Z",
        dueAt: "2026-05-28T12:00:00.000Z",
        id: "task_001",
        priority: "high",
        status: "open",
        text: "Follow up with wholesale lead",
      },
    ],
  };
}

function buildDb() {
  return {
    agentMemoryByUser: { user_attention: {} },
    businessDataByUser: { user_attention: buildBusinessData() },
    connectorsByUser: {
      user_attention: [
        {
          id: "gmail",
          label: "Gmail",
          lastSyncedAt: "2026-05-27T08:00:00.000Z",
          mode: "real",
          status: "connected",
        },
      ],
    },
    connectorTokensByUser: {
      user_attention: [
        {
          accessTokenEncrypted: "super-secret-token",
          connectorId: "gmail",
          id: "tok_secret",
        },
      ],
    },
    integrationsByUser: { user_attention: [] },
    oauthStates: {},
    sessions: [
      {
        createdAt: "2026-05-29T08:00:00.000Z",
        expiresAt: "2026-06-01T08:00:00.000Z",
        id: "session_attention",
        userId: "user_attention",
      },
    ],
    settingsByUser: { user_attention: {} },
    tasksByUser: { user_attention: [] },
    transcriptsByUser: { user_attention: [] },
    users: [
      {
        company: "Attention Test Co",
        createdAt: "2026-05-29T08:00:00.000Z",
        email: "attention@example.com",
        id: "user_attention",
        name: "Attention Tester",
      },
    ],
  };
}

async function testDirectEngine() {
  const originalFetch = global.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "fake-key";
  global.fetch = async () => {
    throw new Error("Gemini unavailable");
  };
  try {
    const summary = await getUnifiedAttentionSummary("user_attention", {
      businessData: buildBusinessData(),
      connectors: buildDb().connectorsByUser.user_attention,
      now: new Date("2026-05-29T09:00:00.000Z"),
      useGemini: true,
    });
    assert(summary.items.some((item) => item.source === "gmail" && item.type === "email_needs_reply"), "Expected important Gmail attention item.");
    assert(summary.items.some((item) => item.type === "gmail_draft_waiting_review"), "Expected Gmail draft review attention item.");
    assert(summary.items.some((item) => item.type === "calendar_event_soon"), "Expected soon calendar event attention item.");
    assert(summary.items.some((item) => item.type === "calendar_approval_pending"), "Expected pending calendar approval item.");
    assert(summary.items[0].score >= summary.items[1].score, "Expected deterministic score ranking.");
    assert(summary.brain === "deterministic", "Expected Gemini failure fallback to deterministic ranking.");
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
}

function testVoiceRouting() {
  const routed = routeIntent("What needs my attention today?");
  assert(routed.intent === "attention_summary", "Expected attention_summary route.");
  assert(routed.routedTo === "attention.getUnifiedAttentionSummary", "Expected attention engine route.");
}

async function testApiPayloadSafety() {
  const db = buildDb();
  const summary = await getUnifiedAttentionSummary("user_attention", {
    businessData: db.businessDataByUser.user_attention,
    connectors: db.connectorsByUser.user_attention,
    now: new Date("2026-05-29T09:00:00.000Z"),
    useGemini: false,
  });
  const json = {
    generatedAt: summary.generatedAt,
    items: summary.items.slice(0, 10),
    ok: true,
    sources: summary.sources,
    spokenReply: summary.spokenReply,
    summary: summary.summary,
    topRecommendation: summary.topRecommendation,
  };
  const serialized = JSON.stringify(json);
  assert(json.ok === true, "Expected ok attention payload.");
  assert(Array.isArray(json.items) && json.items.length >= 4, "Expected multiple attention items.");
  assert(json.items[0].score >= json.items[1].score, "Expected API items ranked by score.");
  assert(json.summary, "Expected summary.");
  assert(json.spokenReply, "Expected spoken reply.");
  assert(!serialized.includes("super-secret-token"), "Token leaked in attention API payload.");
  assert(!serialized.includes("SECRET_FULL_BODY_SHOULD_NOT_LEAK"), "Full private email body leaked in attention API payload.");
}

await testDirectEngine();
testVoiceRouting();
await testApiPayloadSafety();

console.log("Attention engine tests passed.");
