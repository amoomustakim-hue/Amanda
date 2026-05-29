const DEFAULT_MODEL = "gpt-5-mini";

import { calendarClarification, parseCalendarEventRequest, parseCalendarFollowUp } from "./calendar-parser.js";
import { getUnifiedAttentionSummary } from "./attention-engine.js";
import { draftEmailReply, generateAgentDecision } from "./gemini.js";
import { routeIntent } from "./intent-router.js";
import { enforceGeminiDecision } from "./safety-policy.js";
import { getAvailableTools } from "./tool-registry.js";

const connectorAliases = {
  airtable: "airtable",
  calendar: "google_calendar",
  flutterwave: "flutterwave",
  gmail: "gmail",
  google: "google_calendar",
  hubspot: "hubspot",
  notion: "notion",
  paystack: "paystack",
  sheets: "google_sheets",
  shopify: "shopify",
  slack: "slack",
  whatsapp: "whatsapp_business",
};

const intentDefinitions = [
  {
    id: "attention_today",
    labels: ["needs my attention", "attention today", "what needs attention", "urgent today"],
    action: "Finding today's attention queue",
  },
  {
    id: "support_triage",
    labels: ["customer", "support", "ticket", "message", "messages", "intercom", "urgent", "complaint"],
    action: "Reviewing customer conversations",
  },
  {
    id: "draft_replies",
    labels: ["draft replies", "draft reply", "draft responses", "unanswered messages", "reply for unanswered"],
    action: "Drafting customer replies",
  },
  {
    id: "lead_followup",
    labels: ["lead", "leads", "sales", "prospect", "follow up", "pipeline", "crm", "salesforce", "focus on"],
    action: "Prioritizing sales follow-ups",
  },
  {
    id: "create_task",
    labels: ["create a task", "add a task", "make a task", "remind me", "task to"],
    action: "Creating internal task",
  },
  {
    id: "order_ops",
    labels: ["order", "orders", "shopify", "shipment", "refund", "inventory", "fulfillment", "delivery", "deliveries"],
    action: "Checking order operations",
  },
  {
    id: "pending_deliveries",
    labels: ["pending deliveries", "pending delivery", "show me pending", "delayed deliveries"],
    action: "Checking pending deliveries",
  },
  {
    id: "daily_summary",
    labels: ["summary", "brief", "recap", "today", "report", "status"],
    action: "Preparing business summary",
  },
  {
    id: "action_log",
    labels: ["actions have you taken", "what actions", "action log", "done today", "taken today"],
    action: "Reviewing action log",
  },
  {
    id: "needs_approval",
    labels: ["needs approval", "need approval", "approval", "approve", "waiting for me"],
    action: "Reviewing approval queue",
  },
  {
    id: "calendar_read",
    labels: [
      "what is on my calendar",
      "meetings do i have",
      "summarize my calendar",
      "summarize my week",
      "free slots",
      "calendar today",
      "calendar tomorrow",
    ],
    action: "Reviewing calendar events",
  },
  {
    id: "connector_status",
    labels: ["connector", "connectors", "connected apps", "integrations", "what is connected"],
    action: "Reviewing connectors",
  },
  {
    id: "connector_sync",
    labels: ["sync connectors", "sync integrations", "check connectors", "check integrations", "sync all"],
    action: "Syncing connector snapshots",
  },
  {
    id: "external_action_request",
    labels: ["send email", "send message", "refund", "cancel order", "delete record", "change external"],
    action: "Preparing external approval request",
  },
  {
    id: "calendar",
    labels: ["schedule", "calendar", "meeting", "appointment", "availability", "book"],
    action: "Reviewing calendar windows",
  },
  {
    id: "draft",
    labels: ["draft", "write", "reply", "email", "response", "send"],
    action: "Drafting response for review",
  },
  {
    id: "next_action",
    labels: ["next action", "next step", "priority", "what should", "do next"],
    action: "Selecting next best action",
  },
  {
    id: "greeting",
    labels: ["hi", "hello", "hey", "good morning", "good afternoon"],
    action: "Standing by",
  },
];

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function scoreIntent(message, definition) {
  const lower = message.toLowerCase();
  return definition.labels.reduce((score, label) => {
    if (lower.includes(label)) return score + Math.max(2, label.split(" ").length + 1);
    return score;
  }, 0);
}

const routedIntentMap = {
  action_history: "action_log",
  attention_summary: "attention_today",
  calendar_approve_explanation: "needs_approval",
  calendar_find_slots: "calendar_read",
  calendar_followup_needs_target: "general_ops",
  calendar_prepare_event: "external_action_request",
  calendar_prepare_event_followup: "external_action_request",
  calendar_summary: "calendar_read",
  calendar_sync: "connector_sync",
  calendar_today: "calendar_read",
  calendar_tomorrow: "calendar_read",
  check_messages: "support_triage",
  connector_list: "connector_status",
  connector_preview_action: "external_action_request",
  connector_status: "connector_status",
  connector_sync: "connector_sync",
  draft_message_replies: "draft_replies",
  general_help: "greeting",
  gmail_attention: "gmail_attention",
  gmail_connect: "gmail_connect",
  gmail_customer_today: "gmail_customer_today",
  gmail_draft_replies: "gmail_draft_replies",
  gmail_draft_latest_email: "gmail_draft_latest_email",
  gmail_draft_single_reply: "gmail_draft_single_reply",
  gmail_draft_reply_to_sender: "gmail_draft_reply_to_sender",
  gmail_needs_approval: "gmail_needs_approval",
  gmail_quote_requests: "gmail_quote_requests",
  gmail_search_keyword: "gmail_search_keyword",
  gmail_search_sender: "gmail_search_sender",
  gmail_send_blocked: "gmail_send_blocked",
  gmail_summarize_sender: "gmail_summarize_sender",
  gmail_summarize_unread: "gmail_summary",
  gmail_summary: "gmail_summary",
  gmail_sync: "gmail_sync",
  lead_focus: "lead_followup",
  needs_approval: "needs_approval",
  operations_summary: "attention_today",
  order_summary: "order_ops",
  unknown: "general_ops",
};

function classifyIntent(message, memory = {}) {
  const routed = routeIntent(message, { memory });
  if (routed.intent !== "unknown") {
    return {
      ...routed,
      id: routedIntentMap[routed.intent] || "general_ops",
      routedIntent: routed.intent,
    };
  }

  const lower = message.toLowerCase();
  if (
    /(schedule|create|book|move|cancel|delete|reschedule)\b/.test(lower) &&
    /(calendar|event|meeting|appointment)/.test(lower)
  ) {
    return { confidence: 0.99, id: "external_action_request", routedIntent: "calendar_prepare_event", routedTo: "calendar.prepareEvent" };
  }
  if (
    lower.includes("what is on my calendar") ||
    lower.includes("meetings do i have") ||
    lower.includes("summarize my calendar") ||
    lower.includes("summarize my week") ||
    lower.includes("find free slots") ||
    (lower.includes("calendar") && (lower.includes("today") || lower.includes("tomorrow") || lower.includes("week")))
  ) {
    return { confidence: 0.97, id: "calendar_read", routedIntent: "calendar_summary", routedTo: "calendar.read" };
  }
  if (lower.includes("prepare an approval request") || lower.includes("approval request")) {
    return { confidence: 0.98, id: "external_action_request", routedIntent: "connector_preview_action", routedTo: "connectors.previewOrRequestApproval" };
  }
  if (lower.includes("preview sending") || lower.includes("preview refunding") || lower.includes("preview ")) {
    return { confidence: 0.97, id: "external_action_request", routedIntent: "connector_preview_action", routedTo: "connectors.previewOrRequestApproval" };
  }
  if (/\b(send|email|refund|cancel|delete)\b/.test(lower)) {
    if (
      lower.includes("send email") ||
      lower.includes("email customer") ||
      lower.includes("send message") ||
      lower.includes("refund") ||
      lower.includes("cancel order") ||
      lower.includes("delete record")
    ) {
      return { confidence: 0.98, id: "external_action_request", routedIntent: "connector_preview_action", routedTo: "connectors.previewOrRequestApproval" };
    }
  }
  if (
    lower.includes("sync connectors") ||
    lower.includes("sync integrations") ||
    lower.includes("check connectors") ||
    lower.includes("check integrations") ||
    lower.includes("sync all") ||
    (lower.includes("sync") &&
      Object.keys(connectorAliases).some((token) => lower.includes(token)))
  ) {
    return { confidence: 0.96, id: "connector_sync", routedIntent: "connector_sync", routedTo: "connectors.sync" };
  }
  if (
    lower.includes("what connectors") ||
    lower.includes("what tools are connected") ||
    lower.includes("what tools") ||
    lower.includes("what can you do with") ||
    lower.includes("what is connected") ||
    lower.includes("connected apps") ||
    lower.includes("available connectors")
  ) {
    return { confidence: 0.94, id: "connector_status", routedIntent: "connector_status", routedTo: "connectors.status" };
  }
  if (/^(hi|hello|hey)\b/.test(lower)) {
    return { confidence: 0.95, id: "greeting", routedIntent: "general_help", routedTo: "general.greeting" };
  }

  const ranked = intentDefinitions
    .map((definition) => ({
      confidence: scoreIntent(message, definition) / Math.max(4, definition.labels.length),
      id: definition.id,
    }))
    .sort((a, b) => b.confidence - a.confidence);

  const winner = ranked[0];
  if (!winner || winner.confidence <= 0) {
    return { confidence: 0.32, id: "general_ops", routedIntent: "unknown", routedTo: "general.fallback" };
  }
  return { ...winner, confidence: Math.min(0.96, winner.confidence), routedIntent: winner.id, routedTo: winner.id };
}

function connectorIdFromMessage(message, fallback = "gmail") {
  const lower = message.toLowerCase();
  for (const [token, connectorId] of Object.entries(connectorAliases)) {
    if (lower.includes(token)) return connectorId;
  }
  return fallback;
}

function actionFromMessage(message) {
  const lower = message.toLowerCase();
  if (lower.includes("calendar") || lower.includes("event") || lower.includes("meeting")) {
    if (lower.includes("cancel") || lower.includes("delete")) return "delete_event";
    if (lower.includes("move") || lower.includes("reschedule")) return "update_event";
    return "create_event";
  }
  if (lower.includes("refund")) return "refund_order";
  if (lower.includes("cancel")) return "cancel_order";
  if (lower.includes("delete")) return "delete_record";
  if (lower.includes("sheet")) return "update_row";
  if (lower.includes("email")) return "send_email";
  return "send_message";
}

function calendarCreatePayloadFromMessage(message) {
  const parsed = parseCalendarEventRequest(message, { timezone: "Africa/Lagos" });
  return {
    ...parsed,
    location: parsed.location || "",
    subject: `Create calendar event: ${parsed.title || "An event"}`,
  };
}

