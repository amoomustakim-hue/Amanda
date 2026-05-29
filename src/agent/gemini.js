import { getAvailableTools } from "./tool-registry.js";

const DEFAULT_GEMINI_MODEL = "gemini-1.5-flash";

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function geminiConfigured() {
  return Boolean(cleanText(process.env.GEMINI_API_KEY) && typeof fetch === "function");
}

function geminiModel() {
  return cleanText(process.env.GEMINI_MODEL) || DEFAULT_GEMINI_MODEL;
}

function safeJsonText(value) {
  return JSON.stringify(value, null, 2);
}

function extractGeminiText(payload = {}) {
  const parts = payload.candidates?.[0]?.content?.parts || [];
  return parts.map((part) => part.text || "").join("\n").trim();
}

function parseJsonObject(text = "") {
  const cleaned = cleanText(text)
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Gemini response did not contain JSON.");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function callGeminiJson({ prompt, temperature = 0.2 }) {
  if (!geminiConfigured()) return null;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel())}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.GEMINI_TIMEOUT_MS || 8000));
  const response = await fetch(url, {
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }],
          role: "user",
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature,
      },
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!response.ok) {
    throw new Error(`Gemini request failed with ${response.status}`);
  }

  const payload = await response.json();
  const text = extractGeminiText(payload);
  return text ? parseJsonObject(text) : null;
}

function compactEmail(email = {}) {
  return {
    bodyPreview: cleanText(email.bodyPreview || email.snippet || "").slice(0, 1200),
    category: email.category || "",
    from: email.from || "",
    priority: email.priority || "",
    receivedAt: email.receivedAt || "",
    subject: email.subject || "",
  };
}

function compactContext(context = {}) {
  return {
    approvals: (context.approvals || []).slice(0, 8).map((item) => ({
      action: item.action,
      connectorId: item.connectorId,
      riskLevel: item.riskLevel,
      status: item.status,
      summary: item.summary || item.subject,
    })),
    calendar: (context.calendar || []).slice(0, 12).map((event) => ({
      end: event.end,
      location: event.location,
      start: event.start,
      status: event.status,
      title: event.title,
    })),
    gmail: (context.gmail || []).slice(0, 10).map(compactEmail),
    tasks: (context.tasks || []).slice(0, 10).map((task) => ({
      priority: task.priority,
      source: task.source,
      status: task.status,
      text: task.text || task.title,
    })),
  };
}

export async function generateAgentDecision({ userMessage, context = {}, availableTools = getAvailableTools() }) {
  const prompt = [
    "You are Amanda's reasoning brain for a small-business operations app.",
    "Return strict JSON only. Do not include markdown.",
    "Gemini thinks, but the backend executes tools and enforces approval policy.",
    "Choose one available tool or ask a clarification. Never claim external actions were completed.",
    "Allowed output shape:",
    '{"intent":"gmail.search_sender","confidence":0.92,"tool":"gmail.searchMessages","requiresApproval":false,"entities":{"sender":"Tunde"},"reply":"I will search Gmail for emails from Tunde."}',
    "Clarification shape:",
    '{"intent":"clarification","confidence":0.86,"requiresApproval":false,"missingFields":["time"],"reply":"What time should I schedule the meeting for?"}',
    `Available tools: ${safeJsonText(availableTools)}`,
    `Safe context: ${safeJsonText(compactContext(context))}`,
    `User message: ${userMessage}`,
  ].join("\n\n");

  return callGeminiJson({ prompt });
}

export async function summarizeBusinessContext({ gmail = [], calendar = [], approvals = [], tasks = [] }) {
  const prompt = [
    "Summarize this business context for Amanda. Return strict JSON only.",
    'Shape: {"summary":"...","signals":[{"title":"...","reason":"...","nextAction":"..."}]}',
    `Context: ${safeJsonText(compactContext({ approvals, calendar, gmail, tasks }))}`,
  ].join("\n\n");
  return callGeminiJson({ prompt });
}

export async function draftEmailReply({ email = {}, businessContext = {} }) {
  const prompt = [
    "Draft a concise, warm, professional Gmail reply for Amanda.",
    "Return strict JSON only. Do not say the email was sent.",
    'Shape: {"subject":"Re: ...","body":"..."}',
    `Email: ${safeJsonText(compactEmail(email))}`,
    `Business context: ${safeJsonText(compactContext(businessContext))}`,
  ].join("\n\n");
  return callGeminiJson({ prompt, temperature: 0.35 });
}

export async function rankAttentionItems({ signals = [] }) {
  const prompt = [
    "Rank these small-business attention signals for Amanda.",
    "Return strict JSON only.",
    'Shape: {"priorities":[{"title":"...","reason":"...","recommendedNextAction":"..."}]}',
    `Signals: ${safeJsonText(signals.slice(0, 20))}`,
  ].join("\n\n");
  return callGeminiJson({ prompt });
}

export async function rankAttentionSignals({ signals = [] }) {
  const prompt = [
    "Rank these small-business attention signals for Amanda's daily operator briefing.",
    "Return strict JSON only. Use only the provided ids. Do not include private details beyond the provided previews.",
    'Shape: {"summary":"You have 4 things that need attention today.","rankedItemIds":["attention_001"],"topRecommendation":"Start with ...","spokenReply":"You have 4 things that need attention today. First..."}',
    `Signals: ${safeJsonText(signals.slice(0, 12).map((signal) => ({
      description: signal.description,
      id: signal.id,
      priority: signal.priority,
      score: signal.score,
      source: signal.source,
      title: signal.title,
      type: signal.type,
    })))}`,
  ].join("\n\n");
  return callGeminiJson({ prompt });
}

export const geminiStatus = {
  configured: geminiConfigured,
  model: geminiModel,
};
