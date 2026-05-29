import "dotenv/config";
import { createServer } from "node:http";
import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import {
  access,
  mkdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateAmandaResponse } from "./src/agent/brain.js";
import { getUnifiedAttentionSummary } from "./src/agent/attention-engine.js";
import { routeIntent } from "./src/agent/intent-router.js";
import { createAmandaTools } from "./src/agent/tools.js";
import { defaultConnectorRecords } from "./src/connectors/adapters.js";
import { createConnectorSystem } from "./src/connectors/system.js";
import {
  buildGmailAuthUrl,
  createGmailDraft,
  gmailAccessState,
  exchangeGmailCodeForTokens,
  gmailSetupStatus,
  hasGmailComposeScope,
  publicGmailTokenStatus,
  searchGmailMessages,
  syncGmailMessages,
} from "./src/connectors/gmail.js";
import {
  createGoogleCalendarAuthUrl,
  createEvent as createGoogleCalendarEvent,
  deleteConnectorToken,
  exchangeGoogleCalendarCode,
  hasGoogleCalendarEventWriteScope,
  googleCalendarSetupStatus,
  publicTokenStatus,
  saveConnectorToken,
  syncEvents as syncGoogleCalendarEvents,
} from "./src/connectors/google-calendar.js";

const scrypt = promisify(scryptCallback);

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 3000);
const dbPath = process.env.AMANDA_DB_PATH
  ? resolve(process.env.AMANDA_DB_PATH)
  : join(root, "data", "db.json");
const dataDir = dirname(dbPath);
const sessionTtlMs = 1000 * 60 * 60 * 24 * 7;
const cacheTtlMs = 1000 * 30;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const fileCache = new Map();
const responseCache = new Map();

let dbCache = null;
let writeChain = Promise.resolve();

function isDemoMode() {
  return process.env.AMANDA_DEMO_MODE === "true";
}

function isDemoRecord(item = {}) {
  if (!item || typeof item !== "object") return false;
  if (item.isDemo === true || item.source === "demo" || item.mode === "mock" || item.mode === "demo") {
    return true;
  }
  const id = String(item.id || "");
  const demoIds = [
    "msg_northline",
    "msg_brightcart",
    "msg_greenmarket",
    "draft_northline",
    "lead_atlas",
    "lead_pine",
    "lead_local_ops",
    "ord_1234",
    "ord_1288",
    "ord_1302",
    "task_support_queue",
    "task_wholesale_lead",
    "task_order_review",
    "log_bootstrap",
    "log_triage",
  ];
  return demoIds.some((prefix) => id.startsWith(prefix));
}

function nonDemoRecords(items = []) {
  return items.filter((item) => !isDemoRecord(item));
}

function visibleRecords(items = []) {
  return isDemoMode() ? items : nonDemoRecords(items);
}

function visibleBusinessData(data = {}) {
  if (isDemoMode()) return data;
  const next = { ...data };
  for (const key of [
    "actionLogs",
    "approvalRequests",
    "drafts",
    "gmailDrafts",
    "gmailMessages",
    "leads",
    "messages",
    "orders",
    "records",
    "summaries",
    "tasks",
  ]) {
    next[key] = visibleRecords(data[key] || []);
  }
  next.customerMessages = next.messages;
  return next;
}

function normalizeApprovalStatus(status) {
  return status === "needs_approval" ? "pending" : status || "pending";
}

function isPendingApproval(item = {}) {
  return normalizeApprovalStatus(item.status) === "pending";
}

function ensureGmailDraftApprovalRequest(data, draft, makeId) {
  if (!draft || draft.connectorId !== "gmail") return null;
  if (!Array.isArray(data.approvalRequests)) data.approvalRequests = [];
  const requests = data.approvalRequests;
  let approval = requests.find(
    (item) =>
      item.connectorId === "gmail" &&
      ["create_gmail_draft", "review_local_draft"].includes(item.action) &&
      item.payload?.draftId === draft.id &&
      item.status !== "dismissed",
  );
  const approvalStatus =
    draft.status === "needs_approval"
      ? "pending"
      : draft.status === "approved_local"
        ? "approved_local"
        : draft.status === "created_in_gmail"
          ? "approved"
        : draft.status === "rejected"
          ? "rejected"
          : draft.status;
  if (!approval) {
    approval = {
      action: "create_gmail_draft",
      connectorId: "gmail",
      createdAt: draft.createdAt || new Date().toISOString(),
      id: makeId("approval"),
      payload: {
        bodyPreview: String(draft.body || "").slice(0, 240),
        draftId: draft.id,
        gmailDraftId: draft.gmailDraftId || "",
        messageId: draft.messageId,
        subject: draft.subject,
        to: draft.to,
      },
      reason: "Create this approved Amanda draft in Gmail Drafts. No email will be sent.",
      riskLevel: "low",
      source: draft.source || "gmail",
      status: approvalStatus,
      subject: `Create Gmail draft: ${draft.subject || "Draft reply"}`,
      summary: `Create Gmail draft: ${draft.subject || "Draft reply"}`,
      type: "gmail_draft_review",
      updatedAt: new Date().toISOString(),
      userId: draft.userId || "",
    };
    requests.push(approval);
  } else {
    approval.action = "create_gmail_draft";
    approval.payload = {
      ...approval.payload,
      bodyPreview: String(draft.body || "").slice(0, 240),
      draftId: draft.id,
      gmailDraftId: draft.gmailDraftId || approval.payload?.gmailDraftId || "",
      messageId: draft.messageId,
      subject: draft.subject,
      to: draft.to,
    };
    approval.status = approvalStatus;
    approval.subject = `Create Gmail draft: ${draft.subject || "Draft reply"}`;
    approval.summary = approval.subject;
    approval.reason = "Create this approved Amanda draft in Gmail Drafts. No email will be sent.";
    approval.updatedAt = new Date().toISOString();
  }
  draft.approvalRequestId = approval.id;
  return approval;
}

const pageMap = new Map([
  ["/", "index.html"],
  ["/dashboard", "dashboard.html"],
  ["/dashboard.html", "dashboard.html"],
  ["/connectors", "connectors.html"],
  ["/connectors.html", "connectors.html"],
  ["/login", "login.html"],
  ["/login.html", "login.html"],
  ["/onboarding", "onboarding-identity.html"],
  ["/onboarding/identity", "onboarding-identity.html"],
  ["/onboarding-identity.html", "onboarding-identity.html"],
  ["/onboarding/knowledge", "onboarding-knowledge.html"],
  ["/onboarding-knowledge.html", "onboarding-knowledge.html"],
  ["/onboarding/specialization", "onboarding-specialization.html"],
  ["/onboarding-specialization.html", "onboarding-specialization.html"],
  ["/onboarding/workspace", "onboarding-knowledge.html"],
  ["/settings", "settings.html"],
  ["/settings.html", "settings.html"],
  ["/signup", "signup.html"],
  ["/signup.html", "signup.html"],
  ["/transcript", "transcript.html"],
  ["/transcript.html", "transcript.html"],
  ["/voice", "voice.html"],
  ["/voice.html", "voice.html"],
  ["/workspace", "workspace.html"],
  ["/workspace.html", "workspace.html"],
]);

const protectedRoutes = new Set([
  "/dashboard",
  "/dashboard.html",
  "/connectors",
  "/connectors.html",
  "/onboarding",
  "/onboarding/identity",
  "/onboarding-identity.html",
  "/onboarding/knowledge",
  "/onboarding-knowledge.html",
  "/onboarding/specialization",
  "/onboarding-specialization.html",
  "/onboarding/workspace",
  "/settings",
  "/settings.html",
  "/transcript",
  "/transcript.html",
  "/voice",
  "/voice.html",
  "/workspace",
  "/workspace.html",
]);

function emptyDb() {
  return {
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
}

async function ensureDb() {
  await mkdir(dataDir, { recursive: true });
  try {
    await access(dbPath);
  } catch {
    await writeFile(dbPath, JSON.stringify(emptyDb(), null, 2), "utf8");
  }
}

async function loadDb() {
  if (dbCache) return dbCache;
  await ensureDb();
  const raw = await readFile(dbPath, "utf8");
  dbCache = JSON.parse(raw);
  cleanupSessions(dbCache);
  return dbCache;
}

function queueWrite() {
  writeChain = writeChain.then(async () => {
    if (!dbCache) return;
    await writeFile(dbPath, JSON.stringify(dbCache, null, 2), "utf8");
  });
  return writeChain;
}

function cleanupSessions(db) {
  const now = Date.now();
  db.sessions = db.sessions.filter((session) => session.expiresAt > now);
}

function makeId(prefix) {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

function parseCookies(request) {
  const header = request.headers.cookie || "";
  return Object.fromEntries(
    header
      .split(";")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const index = entry.indexOf("=");
        return [entry.slice(0, index), decodeURIComponent(entry.slice(index + 1))];
      }),
  );
}

function redirect(response, location) {
  response.writeHead(302, { Location: location });
  response.end();
}

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    ...extraHeaders,
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "text/plain; charset=utf-8",
  });
  response.end(text);
}

async function parseBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const derived = await scrypt(password, salt, 64);
  return {
    hash: Buffer.from(derived).toString("hex"),
    salt,
  };
}