function latestPendingCalendarApproval(data) {
  return (data.approvalRequests || [])
    .filter(
      (request) =>
        (request.status === "pending" || request.status === "needs_approval") &&
        request.connectorId === "google_calendar" &&
        request.action === "create_event",
    )
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))[0] || null;
}

function pickDefinedCalendarUpdates(update = {}) {
  const next = {};
  for (const key of ["description", "durationMinutes", "end", "location", "start", "timeZone", "title"]) {
    const value = update[key];
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && !value.trim()) continue;
    next[key] = value;
  }
  return next;
}

function calendarFollowUpReply(followUpType, payload) {
  if (followUpType === "location" && payload?.location) {
    return `I updated the pending calendar approval with the location: ${payload.location}.`;
  }
  if (followUpType === "time" && payload?.timeLabel) {
    return `I updated the pending calendar approval to ${payload.timeLabel}.`;
  }
  if (followUpType === "date") {
    return "I updated the pending calendar approval with the new date.";
  }
  return "I updated the pending calendar approval with the new details.";
}

function messageWithCalendarContext(message, memory, intent) {
  if (!intent?.usedFollowUpContext) return message;
  const pendingMessage = memory?.pendingClarification?.partialPayload?.userMessage;
  if (pendingMessage) return `${pendingMessage} ${message}`;
  if (memory?.lastTaskType === "calendar_event" && memory?.lastUserMessage) {
    return `${memory.lastUserMessage} ${message}`;
  }
  return message;
}

function routeSummary(intent, message) {
  const routed = intent.routedIntent || intent.id;
  if (routed === "attention_summary") return "rank today's business priorities";
  if (routed === "calendar_prepare_event") return "prepare a calendar event approval";
  if (routed === "calendar_prepare_event_followup") return "update the pending calendar approval";
  if (routed === "calendar_today") return "check today's calendar";
  if (routed === "calendar_tomorrow") return "check tomorrow's calendar";
  if (routed === "calendar_summary") return "summarize your calendar";
  if (routed === "calendar_find_slots") return "find calendar availability";
  if (routed === "calendar_sync") return "sync Google Calendar";
  if (routed === "check_messages") return "check business messages that need replies";
  if (routed === "draft_message_replies") return "draft replies for unanswered messages";
  if (routed === "gmail_connect") return "connect Gmail";
  if (routed === "gmail_sync") return "sync Gmail";
  if (routed === "gmail_summary" || routed === "gmail_summarize_unread") return "summarize unread Gmail messages";
  if (routed === "gmail_attention") return "find important Gmail messages";
  if (routed === "gmail_customer_today") return "find customer emails from today";
  if (routed === "gmail_quote_requests") return "find quote requests in Gmail";
  if (routed === "gmail_draft_replies") return "draft replies for important Gmail messages";
  if (routed === "gmail_draft_latest_email") return "draft a reply to the latest Gmail email";
  if (routed === "gmail_draft_single_reply") return "draft a reply to a specific Gmail message";
  if (routed === "gmail_draft_reply_to_sender") return "draft a reply to the latest Gmail message from a sender";
  if (routed === "gmail_needs_approval") return "review Gmail drafts waiting for approval";
  if (routed === "gmail_search_sender") return "search Gmail by sender";
  if (routed === "gmail_search_keyword") return "search Gmail by keyword";
  if (routed === "gmail_summarize_sender") return "summarize Gmail messages from a sender";
  if (routed === "gmail_send_blocked") return "keep Gmail sending disabled";
  if (routed === "order_summary") return "summarize orders";
  if (routed === "lead_focus") return "prioritize leads";
  if (routed === "action_history") return "review Amanda's action history";
  if (routed === "needs_approval") return "review what needs approval";
  if (routed === "operations_summary") return "review what needs attention today";
  if (routed === "connector_list" || routed === "connector_status") return "check connector status";
  if (routed === "connector_sync") return "sync connector data";
  if (routed === "connector_preview_action") return "prepare a safe connector action";
  return cleanText(message).slice(0, 80);
}

function recentTranscriptSummary(transcripts = []) {
  return transcripts
    .slice(-6)
    .map((entry) => `${entry.role}: ${cleanText(entry.text)}`)
    .join("\n");
}

function topItems(items = [], count = 3) {
  return items.slice(0, count);
}

function formatList(items, formatter) {
  return items.map(formatter).filter(Boolean).join("; ");
}

function startOfDay(offsetDays = 0) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return date;
}

function endOfDay(offsetDays = 0) {
  const date = startOfDay(offsetDays);
  date.setHours(23, 59, 59, 999);
  return date;
}

function eventStartsInRange(event, start, end) {
  const time = new Date(event.start || event.end || 0).getTime();
  return Number.isFinite(time) && time >= start.getTime() && time <= end.getTime();
}

