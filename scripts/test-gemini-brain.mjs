import { generateAmandaResponse } from "../src/agent/brain.js";
import { createAmandaTools } from "../src/agent/tools.js";
import { enforceGeminiDecision } from "../src/agent/safety-policy.js";
import { getAvailableTools } from "../src/agent/tool-registry.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function geminiResponse(object) {
  return new Response(JSON.stringify({
    candidates: [
      {
        content: {
          parts: [{ text: JSON.stringify(object) }],
        },
      },
    ],
  }), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

function geminiTextResponse(text) {
  return new Response(JSON.stringify({
    candidates: [
      {
        content: {
          parts: [{ text }],
        },
      },
    ],
  }), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

function baseBusinessData() {
  return {
    actionLogs: [],
    approvalRequests: [],
    calendarEvents: [],
    connectors: [
      {
        id: "gmail",
        mode: "real",
        oauthScope: "https://www.googleapis.com/auth/gmail.readonly",
        status: "connected",
      },
    ],
    gmailDrafts: [],
    gmailMessages: [
      {
        bodyPreview: "Can you send pricing for 100 units and delivery to Lagos?",
        category: "quote_request",
        from: "Tunde <tunde@example.com>",
        id: "gmail_msg_001",
        needsReply: true,
        priority: "high",
        receivedAt: "2026-05-29T09:00:00.000Z",
        snippet: "Can you send pricing for 100 units and delivery to Lagos?",
        subject: "Bulk order inquiry",
      },
    ],
    tasks: [],
  };
}

async function withEnv(env, fn) {
  const previous = {};
  for (const key of Object.keys(env)) {
    previous[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function withMockFetch(handler, fn) {
  const original = global.fetch;
  global.fetch = handler;
  try {
    return await fn();
  } finally {
    global.fetch = original;
  }
}

function makeContext(message, businessData = baseBusinessData()) {
  return {
    businessData,
    memory: {},
    message,
    settings: {},
    tools: createAmandaTools({
      businessData,
      makeId: (prefix) => `${prefix}_${Math.random().toString(16).slice(2, 10)}`,
      userId: "user_test",
    }),
    transcripts: [],
    user: { company: "Amanda Test Co", id: "user_test", name: "Tester" },
    workspace: {},
  };
}

async function testGeminiUnavailableFallback() {
  await withEnv({ GEMINI_API_KEY: undefined }, async () => {
    const result = await generateAmandaResponse(makeContext("What random thing should I do next?"));
    assert(result.reply, "Expected local fallback reply when Gemini is unavailable.");
    assert(result.memory?.debugAgent?.brain !== "gemini", "Gemini should not be marked as active without API key.");
  });
}

async function testMalformedGeminiFallback() {
  await withEnv({ GEMINI_API_KEY: "fake-key", GEMINI_MODEL: "gemini-test" }, async () => {
    await withMockFetch(async () => geminiTextResponse("not-json"), async () => {
      const result = await generateAmandaResponse(makeContext("Please reason about a strange inbox thing."));
      assert(result.reply, "Expected fallback reply after malformed Gemini JSON.");
      assert(result.memory?.debugAgent?.geminiFallback, "Expected safe Gemini fallback debug note.");
    });
  });
}

async function testBlockedToolSuggestion() {
  await withEnv({ GEMINI_API_KEY: "fake-key", GEMINI_MODEL: "gemini-test" }, async () => {
    await withMockFetch(async () => geminiResponse({
      confidence: 0.91,
      entities: { recipient: "Tunde" },
      intent: "gmail.send_email",
      reply: "I will send the email.",
      requiresApproval: true,
      tool: "gmail.sendEmail",
    }), async () => {
      const result = await generateAmandaResponse(makeContext("Dispatch the note to Tunde now."));
      assert(result.reply.includes("cannot send emails"), "Expected backend safety policy to block Gmail sending.");
      assert(result.memory?.debugAgent?.safetyDecision === "blocked", "Expected blocked safety decision.");
    });
  });
}

async function testGmailDraftUsesGeminiWhenAvailable() {
  await withEnv({ GEMINI_API_KEY: "fake-key", GEMINI_MODEL: "gemini-test" }, async () => {
    await withMockFetch(async (_url, options = {}) => {
      const body = JSON.parse(options.body || "{}");
      const prompt = body.contents?.[0]?.parts?.[0]?.text || "";
      if (prompt.includes("Draft a concise")) {
        return geminiResponse({
          body: "Hello Tunde,\n\nThanks for reaching out. I can help with pricing for 100 units. Please confirm your delivery timeline and exact location so we can prepare the best quote.\n\nBest,\nAmanda",
          subject: "Re: Bulk order inquiry",
        });
      }
      return geminiResponse({
        confidence: 0.8,
        intent: "general",
        reply: "Fallback decision",
        requiresApproval: false,
        tool: "gmail.searchMessages",
      });
    }, async () => {
      const data = baseBusinessData();
      const result = await generateAmandaResponse(makeContext("Draft a reply to the latest Gmail email.", data));
      assert(result.drafts.length === 1, "Expected one local Gmail draft.");
      assert(result.drafts[0].body.includes("Hello Tunde"), "Expected Gemini-generated Gmail draft body.");
      assert(data.approvalRequests.length === 1, "Expected linked Gmail approval request.");
      assert(data.approvalRequests[0].payload.bodyPreview.includes("Hello Tunde"), "Expected approval preview to reflect Gemini body.");
      assert(result.memory?.debugAgent?.brain === "gemini", "Expected Gemini debug metadata on enhanced draft.");
    });
  });
}

function testToolRegistryAndSafety() {
  const tools = getAvailableTools();
  assert(tools.some((tool) => tool.name === "gmail.searchMessages"), "Expected Gmail search tool in registry.");
  assert(enforceGeminiDecision({ tool: "gmail.deleteEmail" }).blocked, "Expected delete email to be blocked.");
  assert(enforceGeminiDecision({ tool: "calendar.createEvent" }).requiresApproval, "Expected event creation to require approval.");
}

await testGeminiUnavailableFallback();
await testMalformedGeminiFallback();
await testBlockedToolSuggestion();
await testGmailDraftUsesGeminiWhenAvailable();
testToolRegistryAndSafety();

console.log("Gemini brain tests passed.");