async function verifyPassword(password, user) {
  const derived = await scrypt(password, user.passwordSalt, 64);
  const a = Buffer.from(derived);
  const b = Buffer.from(user.passwordHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function sanitizeUser(user) {
  return {
    company: user.company,
    createdAt: user.createdAt,
    email: user.email,
    id: user.id,
    name: user.name,
  };
}

function bootstrapForUser(db, user) {
  ensureUserDefaults(db, user);
  const businessData = visibleBusinessData(db.businessDataByUser[user.id]);
  return {
    agentMemory: db.agentMemoryByUser[user.id],
    businessDataSummary: summarizeBusinessData(businessData),
    debugVoice: process.env.AMANDA_DEBUG_VOICE === "true",
    demoMode: isDemoMode(),
    integrations: isDemoMode() ? db.integrationsByUser[user.id] : visibleRecords(db.integrationsByUser[user.id] || []),
    nodeEnv: process.env.NODE_ENV || "production",
    settings: db.settingsByUser[user.id],
    tasks: isDemoMode() ? db.tasksByUser[user.id] : visibleRecords(db.tasksByUser[user.id] || []),
    transcriptPreview: db.transcriptsByUser[user.id].slice(-6),
    user: sanitizeUser(user),
  };
}

function ensureUserDefaults(db, user) {
  if (!db.agentMemoryByUser) db.agentMemoryByUser = {};
  if (!db.businessDataByUser) db.businessDataByUser = {};
  if (!db.connectorsByUser) db.connectorsByUser = {};
  if (!db.connectorTokensByUser) db.connectorTokensByUser = {};
  if (!db.integrationsByUser) db.integrationsByUser = {};
  if (!db.oauthStates) db.oauthStates = {};
  if (!db.settingsByUser) db.settingsByUser = {};
  if (!db.tasksByUser) db.tasksByUser = {};
  if (!db.transcriptsByUser) db.transcriptsByUser = {};

  if (!db.tasksByUser[user.id]) {
    db.tasksByUser[user.id] = isDemoMode() ? [
      { id: makeId("task"), source: "Shopify", status: "thinking", text: "Drafting reply to Order #1234" },
      { id: makeId("task"), source: "Salesforce", status: "queued", text: "Updating CRM records" },
      { id: makeId("task"), source: "Intercom", status: "success", text: "Analyzing sentiment on Ticket #882" },
    ] : [];
  }
  if (!db.integrationsByUser[user.id]) {
    db.integrationsByUser[user.id] = isDemoMode() ? [
      { id: "shopify", label: "Shopify", status: "Connected" },
      { id: "salesforce", label: "Salesforce", status: "Connected" },
      { id: "intercom", label: "Intercom", status: "Connected" },
    ] : [];
  }
  if (!db.settingsByUser[user.id]) {
    db.settingsByUser[user.id] = {
      persona: "Professional",
      reasoningIntensity: 75,
      tone: "Professional",
      voice: "Lumina Female",
    };
  }
  if (!db.transcriptsByUser[user.id]) {
    db.transcriptsByUser[user.id] = [
      {
        id: makeId("entry"),
        role: "assistant",
        text: `Welcome to Amanda, ${user.name}. Your workspace is ready.`,
        timestamp: new Date().toISOString(),
      },
    ];
  }
  if (!db.businessDataByUser[user.id]) {
    db.businessDataByUser[user.id] = defaultBusinessData(user);
  } else {
    db.businessDataByUser[user.id] = normalizeBusinessData(user, db.businessDataByUser[user.id]);
  }
  if (!db.connectorsByUser[user.id]) {
    db.connectorsByUser[user.id] = db.businessDataByUser[user.id].connectors?.length
      ? db.businessDataByUser[user.id].connectors
      : defaultConnectorRecords({ demoMode: isDemoMode() });
  }
  db.businessDataByUser[user.id].connectors = db.connectorsByUser[user.id];
  if (!db.agentMemoryByUser[user.id]) {
    db.agentMemoryByUser[user.id] = {
      lastIntent: null,
      lastUserMessage: null,
      notes: [],
      openLoops: [
        "Review urgent support queue",
        "Follow up with the highest-fit sales lead",
      ],
      updatedAt: new Date().toISOString(),
    };
  }
  if (!db.businessDataByUser[user.id].integrations?.length) {
    db.businessDataByUser[user.id].integrations = db.integrationsByUser[user.id];
  }
}

function defaultBusinessData(user) {
  const createdAt = new Date().toISOString();
  if (!isDemoMode()) {
    return {
      calendarEvents: [],
      calendarWindows: [],
      customers: [],
      gmailDrafts: [],
      gmailMessages: [],
      messages: [],
      customerMessages: [],
      leads: [],
      orders: [],
      tasks: [],
      drafts: [],
      summaries: [],
      integrations: [],
      connectors: defaultConnectorRecords({ demoMode: false }),
      actionLogs: [],
      approvalRequests: [],
      records: [],
      updatedAt: createdAt,
    };
  }
  return {
    calendarWindows: [
      {
        label: "Today 2:30 PM",
        reason: "it leaves a 30-minute buffer after the operations review",
      },
      {
        label: "Tomorrow 10:00 AM",
        reason: "it is open before the first customer block",
      },
    ],
    calendarEvents: [],
    customers: [
      {
        company: "Northline Retail",
        email: "maya@northline.example",
        id: "cust_northline",
        lifetimeValue: 18400,
        name: "Maya Okafor",
        tags: ["wholesale", "priority"],
      },
      {
        company: "BrightCart",
        email: "evan@brightcart.example",
        id: "cust_brightcart",
        lifetimeValue: 7200,
        name: "Evan Brooks",
        tags: ["growth", "pricing"],
      },
      {
        company: "Green Market",
        email: "tola@greenmarket.example",
        id: "cust_greenmarket",
        lifetimeValue: 5300,
        name: "Tola Adeyemi",
        tags: ["repeat buyer"],
      },
    ],
    messages: [
      {
        body: "We still have not seen the delivery scan for the wholesale order. Can someone confirm if this is moving today?",
        channel: "Intercom",
        createdAt,
        customerId: "cust_northline",
        id: "msg_northline_delivery",
        needsReply: true,
        orderId: "ord_1234",
        priority: "high",
        sentiment: "concerned",
        status: "unanswered",
        subject: "Wholesale delivery confirmation",
        isDemo: true,
        source: "demo",
      },
      {
        body: "Thanks, that answer helps. We will review with the team.",
        channel: "Intercom",
        createdAt,
        customerId: "cust_greenmarket",
        id: "msg_greenmarket_thanks",
        needsReply: false,
        priority: "medium",
        sentiment: "positive",
        status: "answered",
        subject: "Repeat purchase question",
        isDemo: true,
        source: "demo",
      },
    ],
    gmailMessages: [
      {
        bodyPreview: "Hi, I want to know your price for 50 units and the delivery timeline.",
        category: "quote_request",
        connectorId: "gmail",
        from: "evan@brightcart.example",
        id: "gmail_msg_brightcart_quote",
        labels: ["INBOX", "UNREAD"],
        needsReply: true,
        priority: "high",
        providerMessageId: "gmail_provider_brightcart_quote",
        receivedAt: createdAt,
        snippet: "Hi, I want to know your price for 50 units and the delivery timeline.",
        source: "demo",
        status: "unread",
        subject: "Bulk order inquiry",
        syncedAt: createdAt,
        threadId: "gmail_thread_brightcart_quote",
        to: user.email,
        userId: user.id,
      },
      {
        bodyPreview: "Our delivery arrived damaged and we need help resolving this quickly.",
        category: "customer_complaint",
        connectorId: "gmail",
        from: "support@northline.example",
        id: "gmail_msg_northline_complaint",
        labels: ["INBOX", "UNREAD"],
        needsReply: true,
        priority: "high",
        providerMessageId: "gmail_provider_northline_complaint",
        receivedAt: createdAt,
        snippet: "Our delivery arrived damaged and we need help resolving this quickly.",
        source: "demo",
        status: "unread",
        subject: "Delivery issue with last shipment",
        syncedAt: createdAt,
        threadId: "gmail_thread_northline_complaint",
        to: user.email,
        userId: user.id,
      },
      {
        bodyPreview: "Weekly product digest and tips for your store.",
        category: "newsletter",
        connectorId: "gmail",
        from: "newsletter@example.com",
        id: "gmail_msg_newsletter",
        labels: ["INBOX"],
        needsReply: false,
        priority: "low",
        providerMessageId: "gmail_provider_newsletter",
        receivedAt: createdAt,
        snippet: "Weekly product digest and tips for your store.",
        source: "demo",
        status: "read",
        subject: "Weekly industry digest",
        syncedAt: createdAt,
        threadId: "gmail_thread_newsletter",
        to: user.email,
        userId: user.id,
      },
    ],
    leads: [
      {
        company: "Atlas Home Goods",
        createdAt,
        id: "lead_atlas",
        name: "Jordan Lee",
        nextStep: "send a concise ROI follow-up with two implementation options",
        score: 91,
        stage: "qualified",
        value: 24000,
        isDemo: true,
        source: "demo",
      },
      {
        company: "Pine & Co.",
        createdAt,
        id: "lead_pine",
        name: "Samira Bello",
        nextStep: "book a discovery call around inventory automation",
        score: 84,
        stage: "demo requested",
        value: 18000,
        isDemo: true,
        source: "demo",
      },
      {
        company: user.company || "Local Retail Group",
        createdAt,
        id: "lead_local_ops",
        name: "Operations Team",
        nextStep: "confirm workflow requirements",
        score: 76,
        stage: "needs context",
        value: 9600,
        isDemo: true,
        source: "demo",
      },
    ],
    orders: [
      {
        createdAt,
        customerId: "cust_northline",
        id: "ord_1234",
        issue: "carrier scan has not updated in 18 hours",
        priority: "high",
        publicId: "Order #1234",
        status: "delayed",
        total: 1280,
        isDemo: true,
        source: "demo",
      },
      {
        createdAt,
        customerId: "cust_brightcart",
        id: "ord_1288",
        issue: "inventory count should be verified before fulfillment",
        priority: "medium",
        publicId: "Order #1288",
        status: "review",
        total: 640,
        isDemo: true,
        source: "demo",
      },
      {
        createdAt,
        customerId: "cust_greenmarket",
        id: "ord_1302",
        issue: "delivered successfully",
        priority: "low",
        publicId: "Order #1302",
        status: "delivered",
        total: 218,
        isDemo: true,
        source: "demo",
      },
    ],
    tasks: [
      {
        createdAt,
        id: "task_support_queue",
        priority: "high",
        source: "Intercom",
        status: "open",
        text: "Reply to Northline Retail about delayed wholesale delivery",
        isDemo: true,
        source: "demo",
      },
      {
        createdAt,
        id: "task_wholesale_lead",
        priority: "high",
        source: "Salesforce",
        status: "open",
        text: "Follow up with Atlas Home Goods wholesale lead",
        isDemo: true,
        source: "demo",
      },
      {
        createdAt,
        id: "task_order_review",
        priority: "medium",
        source: "Shopify",
        status: "open",
        text: "Verify inventory before fulfilling Order #1288",
        isDemo: true,
        source: "demo",
      },
    ],
    drafts: [
      {
        body: "Hi Maya,\n\nI checked Order #1234 and the carrier scan has not updated in 18 hours. I am flagging this with operations and will send the next update as soon as the carrier status refreshes.\n\nThanks for your patience,\nAmanda",
        channel: "Intercom",
        createdAt,
        customerId: "cust_northline",
        id: "draft_northline_delivery",
        messageId: "msg_northline_delivery",
        status: "needs_approval",
        subject: "Re: Wholesale delivery confirmation",
        isDemo: true,
        source: "demo",
      },
    ],
    gmailDrafts: [],
    summaries: [],
    integrations: [
      { id: "shopify", label: "Shopify", status: "Connected" },
      { id: "salesforce", label: "Salesforce", status: "Connected" },
      { id: "intercom", label: "Intercom", status: "Connected" },
      { id: "gmail", label: "Gmail", status: "Demo data" },
      { id: "calendar", label: "Calendar", status: "Demo data" },
    ],
    connectors: defaultConnectorRecords({ demoMode: true }).map((connector) =>
      connector.id === "gmail"
        ? { ...connector, mode: "demo", source: "demo", status: "Demo data" }
        : connector
    ),
    actionLogs: [
      {
        action: "bootstrapWorkspace",
        createdAt,
        detail: { note: "Demo operations workspace initialized" },
        id: "log_bootstrap",
        isDemo: true,
        source: "demo",
      },
      {
        action: "triageMessages",
        createdAt,
        detail: { count: 2, status: "unanswered" },
        id: "log_triage",
        isDemo: true,
        source: "demo",
      },
    ],
    approvalRequests: [],
    records: [
      {
        id: "CRM-2041",
        note: "High-intent buyer asked about multi-location rollout.",
        owner: "Sales",
        isDemo: true,
        source: "demo",
      },
    ],
    updatedAt: new Date().toISOString(),
  };
}

function normalizeBusinessData(user, existing = {}) {
  const defaults = defaultBusinessData(user);
  const next = {
    ...defaults,
    ...existing,
  };

  if (existing.customerMessages && !existing.messages) {
    next.messages = existing.customerMessages.map((message, index) => ({
      body: message.body || `Customer asked about ${message.topic || "their account"}.`,
      channel: message.channel || "Intercom",
      createdAt: message.createdAt || defaults.updatedAt,
      customerId: message.customerId || defaults.customers[index]?.id || "cust_northline",
      id: message.id || `msg_legacy_${index}`,
      needsReply: message.needsReply ?? true,
      priority: message.priority || "medium",
      sentiment: message.sentiment || "neutral",
      status: message.status || "unanswered",
      subject: message.subject || message.topic || "Customer message",
    }));
  }

  for (const key of [
    "actionLogs",
    "approvalRequests",
    "calendarEvents",
    "calendarWindows",
    "customers",
    "drafts",
    "gmailDrafts",
    "gmailMessages",
    "integrations",
    "connectors",
    "leads",
    "messages",
    "orders",
    "records",
    "summaries",
    "tasks",
  ]) {
    if (!Array.isArray(next[key])) next[key] = defaults[key] || [];
  }

  next.customerMessages = next.messages;
  next.updatedAt = next.updatedAt || defaults.updatedAt;
  return next;
}

function summarizeBusinessData(data = {}) {
  return {
    calendarWindows: data.calendarWindows?.length || 0,
    customers: data.customers?.length || 0,
    customerMessages: data.messages?.length || data.customerMessages?.length || 0,
    draftsNeedingApproval: data.drafts?.filter((item) => item.status === "needs_approval").length || 0,
    gmailDraftsNeedingApproval: data.gmailDrafts?.filter((item) => item.status === "needs_approval").length || 0,
    gmailImportant: data.gmailMessages?.filter((item) => item.priority === "high").length || 0,
    gmailNeedsReply: data.gmailMessages?.filter((item) => item.needsReply).length || 0,
    gmailUnread: data.gmailMessages?.filter((item) => item.status === "unread").length || 0,
    highPriorityMessages:
      (data.messages || data.customerMessages || []).filter((item) => item.priority === "high").length || 0,
    leads: data.leads?.length || 0,
    openTasks: data.tasks?.filter((item) => item.status === "open").length || 0,
    openOrders: data.orders?.filter((item) => item.status !== "delivered").length || 0,
    records: data.records?.length || 0,
    connectors: data.connectors?.length || 0,
    connectedConnectors:
      data.connectors?.filter((item) => item.mode !== "not_connected").length || 0,
    updatedAt: data.updatedAt || null,
  };
}

function connectorRecordFor(data, connectorId) {
  if (!Array.isArray(data.connectors)) data.connectors = defaultConnectorRecords({ demoMode: isDemoMode() });
  let connector = data.connectors.find((item) => item.id === connectorId);
  if (!connector) {
    connector = defaultConnectorRecords({ demoMode: isDemoMode() }).find((item) => item.id === connectorId);
    if (connector) data.connectors.push(connector);
  }
  return connector || null;
}

function gmailStatusLabel(scope = "", hasAccessToken = false) {
  const state = gmailAccessState(scope, hasAccessToken);
  if (state === "compose_enabled") return "Draft creation enabled";
  if (state === "read_only_connected") return "Read-only connected";
  if (state === "missing_compose_scope") return "Compose scope missing";
  return "Not connected";
}

function buildGmailSearchQuery(route = {}, transcript = "") {
  const entities = route.entities || {};
  const sender = String(entities.senderNameOrEmail || "").trim();
  const keyword = String(entities.keyword || "").trim();
  if (route.intent === "gmail_search_sender" || route.intent === "gmail_summarize_sender" || route.intent === "gmail_draft_reply_to_sender") {
    return sender ? `from:${sender} newer_than:30d` : "newer_than:30d in:inbox";
  }
  if (route.intent === "gmail_search_keyword") {
    const term = keyword || String(entities.query || "").trim() || transcript.trim();
    return term ? `"${term}" newer_than:30d in:inbox` : "newer_than:30d in:inbox";
  }
  return String(entities.query || "").trim() || "";
}

function mergeLocalGmailMessages(data, messages = []) {
  if (!Array.isArray(data.gmailMessages)) data.gmailMessages = [];
  const byId = new Map(
    data.gmailMessages.map((message) => [message.providerMessageId || message.id, message]),
  );
  for (const message of messages) {
    const key = message.providerMessageId || message.id;
    byId.set(key, {
      ...(byId.get(key) || {}),
      ...message,
      syncedAt: new Date().toISOString(),
    });
  }
  data.gmailMessages = Array.from(byId.values())
    .sort((a, b) => String(b.receivedAt || "").localeCompare(String(a.receivedAt || "")));
  data.updatedAt = new Date().toISOString();
}

function decorateConnector(db, userId, connector) {
  if (!connector) return connector;
  if (connector.id === "google_calendar") {
    const credential = publicTokenStatus(db, userId, "google_calendar");
    const connected = Boolean(credential.hasAccessToken);
    const writeCapability = connected
      ? credential.writeCapability || (hasGoogleCalendarEventWriteScope(credential.scope) ? "event_write_enabled" : "missing_write_scope")
      : "disconnected";
    return {
      ...connector,
      calendarAccess: {
        canCreateEvents: writeCapability === "event_write_enabled",
        state: connected
          ? writeCapability === "event_write_enabled"
            ? "event_write_enabled"
            : "read_only"
          : "disconnected",
        writeCapability,
      },
      credentialStatus: {
        canRefresh: credential.hasRefreshToken,
        connected,
        expiresAt: credential.expiresAt,
        scope: credential.scope,
        writeCapability,
      },
      oauth: googleCalendarSetupStatus(),
    };
  }
  if (connector.id === "gmail") {
    const credential = publicGmailTokenStatus(db, userId);
    const connected = Boolean(credential.hasAccessToken);
    const data = db.businessDataByUser[userId] || {};
    return {
      ...connector,
      credentialStatus: {
        canRefresh: credential.hasRefreshToken,
        connected,
        connectionState: credential.connectionState,
        draftCapability: credential.draftCapability,
        expiresAt: credential.expiresAt,
        scope: credential.scope,
      },
      gmailAccess: {
        canCreateDrafts: credential.composeEnabled,
        connectionState: credential.connectionState,
        label: gmailStatusLabel(credential.scope, credential.hasAccessToken),
      },
      gmailStats: {
        messagesSynced: data.gmailMessages?.length || 0,
        draftsWaiting: data.gmailDrafts?.filter((item) => item.status === "needs_approval").length || 0,
        important: data.gmailMessages?.filter((item) => item.priority === "high").length || 0,
        unread: data.gmailMessages?.filter((item) => item.status === "unread").length || 0,
      },
      oauth: gmailSetupStatus(),
      status: connected ? gmailStatusLabel(credential.scope, credential.hasAccessToken) : connector.status,
    };
  }
  return connector;
}

function decorateConnectors(db, userId, connectors) {
  return connectors.map((connector) => decorateConnector(db, userId, connector));
}

function cleanupOAuthStates(db) {
  if (!db.oauthStates) db.oauthStates = {};
  const now = Date.now();
  for (const [state, record] of Object.entries(db.oauthStates)) {
    if (!record?.expiresAt || new Date(record.expiresAt).getTime() <= now) {
      delete db.oauthStates[state];
    }
  }
}

function createOAuthState(db, userId, connectorId = "google_calendar") {
  cleanupOAuthStates(db);
  const state = randomBytes(24).toString("hex");
  db.oauthStates[state] = {
    connectorId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 10).toISOString(),
    userId,
  };
  return state;
}

function consumeOAuthState(db, state) {
  cleanupOAuthStates(db);
  const record = db.oauthStates?.[state];
  if (record) delete db.oauthStates[state];
  return record || null;
}

function markGoogleCalendarConnected(db, userId, tokenPayload) {
  const data = db.businessDataByUser[userId];
  const connector = connectorRecordFor(data, "google_calendar");
  if (!connector) return null;
  connector.connectedAt = new Date().toISOString();
  connector.mode = "real";
  connector.oauthScope = tokenPayload.scope || googleCalendarSetupStatus().scope;
  connector.status = "Connected";
  data.connectors = db.connectorsByUser[userId];
  return connector;
}

function markGoogleCalendarDisconnected(db, userId) {
  const data = db.businessDataByUser[userId];
  const connector = connectorRecordFor(data, "google_calendar");
  if (!connector) return null;
  connector.connectedAt = null;
  connector.mode = "not_connected";
  connector.status = "OAuth not connected";
  connector.lastSyncAt = null;
  connector.lastSyncSummary = null;
  if (Array.isArray(data.calendarEvents)) {
    data.calendarEvents = data.calendarEvents.filter(
      (event) => event.connectorId !== "google_calendar",
    );
  }
  data.updatedAt = new Date().toISOString();
  return connector;
}

function markGmailConnected(db, userId, tokenPayload) {
  const data = db.businessDataByUser[userId];
  const connector = connectorRecordFor(data, "gmail");
  if (!connector) return null;
  connector.connectedAt = new Date().toISOString();
  connector.mode = "real";
  connector.oauthScope = tokenPayload.scope || gmailSetupStatus().scope;
  connector.status = gmailStatusLabel(connector.oauthScope, true);
  data.connectors = db.connectorsByUser[userId];
  return connector;
}

function markGmailDisconnected(db, userId) {
  const data = db.businessDataByUser[userId];
  const connector = connectorRecordFor(data, "gmail");
  if (!connector) return null;
  connector.connectedAt = null;
  connector.mode = "not_connected";
  connector.oauthScope = null;
  connector.status = "Not connected";
  connector.lastSyncAt = null;
  connector.lastSyncSummary = null;
  data.gmailMessages = [];
  data.gmailDrafts = [];
  data.updatedAt = new Date().toISOString();
  return connector;
}

function isGoogleCalendarRealConnected(db, userId) {
  const data = db.businessDataByUser[userId];
  const connector = connectorRecordFor(data, "google_calendar");
  const tokenStatus = publicTokenStatus(db, userId, "google_calendar");
  return connector?.mode === "real" && tokenStatus.hasAccessToken;
}

function isGmailRealConnected(db, userId) {
  const data = db.businessDataByUser[userId];
  const connector = connectorRecordFor(data, "gmail");
  const tokenStatus = publicGmailTokenStatus(db, userId);
  return connector?.mode === "real" && tokenStatus.hasAccessToken;
}

async function syncRealGoogleCalendar(db, userId) {
  const data = db.businessDataByUser[userId];
  const connector = connectorRecordFor(data, "google_calendar");
  const result = await syncGoogleCalendarEvents(db, userId, data);
  connector.mode = "real";
  connector.status = "Connected";
  connector.lastSyncAt = result.lastSyncedAt;
  connector.lastSyncSummary = {
    highlights: result.events.slice(0, 3).map((event) => event.title),
    metrics: { eventsSynced: result.eventsSynced },
    provider: "Google Calendar",
  };
  const tools = createAmandaTools({ businessData: data, makeId });
  tools.logAction("syncGoogleCalendar", {
    eventsSynced: result.eventsSynced,
    externalWrite: false,
    mode: "real",
  });
  return result;
}

async function syncRealGmail(db, userId) {
  const data = db.businessDataByUser[userId];
  const connector = connectorRecordFor(data, "gmail");
  const result = await syncGmailMessages(db, userId, data);
  connector.mode = "real";
  connector.status = gmailStatusLabel(connector.oauthScope || publicGmailTokenStatus(db, userId).scope, true);
  connector.lastSyncAt = result.lastSyncedAt;
  connector.lastSyncSummary = {
    highlights: result.messages.slice(0, 3).map((message) => message.subject),
    metrics: {
      draftsWaiting: data.gmailDrafts?.filter((item) => item.status === "needs_approval").length || 0,
      highPriorityCount: result.highPriorityCount,
      needsReplyCount: result.needsReplyCount,
      unreadCount: result.unreadCount,
    },
    provider: "Gmail",
  };
  const tools = createAmandaTools({ businessData: data, makeId, userId });
  tools.logAction("syncGmail", {
    externalWrite: false,
    highPriorityCount: result.highPriorityCount,
    messagesSynced: result.messagesSynced,
    mode: "real",
    needsReplyCount: result.needsReplyCount,
    unreadCount: result.unreadCount,
  });
  return result;
}

function safeApprovalError(error) {
  if (error?.code === "missing_write_scope") {
    return "Google Calendar needs event creation permission. Reconnect Calendar with event access.";
  }
  if (String(error?.message || "").toLowerCase().includes("not connected")) {
    return "Google Calendar is not connected.";
  }
  return "Amanda could not create the Google Calendar event. Check the Calendar connection and try again.";
}

function safeGmailDraftError(error) {
  if (error?.code === "missing_compose_scope") {
    return "Gmail draft creation requires compose permission. Reconnect Gmail with draft creation access.";
  }
  if (String(error?.message || "").toLowerCase().includes("not connected")) {
    return "Gmail is not connected.";
  }
  return "Amanda could not create the Gmail draft. Check the Gmail connection and try again.";
}

async function executeGoogleCalendarCreateEventApproval(db, userId, approval) {
  const data = db.businessDataByUser[userId];
  const connector = connectorRecordFor(data, "google_calendar");
  if (connector?.mode !== "real") {
    const error = new Error("Google Calendar is not connected.");
    error.code = "calendar_disconnected";
    throw error;
  }
  const tokenStatus = publicTokenStatus(db, userId, "google_calendar");
  if (!tokenStatus.hasAccessToken) {
    const error = new Error("Google Calendar is not connected.");
    error.code = "calendar_disconnected";
    throw error;
  }
  if (!hasGoogleCalendarEventWriteScope(tokenStatus.scope)) {
    const error = new Error(
      "Google Calendar needs event creation permission. Reconnect Calendar with event access.",
    );
    error.code = "missing_write_scope";
    throw error;
  }

  const result = await createGoogleCalendarEvent(db, userId, data, approval.payload || {});
  approval.status = "approved";
  approval.reviewedAt = new Date().toISOString();
  approval.reviewNote = "Created in Google Calendar after explicit approval.";
  approval.executedExternally = true;
  approval.execution = {
    createdAt: new Date().toISOString(),
    eventId: result.eventId,
    htmlLink: result.htmlLink,
    provider: "Google Calendar",
    status: "created",
  };
  const tools = createAmandaTools({ businessData: data, makeId });
  tools.logAction("googleCalendarEventCreated", {
    approvalRequestId: approval.id,
    eventId: result.eventId,
    externalWrite: true,
    provider: "Google Calendar",
  });
  return result;
}

async function executeGmailDraftApproval(db, userId, approval) {
  const data = db.businessDataByUser[userId];
  const connector = connectorRecordFor(data, "gmail");
  if (connector?.mode !== "real") {
    const error = new Error("Gmail is not connected.");
    error.code = "gmail_disconnected";
    throw error;
  }
  const tokenStatus = publicGmailTokenStatus(db, userId);
  if (!tokenStatus.hasAccessToken) {
    const error = new Error("Gmail is not connected.");
    error.code = "gmail_disconnected";
    throw error;
  }
  if (!hasGmailComposeScope(tokenStatus.scope)) {
    const error = new Error(
      "Gmail draft creation requires compose permission. Reconnect Gmail with draft creation access.",
    );
    error.code = "missing_compose_scope";
    throw error;
  }

  const draft = data.gmailDrafts?.find((item) => item.id === approval.payload?.draftId);
  if (!draft) {
    throw new Error("Amanda could not find the linked Gmail draft.");
  }

  const result = await createGmailDraft(db, userId, {
    body: draft.body,
    subject: draft.subject,
    to: draft.to,
  });

  draft.status = "created_in_gmail";
  draft.approvedAt = new Date().toISOString();
  draft.createdInGmailAt = new Date().toISOString();
  draft.gmailDraftId = result.draftId;
  draft.gmailDraftMessageId = result.messageId || draft.gmailDraftMessageId || "";
  draft.gmailDraftThreadId = result.threadId || draft.gmailDraftThreadId || "";
  draft.gmailDraftUrl = result.draftsUrl;
  draft.reviewedAt = new Date().toISOString();
  draft.reviewNote = "Created in Gmail Drafts. No email was sent.";

  approval.status = "approved";
  approval.reviewedAt = new Date().toISOString();
  approval.reviewNote = "Created in Gmail Drafts. No email was sent.";
  approval.executedExternally = true;
  approval.execution = {
    createdAt: new Date().toISOString(),
    draftId: result.draftId,
    draftsUrl: result.draftsUrl,
    messageId: result.messageId,
    provider: "Gmail",
    status: "created",
    threadId: result.threadId,
  };
  approval.payload = {
    ...approval.payload,
    gmailDraftId: result.draftId,
  };

  const tools = createAmandaTools({ businessData: data, makeId, userId });
  tools.logAction("gmailDraftCreated", {
    approvalRequestId: approval.id,
    draftId: result.draftId,
    externalWrite: true,
    provider: "Gmail",
  });
  return result;
}

function taskForUi(task) {
  return {
    id: task.id,
    source: task.source || "Amanda",
    status:
      task.status === "completed"
        ? "success"
        : task.status === "open"
          ? "active"
          : task.status || "queued",
    text: task.text,
  };
}

function syncUiTasksFromBusiness(db, userId) {
  const businessTasks = db.businessDataByUser[userId]?.tasks || [];
  if (businessTasks.length) {
    db.tasksByUser[userId] = businessTasks
      .filter((task) => task.status !== "completed")
      .slice(0, 5)
      .map(taskForUi);
  }
}

function cacheKey(kind, userId) {
  return `${kind}:${userId}`;
}

function getCached(kind, userId) {
  const hit = responseCache.get(cacheKey(kind, userId));
  if (!hit) return null;
  if (Date.now() - hit.createdAt > cacheTtlMs) {
    responseCache.delete(cacheKey(kind, userId));
    return null;
  }
  return hit;
}

function setCached(kind, userId, payload) {
  const body = JSON.stringify(payload);
  const etag = createHash("sha1").update(body).digest("hex");
  const entry = { body, createdAt: Date.now(), etag, payload };
  responseCache.set(cacheKey(kind, userId), entry);
  return entry;
}

function invalidateUserCache(userId) {
  for (const kind of ["bootstrap", "settings", "transcripts", "business"]) {
    responseCache.delete(cacheKey(kind, userId));
  }
}

async function getSessionUser(request) {
  const cookies = parseCookies(request);
  const sessionId = cookies.Amanda_session;
  if (!sessionId) return null;
  const db = await loadDb();
  cleanupSessions(db);
  const session = db.sessions.find((item) => item.id === sessionId);
  if (!session) return null;
  const user = db.users.find((item) => item.id === session.userId);
  if (!user) return null;
  return user;
}

async function createSession(response, userId) {
  const db = await loadDb();
  cleanupSessions(db);
  const session = {
    createdAt: Date.now(),
    expiresAt: Date.now() + sessionTtlMs,
    id: makeId("session"),
    userId,
  };
  db.sessions.push(session);
  await queueWrite();
  response.setHeader(
    "Set-Cookie",
    `Amanda_session=${encodeURIComponent(session.id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(
      sessionTtlMs / 1000,
    )}`,
  );
}

async function clearSession(request, response) {
  const cookies = parseCookies(request);
  const sessionId = cookies.Amanda_session;
  if (!sessionId) return;
  const db = await loadDb();
  db.sessions = db.sessions.filter((item) => item.id !== sessionId);
  await queueWrite();
  response.setHeader(
    "Set-Cookie",
    "Amanda_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
  );
}

function resolveRequestPath(url) {
  const pathname = new URL(url, `http://localhost:${port}`).pathname;

  if (pageMap.has(pathname)) {
    return join(root, pageMap.get(pathname));
  }

  const normalized = normalize(decodeURIComponent(pathname))
    .replace(/^[/\\]+/, "")
    .replace(/^(\.\.[/\\])+/, "");
  return join(root, normalized);
}

async function serveFile(request, response) {
  const filePath = resolveRequestPath(request.url || "/");
  const fileStat = await stat(filePath);
  const cached = fileCache.get(filePath);
  const ext = extname(filePath);
  let entry = cached;

  if (!entry || entry.mtimeMs !== fileStat.mtimeMs) {
    const body = await readFile(filePath);
    entry = {
      body,
      etag: createHash("sha1").update(body).digest("hex"),
      mtimeMs: fileStat.mtimeMs,
    };
    fileCache.set(filePath, entry);
  }

  if (request.headers["if-none-match"] === entry.etag) {
    response.writeHead(304);
    response.end();
    return;
  }

  const isHtml = ext === ".html";
  response.writeHead(200, {
    "Cache-Control": isHtml ? "no-store" : "public, max-age=300",
    "Content-Type": mimeTypes[ext] || "application/octet-stream",
    ETag: entry.etag,
  });
  response.end(entry.body);
}

async function handleApi(request, response) {
  const url = new URL(request.url, `http://localhost:${port}`);

  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true, timestamp: new Date().toISOString() });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/signup") {
    const body = await parseBody(request);
    const name = String(body.name || "").trim();
    const company = String(body.company || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");

    if (!name || !company || !email || !password) {
      sendJson(response, 400, { error: "All fields are required." });
      return;
    }

    const db = await loadDb();
    if (db.users.some((user) => user.email === email)) {
      sendJson(response, 409, { error: "An account with that email already exists." });
      return;
    }

    const passwordRecord = await hashPassword(password);
    const user = {
      company,
      createdAt: new Date().toISOString(),
      email,
      id: makeId("user"),
      name,
      passwordHash: passwordRecord.hash,
      passwordSalt: passwordRecord.salt,
    };

    db.users.push(user);
    ensureUserDefaults(db, user);
    await queueWrite();
    await createSession(response, user.id);

    sendJson(response, 201, {
      ok: true,
      redirectTo: "/onboarding/identity",
      user: sanitizeUser(user),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await parseBody(request);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const db = await loadDb();
    const user = db.users.find((item) => item.email === email);

    if (!user || !(await verifyPassword(password, user))) {
      sendJson(response, 401, { error: "Invalid email or password." });
      return;
    }

    await createSession(response, user.id);
    sendJson(response, 200, {
      ok: true,
      redirectTo: "/workspace",
      user: sanitizeUser(user),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    await clearSession(request, response);
    sendJson(response, 200, { ok: true, redirectTo: "/login" });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/connectors/google_calendar/callback") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) {
      redirect(response, "/connectors?error=google_calendar_missing_code");
      return;
    }

    const db = await loadDb();
    const stateRecord = consumeOAuthState(db, state);
    if (!stateRecord || stateRecord.connectorId !== "google_calendar") {
      await queueWrite();
      redirect(response, "/connectors?error=google_calendar_invalid_state");
      return;
    }

    const userForState = db.users.find((item) => item.id === stateRecord.userId);
    if (!userForState) {
      await queueWrite();
      redirect(response, "/connectors?error=google_calendar_user_missing");
      return;
    }

    try {
      ensureUserDefaults(db, userForState);
      const tokenPayload = await exchangeGoogleCalendarCode(code);
      saveConnectorToken(db, userForState.id, "google_calendar", tokenPayload);
      markGoogleCalendarConnected(db, userForState.id, tokenPayload);
      const tools = createAmandaTools({
        businessData: db.businessDataByUser[userForState.id],
        makeId,
        userId: userForState.id,
      });
      tools.logAction("connectGoogleCalendar", {
        externalWrite: false,
        mode: "real",
        scope: tokenPayload.scope || googleCalendarSetupStatus().scope,
      });
      invalidateUserCache(userForState.id);
      await queueWrite();
      redirect(response, "/connectors?connected=google_calendar");
      return;
    } catch (error) {
      console.warn(`Google Calendar OAuth callback failed: ${error.message}`);
      await queueWrite();
      redirect(response, "/connectors?error=google_calendar_oauth_failed");
      return;
    }
  }

  if (request.method === "GET" && url.pathname === "/api/connectors/gmail/callback") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) {
      redirect(response, "/connectors?error=gmail_missing_code");
      return;
    }

    const db = await loadDb();
    const stateRecord = consumeOAuthState(db, state);
    if (!stateRecord || stateRecord.connectorId !== "gmail") {
      await queueWrite();
      redirect(response, "/connectors?error=gmail_invalid_state");
      return;
    }

    const userForState = db.users.find((item) => item.id === stateRecord.userId);
    if (!userForState) {
      await queueWrite();
      redirect(response, "/connectors?error=gmail_user_missing");
      return;
    }

    try {
      ensureUserDefaults(db, userForState);
      const tokenPayload = await exchangeGmailCodeForTokens(code);
      saveConnectorToken(db, userForState.id, "gmail", tokenPayload);
      markGmailConnected(db, userForState.id, tokenPayload);
      const tools = createAmandaTools({
        businessData: db.businessDataByUser[userForState.id],
        makeId,
        userId: userForState.id,
      });
      tools.logAction("connectGmail", {
        externalWrite: false,
        mode: "real",
        scope: tokenPayload.scope || gmailSetupStatus().scope,
      });
      invalidateUserCache(userForState.id);
      await queueWrite();
      redirect(response, "/connectors?connected=gmail");
      return;
    } catch (error) {
      console.warn(`Gmail OAuth callback failed: ${error.message}`);
      await queueWrite();
      redirect(response, "/connectors?error=gmail_oauth_failed");
      return;
    }
  }

  const user = await getSessionUser(request);
  if (!user) {
    sendJson(response, 401, { error: "Unauthorized." });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/auth/me") {
    sendJson(response, 200, { ok: true, user: sanitizeUser(user) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/dev/clear-demo-data") {
    if (process.env.NODE_ENV !== "development") {
      sendJson(response, 403, { error: "Demo cleanup is only available in development." });
      return;
    }
    const db = await loadDb();
    ensureUserDefaults(db, user);
    const data = db.businessDataByUser[user.id];
    const keys = [
      "actionLogs",
      "approvalRequests",
      "drafts",
      "gmailDrafts",
      "gmailMessages",
      "leads",
      "messages",
      "orders",
      "records",
      "summaries",
      "tasks",
    ];
    const removed = {};
    for (const key of keys) {
      const before = Array.isArray(data[key]) ? data[key].length : 0;
      data[key] = nonDemoRecords(data[key] || []);
      removed[key] = before - data[key].length;
    }
    if (Array.isArray(data.connectors)) {
      data.connectors = data.connectors.map((connector) =>
        connector.mode === "demo" || connector.isDemo
          ? {
            ...connector,
            isDemo: false,
            lastSyncAt: null,
            lastSyncSummary: null,
            mode: "not_connected",
            source: "real",
            status: connector.id === "google_calendar" || connector.id === "gmail" || connector.id === "google_sheets"
              ? "Not connected"
              : "Coming soon",
          }
          : connector,
      );
      db.connectorsByUser[user.id] = data.connectors;
    }
    data.customerMessages = data.messages;
    data.updatedAt = new Date().toISOString();
    invalidateUserCache(user.id);
    await queueWrite();
    sendJson(response, 200, { ok: true, removed });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/bootstrap") {
    const cached = getCached("bootstrap", user.id);
    if (cached && request.headers["if-none-match"] === cached.etag) {
      response.writeHead(304);
      response.end();
      return;
    }
    const db = await loadDb();
    const entry = cached || setCached("bootstrap", user.id, bootstrapForUser(db, user));
    sendJson(response, 200, entry.payload, { ETag: entry.etag });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/session/debug") {
    const db = await loadDb();
    ensureUserDefaults(db, user);
    const data = db.businessDataByUser[user.id] || {};
    const connector = (db.connectorsByUser[user.id] || []).find((item) => item.id === "gmail");
    const approvalRequests = data.approvalRequests || [];
    sendJson(response, 200, {
      company: user.company,
      email: user.email,
      gmailConnected: connector?.mode === "real",
      gmailDraftsCount: (data.gmailDrafts || []).length,
      gmailMessagesCount: (data.gmailMessages || []).length,
      importantGmailMessagesCount: (data.gmailMessages || []).filter((item) => item.priority === "high" || item.needsReply).length,
      pendingApprovalCount: approvalRequests.filter((item) => normalizeApprovalStatus(item.status) === "pending").length,
      pendingGmailApprovalCount: approvalRequests.filter((item) => item.connectorId === "gmail" && normalizeApprovalStatus(item.status) === "pending").length,
      userId: user.id,
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/transcripts") {
    const cached = getCached("transcripts", user.id);
    if (cached && request.headers["if-none-match"] === cached.etag) {
      response.writeHead(304);
      response.end();
      return;
    }
    const db = await loadDb();
    ensureUserDefaults(db, user);
    const payload = { entries: db.transcriptsByUser[user.id] };
    const entry = cached || setCached("transcripts", user.id, payload);
    sendJson(response, 200, entry.payload, { ETag: entry.etag });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/settings") {
    const cached = getCached("settings", user.id);
    if (cached && request.headers["if-none-match"] === cached.etag) {
      response.writeHead(304);
      response.end();
      return;
    }
    const db = await loadDb();
    ensureUserDefaults(db, user);
    const payload = { settings: db.settingsByUser[user.id] };
    const entry = cached || setCached("settings", user.id, payload);
    sendJson(response, 200, entry.payload, { ETag: entry.etag });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/business/overview") {
    const db = await loadDb();
    ensureUserDefaults(db, user);
    const data = visibleBusinessData(db.businessDataByUser[user.id]);
    const tools = createAmandaTools({
      businessData: data,
      makeId,
      userId: user.id,
    });
    const overview = {
      actionLogCount: data.actionLogs.length,
      businessDataSummary: summarizeBusinessData(data),
      needsApproval: tools.listNeedsApproval(),
      orderSummary: tools.getOrderSummary().summary,
      topLeads: tools.listLeads().slice(0, 3),
      unansweredMessages: tools.listUnansweredMessages(),
    };
    await queueWrite();
    sendJson(response, 200, { ok: true, overview });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/attention/today") {
    const db = await loadDb();
    ensureUserDefaults(db, user);
    const summary = await getUnifiedAttentionSummary(user.id, {
      businessData: visibleBusinessData(db.businessDataByUser[user.id]),
      connectors: db.connectorsByUser[user.id] || [],
      useGemini: url.searchParams.get("gemini") !== "false",
    });
    sendJson(response, 200, {
      generatedAt: summary.generatedAt,
      items: summary.items.slice(0, 10),
      ok: true,
      sources: summary.sources,
      spokenReply: summary.spokenReply,
      summary: summary.summary,
      topRecommendation: summary.topRecommendation,
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/tasks") {
    const db = await loadDb();
    ensureUserDefaults(db, user);
    const tools = createAmandaTools({ businessData: visibleBusinessData(db.businessDataByUser[user.id]), makeId });
    const tasks = tools.listTasks(Object.fromEntries(url.searchParams));
    await queueWrite();
    sendJson(response, 200, { ok: true, tasks });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/tasks") {
    const body = await parseBody(request);
    const db = await loadDb();
    ensureUserDefaults(db, user);
    const tools = createAmandaTools({ businessData: db.businessDataByUser[user.id], makeId });
    const task = tools.createTask({
      dueAt: body.dueAt,
      priority: body.priority,
      source: body.source,
      text: body.text,
    });
    syncUiTasksFromBusiness(db, user.id);
    invalidateUserCache(user.id);
    await queueWrite();
    sendJson(response, 201, { ok: true, task });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/drafts") {
    const db = await loadDb();
    ensureUserDefaults(db, user);
    const data = visibleBusinessData(db.businessDataByUser[user.id]);
    const allDrafts = [...(data.drafts || []), ...(data.gmailDrafts || [])];
    const tools = createAmandaTools({ businessData: data, makeId, userId: user.id });
    tools.logAction("listDrafts", { count: allDrafts.length });
    await queueWrite();
    sendJson(response, 200, { drafts: allDrafts, ok: true });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/gmail/drafts") {
    const db = await loadDb();
    ensureUserDefaults(db, user);
    const data = visibleBusinessData(db.businessDataByUser[user.id]);
    sendJson(response, 200, { drafts: data.gmailDrafts || [], ok: true });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/gmail/messages") {
    const db = await loadDb();
    ensureUserDefaults(db, user);
    const data = visibleBusinessData(db.businessDataByUser[user.id]);
    sendJson(response, 200, { messages: data.gmailMessages || [], ok: true });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/gmail/search") {
    const db = await loadDb();
    ensureUserDefaults(db, user);
    const data = db.businessDataByUser[user.id];
    const query = String(url.searchParams.get("q") || "").trim();
    const tools = createAmandaTools({ businessData: data, makeId, userId: user.id });
    let matches = [];
    let source = "local_sync";
    if (query && isGmailRealConnected(db, user.id)) {
      try {
        matches = await searchGmailMessages(db, user.id, query, { maxResults: 10 });
        mergeLocalGmailMessages(data, matches);
        source = "gmail_api";
      } catch {
        matches = tools.gmailSearchMessages({ query });
      }
    } else {
      matches = tools.gmailSearchMessages({ query });
    }
    invalidateUserCache(user.id);
    await queueWrite();
    sendJson(response, 200, { messages: matches, ok: true, query, source });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/action-logs") {
    const db = await loadDb();
    ensureUserDefaults(db, user);
    const data = visibleBusinessData(db.businessDataByUser[user.id]);
    const tools = createAmandaTools({ businessData: data, makeId });
    tools.logAction("listActionLogs", { count: data.actionLogs.length });
    await queueWrite();
    sendJson(response, 200, { actionLogs: data.actionLogs.slice().reverse(), ok: true });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/messages") {
    const db = await loadDb();
    ensureUserDefaults(db, user);
    const tools = createAmandaTools({ businessData: visibleBusinessData(db.businessDataByUser[user.id]), makeId });
    const messages = url.searchParams.get("unanswered") === "true"
      ? tools.listUnansweredMessages()
      : visibleBusinessData(db.businessDataByUser[user.id]).messages;
    if (url.searchParams.get("unanswered") !== "true") {
      tools.logAction("listMessages", { count: messages.length });
    }
    await queueWrite();
    sendJson(response, 200, { messages, ok: true });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/orders") {
    const db = await loadDb();
    ensureUserDefaults(db, user);
    const tools = createAmandaTools({ businessData: visibleBusinessData(db.businessDataByUser[user.id]), makeId });
    const orders = tools.listOrders({
      pendingOnly: url.searchParams.get("pendingOnly") === "true",
      status: url.searchParams.get("status"),
    });
    await queueWrite();
    sendJson(response, 200, { ok: true, orders });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/leads") {
    const db = await loadDb();
    ensureUserDefaults(db, user);
    const tools = createAmandaTools({ businessData: visibleBusinessData(db.businessDataByUser[user.id]), makeId });
    const leads = tools.listLeads({ stage: url.searchParams.get("stage") });
    await queueWrite();
    sendJson(response, 200, { leads, ok: true });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/connectors/google_calendar/connect") {
    const setup = googleCalendarSetupStatus();
    if (!setup.isConfigured) {
      sendJson(response, 400, {
        ok: false,
        message: setup.message,
        missingEnv: setup.missingEnv,
      });
      return;
    }
    const db = await loadDb();
    ensureUserDefaults(db, user);
    const state = createOAuthState(db, user.id, "google_calendar");
    const authUrl = createGoogleCalendarAuthUrl(state);
    await queueWrite();
    redirect(response, authUrl);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/connectors/gmail/connect") {
    const setup = gmailSetupStatus();
    if (!setup.isConfigured) {
      sendJson(response, 400, {
        ok: false,
        message: setup.message,
        missingEnv: setup.missingEnv,
      });
      return;
    }
    const db = await loadDb();
    ensureUserDefaults(db, user);
    const state = createOAuthState(db, user.id, "gmail");
    const authUrl = buildGmailAuthUrl(state);
    await queueWrite();
    redirect(response, authUrl);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/connectors/google_calendar/setup") {
    const db = await loadDb();
    ensureUserDefaults(db, user);
    sendJson(response, 200, {
      ok: true,
      setup: googleCalendarSetupStatus(),
      credentialStatus: {
        canRefresh: publicTokenStatus(db, user.id, "google_calendar").hasRefreshToken,
        connected: publicTokenStatus(db, user.id, "google_calendar").hasAccessToken,
        expiresAt: publicTokenStatus(db, user.id, "google_calendar").expiresAt,
        scope: publicTokenStatus(db, user.id, "google_calendar").scope,
      },
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/connectors/gmail/setup") {
    const db = await loadDb();
    ensureUserDefaults(db, user);
    const credential = publicGmailTokenStatus(db, user.id);
    sendJson(response, 200, {
      ok: true,
      setup: gmailSetupStatus(),
      credentialStatus: {
        canRefresh: credential.hasRefreshToken,
        composeEnabled: credential.composeEnabled,
        connected: credential.hasAccessToken,
        connectionState: credential.connectionState,
        draftCapability: credential.draftCapability,
        expiresAt: credential.expiresAt,
        scope: credential.scope,
      },
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/connectors/google_calendar/disconnect") {
    const db = await loadDb();
    ensureUserDefaults(db, user);
    deleteConnectorToken(db, user.id, "google_calendar");
    const connector = markGoogleCalendarDisconnected(db, user.id);
    const tools = createAmandaTools({ businessData: db.businessDataByUser[user.id], makeId, userId: user.id });
    tools.logAction("disconnectGoogleCalendar", {
      externalWrite: false,
      tokenDeleted: true,
    });
    invalidateUserCache(user.id);
    await queueWrite();
    sendJson(response, 200, {
      connector: decorateConnector(db, user.id, connector),
      ok: true,
      tokenDeleted: true,
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/connectors/gmail/disconnect") {
    const db = await loadDb();
    ensureUserDefaults(db, user);
    deleteConnectorToken(db, user.id, "gmail");
    const connector = markGmailDisconnected(db, user.id);
    const tools = createAmandaTools({ businessData: db.businessDataByUser[user.id], makeId, userId: user.id });
    tools.logAction("disconnectGmail", {
      externalWrite: false,
      tokenDeleted: true,
    });
    invalidateUserCache(user.id);
    await queueWrite();
    sendJson(response, 200, {
      connector: decorateConnector(db, user.id, connector),
      ok: true,
      tokenDeleted: true,
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/connectors") {
    const db = await loadDb();
    ensureUserDefaults(db, user);
    const connectors = createConnectorSystem({
      businessData: db.businessDataByUser[user.id],
      demoMode: isDemoMode(),
      makeId,
      userId: user.id,
    });
    const items = decorateConnectors(db, user.id, connectors.listConnectors());
    await queueWrite();
    sendJson(response, 200, { connectors: items, demoMode: isDemoMode(), ok: true });
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/connectors/")) {
    const [, , , connectorId] = url.pathname.split("/");
    const db = await loadDb();
    ensureUserDefaults(db, user);
    const connectors = createConnectorSystem({
      businessData: db.businessDataByUser[user.id],
      demoMode: isDemoMode(),
      makeId,
      userId: user.id,
    });
    const connector = connectors.getConnector(connectorId);
    if (!connector) {
      sendJson(response, 404, { error: "Connector not found." });
      return;
    }
    await queueWrite();
    sendJson(response, 200, { connector: decorateConnector(db, user.id, connector), ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname.match(/^\/api\/connectors\/[^/]+\/sync$/)) {
    const [, , , connectorId] = url.pathname.split("/");
    const db = await loadDb();
    ensureUserDefaults(db, user);
    const connectors = createConnectorSystem({
      businessData: db.businessDataByUser[user.id],
      demoMode: isDemoMode(),
      makeId,
      userId: user.id,
    });
    let result = null;
    if (connectorId === "google_calendar" && isGoogleCalendarRealConnected(db, user.id)) {
      try {
        result = await syncRealGoogleCalendar(db, user.id);
      } catch (error) {
        sendJson(response, 502, {
          error: "Google Calendar sync failed.",
          message:
            "Google Calendar could not sync. Your token may have expired or the API request failed. Try reconnecting Calendar.",
          ok: false,
        });
        return;
      }
    } else if (connectorId === "gmail" && isGmailRealConnected(db, user.id)) {
      try {
        result = await syncRealGmail(db, user.id);
      } catch (error) {
        sendJson(response, 502, {
          error: "Gmail sync failed.",
          message:
            "Gmail could not sync. Your token may have expired or the API request failed. Try reconnecting Gmail.",
          ok: false,
        });
        return;
      }
    } else if (connectorId === "all" && isGoogleCalendarRealConnected(db, user.id)) {
      try {
        const localResults = connectors.syncAllConnectors();
        const googleResult = await syncRealGoogleCalendar(db, user.id);
        const gmailResult = isGmailRealConnected(db, user.id)
          ? await syncRealGmail(db, user.id)
          : null;
        result = localResults.map((item) =>
          item?.connector?.id === "google_calendar"
            ? { connector: decorateConnector(db, user.id, item.connector), snapshot: googleResult }
            : item?.connector?.id === "gmail" && gmailResult
              ? { connector: decorateConnector(db, user.id, item.connector), snapshot: gmailResult }
            : item,
        );
      } catch (error) {
        sendJson(response, 502, {
          error: "Google Calendar sync failed.",
          message:
            "Google Calendar could not sync. Your token may have expired or the API request failed. Try reconnecting Calendar.",
          ok: false,
        });
        return;
      }
    } else if (connectorId === "all" && isGmailRealConnected(db, user.id)) {
      try {
        const localResults = connectors.syncAllConnectors();
        const gmailResult = await syncRealGmail(db, user.id);
        result = localResults.map((item) =>
          item?.connector?.id === "gmail"
            ? { connector: decorateConnector(db, user.id, item.connector), snapshot: gmailResult }
            : item,
        );
      } catch (error) {
        sendJson(response, 502, {
          error: "Gmail sync failed.",
          message:
            "Gmail could not sync. Your token may have expired or the API request failed. Try reconnecting Gmail.",
          ok: false,
        });
        return;
      }
    } else {
      result = connectorId === "all"
        ? connectors.syncAllConnectors()
        : connectors.syncConnector(connectorId);
    }
    if (!result) {
      sendJson(response, 404, { error: "Connector not found." });
      return;
    }
    invalidateUserCache(user.id);
    await queueWrite();
    sendJson(response, 200, { ok: true, sync: result });
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname.match(/^\/api\/connectors\/[^/]+\/actions\/preview$/)
  ) {
    const [, , , connectorId] = url.pathname.split("/");
    const body = await parseBody(request);
    const db = await loadDb();
    ensureUserDefaults(db, user);
    const connectors = createConnectorSystem({
      businessData: db.businessDataByUser[user.id],
      demoMode: isDemoMode(),
      makeId,
      userId: user.id,
    });
    const preview = connectors.previewExternalAction(connectorId, body.action, body.payload || {});
    if (!preview) {
      sendJson(response, 404, { error: "Connector not found." });
      return;
    }
    await queueWrite();
    sendJson(response, 200, { ok: true, preview });
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname.match(/^\/api\/connectors\/[^/]+\/approval-requests$/)
  ) {
    const [, , , connectorId] = url.pathname.split("/");
    const body = await parseBody(request);
    const db = await loadDb();
    ensureUserDefaults(db, user);
    const connectors = createConnectorSystem({
      businessData: db.businessDataByUser[user.id],
      demoMode: isDemoMode(),
      makeId,
      userId: user.id,
    });
    const approvalRequest = connectors.requestApproval(
      connectorId,
      body.action,
      body.payload || {},
    );
    if (!approvalRequest) {
      sendJson(response, 404, { error: "Connector not found." });
      return;
    }
    invalidateUserCache(user.id);
    await queueWrite();
    sendJson(response, 201, { approvalRequest, ok: true });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/approval-requests") {
    const db = await loadDb();
    ensureUserDefaults(db, user);
    const data = db.businessDataByUser[user.id];
    for (const draft of data.gmailDrafts || []) {
      if (!["needs_approval", "approved_local", "created_in_gmail", "rejected"].includes(draft.status)) continue;
      ensureGmailDraftApprovalRequest(data, draft, makeId);
    }
    const approvalRequests = [
      ...visibleRecords(data.approvalRequests || []),
      ...visibleRecords(data.drafts || [])
        .filter((draft) => draft.status === "needs_approval")
        .map((draft) => ({
          action: "send_draft",
          connectorId: draft.channel === "Gmail" ? "gmail" : "whatsapp_business",
          createdAt: draft.createdAt,
          id: draft.id,
          payload: {
            body: draft.body,
            messageId: draft.messageId,
            subject: draft.subject,
          },
          reason: "Draft must be reviewed before sending.",
          isDemo: draft.isDemo === true,
          source: draft.source || "real",
          status: draft.status,
          subject: draft.subject,
          type: "draft",
        })),
      ...visibleRecords(data.gmailDrafts || [])
        .filter((draft) => draft.status === "needs_approval" && !draft.approvalRequestId)
        .map((draft) => ({
          action: "create_gmail_draft",
          connectorId: "gmail",
          createdAt: draft.createdAt,
          id: draft.id,
          payload: {
            bodyPreview: String(draft.body || "").slice(0, 240),
            draftId: draft.id,
            gmailDraftId: draft.gmailDraftId || "",
            messageId: draft.messageId,
            subject: draft.subject,
            to: draft.to,
          },
          reason: "Create this approved Amanda draft in Gmail Drafts. No email will be sent.",
          isDemo: draft.isDemo === true,
          source: draft.source || "gmail",
          status: draft.status,
          subject: `Create Gmail draft: ${draft.subject || "Draft reply"}`,
          summary: `Create Gmail draft: ${draft.subject || "Draft reply"}`,
          type: "gmail_draft",
        })),
    ]
      .filter((approval) => !approval.dismissedAt)
      .map((approval) => ({
        ...approval,
        status: normalizeApprovalStatus(approval.status),
      }));
    const tools = createAmandaTools({ businessData: data, makeId, userId: user.id });
    tools.logAction("listApprovalRequests", { count: approvalRequests.length });
    await queueWrite();
    sendJson(response, 200, { approvalRequests, ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/dev/dedupe-approval-requests") {
    if (process.env.NODE_ENV !== "development") {
      sendJson(response, 403, { error: "Approval dedupe is only available in development." });
      return;
    }
    const db = await loadDb();
    ensureUserDefaults(db, user);
    const data = db.businessDataByUser[user.id];
    const pending = (data.approvalRequests || []).filter(
      (item) =>
        item.connectorId === "google_calendar" &&
        item.action === "create_event" &&
        isPendingApproval(item),
    );
    const groups = new Map();
    for (const approval of pending) {
      const payload = approval.payload || {};
      const startDate = String(payload.start || "").slice(0, 10);
      const key = [
        String(payload.title || "").trim().toLowerCase(),
        startDate,
        String(payload.location || "").trim().toLowerCase(),
      ].join("|");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(approval);
    }
    let dismissed = 0;
    for (const group of groups.values()) {
      if (group.length <= 1) continue;
      group.sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
      const keep = group[0];
      for (const duplicate of group.slice(1)) {
        duplicate.status = "cancelled";
        duplicate.dismissedAt = new Date().toISOString();
        duplicate.reviewNote = `Cancelled as duplicate of ${keep.id}.`;
        dismissed += 1;
      }
    }
    invalidateUserCache(user.id);
    await queueWrite();
    sendJson(response, 200, { dismissed, ok: true });
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname.match(/^\/api\/approval-requests\/[^/]+\/(approve|reject)$/)
  ) {
    const [, , approvalRequestsPath, requestId, decision] = url.pathname.split("/");
    if (approvalRequestsPath !== "approval-requests") {
      sendJson(response, 404, { error: "Not found." });
      return;
    }
    const db = await loadDb();
    ensureUserDefaults(db, user);
    const data = db.businessDataByUser[user.id];
    const approval = data.approvalRequests?.find((item) => item.id === requestId);
    const draft = data.drafts?.find((item) => item.id === requestId);
    const gmailDraft = data.gmailDrafts?.find((item) => item.id === requestId);
    const linkedGmailDraft =
      (approval?.connectorId === "gmail" && ["create_gmail_draft", "review_local_draft"].includes(approval?.action)
        ? data.gmailDrafts?.find((item) => item.id === approval.payload?.draftId)
        : null) || gmailDraft;
    const target = approval || draft || gmailDraft;
    if (!target) {
      sendJson(response, 404, { error: "Approval request not found." });
      return;
    }
    const isGoogleCalendarCreateEvent =
      decision === "approve" &&
      approval?.connectorId === "google_calendar" &&
      approval?.action === "create_event";
    if (isGoogleCalendarCreateEvent) {
      try {
        const execution = await executeGoogleCalendarCreateEventApproval(db, user.id, approval);
        invalidateUserCache(user.id);
        await queueWrite();
        sendJson(response, 200, {
          approvalRequest: approval,
          executedExternally: true,
          execution,
          message: "The approved calendar event has been created in Google Calendar.",
          ok: true,
        });
        return;
      } catch (error) {
        approval.status = "approval_failed";
        approval.reviewedAt = new Date().toISOString();
        approval.reviewNote = safeApprovalError(error);
        approval.executedExternally = false;
        const tools = createAmandaTools({ businessData: data, makeId });
        tools.logAction("googleCalendarEventCreationFailed", {
          approvalRequestId: requestId,
          error: approval.reviewNote,
          externalWrite: false,
          provider: "Google Calendar",
        });
        invalidateUserCache(user.id);
        await queueWrite();
        sendJson(response, error?.code === "missing_write_scope" ? 409 : 400, {
          approvalRequest: approval,
          error: approval.reviewNote,
          executedExternally: false,
          ok: false,
        });
        return;
      }
    }
    const isGmailDraftApproval = approval?.connectorId === "gmail" && ["create_gmail_draft", "review_local_draft"].includes(approval?.action);
    if (decision === "approve" && isGmailDraftApproval) {
      try {
        const execution = await executeGmailDraftApproval(db, user.id, approval);
        invalidateUserCache(user.id);
        await queueWrite();
        sendJson(response, 200, {
          approvalRequest: approval,
          executedExternally: true,
          execution,
          message: "Gmail draft created. No email was sent.",
          ok: true,
        });
        return;
      } catch (error) {
        approval.reviewNote = safeGmailDraftError(error);
        approval.lastErrorAt = new Date().toISOString();
        const tools = createAmandaTools({ businessData: data, makeId, userId: user.id });
        tools.logAction("gmailDraftCreationFailed", {
          approvalRequestId: requestId,
          error: approval.reviewNote,
          externalWrite: false,
          provider: "Gmail",
        });
        invalidateUserCache(user.id);
        await queueWrite();
        sendJson(response, error?.code === "missing_compose_scope" ? 409 : 400, {
          approvalRequest: approval,
          error: approval.reviewNote,
          executedExternally: false,
          ok: false,
        });
        return;
      }
    }
    if (isGmailDraftApproval && linkedGmailDraft) {
      linkedGmailDraft.status = decision === "approve" ? "approved_local" : "rejected";
      linkedGmailDraft.approvedAt = decision === "approve" ? new Date().toISOString() : null;
      linkedGmailDraft.rejectedAt = decision === "reject" ? new Date().toISOString() : null;
      linkedGmailDraft.reviewedAt = new Date().toISOString();
      linkedGmailDraft.reviewNote =
        decision === "approve"
          ? "Gmail draft approved locally. No email was sent."
          : "Gmail draft rejected. No email was sent.";
    }
    target.status = decision === "approve"
      ? gmailDraft || isGmailDraftApproval
        ? "approved_local"
        : "approved"
      : "rejected";
    target.reviewedAt = new Date().toISOString();
    target.reviewNote =
      decision === "approve"
        ? gmailDraft || isGmailDraftApproval
          ? "Gmail draft approved locally. No email was sent."
          : "Approved locally. No external action executed in Connector System v1."
        : gmailDraft || isGmailDraftApproval
          ? "Gmail draft rejected. No email was sent."
          : "Rejected locally. No external action executed.";
    const tools = createAmandaTools({ businessData: data, makeId, userId: user.id });
    tools.logAction(`approvalRequest${decision === "approve" ? "Approved" : "Rejected"}`, {
      approvalRequestId: requestId,
      executedExternally: false,
      type: approval ? (isGmailDraftApproval ? "gmail_draft_review" : "connector_action") : gmailDraft ? "gmail_draft" : "draft",
    });
    invalidateUserCache(user.id);
    await queueWrite();
    sendJson(response, 200, {
      approvalRequest: target,
      executedExternally: false,
      message:
        decision === "approve"
          ? gmailDraft || isGmailDraftApproval
            ? "Gmail draft approved locally. No email was sent."
            : "Approval processed locally."
          : gmailDraft || isGmailDraftApproval
            ? "Gmail draft rejected. No email was sent."
            : "Approval rejected locally.",
      ok: true,
    });
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname.match(/^\/api\/approval-requests\/[^/]+\/dismiss$/)
  ) {
    const [, , approvalRequestsPath, requestId] = url.pathname.split("/");
    if (approvalRequestsPath !== "approval-requests") {
      sendJson(response, 404, { error: "Not found." });
      return;
    }
    const db = await loadDb();
    ensureUserDefaults(db, user);
    const data = db.businessDataByUser[user.id];
    const approval = data.approvalRequests?.find((item) => item.id === requestId);
    const draft = data.drafts?.find((item) => item.id === requestId);
    const gmailDraft = data.gmailDrafts?.find((item) => item.id === requestId);
    const linkedGmailDraft =
      (approval?.connectorId === "gmail" && ["create_gmail_draft", "review_local_draft"].includes(approval?.action)
        ? data.gmailDrafts?.find((item) => item.id === approval.payload?.draftId)
        : null) || gmailDraft;
    const target = approval || draft || gmailDraft;
    if (!target) {
      sendJson(response, 404, { error: "Approval request not found." });
      return;
    }
    if (isPendingApproval(target)) {
      sendJson(response, 409, { error: "Pending approvals cannot be dismissed." });
      return;
    }
    target.dismissedAt = new Date().toISOString();
    target.reviewNote = target.reviewNote || "Dismissed from approval history.";
    if (linkedGmailDraft && linkedGmailDraft.status !== "needs_approval") {
      linkedGmailDraft.status = "dismissed";
      linkedGmailDraft.dismissedAt = target.dismissedAt;
    }
    invalidateUserCache(user.id);
    await queueWrite();
    sendJson(response, 200, { approvalRequest: target, ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/settings") {
    const body = await parseBody(request);
    const db = await loadDb();
    ensureUserDefaults(db, user);

    const current = db.settingsByUser[user.id];
    const nextSettings = {
      persona:
        typeof body.persona === "string" && body.persona.trim()
          ? body.persona.trim()
          : current.persona,
      reasoningIntensity: Number.isFinite(Number(body.reasoningIntensity))
        ? Math.max(0, Math.min(100, Number(body.reasoningIntensity)))
        : current.reasoningIntensity,
      tone:
        typeof body.tone === "string" && body.tone.trim()
          ? body.tone.trim()
          : current.tone || "Professional",
      voice:
        typeof body.voice === "string" && body.voice.trim()
          ? body.voice.trim()
          : current.voice,
    };

    db.settingsByUser[user.id] = nextSettings;
    invalidateUserCache(user.id);
    await queueWrite();
    sendJson(response, 200, { ok: true, settings: nextSettings });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/voice/respond") {
    const body = await parseBody(request);
    const transcript = String(body.transcript || "").trim();
    const requestId = String(body.requestId || makeId("voice")).replace(/[^\w-]/g, "").slice(0, 80);
    if (!transcript) {
      sendJson(response, 400, { error: "Transcript is required." });
      return;
    }

    const db = await loadDb();
    ensureUserDefaults(db, user);

    const workspace = {
      businessDataSummary: summarizeBusinessData(db.businessDataByUser[user.id]),
      integrations: db.integrationsByUser[user.id],
      tasks: db.tasksByUser[user.id],
    };
    const tools = createAmandaTools({
      businessData: db.businessDataByUser[user.id],
      makeId,
      userId: user.id,
    });
    const connectors = createConnectorSystem({
      businessData: db.businessDataByUser[user.id],
      demoMode: isDemoMode(),
      makeId,
      userId: user.id,
    });
    let calendarSyncResult = null;
    let gmailSyncResult = null;
    let gmailSearchResult = null;
    let gmailSearchSource = null;
    if (
      /\bsync\b/i.test(transcript) &&
      /(google\s+calendar|calendar)/i.test(transcript) &&
      isGoogleCalendarRealConnected(db, user.id)
    ) {
      try {
        calendarSyncResult = await syncRealGoogleCalendar(db, user.id);
      } catch (error) {
        calendarSyncResult = {
          error: error.message,
          ok: false,
        };
      }
    }
    if (
      /\bsync\b/i.test(transcript) &&
      /\bgmail\b/i.test(transcript) &&
      isGmailRealConnected(db, user.id)
    ) {
      try {
        gmailSyncResult = await syncRealGmail(db, user.id);
      } catch (error) {
        gmailSyncResult = {
          error: error.message,
          ok: false,
        };
      }
    }

    const routedVoiceIntent = routeIntent(transcript, { memory: db.agentMemoryByUser[user.id] || {} });
    if (
      ["gmail_search_sender", "gmail_search_keyword", "gmail_summarize_sender", "gmail_draft_reply_to_sender"].includes(routedVoiceIntent.intent) &&
      isGmailRealConnected(db, user.id)
    ) {
      try {
        const query = buildGmailSearchQuery(routedVoiceIntent, transcript);
        gmailSearchResult = await searchGmailMessages(db, user.id, query, { maxResults: 10 });
        mergeLocalGmailMessages(db.businessDataByUser[user.id], gmailSearchResult);
        gmailSearchSource = "gmail_api";
      } catch {
        gmailSearchSource = "local_sync";
      }
    }

    const agentResult = await generateAmandaResponse({
      businessData: db.businessDataByUser[user.id],
      calendarSyncResult,
      gmailSyncResult,
      gmailSearchResult,
      gmailSearchSource,
      connectors,
      memory: db.agentMemoryByUser[user.id],
      message: transcript,
      settings: db.settingsByUser[user.id],
      tools,
      transcripts: db.transcriptsByUser[user.id],
      user: sanitizeUser(user),
      workspace,
    });

    const userEntry = {
      id: makeId("entry"),
      role: "user",
      text: transcript,
      timestamp: new Date().toISOString(),
    };
    const assistantEntry = {
      id: makeId("entry"),
      role: "assistant",
      text: agentResult.reply,
      timestamp: new Date().toISOString(),
    };

    db.transcriptsByUser[user.id].push(userEntry, assistantEntry);
    db.tasksByUser[user.id] = agentResult.tasks.map((task, index) => ({
      id: task.id || makeId(`task${index}`),
      source: task.source || "Amanda",
      status: task.status || (index === 0 ? "active" : "queued"),
      text: task.text,
    }));
    db.agentMemoryByUser[user.id] = {
      ...db.agentMemoryByUser[user.id],
      ...agentResult.memory,
      notes: [
        ...(db.agentMemoryByUser[user.id]?.notes || []),
        ...(agentResult.memory?.notes || []),
      ].slice(-20),
      updatedAt: new Date().toISOString(),
    };

    invalidateUserCache(user.id);
    await queueWrite();

    const agentMeta = {
      confidence: agentResult.confidence,
      intent: agentResult.intent,
    };

    if (process.env.NODE_ENV === "development" || process.env.AMANDA_DEBUG_VOICE === "true") {
      const memory = db.agentMemoryByUser[user.id] || {};
      const pendingClarification = memory.pendingClarification;
      const debugAgent = agentResult.memory?.debugAgent || {};

      agentMeta.routedTo = agentResult.routedTo || debugAgent.routedTo;
      agentMeta.usedFollowUpContext = Boolean(agentResult.usedFollowUpContext || debugAgent.usedFollowUpContext);
      if (debugAgent.brain) agentMeta.brain = debugAgent.brain;
      if (debugAgent.tool) agentMeta.tool = debugAgent.tool;
      if (debugAgent.safetyDecision) agentMeta.safetyDecision = debugAgent.safetyDecision;
      if (debugAgent.attention) agentMeta.attention = debugAgent.attention;
      if (debugAgent.geminiFallback) agentMeta.geminiFallback = debugAgent.geminiFallback;
      if (debugAgent.followUpType) agentMeta.followUpType = debugAgent.followUpType;

      // Include pending clarification details
      if (pendingClarification) {
        agentMeta.pendingClarification = {
          type: pendingClarification.type,
          missingFields: pendingClarification.missingFields || [],
        };
      }

      // Include calendar parser details if available
      if (debugAgent.calendarParser) {
        agentMeta.calendarParser = debugAgent.calendarParser;
      } else if (pendingClarification?.partialPayload) {
        const payload = pendingClarification.partialPayload;
        agentMeta.calendarParser = {
          title: payload.title || "",
          dateText: payload.dateLabel || "",
          timeText: payload.timeLabel || "",
          location: payload.location || "",
          missingFields: payload.missingFields || [],
        };
      }

      // Include approval action details
      if (debugAgent.approval) {
        agentMeta.approval = debugAgent.approval;
      } else if (agentResult.needsApproval && agentResult.needsApproval.length > 0) {
        const approval = agentResult.needsApproval[0];
        agentMeta.approval = {
          action: "created",
          id: approval.id || "",
          deduped: approval.reused ? true : false,
          updatedExisting: approval.updated ? true : false,
        };
      }

      if (debugAgent.gmail) {
        agentMeta.gmail = debugAgent.gmail;
      }

      // Log safe debug info
      const logMsg = `[VOICE DEBUG] requestId="${requestId}" transcript="${transcript}" intent="${agentResult.intent}" confidence=${agentResult.confidence} routedTo="${agentResult.routedTo || agentMeta.routedTo || ""}" followUp=${Boolean(agentResult.usedFollowUpContext || agentMeta.usedFollowUpContext)} state="executed"`;
      console.log(logMsg);
    }

    sendJson(response, 200, {
      actions: agentResult.actions || [],
      agent: agentMeta,
      drafts: agentResult.drafts || [],
      needsApproval: agentResult.needsApproval || [],
      ok: true,
      reply: agentResult.reply,
      requestId,
      tasks: db.tasksByUser[user.id],
      transcript: [userEntry, assistantEntry],
    });
    return;
  }

  sendJson(response, 404, { error: "Not found." });
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://localhost:${port}`);
    const pathname = url.pathname;

    if (pathname.startsWith("/api/")) {
      await handleApi(request, response);
      return;
    }

    const user = await getSessionUser(request);

    if (
      (pathname === "/login" ||
        pathname === "/login.html" ||
        pathname === "/signup" ||
        pathname === "/signup.html") &&
      user
    ) {
      redirect(response, "/workspace");
      return;
    }

    if (protectedRoutes.has(pathname) && !user) {
      redirect(response, "/login");
      return;
    }

    await serveFile(request, response);
  } catch (error) {
    console.error(error);
    sendText(response, 500, "Server error");
  }
});

if (process.env.AMANDA_SKIP_LISTEN !== "true") {
  server.listen(port, () => {
    console.log(`Amanda app running at http://localhost:${port}/`);
  });
}

export { server };