function formatEventTime(value) {
  if (!value) return "time not listed";
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function eventSummary(event) {
  const extras = [];
  if (event.location) extras.push(`at ${event.location}`);
  if (event.meetingLink) extras.push("with a Meet link");
  return `${event.title} at ${formatEventTime(event.start)}${extras.length ? ` ${extras.join(", ")}` : ""}`;
}

function calendarMode(data) {
  return data.connectors?.find((connector) => connector.id === "google_calendar")?.mode || "demo";
}

function gmailConnector(data) {
  return data.connectors?.find((connector) => connector.id === "gmail") || null;
}

function gmailMode(data) {
  return gmailConnector(data)?.mode || "not_connected";
}

function gmailIsConnected(data) {
  return gmailMode(data) === "real";
}

function gmailScopeList(data) {
  return String(gmailConnector(data)?.oauthScope || "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function gmailComposeEnabled(data) {
  const scopes = gmailScopeList(data);
  return scopes.includes("https://www.googleapis.com/auth/gmail.compose") || scopes.includes("https://mail.google.com/");
}

function gmailCanReview(data) {
  return gmailIsConnected(data) || (gmailMode(data) === "demo" && gmailHasMessages(data));
}

function gmailHasMessages(data) {
  return Array.isArray(data.gmailMessages) && data.gmailMessages.length > 0;
}

function gmailDraftApprovalCount(data) {
  return (data.gmailDrafts || []).filter((draft) => draft.status === "needs_approval").length;
}

function gmailSyncedCount(data) {
  return Array.isArray(data.gmailMessages) ? data.gmailMessages.length : 0;
}

function gmailTopAttentionItems(data, tools) {
  if (!tools) return [];
  return tools.gmailFindImportantEmails().slice(0, 3);
}

function gmailApprovalIdsForDrafts(drafts = []) {
  return drafts.map((draft) => draft.approvalRequestId).filter(Boolean);
}

function gmailDebugBase(data) {
  return {
    approvalIds: [],
    approvalRequestsCreated: 0,
    connected: gmailIsConnected(data),
    draftableMessagesCount: 0,
    draftsCreated: 0,
    importantMessagesFound: 0,
    importantCandidatesCount: 0,
    syncedMessagesCount: gmailSyncedCount(data),
    syncedMessages: gmailSyncedCount(data),
  };
}

function gmailDraftableMessages(data, tools) {
  if (tools?.gmailListDraftableEmails) return tools.gmailListDraftableEmails();
  return (data.gmailMessages || []).filter(
    (message) =>
      message?.needsReply === true ||
      message?.priority === "high" ||
      message?.priority === "medium" ||
      [
        "lead",
        "quote_request",
        "pricing_inquiry",
        "customer_complaint",
        "support_request",
        "booking_request",
        "partnership",
        "follow_up",
      ].includes(message?.category),
  );
}

function gmailSearchResult(args, tools, intent) {
  if (Array.isArray(args.gmailSearchResult)) {
    return args.gmailSearchResult;
  }
  if (!tools) return [];
  const sender = intent?.entities?.senderNameOrEmail || "";
  const keyword = intent?.entities?.keyword || "";
  const query = intent?.entities?.query || sender || keyword;
  if (sender) return tools.gmailSearchBySender(sender);
  if (keyword) return tools.gmailSearchByKeyword(keyword);
  if (query) return tools.gmailSearchMessages({ query });
  return [];
}

function workspaceName(user) {
  return user?.company || "your workspace";
}

function buildLocalResponse({ user, message, workspace, settings, transcripts, businessData, memory }) {
  const data = businessData || {};
  const args = arguments[0] || {};
  const pendingCalendarApproval = latestPendingCalendarApproval(data);
  const routingMemory = {
    ...(memory || {}),
    pendingCalendarApproval: pendingCalendarApproval
      ? {
          action: pendingCalendarApproval.action,
          connectorId: pendingCalendarApproval.connectorId,
          id: pendingCalendarApproval.id,
          payload: pendingCalendarApproval.payload || {},
          status: pendingCalendarApproval.status,
        }
      : null,
  };
  const intent = classifyIntent(message, routingMemory);
  const tools = arguments[0].tools || null;
  const connectors = arguments[0].connectors || null;
  const tone = settings?.tone || "Professional";
  const intensity = Number(settings?.reasoningIntensity || 70);
  const company = workspaceName(user);
  const openLoops = memory?.openLoops || [];

  const actions = [];
  const drafts = [];
  const needsApproval = [];
  const tasks = [];
  let reply = "";
  let memoryNote = "";
  let pendingClarification = routingMemory?.pendingClarification || null;
  let lastTaskType = null;

  function rememberAction(action, result) {
    actions.push({
      action,
      count: Array.isArray(result) ? result.length : undefined,
    });
    return result;
  }

  function customerDisplay(item) {
    if (!item) return "a customer";
    const customer = data.customers?.find((entry) => entry.id === item.customerId);
    return customer ? `${customer.name} at ${customer.company}` : item.customer || "a customer";
  }

  function orderDisplay(order) {
    return order?.publicId || order?.id || "an order";
  }

  function taskFromTool(task, status = "active") {
    return {
      id: task.id,
      source: task.source || "Amanda",
      status,
      text: task.text,
    };
  }

  if (intent.id === "greeting") {
    const activeTask = workspace?.tasks?.find((task) => task.status === "active" || task.status === "thinking");
    reply = `Hi ${user?.name?.split(" ")[0] || "there"}, I'm online in ${company}. I can triage messages, prioritize leads, check orders, draft replies, or give you the next best action.`;
    tasks.push({
      source: "Amanda",
      status: "active",
      text: activeTask?.text || "Waiting for the next business instruction...",
    });
    memoryNote = "User greeted Amanda and may need task suggestions.";
  } else if (intent.id === "attention_today") {
    const messages = tools ? rememberAction("listUnansweredMessages", tools.listUnansweredMessages()) : [];
    const orderSummary = tools ? rememberAction("getOrderSummary", tools.getOrderSummary()) : { orders: [], summary: {} };
    const leads = tools ? rememberAction("listLeads", tools.listLeads().slice(0, 3)) : [];
    const openTasks = tools ? rememberAction("listTasks", tools.listTasks({ status: "open" }).slice(0, 3)) : [];
    const gmailImportant = tools ? rememberAction("gmailFindImportantEmails", gmailTopAttentionItems(data, tools)) : [];
    const gmailDraftsWaiting = gmailDraftApprovalCount(data);
    const firstMessage = messages[0];
    const firstLead = leads[0];
    const firstEmail = gmailImportant[0];
    const attentionItems = [];
    if (firstEmail) {
      attentionItems.push(`${gmailImportant.length} important unread email${gmailImportant.length === 1 ? "" : "s"}`);
    }
    if (messages.length) {
      attentionItems.push(`${messages.length} unanswered customer message${messages.length === 1 ? "" : "s"}`);
    }
    if (orderSummary.summary.pending || 0) {
      attentionItems.push(`${orderSummary.summary.pending || 0} pending order${orderSummary.summary.pending === 1 ? "" : "s"}`);
    }
    if (leads.length) {
      attentionItems.push(`${leads.length} high-priority lead${leads.length === 1 ? "" : "s"}`);
    }
    if (gmailDraftsWaiting) {
      attentionItems.push(`${gmailDraftsWaiting} email draft${gmailDraftsWaiting === 1 ? "" : "s"} waiting for approval`);
    }
    reply = `You have ${attentionItems.length || 1} things that need attention: ${attentionItems.join(", ") || "the open workspace queue"}. I recommend starting with ${firstEmail ? `"${firstEmail.subject}"` : firstMessage ? customerDisplay(firstMessage) : firstLead?.company || "the open task queue"}${firstEmail ? " because it looks closest to revenue or customer risk." : "."}`;
    tasks.push(
      ...(firstEmail ? [{ source: "Gmail", status: "active", text: `Review ${firstEmail.subject}` }] : []),
      ...(openTasks.length ? openTasks.map((task, index) => taskFromTool(task, index === 0 ? "active" : "queued")) : []),
      { source: "Amanda", status: "queued", text: "Review today's customer, order, and lead priorities" },
    );
    memoryNote = "User asked what needs attention today.";
  } else if (intent.id === "support_triage") {
    const messages = tools
      ? rememberAction("listUnansweredMessages", tools.listUnansweredMessages())
      : topItems(data.messages || data.customerMessages, intensity > 70 ? 4 : 3);
    const urgent = messages.filter((item) => item.priority === "high");
    reply = messages.length
      ? `I reviewed the customer queue. ${urgent.length || 1} conversation needs attention first: ${formatList(
          urgent.length ? urgent : messages.slice(0, 1),
          (item) => `${customerDisplay(item)} about ${item.subject || item.topic}`,
        )}. I would answer that first, then clear the remaining ${Math.max(0, messages.length - 1)} lower-risk threads.`
      : "I do not see live customer messages in the local workspace yet, but I can prepare a support triage workflow for when the integration is connected.";
    tasks.push(
      { source: "Intercom", status: "active", text: "Triage high-priority customer conversations" },
      { source: "Amanda", status: "queued", text: "Draft suggested replies for urgent support threads" },
      { source: "Amanda", status: "queued", text: "Summarize remaining customer risk" },
    );
    memoryNote = "User asked for support/customer triage.";
  } else if (intent.id === "gmail_connect") {
    if (gmailIsConnected(data)) {
      reply = gmailComposeEnabled(data)
        ? "Gmail is already connected with draft creation enabled. Open the Connectors page if you want to sync the latest messages."
        : "Gmail is already connected in read-only mode. Reconnect it with compose permission if you want Amanda to create Gmail drafts after approval.";
    } else if (gmailMode(data) === "demo" && gmailHasMessages(data)) {
      reply = "Gmail demo data is available locally. Connect real Gmail from the Connectors page when you want read-only inbox sync.";
    } else {
      reply = "Gmail is not connected yet. Connect Gmail from the Connectors page so I can summarize important business emails and, with compose permission, create Gmail drafts after approval.";
    }
    tasks.push(
      { source: "Gmail", status: "active", text: "Connect Gmail for inbox sync and draft creation" },
      { source: "Amanda", status: "queued", text: "Wait for Gmail OAuth before reading inbox data" },
    );
    memoryNote = "User asked Amanda to connect Gmail.";
  } else if (intent.id === "gmail_sync") {
    const syncResult = arguments[0].gmailSyncResult || null;
    if (gmailMode(data) === "demo" && gmailHasMessages(data)) {
      reply = `Gmail demo data is available locally with ${data.gmailMessages.length} recent message${data.gmailMessages.length === 1 ? "" : "s"}. Connect real Gmail when you want read-only inbox sync.`;
    } else if (!gmailIsConnected(data)) {
      reply = "Gmail is not connected yet. Connect Gmail from the Connectors page so I can summarize important business emails.";
    } else if (syncResult?.ok) {
      reply = `I synced Gmail and found ${syncResult.unreadCount} unread email${syncResult.unreadCount === 1 ? "" : "s"}. ${syncResult.needsReplyCount} look like they need replies, and ${syncResult.highPriorityCount} look high priority.`;
    } else if (syncResult?.error) {
      reply = `Gmail is connected, but the read-only sync failed: ${syncResult.error}. I did not change your mailbox.`;
    } else if (!gmailHasMessages(data)) {
      reply = "Gmail is connected, but I do not have recent messages in Amanda yet. Sync Gmail from the Connectors page and I will summarize what matters.";
    } else {
      reply = `Gmail is connected. I already have ${data.gmailMessages.length} recent email${data.gmailMessages.length === 1 ? "" : "s"} in Amanda's local cache.`;
    }
    tasks.push(
      { source: "Gmail", status: "active", text: "Sync recent Gmail messages in read-only mode" },
      { source: "Amanda", status: "queued", text: "Classify business emails and flag reply candidates" },
    );
    memoryNote = "User asked Amanda to sync Gmail.";
  } else if (intent.id === "gmail_summary") {
    if (!gmailCanReview(data)) {
      reply = "Gmail is not connected yet. Connect Gmail from the Connectors page so I can summarize important business emails.";
    } else if (!gmailHasMessages(data)) {
      reply = "Gmail is connected, but I have not synced recent messages yet. Sync Gmail first and I will summarize the unread business emails.";
    } else {
      const summary = tools ? rememberAction("gmailSummarizeUnreadEmails", tools.gmailSummarizeUnreadEmails()) : null;
      const categories = summary?.categories?.length ? summary.categories.join(", ") : "nothing urgent";
      reply = `You have ${summary?.unreadCount || 0} unread email${summary?.unreadCount === 1 ? "" : "s"}. ${summary?.needsReplyCount || 0} need replies, ${summary?.highPriorityCount || 0} look high priority, and the main themes are ${categories}.`;
    }
    tasks.push(
      { source: "Gmail", status: "active", text: "Summarize unread business emails" },
      { source: "Amanda", status: "queued", text: "Prioritize email replies without sending anything" },
    );
    memoryNote = "User asked Amanda to summarize unread Gmail messages.";
  } else if (intent.id === "gmail_attention") {
    if (!gmailCanReview(data)) {
      reply = "Gmail is not connected yet. Connect Gmail from the Connectors page so I can summarize important business emails.";
    } else if (!gmailHasMessages(data)) {
      reply = "Gmail is connected, but I have not synced recent messages yet. Sync Gmail first and I will surface the important email threads.";
    } else {
      const important = tools ? rememberAction("gmailFindImportantEmails", tools.gmailFindImportantEmails()) : [];
      const top = important.slice(0, 2);
      reply = important.length
        ? `You have ${important.length} Gmail thread${important.length === 1 ? "" : "s"} that need attention. Start with ${top.map((message) => `"${message.subject}"`).join(" and ")}.`
        : "I do not see urgent Gmail threads right now.";
    }
    tasks.push(
      { source: "Gmail", status: "active", text: "Review important Gmail threads" },
      { source: "Amanda", status: "queued", text: "Prepare local drafts for reply-needed emails" },
    );
    memoryNote = "User asked which Gmail emails need attention.";
  } else if (intent.id === "gmail_customer_today") {
    if (!gmailCanReview(data)) {
      reply = "Gmail is not connected yet. Connect Gmail from the Connectors page so I can summarize important business emails.";
    } else if (!gmailHasMessages(data)) {
      reply = "Gmail is connected, but I have not synced recent messages yet. Sync Gmail first and I will filter today's customer emails.";
    } else {
      const today = new Date().toISOString().slice(0, 10);
      const emails = tools
        ? rememberAction("gmailListRecentEmails", tools.gmailListRecentEmails({ limit: 10, query: "", receivedOn: today }))
        : [];
      const customerEmails = emails.filter((message) => message.needsReply || ["lead", "quote_request", "pricing_inquiry", "customer_complaint", "support_request", "booking_request", "partnership", "follow_up"].includes(message.category));
      reply = customerEmails.length
        ? `I found ${customerEmails.length} customer email${customerEmails.length === 1 ? "" : "s"} from today. The most important is "${customerEmails[0].subject}".`
        : "I do not see customer-style Gmail messages from today in the local sync.";
    }
    tasks.push(
      { source: "Gmail", status: "active", text: "Filter today's customer emails" },
      { source: "Amanda", status: "queued", text: "Highlight the best reply opportunities" },
    );
    memoryNote = "User asked for today's customer emails in Gmail.";
  } else if (intent.id === "gmail_quote_requests") {
    if (!gmailCanReview(data)) {
      reply = "Gmail is not connected yet. Connect Gmail from the Connectors page so I can summarize important business emails.";
    } else if (!gmailHasMessages(data)) {
      reply = "Gmail is connected, but I have not synced recent messages yet. Sync Gmail first and I will look for quote requests.";
    } else {
      const quotes = tools
        ? rememberAction("gmailFindImportantEmails", tools.gmailFindImportantEmails({ category: "quote_request" }))
        : [];
      const pricing = tools
        ? rememberAction("gmailFindEmailsNeedingReply", tools.gmailFindEmailsNeedingReply({ category: "pricing_inquiry" }))
        : [];
      const results = [...quotes, ...pricing].slice(0, 4);
      reply = results.length
        ? `I found ${results.length} quote or pricing email${results.length === 1 ? "" : "s"}. Start with "${results[0].subject}".`
        : "I do not see recent quote requests or pricing inquiries in the local Gmail sync.";
    }
    tasks.push(
      { source: "Gmail", status: "active", text: "Find quote requests and pricing inquiries" },
      { source: "Amanda", status: "queued", text: "Draft local reply candidates for sales email" },
    );
    memoryNote = "User asked Amanda to find quote requests in Gmail.";
  } else if (intent.id === "gmail_draft_replies") {
    intent.debugGmail = gmailDebugBase(data);
    if (!gmailCanReview(data)) {
      reply = "Gmail is not connected in this workspace. Connect Gmail from the Connectors page first.";
    } else if (!gmailHasMessages(data)) {
      reply = "I need to sync Gmail first before drafting replies.";
    } else {
      const importantMessages = tools ? rememberAction("gmailFindImportantEmails", tools.gmailFindImportantEmails()) : [];
      const allDraftableMessages = tools ? rememberAction("gmailListDraftableEmails", tools.gmailListDraftableEmails()) : gmailDraftableMessages(data, tools);
      const draftableMessages = allDraftableMessages.filter((message) =>
        importantMessages.some((importantMessage) => importantMessage.id === message.id),
      );
      const createdDrafts = tools ? rememberAction("gmailDraftRepliesForImportantEmails", tools.gmailDraftRepliesForImportantEmails({ limit: 3 })) : [];
      const approvalIds = gmailApprovalIdsForDrafts(createdDrafts);
      drafts.push(...createdDrafts);
      needsApproval.push(...createdDrafts.map((draft) => ({ ...draft, type: "gmail_draft" })));
      intent.debugGmail = {
        ...gmailDebugBase(data),
        approvalIds,
        approvalRequestsCreated: approvalIds.length,
        draftableMessagesCount: draftableMessages.length,
        draftsCreated: createdDrafts.length,
        importantMessagesFound: importantMessages.length,
        importantCandidatesCount: importantMessages.length,
        routedTo: "gmail.draftRepliesForImportantEmails",
        syncedMessagesCount: gmailSyncedCount(data),
      };
      reply = importantMessages.length === 0
        ? "I did not find any important Gmail messages that need replies right now."
        : createdDrafts.length === 0
        ? "I found important Gmail messages, but I could not create draft review items."
        : approvalIds.length === 0
        ? "I created local Gmail drafts, but could not add them to the Approval Queue."
        : createdDrafts.length > 0 && approvalIds.length > 0
        ? gmailIsConnected(data) && !gmailComposeEnabled(data)
          ? `I drafted replies for ${createdDrafts.length} Gmail email${createdDrafts.length === 1 ? "" : "s"}. You can review them in the Approval Queue. To create them inside Gmail Drafts, reconnect Gmail with compose permission enabled.`
          : `I drafted replies for ${createdDrafts.length} Gmail email${createdDrafts.length === 1 ? "" : "s"}. You can review them in the Approval Queue.`
        : "I found important Gmail messages, but I could not create draft review items.";
    }
    tasks.push(
      { source: "Gmail", status: "active", text: "Draft local Gmail replies for review" },
      { source: "Amanda", status: "queued", text: "Keep Gmail sending disabled" },
    );
    memoryNote = "User asked Amanda to draft replies for important Gmail messages.";
  } else if (intent.id === "gmail_draft_latest_email") {
    intent.debugGmail = gmailDebugBase(data);
    if (!gmailCanReview(data)) {
      reply = "Gmail is not connected in this workspace. Connect Gmail from the Connectors page first.";
    } else if (!gmailHasMessages(data)) {
      reply = "I need to sync Gmail first before drafting replies.";
    } else {
      const latestMessage = (data.gmailMessages || [])
        .slice()
        .sort((a, b) => String(b.receivedAt || "").localeCompare(String(a.receivedAt || "")))[0] || null;
      const draft = tools ? rememberAction("gmailDraftLatestEmail", tools.gmailDraftLatestEmail()) : null;
      if (draft) {
        drafts.push(draft);
        needsApproval.push({ ...draft, type: "gmail_draft" });
      }
      intent.debugGmail = {
        ...gmailDebugBase(data),
        approvalIds: draft?.approvalRequestId ? [draft.approvalRequestId] : [],
        approvalRequestsCreated: draft?.approvalRequestId ? 1 : 0,
        draftableMessagesCount: latestMessage ? 1 : 0,
        draftsCreated: draft ? 1 : 0,
        importantMessagesFound: latestMessage ? 1 : 0,
        importantCandidatesCount: latestMessage ? 1 : 0,
        routedTo: "gmail.draftLatestEmail",
        syncedMessagesCount: gmailSyncedCount(data),
      };
      reply = !latestMessage
        ? "I need to sync Gmail first before drafting replies."
        : !draft
        ? "I found the latest Gmail email, but I could not create a draft review item."
        : !draft.approvalRequestId
        ? "I created a local Gmail draft, but could not add it to the Approval Queue."
        : gmailIsConnected(data) && !gmailComposeEnabled(data)
          ? `I drafted a reply to the latest Gmail email. You can review it in the Approval Queue. To create it inside Gmail Drafts, reconnect Gmail with compose permission enabled.`
          : "I drafted a reply to the latest Gmail email. You can review it in the Approval Queue.";
    }
    tasks.push(
      { source: "Gmail", status: "active", text: "Draft a local reply to the latest Gmail email" },
      { source: "Amanda", status: "queued", text: "Keep Gmail sending disabled" },
    );
    memoryNote = "User asked Amanda to draft a reply to the latest Gmail email.";
  } else if (intent.id === "gmail_draft_single_reply") {
    intent.debugGmail = gmailDebugBase(data);
    if (!gmailCanReview(data)) {
      reply = "Gmail is not connected in this workspace. Connect Gmail from the Connectors page first.";
    } else if (!gmailHasMessages(data)) {
      reply = "I need to sync Gmail first before drafting replies.";
    } else {
      const lowerMessage = message.toLowerCase();
      const match = (data.gmailMessages || []).find((item) => {
        const haystack = `${item.subject || ""} ${item.snippet || ""}`.toLowerCase();
        return (
          (lowerMessage.includes("bulk order") && haystack.includes("bulk order")) ||
          (lowerMessage.includes("quote") && haystack.includes("quote")) ||
          (lowerMessage.includes("pricing") && haystack.includes("pricing")) ||
          (lowerMessage.includes("delivery issue") && haystack.includes("delivery issue")) ||
          (lowerMessage.includes("complaint") && item.category === "customer_complaint") ||
          (lowerMessage.includes("support") && item.category === "support_request") ||
          lowerMessage.includes(item.subject?.toLowerCase() || "")
        );
      }) || tools?.gmailFindImportantEmails()?.[0];
      const draft = match && tools ? rememberAction("gmailDraftLocalReply", tools.gmailDraftLocalReply(match.id)) : null;
      if (draft) {
        drafts.push(draft);
        needsApproval.push({ ...draft, type: "gmail_draft" });
      }
      intent.debugGmail = {
        ...gmailDebugBase(data),
        approvalIds: draft?.approvalRequestId ? [draft.approvalRequestId] : [],
        approvalRequestsCreated: draft?.approvalRequestId ? 1 : 0,
        draftsCreated: draft ? 1 : 0,
        importantMessagesFound: match ? 1 : 0,
        routedTo: "gmail.draftSingleReply",
      };
      reply = draft
        ? gmailIsConnected(data) && !gmailComposeEnabled(data)
          ? `I drafted a reply to "${match.subject}". You can review it in the Approval Queue. To create it inside Gmail Drafts, reconnect Gmail with compose permission enabled.`
          : `I drafted a reply to "${match.subject}". You can review it in the Approval Queue.`
        : "I could not match that request to a synced Gmail message yet.";
    }
    tasks.push(
      { source: "Gmail", status: "active", text: "Draft a local reply for one Gmail thread" },
      { source: "Amanda", status: "queued", text: "Wait for review before any future sending support" },
    );
    memoryNote = "User asked Amanda to draft a reply for one Gmail message.";
  } else if (["gmail_search_sender", "gmail_search_keyword", "gmail_summarize_sender"].includes(intent.id)) {
    const sender = intent.entities?.senderNameOrEmail || "";
    const keyword = intent.entities?.keyword || "";
    const searchQuery = intent.entities?.query || sender || keyword;
    const matches = gmailSearchResult(args, tools, intent);
    const source = args.gmailSearchSource || "local_sync";
    intent.debugGmail = {
      connected: gmailIsConnected(data),
      query: searchQuery,
      resultCount: matches.length,
      source,
      syncedMessages: gmailSyncedCount(data),
    };
    if (!gmailCanReview(data)) {
      reply = "Gmail is not connected in this workspace. Connect Gmail from the Connectors page first.";
    } else if (!gmailHasMessages(data) && !matches.length) {
      reply = "I need to sync Gmail first before searching the inbox.";
    } else if (!matches.length) {
      reply = sender
        ? `I could not find recent emails from ${sender} in Gmail.`
        : `I could not find recent Gmail messages matching "${keyword || searchQuery}".`;
    } else {
      const latest = matches[0];
      const replyTail = source === "local_sync"
        ? " This is based on the emails already synced into Amanda."
        : "";
      reply = intent.id === "gmail_summarize_sender"
        ? `I found ${matches.length} recent email${matches.length === 1 ? "" : "s"} from ${sender || "that sender"}. The latest is "${latest.subject}" and it ${latest.needsReply ? "looks like it needs a reply." : "does not look urgent."}${replyTail}`
        : sender
          ? `I found ${matches.length} recent email${matches.length === 1 ? "" : "s"} from ${sender}. The latest is "${latest.subject}" and it ${latest.needsReply ? "looks like it needs a reply." : "does not look urgent."}${replyTail}`
          : `I found ${matches.length} Gmail match${matches.length === 1 ? "" : "es"} for "${keyword || searchQuery}". The latest is "${latest.subject}".${replyTail}`;
    }
    tasks.push(
      { source: "Gmail", status: "active", text: "Search Gmail by sender or keyword" },
      { source: "Amanda", status: "queued", text: "Summarize the strongest matching thread" },
    );
    memoryNote = sender
      ? `User asked Amanda to search Gmail for messages from ${sender}.`
      : `User asked Amanda to search Gmail for ${keyword || searchQuery}.`;
  } else if (intent.id === "gmail_draft_reply_to_sender") {
    const sender = intent.entities?.senderNameOrEmail || "";
    const matches = gmailSearchResult(args, tools, intent);
    const source = args.gmailSearchSource || "local_sync";
    intent.debugGmail = {
      ...gmailDebugBase(data),
      query: intent.entities?.query || sender,
      resultCount: matches.length,
      source,
    };
    if (!gmailCanReview(data)) {
      reply = "Gmail is not connected in this workspace. Connect Gmail from the Connectors page first.";
    } else if (!gmailHasMessages(data) && !matches.length) {
      reply = "I need to sync Gmail first before drafting replies.";
    } else if (!matches.length) {
      reply = `I could not find recent emails from ${sender} in Gmail.`;
    } else {
      const latest = matches[0];
      const draft = tools ? rememberAction("gmailDraftLocalReply", tools.gmailDraftLocalReply(latest.id)) : null;
      if (draft) {
        drafts.push(draft);
        needsApproval.push({ ...draft, type: "gmail_draft" });
      }
      intent.debugGmail = {
        ...intent.debugGmail,
        approvalIds: draft?.approvalRequestId ? [draft.approvalRequestId] : [],
        approvalRequestsCreated: draft?.approvalRequestId ? 1 : 0,
        draftsCreated: draft ? 1 : 0,
        importantMessagesFound: matches.filter((item) => item.needsReply || item.priority === "high").length,
      };
      reply = draft?.approvalRequestId
        ? `I drafted a reply to the latest email from ${sender}. You can review it in the Approval Queue.`
        : "I found the email, but I could not create a draft review item. Please try again.";
    }
    tasks.push(
      { source: "Gmail", status: "active", text: "Draft a reply to the latest matching Gmail message" },
      { source: "Amanda", status: "queued", text: "Wait for Gmail draft approval" },
    );
    memoryNote = `User asked Amanda to draft a reply to the latest Gmail message from ${sender}.`;
  } else if (intent.id === "gmail_needs_approval") {
    const gmailDrafts = (data.gmailDrafts || []).filter((draft) => draft.status === "needs_approval");
    needsApproval.push(...gmailDrafts.map((draft) => ({ ...draft, type: "gmail_draft" })));
    reply = gmailDrafts.length
      ? gmailComposeEnabled(data)
        ? `${gmailDrafts.length} Gmail draft${gmailDrafts.length === 1 ? "" : "s"} are waiting in the Approval Queue. Approving them will create Gmail drafts only. Amanda will not send anything.`
        : `${gmailDrafts.length} Gmail draft${gmailDrafts.length === 1 ? "" : "s"} are waiting in the Approval Queue. Gmail draft creation requires compose permission, so reconnect Gmail with draft access before approving them.`
      : "There are no Gmail drafts waiting for approval right now.";
    tasks.push(
      { source: "Gmail", status: "active", text: "Review Gmail drafts waiting for approval" },
      { source: "Amanda", status: "queued", text: "Keep Gmail send actions disabled" },
    );
    memoryNote = "User asked what Gmail actions need approval.";
  } else if (intent.id === "gmail_send_blocked") {
    reply = "I cannot send emails yet. I can only create Gmail drafts after approval.";
    tasks.push(
      { source: "Gmail", status: "active", text: "Keep Gmail replies as local drafts only" },
      { source: "Amanda", status: "queued", text: "Wait for review rather than sending email" },
    );
    memoryNote = "User asked Amanda to send email, but Gmail sending is intentionally blocked.";
  } else if (intent.id === "draft_replies") {
    const createdDrafts = tools
      ? rememberAction("draftCustomerReply", tools.draftCustomerReply({ limit: 3, tone }))
      : [];
    drafts.push(...createdDrafts);
    needsApproval.push(...createdDrafts.map((draft) => ({ ...draft, type: "draft" })));
    reply = createdDrafts.length
      ? `I drafted ${createdDrafts.length} customer repl${createdDrafts.length === 1 ? "y" : "ies"} for unanswered messages. They are saved as drafts and need your approval before anything is sent.`
      : "I did not find unanswered messages that need drafts right now.";
    tasks.push(
      { source: "Amanda", status: "active", text: "Draft customer replies for review" },
      { source: "Amanda", status: "queued", text: "Wait for approval before sending any message" },
    );
    memoryNote = "User asked Amanda to draft replies for unanswered messages.";
  } else if (intent.id === "lead_followup") {
    const leads = tools
      ? rememberAction("listLeads", tools.listLeads().slice(0, 3))
      : topItems(data.leads, 3).sort((a, b) => (b.score || 0) - (a.score || 0));
    reply = leads.length
      ? `The strongest sales move is to follow up with ${leads[0].name} from ${leads[0].company}. They have a ${leads[0].score}% fit score and the next step is ${leads[0].nextStep}. I would queue ${leads.length} follow-ups and keep the wording ${tone.toLowerCase()}.`
      : "I do not see lead data connected yet. I can still set up a lead scoring checklist and draft the follow-up sequence.";
    tasks.push(
      { source: "Salesforce", status: "active", text: "Rank open leads by fit and urgency" },
      { source: "Amanda", status: "queued", text: "Draft follow-up for the highest-fit prospect" },
      { source: "Amanda", status: "queued", text: "Prepare CRM update notes" },
    );
    memoryNote = "User asked for lead or CRM follow-up work.";
  } else if (intent.id === "create_task") {
    const taskText = cleanText(message)
      .replace(/^amanda,?\s*/i, "")
      .replace(/^(create|add|make)\s+a?\s*task\s*(to|for)?\s*/i, "")
      .replace(/[.?!]+$/g, "")
      || "Follow up on the requested business operation";
    const task = tools
      ? rememberAction("createTask", tools.createTask({
          priority: /wholesale|urgent|customer|lead/i.test(taskText) ? "high" : "medium",
          source: "Amanda",
          text: taskText,
        }))
      : { id: "task_local", source: "Amanda", text: taskText };
    reply = `Done. I created an internal task: ${task.text}. This does not change any external system.`;
    tasks.push(taskFromTool(task));
    memoryNote = "User asked Amanda to create an internal task.";
  } else if (intent.id === "order_ops") {
    const orderResult = tools
      ? rememberAction("getOrderSummary", tools.getOrderSummary())
      : { orders: data.orders || [], summary: {} };
    const riskyOrders = topItems(orderResult.orders?.filter((order) => order.status !== "delivered"), 3);
    reply = riskyOrders.length
      ? `I checked the order queue. ${orderResult.summary.pending || riskyOrders.length} order${(orderResult.summary.pending || riskyOrders.length) === 1 ? "" : "s"} are pending. Handle ${orderDisplay(riskyOrders[0])} first: ${riskyOrders[0].issue}. I can draft the customer update, but sending it needs approval.`
      : "The local order queue looks clear. If Shopify is connected later, I will watch delayed, refunded, and inventory-risk orders first.";
    tasks.push(
      { source: "Shopify", status: "active", text: "Review delayed or exception orders" },
      { source: "Amanda", status: "queued", text: "Prepare customer-facing order update" },
      { source: "Amanda", status: "queued", text: "Flag inventory or fulfillment risk" },
    );
    memoryNote = "User asked for order operations review.";
  } else if (intent.id === "pending_deliveries") {
    const pendingOrders = tools
      ? rememberAction("listOrders", tools.listOrders({ pendingOnly: true }))
      : (data.orders || []).filter((order) => order.status !== "delivered");
    reply = pendingOrders.length
      ? `There are ${pendingOrders.length} pending deliver${pendingOrders.length === 1 ? "y" : "ies"}. The highest priority is ${orderDisplay(pendingOrders[0])}: ${pendingOrders[0].issue}. I will keep this as a review task unless you approve an external update.`
      : "There are no pending deliveries in the local order data.";
    tasks.push(
      ...pendingOrders.slice(0, 3).map((order, index) => ({
        source: "Shopify",
        status: index === 0 ? "active" : "queued",
        text: `Review ${orderDisplay(order)}: ${order.issue}`,
      })),
    );
    memoryNote = "User asked for pending deliveries.";
  } else if (intent.id === "calendar_read") {
    const lower = message.toLowerCase();
    const mode = calendarMode(data);
    const events = Array.isArray(data.calendarEvents) ? data.calendarEvents : [];
    const isTomorrow = intent.routedIntent === "calendar_tomorrow" || lower.includes("tomorrow");
    const isWeek = intent.routedIntent === "calendar_summary" && lower.includes("week");
    const rangeStart = isTomorrow ? startOfDay(1) : startOfDay(0);
    const rangeEnd = isWeek ? endOfDay(6) : isTomorrow ? endOfDay(1) : endOfDay(0);
    const inRange = events
      .filter((event) => eventStartsInRange(event, rangeStart, rangeEnd))
      .sort((a, b) => new Date(a.start || 0) - new Date(b.start || 0));
    rememberAction("reviewCalendarEvents", inRange);

    if (lower.includes("free slot")) {
      const windows = topItems(data.calendarWindows, 2);
      reply = mode === "real"
        ? inRange.length
          ? `Google Calendar is connected. Tomorrow has ${inRange.length} synced event${inRange.length === 1 ? "" : "s"} in the local cache: ${formatList(inRange.slice(0, 4), eventSummary)}. I have not written to your calendar; use the open gaps around those events for free slots.`
          : "Google Calendar is connected, and I do not see synced events tomorrow in the local cache. That looks open, but sync again if you want the freshest read before scheduling."
        : `Google Calendar is not connected yet. I can use demo availability such as ${windows.map((window) => window.label).join(" or ") || "the local calendar windows"}, or you can connect it from the Connectors page.`;
    } else if (mode === "real") {
      reply = inRange.length
        ? `Google Calendar is connected. I found ${inRange.length} event${inRange.length === 1 ? "" : "s"} ${isWeek ? "this week" : isTomorrow ? "tomorrow" : "today"}: ${formatList(inRange.slice(0, 5), eventSummary)}. This is read-only; I did not change your calendar.`
        : `Google Calendar is connected, but I do not see synced events ${isWeek ? "this week" : isTomorrow ? "tomorrow" : "today"} in the local cache. Try “Sync Google Calendar” if you want me to refresh it.`;
    } else {
      const windows = topItems(data.calendarWindows, 2);
      reply = `Google Calendar is not connected yet. I can use demo calendar data${windows.length ? `, including ${windows.map((window) => window.label).join(" and ")}` : ""}, or you can connect it from the Connectors page for real read-only events.`;
    }
    tasks.push(
      { source: "Google Calendar", status: "active", text: "Review read-only calendar events" },
      { source: "Amanda", status: "queued", text: "Keep calendar writes behind approval" },
    );
    memoryNote = "User asked Amanda to read calendar availability or events.";
    lastTaskType = "calendar_event";
  } else if (intent.id === "daily_summary") {
    const summary = tools ? rememberAction("generateDailySummary", tools.generateDailySummary()) : null;
    const highMessage = (data.messages || data.customerMessages)?.find((item) => item.priority === "high");
    const lead = data.leads?.slice().sort((a, b) => (b.score || 0) - (a.score || 0))[0];
    const order = data.orders?.find((item) => item.status !== "delivered");
    const gmailImportant = tools ? rememberAction("gmailFindImportantEmails", gmailTopAttentionItems(data, tools)) : [];
    const gmailDraftsWaiting = gmailDraftApprovalCount(data);
    reply = summary
      ? `Daily summary: ${summary.unansweredMessageCount} unanswered message${summary.unansweredMessageCount === 1 ? "" : "s"}, ${summary.orderSummary.pending} pending order${summary.orderSummary.pending === 1 ? "" : "s"}, ${summary.openTaskCount} open task${summary.openTaskCount === 1 ? "" : "s"}, ${summary.gmailImportantCount || gmailImportant.length} important Gmail email${(summary.gmailImportantCount || gmailImportant.length) === 1 ? "" : "s"}, and ${gmailDraftsWaiting} email draft${gmailDraftsWaiting === 1 ? "" : "s"} waiting for approval. Recommendation: ${summary.recommendation}`
      : `Here is the operating picture for ${company}: customer support needs attention${highMessage ? ` on ${customerDisplay(highMessage)}` : ""}, sales should prioritize${lead ? ` ${lead.company}` : " the warmest lead"}, Gmail has ${gmailImportant.length} important thread${gmailImportant.length === 1 ? "" : "s"}${gmailImportant[0] ? ` led by "${gmailImportant[0].subject}"` : ""}, and orders${order ? ` need a check on ${orderDisplay(order)}` : " are stable"}.`;
    tasks.push(
      { source: "Amanda", status: "active", text: "Compile daily risks, opportunities, and open loops" },
      { source: "Intercom", status: "queued", text: "Surface urgent customer conversation" },
      { source: "Salesforce", status: "queued", text: "Prioritize highest-value follow-up" },
    );
    memoryNote = "User asked for a business summary.";
  } else if (intent.id === "action_log") {
    if (tools) rememberAction("reviewActionLog", tools.logAction("reviewActionLog", { requestedBy: "voice" }));
    const logs = (data.actionLogs || []).slice(-6).reverse();
    reply = logs.length
      ? `Today I logged ${data.actionLogs.length} local action${data.actionLogs.length === 1 ? "" : "s"}. Most recent: ${logs.slice(0, 3).map((log) => log.action).join(", ")}. These were local workspace actions, not external changes.`
      : "I have not logged any local actions yet today.";
    tasks.push({ source: "Amanda", status: "active", text: "Review local action log" });
    memoryNote = "User asked what actions Amanda has taken.";
  } else if (intent.id === "needs_approval") {
    const approvals = tools ? rememberAction("listNeedsApproval", tools.listNeedsApproval()) : [];
    needsApproval.push(...approvals);
    const gmailDrafts = approvals.filter((item) => item.type === "gmail_draft");
    reply = approvals.length
      ? `${approvals.length} item${approvals.length === 1 ? "" : "s"} need your approval. The first is ${approvals[0].subject || approvals[0].action || "a pending draft"}.${gmailDrafts.length ? ` ${gmailDrafts.length} of those are local Gmail draft${gmailDrafts.length === 1 ? "" : "s"} and approving them will not send anything.` : ""} I will not send, refund, cancel, delete, or change external systems without approval.`
      : "Nothing needs approval right now. I will still ask before sending messages, emailing customers, refunding, cancelling, deleting records, or changing external systems.";
    tasks.push({ source: "Amanda", status: "active", text: "Review approval queue" });
    memoryNote = "User asked what needs approval.";
  } else if (intent.id === "connector_status") {
    const items = connectors ? rememberAction("listConnectors", connectors.listConnectors()) : [];
    const requestedConnectorId = connectorIdFromMessage(message, "");
    const requestedConnector = requestedConnectorId
      ? items.find((connector) => connector.id === requestedConnectorId)
      : null;
    const demo = items.filter((connector) => connector.mode !== "not_connected");
    const waiting = items.filter((connector) => connector.mode === "not_connected");
    reply = requestedConnector
      ? requestedConnector.id === "gmail"
        ? `${requestedConnector.label} is ${requestedConnector.status.toLowerCase()} in ${requestedConnector.mode} mode. I can ${requestedConnector.capabilities.slice(0, 3).join(", ").replaceAll("_", " ")}. Gmail sending is not implemented, so Amanda only prepares local drafts for review.`
        : `${requestedConnector.label} is ${requestedConnector.status.toLowerCase()} in ${requestedConnector.mode} mode. I can ${requestedConnector.capabilities.slice(0, 3).join(", ").replaceAll("_", " ")}. Write actions such as ${(requestedConnector.writeActions || []).slice(0, 2).join(", ").replaceAll("_", " ") || "external changes"} require approval before anything external happens.`
      : items.length
      ? `Connector System v1 is ready. ${demo.length} connector${demo.length === 1 ? "" : "s"} are available in demo mode, and ${waiting.length} connector${waiting.length === 1 ? "" : "s"} are waiting for OAuth. I can sync local snapshots, but external writes still require approval.`
      : "Connector System v1 is ready, but I do not see connector records yet.";
    tasks.push(
      { source: "Connectors", status: "active", text: "Review connector status and capabilities" },
      { source: "Amanda", status: "queued", text: "Keep external actions approval-gated" },
    );
    memoryNote = "User asked about connector status.";
  } else if (intent.id === "connector_sync") {
    const requestedConnectorId = connectorIdFromMessage(message, "");
    const calendarSyncResult = arguments[0].calendarSyncResult || null;
    const gmailSyncResult = arguments[0].gmailSyncResult || null;
    const syncResult = requestedConnectorId === "google_calendar" && calendarSyncResult
      ? rememberAction("syncGoogleCalendar", calendarSyncResult)
      : requestedConnectorId === "gmail" && gmailSyncResult
        ? rememberAction("syncGmail", gmailSyncResult)
      : connectors
      ? requestedConnectorId
        ? rememberAction("syncConnector", connectors.syncConnector(requestedConnectorId))
        : rememberAction("syncAllConnectors", connectors.syncAllConnectors())
      : null;
    const results = Array.isArray(syncResult) ? syncResult : syncResult ? [syncResult] : [];
    const highlights = results
      .flatMap((result) => result.snapshot?.highlights || [])
      .slice(0, 3);
    if (requestedConnectorId === "google_calendar" && calendarSyncResult?.ok) {
      reply = `I synced Google Calendar in read-only mode and saved ${calendarSyncResult.eventsSynced} event${calendarSyncResult.eventsSynced === 1 ? "" : "s"} to Amanda's local calendar cache. No calendar events were created, moved, or deleted.`;
    } else if (requestedConnectorId === "google_calendar" && calendarSyncResult?.error) {
      reply = `Google Calendar is connected, but the read-only sync failed: ${calendarSyncResult.error}. I did not change your calendar.`;
    } else if (requestedConnectorId === "gmail" && gmailSyncResult?.ok) {
      reply = `I synced Gmail and found ${gmailSyncResult.unreadCount} unread email${gmailSyncResult.unreadCount === 1 ? "" : "s"}. ${gmailSyncResult.needsReplyCount} need replies, and ${gmailSyncResult.highPriorityCount} look high priority. No mailbox state was changed.`;
    } else if (requestedConnectorId === "gmail" && gmailSyncResult?.error) {
      reply = `Gmail is connected, but the read-only sync failed: ${gmailSyncResult.error}. I did not change your mailbox.`;
    } else {
      reply = results.length
      ? `I synced ${results.length} connector snapshot${results.length === 1 ? "" : "s"} in local/demo mode. Signals found: ${highlights.length ? highlights.join("; ") : "no urgent connector signal"}. No external system was changed.`
      : "I could not sync connector snapshots yet because no connector registry is available.";
    }
    tasks.push(
      { source: "Connectors", status: "active", text: "Sync local connector snapshots" },
      { source: "Amanda", status: "queued", text: "Summarize connector signals without external writes" },
    );
    memoryNote = "User asked Amanda to sync connectors.";
  } else if (intent.id === "external_action_request") {
    const lower = message.toLowerCase();
    const isCalendarFollowUp = intent.routedIntent === "calendar_prepare_event_followup";
    const action = intent.routedIntent === "calendar_prepare_event" || isCalendarFollowUp
      ? "create_event"
      : actionFromMessage(message);
    const connectorId = connectorIdFromMessage(
      message,
      action === "create_event" || action === "update_event" || action === "delete_event"
        ? "google_calendar"
        : action === "refund_order" || action === "cancel_order"
        ? "shopify"
        : action === "send_email"
          ? "gmail"
          : "whatsapp_business",
    );
    const calendarMessage = messageWithCalendarContext(message, routingMemory, intent);
    const followUpInfo = isCalendarFollowUp
      ? parseCalendarFollowUp(message, {
          basePayload:
            pendingCalendarApproval?.payload ||
            routingMemory?.pendingClarification?.partialPayload ||
            {},
          timezone:
            pendingCalendarApproval?.payload?.timeZone ||
            routingMemory?.pendingClarification?.partialPayload?.timeZone ||
            "Africa/Lagos",
        })
      : null;
    if (isCalendarFollowUp) {
      intent.debugCalendarFollowUp = followUpInfo;
      intent.usedFollowUpContext = true;
    }
    let payload =
      connectorId === "google_calendar" && action === "create_event"
        ? {
            ...calendarCreatePayloadFromMessage(calendarMessage),
            requestedFrom: "voice",
            userMessage: calendarMessage,
          }
        : {
            requestedFrom: "voice",
            subject: `Approval required: ${action.replaceAll("_", " ")}`,
            userMessage: message,
          };
    if (connectorId === "google_calendar" && action === "create_event") {
      intent.debugCalendarParser = {
        dateText: payload.dateLabel || "",
        durationMinutes: payload.durationMinutes || 30,
        location: payload.location || "",
        missingFields: payload.missingFields || [],
        start: payload.start || "",
        end: payload.end || "",
        timeText: payload.timeLabel || "",
        title: payload.title || "",
      };
    }

    if (isCalendarFollowUp && pendingCalendarApproval?.payload) {
      payload = {
        ...pendingCalendarApproval.payload,
        ...pickDefinedCalendarUpdates(followUpInfo),
        requestedFrom: "voice",
        subject: `Create calendar event: ${pendingCalendarApproval.payload.title || "An event"}`,
        userMessage: calendarMessage,
      };
      payload.location = payload.location || pendingCalendarApproval.payload.location || "";
      payload.timeZone = payload.timeZone || pendingCalendarApproval.payload.timeZone || "Africa/Lagos";
      intent.debugCalendarParser = {
        dateText: followUpInfo?.dateLabel || "",
        durationMinutes: payload.durationMinutes || 30,
        followUpType: followUpInfo?.followUpType || "",
        location: payload.location || "",
        missingFields: payload.missingFields || [],
        start: payload.start || "",
        end: payload.end || "",
        timeText: followUpInfo?.timeLabel || "",
        title: payload.title || "",
      };
    }

    if (
      connectorId === "google_calendar" &&
      action === "create_event" &&
      payload.missingFields?.length
    ) {
      reply = calendarClarification(payload);
      pendingClarification = {
        missingFields: payload.missingFields,
        partialPayload: payload,
        type: "calendar_event",
      };
      lastTaskType = "calendar_event";
      tasks.push(
        { source: "Calendar", status: "active", text: "Collect missing scheduling details" },
        { source: "Amanda", status: "queued", text: "Do not create weak calendar approval" },
      );
      memoryNote = "User asked to schedule a calendar event but Amanda needs clarification.";
    } else {
      const isPreview = lower.includes("preview");
      const requestOrPreview = connectors
        ? isPreview
          ? rememberAction("previewExternalAction", connectors.previewExternalAction(connectorId, action, payload))
          : rememberAction("requestConnectorApproval", connectors.requestApproval(connectorId, action, payload))
        : null;
      if (requestOrPreview && !isPreview) needsApproval.push({ ...requestOrPreview, type: "connector_action" });
      const isCalendarWrite = connectorId === "google_calendar";
      reply = requestOrPreview
        ? isPreview
          ? `I prepared a safe preview for ${action.replaceAll("_", " ")} through ${connectorId.replaceAll("_", " ")}. Nothing external happened; this action requires approval before execution.`
          : isCalendarWrite && action === "create_event"
            ? requestOrPreview.reused && !requestOrPreview.updated
              ? `I already prepared that calendar event for approval. You can approve or reject it from the approval queue.`
              : isCalendarFollowUp
                ? calendarFollowUpReply(followUpInfo?.followUpType, followUpInfo)
                : requestOrPreview.updated
                  ? `I updated the pending calendar approval with the new details: ${payload.title}, ${formatEventTime(payload.start)}${payload.location ? `, at ${payload.location}` : ""}.`
                  : `I prepared this calendar event for approval: ${payload.title}, ${formatEventTime(payload.start)}${payload.location ? `, at ${payload.location}` : ""}. I will not add it to Google Calendar until you approve it.`
            : isCalendarWrite
              ? `I prepared that calendar action for review. I will not move, cancel, delete, or modify your real Google Calendar.`
            : `I created an approval request for ${action.replaceAll("_", " ")}. I have not changed any external system. Review and approve it before anything is sent, refunded, cancelled, deleted, or updated.`
        : "That action would affect an external system, so I cannot execute it directly. I need an approval request before proceeding.";
      tasks.push(
        { source: "Approval", status: "active", text: `Review ${action.replaceAll("_", " ")} request` },
        { source: "Amanda", status: "queued", text: "Do not execute external side effect without approval" },
      );
      memoryNote = isCalendarFollowUp
        ? "User provided follow-up details for a pending calendar approval."
        : "User requested an external action that requires approval.";
      pendingClarification = connectorId === "google_calendar" && action === "create_event" ? null : pendingClarification;
      lastTaskType = connectorId === "google_calendar" ? "calendar_event" : null;
      intent.debugApproval = requestOrPreview
        ? {
            action: requestOrPreview.updated ? "updated" : requestOrPreview.reused ? "reused" : "created",
            deduped: Boolean(requestOrPreview.updated || requestOrPreview.reused),
            id: requestOrPreview.id || "",
            updatedExisting: Boolean(requestOrPreview.updated),
          }
        : null;
    }
  } else if (intent.id === "calendar") {
    const windows = topItems(data.calendarWindows, 2);
    reply = windows.length
      ? `I found ${windows.length} good scheduling window${windows.length === 1 ? "" : "s"}. Best option: ${windows[0].label}, because ${windows[0].reason}. I can draft the scheduling note and hold it for your approval.`
      : "I do not see calendar availability in the local workspace yet. I can draft a scheduling request and leave the exact time blank.";
    tasks.push(
      { source: "Calendar", status: "active", text: "Review available meeting windows" },
      { source: "Amanda", status: "queued", text: "Draft scheduling message" },
    );
    memoryNote = "User asked for scheduling help.";
  } else if (intent.id === "draft") {
    const target = data.customerMessages?.[0] || data.leads?.[0];
    reply = target?.customer
      ? `I can draft that reply for ${target.customer}. I would acknowledge ${target.topic}, give a clear next step, and keep the tone ${tone.toLowerCase()}. I will leave it as a draft for review.`
      : target?.name
        ? `I can draft the follow-up to ${target.name}. The angle should be ${target.nextStep}, with a concise CTA and no hard sell.`
        : `I can draft that. I will use a ${tone.toLowerCase()} tone, keep it concise, and avoid sending anything without approval.`;
    tasks.push(
      { source: "Amanda", status: "active", text: "Draft response for human review" },
      { source: "Amanda", status: "queued", text: "Check tone, context, and next step" },
    );
    memoryNote = "User asked Amanda to draft a message.";
  } else if (intent.id === "next_action") {
    const loop = openLoops[0];
    reply = loop
      ? `The next best action is ${loop}. After that, I would update the workspace queue so nothing customer-facing waits too long.`
      : "The next best action is to handle the urgent customer queue, then follow up with the highest-fit sales lead. That sequence protects trust first, then revenue.";
    tasks.push(
      { source: "Amanda", status: "active", text: "Select highest-priority operational action" },
      { source: "Amanda", status: "queued", text: "Prepare next-step checklist" },
    );
    memoryNote = "User asked for next action guidance.";
  } else if (intent.routedIntent === "calendar_followup_needs_target") {
    reply = "What should I apply that location or time update to? I do not have a pending calendar event to update yet.";
    tasks.push(
      { source: "Amanda", status: "active", text: "Clarify which calendar event needs the update" },
      { source: "Amanda", status: "queued", text: "Wait for a scheduling target before creating approval" },
    );
    memoryNote = "User provided a calendar-style follow-up without an active calendar context.";
  } else {
    const contextHint = recentTranscriptSummary(transcripts);
    reply = contextHint
      ? `I understand. Based on the recent workspace context, I will break this into an operations task, identify the affected system, and prepare the safest next action for review.`
      : `Understood. I will treat this as an operations request for ${company}, gather the relevant context, and prepare a concrete next step before making changes.`;
    tasks.push(
      { source: "Amanda", status: "active", text: "Interpret request against workspace context" },
      { source: "Amanda", status: "queued", text: "Identify affected tool and required next action" },
      { source: "Amanda", status: "queued", text: "Prepare review-ready recommendation" },
    );
    memoryNote = "User made a general operations request.";
  }

  if (
    intent.confidence >= 0.55 &&
    intent.requiresTool &&
    !/^I understood:/i.test(reply) &&
    !/^What |^Which /i.test(reply)
  ) {
    reply = `I understood: ${routeSummary(intent, message)}. ${reply}`;
  }

  return {
    actions,
    confidence: intent.confidence,
    drafts,
    intent: intent.routedIntent || intent.id,
    memory: {
      debugAgent: {
        approval: intent.debugApproval || null,
        calendarParser: intent.debugCalendarParser || (intent.debugCalendarFollowUp
          ? {
              dateText: intent.debugCalendarFollowUp.dateLabel || "",
              followUpType: intent.debugCalendarFollowUp.followUpType || "",
              location: intent.debugCalendarFollowUp.location || "",
              timeText: intent.debugCalendarFollowUp.timeLabel || "",
            }
          : null),
        confidence: intent.confidence,
        followUpType: intent.debugCalendarFollowUp?.followUpType || intent.entities?.followUpType || "",
        gmail: intent.debugGmail || null,
        intent: intent.routedIntent || intent.id,
        routedTo: intent.routedTo || intent.id,
        usedFollowUpContext: Boolean(intent.usedFollowUpContext),
      },
      lastIntent: intent.routedIntent || intent.id,
      lastTaskType,
      lastUserMessage: message,
      notes: [memoryNote],
      openLoops: tasks.slice(0, 2).map((task) => task.text),
      pendingClarification,
      updatedAt: new Date().toISOString(),
    },
    needsApproval,
    routedTo: intent.routedTo,
    reply,
    routedIntent: intent.routedIntent || intent.id,
    tasks,
    usedFollowUpContext: Boolean(intent.usedFollowUpContext),
  };
}

function extractOutputText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const parts = [];
  for (const item of payload?.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

function parseAgentJson(text) {
  const cleaned = cleanText(text)
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "");
  return JSON.parse(cleaned);
}

function safeGeminiContext(context = {}) {
  const data = context.businessData || {};
  return {
    approvals: (data.approvalRequests || [])
      .filter((item) => item.status === "pending" || item.status === "needs_approval")
      .slice(0, 8),
    calendar: (data.calendarEvents || []).slice(0, 16),
    gmail: (data.gmailMessages || []).slice(0, 12),
    tasks: (data.tasks || context.workspace?.tasks || []).slice(0, 12),
  };
}

function findGmailMessageForDraft(context, draft = {}) {
  const messages = context.businessData?.gmailMessages || [];
  return messages.find((message) => message.id === draft.messageId || message.providerMessageId === draft.messageId) || null;
}

function updateGmailDraftApprovalPreview(context, draft) {
  const requests = context.businessData?.approvalRequests || [];
  const request = requests.find((item) => item.id === draft.approvalRequestId || item.payload?.draftId === draft.id);
  if (!request) return;
  request.payload = {
    ...(request.payload || {}),
    bodyPreview: String(draft.body || "").slice(0, 240),
    draftId: draft.id,
    messageId: draft.messageId,
    subject: draft.subject,
    to: draft.to,
  };
  request.updatedAt = new Date().toISOString();
}

async function enhanceGmailDraftsWithGemini(result, context) {
  const drafts = (result?.drafts || []).filter((draft) => draft.connectorId === "gmail" && draft.status === "needs_approval");
  if (!drafts.length) return result;

  let enhanced = 0;
  for (const draft of drafts.slice(0, 3)) {
    const email = findGmailMessageForDraft(context, draft);
    if (!email) continue;
    try {
      const aiDraft = await draftEmailReply({
        businessContext: safeGeminiContext(context),
        email,
      });
      if (!aiDraft?.body) continue;
      draft.body = cleanText(aiDraft.body).replace(/\\n/g, "\n");
      draft.subject = cleanText(aiDraft.subject) || draft.subject;
      updateGmailDraftApprovalPreview(context, draft);
      enhanced += 1;
    } catch (error) {
      result.memory = {
        ...(result.memory || {}),
        notes: [...(result.memory?.notes || []), `Gemini Gmail draft fallback: ${error.message}`].slice(-5),
      };
    }
  }

  if (enhanced > 0) {
    result.memory = {
      ...(result.memory || {}),
      debugAgent: {
        ...(result.memory?.debugAgent || {}),
        brain: "gemini",
        gmail: {
          ...(result.memory?.debugAgent?.gmail || {}),
          geminiDraftsEnhanced: enhanced,
        },
      },
    };
  }
  return result;
}

function shouldUseGeminiDecision(localResult = {}) {
  return (
    localResult.intent === "unknown" ||
    localResult.intent === "general_ops" ||
    localResult.routedTo === "general.fallback" ||
    Number(localResult.confidence || 0) < 0.55
  );
}

function signalsForAttention(context = {}) {
  const data = context.businessData || {};
  return [
    ...(data.gmailMessages || []).filter((message) => message.priority === "high" || message.needsReply).slice(0, 6).map((message) => ({
      source: "Gmail",
      title: message.subject,
      reason: message.needsReply ? "Needs a reply" : "High priority",
    })),
    ...(data.calendarEvents || []).slice(0, 5).map((event) => ({
      source: "Calendar",
      title: event.title,
      reason: event.start ? `Scheduled for ${event.start}` : "Upcoming calendar item",
    })),
    ...(data.approvalRequests || []).filter((item) => item.status === "pending" || item.status === "needs_approval").slice(0, 5).map((item) => ({
      source: "Approvals",
      title: item.summary || item.subject,
      reason: `${item.connectorId || "Amanda"} action is waiting for approval`,
    })),
    ...(data.tasks || []).filter((task) => task.status === "open").slice(0, 5).map((task) => ({
      source: "Tasks",
      title: task.title || task.text,
      reason: task.priority ? `${task.priority} priority` : "Open task",
    })),
  ];
}

async function enhanceAttentionWithGemini(result, context) {
  if (!["operations_summary", "attention_today", "attention_summary"].includes(result.intent)) return result;
  try {
    const attention = await getUnifiedAttentionSummary(context.user?.id || "", {
      businessData: context.businessData || {},
      connectors: context.connectors?.listConnectors?.() || context.businessData?.connectors || [],
      useGemini: true,
    });
    result.reply = attention.spokenReply;
    result.intent = "attention_summary";
    result.routedTo = "attention.getUnifiedAttentionSummary";
    result.memory = {
      ...(result.memory || {}),
      debugAgent: {
        ...(result.memory?.debugAgent || {}),
        attention: {
          highPriorityCount: attention.items.filter((item) => item.priority === "high").length,
          itemsFound: attention.items.length,
          sources: attention.sources,
        },
        brain: attention.brain === "gemini" ? "gemini" : "deterministic",
        routedTo: "attention.getUnifiedAttentionSummary",
        safetyDecision: "allowed",
      },
      pendingClarification: null,
    };
  } catch (error) {
    result.memory = {
      ...(result.memory || {}),
      notes: [...(result.memory?.notes || []), `Gemini attention fallback: ${error.message}`].slice(-5),
    };
  }
  return result;
}

function executeGeminiToolDecision(decision, context, fallback) {
  const safety = enforceGeminiDecision(decision);
  const debugAgent = {
    brain: "gemini",
    confidence: Number(decision?.confidence || 0),
    intent: cleanText(decision?.intent) || "gemini_decision",
    routedTo: cleanText(decision?.tool) || "",
    safetyDecision: safety.decision,
    tool: cleanText(decision?.tool) || "",
  };

  if (safety.blocked) {
    return {
      ...fallback,
      confidence: Math.max(Number(decision?.confidence || 0.75), 0.75),
      intent: cleanText(decision?.intent) || "blocked_action",
      memory: {
        ...(fallback.memory || {}),
        debugAgent,
      },
      reply: safety.reply,
      routedTo: safety.tool,
    };
  }

  if (decision?.intent === "clarification") {
    return {
      ...fallback,
      confidence: Number(decision.confidence || 0.75),
      intent: "clarification",
      memory: {
        ...(fallback.memory || {}),
        debugAgent,
        pendingClarification: {
          missingFields: decision.missingFields || [],
          partialPayload: decision.entities || {},
          type: "gemini",
        },
      },
      reply: cleanText(decision.reply) || "Can you clarify what you want Amanda to do next?",
      routedTo: "gemini.clarification",
    };
  }

  const tools = context.tools;
  const entities = decision.entities || {};
  if (safety.tool === "gmail.searchMessages" && tools?.gmailSearchMessages) {
    const matches = tools.gmailSearchMessages({
      keyword: entities.keyword || entities.topic || "",
      query: entities.query || entities.sender || entities.senderNameOrEmail || entities.keyword || "",
      senderNameOrEmail: entities.sender || entities.senderNameOrEmail || "",
    });
    return {
      ...fallback,
      confidence: Number(decision.confidence || 0.75),
      intent: cleanText(decision.intent) || "gmail_search",
      memory: { ...(fallback.memory || {}), debugAgent },
      reply: matches.length
        ? `I found ${matches.length} matching Gmail email${matches.length === 1 ? "" : "s"}. The latest is "${matches[0].subject}".`
        : cleanText(decision.reply) || "I did not find matching Gmail messages in the local sync.",
      routedTo: safety.tool,
    };
  }

  if (safety.tool === "gmail.summarizeUnread" && tools?.gmailSummarizeUnreadEmails) {
    const summary = tools.gmailSummarizeUnreadEmails();
    return {
      ...fallback,
      confidence: Number(decision.confidence || 0.75),
      intent: cleanText(decision.intent) || "gmail_summary",
      memory: { ...(fallback.memory || {}), debugAgent },
      reply: `You have ${summary.unreadCount || 0} unread email${summary.unreadCount === 1 ? "" : "s"}. ${summary.needsReplyCount || 0} need replies and ${summary.highPriorityCount || 0} look high priority.`,
      routedTo: safety.tool,
    };
  }

  if (safety.tool === "approvals.list" && tools?.listNeedsApproval) {
    const approvals = tools.listNeedsApproval();
    return {
      ...fallback,
      confidence: Number(decision.confidence || 0.75),
      intent: cleanText(decision.intent) || "needs_approval",
      memory: { ...(fallback.memory || {}), debugAgent },
      needsApproval: approvals,
      reply: approvals.length
        ? `${approvals.length} action${approvals.length === 1 ? " is" : "s are"} waiting for approval.`
        : "No actions are waiting for approval right now.",
      routedTo: safety.tool,
    };
  }

  return {
    ...fallback,
    confidence: Number(decision?.confidence || fallback.confidence),
    intent: cleanText(decision?.intent) || fallback.intent,
    memory: { ...(fallback.memory || {}), debugAgent },
    reply: cleanText(decision?.reply) || fallback.reply,
    routedTo: safety.tool || fallback.routedTo,
  };
}

async function generateGeminiHybridResponse(context, localResult) {
  if (!shouldUseGeminiDecision(localResult)) return null;
  const decision = await generateAgentDecision({
    availableTools: getAvailableTools(),
    context: safeGeminiContext(context),
    userMessage: context.message,
  });
  if (!decision) return null;
  return executeGeminiToolDecision(decision, context, localResult);
}

async function generateOpenAIResponse(context) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || process.env.AMANDA_ENABLE_OPENAI_BRAIN !== "true" || typeof fetch !== "function") {
    return null;
  }

  const localDraft = buildLocalResponse(context);
  const payload = {
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify({
              businessData: context.businessData,
              localDraft,
              message: context.message,
              recentTranscripts: context.transcripts?.slice(-8),
              settings: context.settings,
              user: {
                company: context.user?.company,
                name: context.user?.name,
              },
              workspace: context.workspace,
            }),
          },
        ],
      },
    ],
    instructions:
      "You are Amanda, a voice-first AI operations employee for a small business. Return strict JSON with reply, intent, confidence, tasks, and memory. Keep reply under 95 words, concrete, calm, and action-oriented. Never claim you completed external actions; say you prepared, reviewed, queued, or recommend actions unless data proves completion.",
    max_output_tokens: 700,
    model: process.env.AMANDA_OPENAI_MODEL || DEFAULT_MODEL,
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`OpenAI response failed with ${response.status}`);
  }

  const data = await response.json();
  const parsed = parseAgentJson(extractOutputText(data));
  if (!parsed?.reply || !Array.isArray(parsed.tasks)) {
    throw new Error("OpenAI response did not match Amanda agent shape.");
  }
  return parsed;
}

function normalizeAgentResult(result, fallbackContext) {
  const resultIsComplete = Boolean(result?.reply && Array.isArray(result?.tasks) && result?.memory);
  const fallback = resultIsComplete ? result : buildLocalResponse(fallbackContext);
  const tasks = Array.isArray(result?.tasks) && result.tasks.length ? result.tasks : fallback.tasks;
  return {
    actions: Array.isArray(result?.actions) ? result.actions : fallback.actions || [],
    confidence: Number.isFinite(Number(result?.confidence))
      ? Math.max(0, Math.min(1, Number(result.confidence)))
      : fallback.confidence,
    drafts: Array.isArray(result?.drafts) ? result.drafts : fallback.drafts || [],
    intent: cleanText(result?.intent) || fallback.intent,
    memory: {
      ...fallback.memory,
      ...(result?.memory && typeof result.memory === "object" ? result.memory : {}),
    },
    needsApproval: Array.isArray(result?.needsApproval)
      ? result.needsApproval
      : fallback.needsApproval || [],
    reply: cleanText(result?.reply) || fallback.reply,
    routedTo: cleanText(result?.routedTo) || fallback.routedTo,
    tasks: tasks.slice(0, 5).map((task, index) => ({
      source: cleanText(task.source) || (index === 0 ? "Amanda" : "Workspace"),
      status: ["active", "queued", "success", "thinking"].includes(task.status)
        ? task.status
        : index === 0
          ? "active"
          : "queued",
      text: cleanText(task.text) || fallback.tasks[index]?.text || "Prepare next operational step",
    })),
    usedFollowUpContext: Boolean(result?.usedFollowUpContext || fallback.usedFollowUpContext),
  };
}

export async function generateAmandaResponse(context) {
  const safeContext = {
    businessData: {},
    connectors: null,
    memory: {},
    message: "",
    settings: {},
    transcripts: [],
    user: null,
    workspace: {},
    ...context,
  };

  const localResult = normalizeAgentResult(buildLocalResponse(safeContext), safeContext);

  try {
    const geminiResult = await generateGeminiHybridResponse(safeContext, localResult);
    if (geminiResult) {
      const normalizedGemini = normalizeAgentResult(geminiResult, safeContext);
      await enhanceGmailDraftsWithGemini(normalizedGemini, safeContext);
      await enhanceAttentionWithGemini(normalizedGemini, safeContext);
      return normalizedGemini;
    }
  } catch (error) {
    localResult.memory = {
      ...(localResult.memory || {}),
      notes: [...(localResult.memory?.notes || []), `Gemini brain fallback: ${error.message}`].slice(-5),
      debugAgent: {
        ...(localResult.memory?.debugAgent || {}),
        brain: "local",
        geminiFallback: error.message,
      },
    };
  }

  await enhanceGmailDraftsWithGemini(localResult, safeContext);
  await enhanceAttentionWithGemini(localResult, safeContext);

  try {
    const aiResult = await generateOpenAIResponse(safeContext);
    if (aiResult) return normalizeAgentResult(aiResult, safeContext);
  } catch (error) {
    console.warn(`Amanda OpenAI brain fallback: ${error.message}`);
  }

  return normalizeAgentResult(localResult, safeContext);
}
