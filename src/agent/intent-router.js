const connectorNames = [
  "airtable",
  "calendar",
  "flutterwave",
  "gmail",
  "google calendar",
  "hubspot",
  "notion",
  "paystack",
  "sheets",
  "shopify",
  "slack",
  "whatsapp",
];

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\bdraught\b/g, "draft")
    .replace(/[.,!?]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(text, patterns) {
  return patterns.some((pattern) =>
    pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern),
  );
}

function extractAfter(text, pattern) {
  const match = text.match(pattern);
  return match?.[1]?.trim().replace(/[.?!]+$/g, "") || "";
}

function senderQuery(text) {
  return (
    extractAfter(text, /\bfind emails from\s+(.+)$/i) ||
    extractAfter(text, /\bcheck if\s+(.+?)\s+emailed me$/i) ||
    extractAfter(text, /\bsummarize emails from\s+(.+)$/i) ||
    extractAfter(text, /\bdraft a reply to the latest email from\s+(.+)$/i)
  );
}

function keywordQuery(text) {
  return (
    extractAfter(text, /\bsearch my inbox for\s+(.+)$/i) ||
    extractAfter(text, /\bfind emails about\s+(.+)$/i) ||
    extractAfter(text, /\bsearch gmail for\s+(.+)$/i)
  );
}

function followUpKind(text) {
  if (/^(yes|yeah|yep|approve it|approve|confirm)$/i.test(text)) return "confirmation";
  if (/\bfor\s+(?:\d+(?:\.\d+)?|one|two|three|four)\s+(?:hour|hours|minute|minutes)\b/i.test(text)) return "duration";
  if (/\b(?:make it|move it to|change it to|set it to|set it for|at|by)?\s*\d{1,2}(?::\d{2})?\s*(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)\b/i.test(text)) return "time";
  if (/^(?:make it|move it|change it|update it|set it)\b.*\b(today|tomorrow|next\s+\w+|monday|tuesday|wednesday|thursday|friday|saturday|sunday|may\s+\d{1,2})\b/i.test(text)) return "date";
  if (
    /^(at|in|on)\s+\S+/i.test(text) ||
    /\b(?:the\s+)?location\s+is\b/i.test(text) ||
    /\b(?:change|set)\s+(?:the\s+)?location\s+to\b/i.test(text) ||
    /\bmake\s+(?:the\s+)?location\b/i.test(text) ||
    /\buse\s+.+\s+as\s+the\s+location\b/i.test(text)
  ) return "location";
  if (/^(make it|change it|move it|set it)\b/i.test(text)) return "change";
  return "";
}

function isExplicitCalendarRead(text) {
  return hasAny(text, [
    "check my calendar today",
    "show my calendar today",
    "what is on my calendar today",
    "what's on my calendar today",
    "what do i have today",
    "do i have meetings today",
    "what meetings do i have today",
    "check my calendar tomorrow",
    "show my calendar tomorrow",
    "what is on my calendar tomorrow",
    "what's on my calendar tomorrow",
    "what meetings do i have tomorrow",
    "summarize my calendar",
    "give me my calendar summary",
    "calendar summary",
    "find free slots",
    "free slots",
    "when am i free",
  ]);
}

function messageLooksLikeCalendarUpdate(text) {
  const raw = String(text || "").trim();
  const lower = normalize(raw);
  if (!raw || isExplicitCalendarRead(lower) || looksLikeFullCalendarRequest(lower)) return false;
  return (
    /^(?:at|by|for)?\s*\d{1,2}(?::\d{2})?\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|am|pm)\.?$/i.test(raw) ||
    /^(?:make it|set it for|set it to|change it to|move it to)\s+\d{1,2}(?::\d{2})?\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|am|pm)\.?$/i.test(raw) ||
    /^(?:at|in|on)\s+.{2,60}$/i.test(raw) ||
    /^for\s+(?:\d+(?:\.\d+)?|one|two|three|four)\s+(?:hour|hours|minute|minutes)\.?$/i.test(raw) ||
    /^(?:make|change|update|move|set)\s+it\b/i.test(raw) ||
    /^set\s+(?:the\s+)?(?:location|time|date)\b/i.test(raw) ||
    /^(?:location is|the location is)\b/i.test(raw) ||
    /^make\s+(?:the\s+)?location\b/i.test(raw) ||
    /^use\s+.+\s+as\s+the\s+location\.?$/i.test(raw)
  );
}

function calendarEntityHints(text) {
  const entities = {};
  const location = text.match(
    /\b(?:the\s+)?location\s+is\s+(?:at\s+)?(.+?)$|\b(?:change|set)\s+(?:the\s+)?location\s+to\s+(.+?)$|\buse\s+(.+?)\s+as\s+the\s+location$|^(?:at|in|on)\s+(.+?)$/i,
  );
  const time = text.match(/\b(?:at|by|for|make it|set it for|set it to|change it to|move it to)?\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|am|pm))\b/i);
  const date = text.match(/\b(today|tomorrow|next\s+\w+|monday|tuesday|wednesday|thursday|friday|saturday|sunday|may\s+\d{1,2})\b/i);
  const duration = text.match(/\bfor\s+((?:\d+(?:\.\d+)?|one|two|three|four)\s+(?:hour|hours|minute|minutes))\b/i);
  if (location) entities.location = [location[1], location[2], location[3], location[4]].find(Boolean)?.trim();
  if (time) entities.time = time[1].trim();
  if (date) entities.date = date[1].trim();
  if (duration) entities.duration = duration[1].trim();
  return entities;
}

function hasCalendarFollowUpContext(memory = {}) {
  const pending = memory.pendingClarification;
  const pendingApproval = memory.pendingCalendarApproval;
  return Boolean(
    pending?.type === "calendar_event" ||
    memory.lastIntent === "calendar_prepare_event" ||
    (pendingApproval &&
      pendingApproval.connectorId === "google_calendar" &&
      pendingApproval.action === "create_event" &&
      pendingApproval.status === "pending"),
  );
}

function looksLikeFullCalendarRequest(text) {
  return hasAny(text, [
    /\b(schedule|book|create|set)\b.*\b(meeting|event|appointment|call|calendar)\b/,
    /\b(schedule|book|create|set)\b.*\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next\b|at\s+\d)/,
    /\b(meeting|event|appointment|call)\b.*\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next\b|at\s+\d)/,
  ]);
}

export function routeIntent(message, options = {}) {
  const raw = String(message || "").trim();
  const text = normalize(raw);
  const memory = options.memory || {};
  const followUp = followUpKind(raw);

  if (
    hasAny(text, [
      "what needs my attention today",
      "what should i focus on today",
      "what should i handle first",
      "what is urgent today",
      "give me my business priorities",
      "what are my top priorities",
      "top priorities",
      "business priorities",
    ])
  ) {
    return {
      confidence: 0.97,
      entities: {},
      intent: "attention_summary",
      requiresTool: true,
      routedTo: "attention.getUnifiedAttentionSummary",
      usedFollowUpContext: false,
    };
  }

  if (hasAny(text, ["sync google calendar", "sync calendar"])) {
    return {
      confidence: 0.97,
      entities: { connectorId: "google_calendar" },
      intent: "calendar_sync",
      requiresTool: true,
      routedTo: "connectors.syncGoogleCalendar",
      usedFollowUpContext: false,
    };
  }

  if (
    hasAny(text, [
      "what is on my calendar today",
      "what's on my calendar today",
      "check my calendar today",
      "show my calendar today",
      "calendar today",
      "what do i have today",
      "do i have meetings today",
      "what meetings do i have today",
    ])
  ) {
    return {
      confidence: 0.96,
      entities: { range: "today" },
      intent: "calendar_today",
      requiresTool: true,
      routedTo: "calendar.today",
      usedFollowUpContext: false,
    };
  }

  if (
    hasAny(text, [
      "meetings do i have tomorrow",
      "what meetings do i have tomorrow",
      "check my calendar tomorrow",
      "show my calendar tomorrow",
      "what is on my calendar tomorrow",
      "what's on my calendar tomorrow",
      "calendar tomorrow",
      "my calendar tomorrow",
    ])
  ) {
    return {
      confidence: 0.96,
      entities: { range: "tomorrow" },
      intent: "calendar_tomorrow",
      requiresTool: true,
      routedTo: "calendar.tomorrow",
      usedFollowUpContext: false,
    };
  }

  if (hasAny(text, ["summarize my calendar", "summarize calendar", "give me my calendar summary", "summarize my week", "calendar summary"])) {
    return {
      confidence: 0.94,
      entities: { range: text.includes("week") ? "week" : "calendar" },
      intent: "calendar_summary",
      requiresTool: true,
      routedTo: "calendar.summary",
      usedFollowUpContext: false,
    };
  }

  if (hasAny(text, ["find free slots", "free slots", "when am i free", "free time", "availability"])) {
    return {
      confidence: 0.93,
      entities: {},
      intent: "calendar_find_slots",
      requiresTool: true,
      routedTo: "calendar.findSlots",
      usedFollowUpContext: false,
    };
  }

  if (looksLikeFullCalendarRequest(text)) {
    return {
      confidence: 0.95,
      entities: calendarEntityHints(raw),
      intent: "calendar_prepare_event",
      requiresTool: true,
      routedTo: "calendar.prepareEvent",
      usedFollowUpContext: false,
    };
  }

  if (hasAny(text, ["what needs approval", "actions need approval", "needs approval", "waiting for approval", "what actions are waiting for approval", "show approval queue", "approval queue"])) {
    return {
      confidence: 0.94,
      entities: {},
      intent: "needs_approval",
      requiresTool: true,
      routedTo: "approvals.list",
      usedFollowUpContext: false,
    };
  }

  if (hasAny(text, ["connect gmail", "link gmail"])) {
    return {
      confidence: 0.98,
      entities: { connectorId: "gmail" },
      intent: "gmail_connect",
      requiresTool: false,
      routedTo: "gmail.connect",
      usedFollowUpContext: false,
    };
  }

  if (hasAny(text, ["sync gmail", "refresh gmail"])) {
    return {
      confidence: 0.98,
      entities: { connectorId: "gmail" },
      intent: "gmail_sync",
      requiresTool: true,
      routedTo: "gmail.sync",
      usedFollowUpContext: false,
    };
  }

  if (hasAny(text, ["summarize my unread emails", "summarize unread emails", "summarize unread gmail", "unread emails"])) {
    return {
      confidence: 0.96,
      entities: {},
      intent: "gmail_summarize_unread",
      requiresTool: true,
      routedTo: "gmail.summarizeUnread",
      usedFollowUpContext: false,
    };
  }

  if (hasAny(text, ["find customer emails from today", "customer emails from today", "emails from today"])) {
    return {
      confidence: 0.94,
      entities: { receivedOn: new Date().toISOString().slice(0, 10) },
      intent: "gmail_customer_today",
      requiresTool: true,
      routedTo: "gmail.findCustomerToday",
      usedFollowUpContext: false,
    };
  }

  if (hasAny(text, ["find quote requests", "quote requests", "pricing inquiries", "pricing inquiry emails"])) {
    return {
      confidence: 0.96,
      entities: {},
      intent: "gmail_quote_requests",
      requiresTool: true,
      routedTo: "gmail.findQuoteRequests",
      usedFollowUpContext: false,
    };
  }

  if (
    hasAny(text, [
      "draft important emails",
      "draft important email",
      "draft important gmail",
      "draft important gmail emails",
      "prepare important emails",
      "draft replies for important emails",
      "draft replies for important email",
      "draft replies for important gmail",
      "draft replies for emails",
      "create replies for important emails",
      "create replies for important email",
      "write replies for important emails",
      "write replies for important email",
      "create a reply for important email",
      "create a reply for important emails",
      "write a reply for important email",
      "write a reply for important emails",
    ]) ||
    /\b(?:draft|create|write)\s+(?:replies|responses)\s+for\s+important\s+(?:gmail\s+)?emails?\b/.test(text) ||
    /\b(?:create|write)\s+a\s+reply\s+for\s+important\s+(?:gmail\s+)?emails?\b/.test(text)
  ) {
    return {
      confidence: 0.97,
      entities: {},
      intent: "gmail_draft_replies",
      requiresTool: true,
      routedTo: "gmail.draftRepliesForImportantEmails",
      usedFollowUpContext: false,
    };
  }

  if (
    hasAny(text, [
      "draft latest email",
      "draft latest gmail",
      "draft latest gmail email",
      "draft last email",
      "draft last gmail",
      "prepare latest email",
      "prepare reply latest email",
      "reply latest email",
      "create email draft",
      "create gmail draft",
      "create a gmail draft",
      "create latest gmail draft",
      "create email reply",
      "create latest reply",
      "create gmail reply",
      "create reply for latest email",
      "create reply for my latest email",
      "gmail draft",
      "email draft",
      "draft a reply to the latest gmail email",
      "draft a reply to the latest email",
      "write a reply to the latest gmail email",
      "create a reply to the latest gmail email",
      "create a reply for the latest gmail email",
      "write a reply for the latest gmail email",
      "draft a reply for the latest gmail email",
    ]) ||
    /\b(?:draft|write|create)\s+a\s+reply\s+to\s+the\s+latest\s+gmail\s+email\b/.test(text) ||
    /\b(?:draft|write|create)\s+a\s+reply\s+to\s+the\s+latest\s+email\b/.test(text) ||
    /\b(?:draft|write|create)\s+a\s+reply\s+for\s+the\s+latest\s+gmail\s+email\b/.test(text) ||
    /\b(?:draft|write|create)\s+a\s+reply\s+for\s+the\s+latest\s+email\b/.test(text) ||
    /\b(?:draft|prepare|reply|create)\s+(?:the\s+)?(?:latest|last)\s+(?:gmail\s+)?email\b/.test(text) ||
    /\b(?:create\s+)?(?:gmail|email)\s+draft\b/.test(text)
  ) {
    if (/\bfrom\s+\S+/.test(text)) {
      // Let sender-specific draft routing handle "latest email from X".
    } else {
    return {
      confidence: 0.97,
      entities: {},
      intent: "gmail_draft_latest_email",
      requiresTool: true,
      routedTo: "gmail.draftLatestEmail",
      usedFollowUpContext: false,
    };
    }
  }

  if (hasAny(text, ["what emails need my attention", "important emails", "email attention", "what gmail needs my attention"])) {
    return {
      confidence: 0.95,
      entities: {},
      intent: "gmail_attention",
      requiresTool: true,
      routedTo: "gmail.findImportant",
      usedFollowUpContext: false,
    };
  }

  if (
    hasAny(text, [
      "draft a reply to the bulk order email",
      "draft a reply to the quote email",
      "draft a reply to the complaint email",
      "draft a reply to the delivery issue email",
      "draft a reply to the email",
    ]) ||
    (/\bdraft\s+a\s+reply\b.*\b(email|gmail|thread)\b/.test(text) && !/\bdraft a reply to the latest email from\b/.test(text))
  ) {
    return {
      confidence: 0.95,
      entities: {},
      intent: "gmail_draft_single_reply",
      requiresTool: true,
      routedTo: "gmail.draftSingleReply",
      usedFollowUpContext: false,
    };
  }

  if (hasAny(text, ["what gmail actions need approval", "gmail actions need approval", "gmail approvals"])) {
    return {
      confidence: 0.96,
      entities: {},
      intent: "gmail_needs_approval",
      requiresTool: true,
      routedTo: "gmail.needsApproval",
      usedFollowUpContext: false,
    };
  }

  if (
    hasAny(text, ["find emails from", "summarize emails from"]) ||
    /\bfind emails from\s+.+$/i.test(text) ||
    /\bcheck if\s+.+\s+emailed me$/i.test(text) ||
    /\bsummarize emails from\s+.+$/i.test(text)
  ) {
    const sender = senderQuery(raw);
    return {
      confidence: 0.95,
      entities: {
        query: sender ? `from:${sender}` : "",
        senderNameOrEmail: sender,
      },
      intent: raw.toLowerCase().startsWith("summarize")
        ? "gmail_summarize_sender"
        : "gmail_search_sender",
      requiresTool: true,
      routedTo: raw.toLowerCase().startsWith("summarize")
        ? "gmail.summarizeSender"
        : "gmail.searchSender",
      usedFollowUpContext: false,
    };
  }

  if (
    hasAny(text, ["search my inbox for", "find emails about", "search gmail for"]) ||
    /\bsearch my inbox for\s+.+$/i.test(text) ||
    /\bfind emails about\s+.+$/i.test(text) ||
    /\bsearch gmail for\s+.+$/i.test(text)
  ) {
    const keyword = keywordQuery(raw);
    return {
      confidence: 0.95,
      entities: {
        keyword,
        query: keyword,
      },
      intent: "gmail_search_keyword",
      requiresTool: true,
      routedTo: "gmail.searchKeyword",
      usedFollowUpContext: false,
    };
  }

  if (
    hasAny(text, ["draft a reply to the latest email from", "draft a reply to the latest gmail from"]) ||
    /\bdraft a reply to the latest email from\s+.+$/i.test(text)
  ) {
    const sender = senderQuery(raw);
    return {
      confidence: 0.96,
      entities: {
        query: sender ? `from:${sender}` : "",
        senderNameOrEmail: sender,
      },
      intent: "gmail_draft_reply_to_sender",
      requiresTool: true,
      routedTo: "gmail.draftReplyToSender",
      usedFollowUpContext: false,
    };
  }

  if (
    hasAny(text, ["send the email", "send email"]) ||
    (text.includes("send") && text.includes("email"))
  ) {
    return {
      confidence: 0.95,
      entities: {},
      intent: "gmail_send_blocked",
      requiresTool: false,
      routedTo: "gmail.sendBlocked",
      usedFollowUpContext: false,
    };
  }

  if (text && hasCalendarFollowUpContext(memory) && messageLooksLikeCalendarUpdate(raw) && followUp) {
    return {
      confidence: followUp === "confirmation" ? 0.72 : 0.9,
      entities: { ...calendarEntityHints(raw), followUp, followUpType: followUp },
      intent: followUp === "confirmation" ? "calendar_approve_explanation" : "calendar_prepare_event_followup",
      requiresTool: followUp !== "confirmation",
      routedTo: followUp === "confirmation" ? "calendar.explainApproval" : "calendar.updatePendingApproval",
      usedFollowUpContext: true,
    };
  }

  if (
    text &&
    ["location", "time", "date", "duration", "change"].includes(followUp) &&
    messageLooksLikeCalendarUpdate(raw) &&
    !looksLikeFullCalendarRequest(text) &&
    String(raw).trim().split(/\s+/).length <= 8 &&
    !hasAny(text, ["needs my attention", "attention today", "business summary", "what needs attention", "daily business summary"])
  ) {
    return {
      confidence: 0.86,
      entities: { ...calendarEntityHints(raw), followUp, followUpType: followUp },
      intent: "calendar_followup_needs_target",
      requiresTool: false,
      routedTo: "calendar.askFollowUpTarget",
      usedFollowUpContext: false,
    };
  }

  if (hasAny(text, ["what needs my attention", "attention today", "daily business summary", "business summary"])) {
    return {
      confidence: 0.94,
      entities: {},
      intent: "attention_summary",
      requiresTool: true,
      routedTo: "attention.getUnifiedAttentionSummary",
      usedFollowUpContext: false,
    };
  }

  // ── Website connector intents (must run before generic operations fallback) ──

  if (
    hasAny(text, [
      "abandoned checkout",
      "abandoned checkouts",
      "show abandoned checkout",
      "show abandoned checkouts",
      "any abandoned checkout",
      "any abandoned checkouts",
      "website abandoned checkout",
      "website abandoned checkouts",
    ])
  ) {
    return {
      confidence: 0.97,
      entities: { type: "abandoned_checkout" },
      intent: "website_abandoned_checkouts",
      requiresTool: true,
      routedTo: "website.getAbandonedCheckouts",
      usedFollowUpContext: false,
    };
  }

  if (
    hasAny(text, [
      "failed payment",
      "failed payments",
      "any failed payment",
      "any failed payments",
      "show failed payments",
      "website failed payments",
      "payment failed",
      "payment failures",
    ])
  ) {
    return {
      confidence: 0.97,
      entities: { type: "failed_payment" },
      intent: "website_failed_payments",
      requiresTool: true,
      routedTo: "website.getFailedPayments",
      usedFollowUpContext: false,
    };
  }

  if (
    hasAny(text, [
      "delivery complaint",
      "delivery complaints",
      "customer complaint",
      "customer complaints",
      "any complaints",
      "show complaints",
      "website complaints",
      "customer complaints from website",
      "any delivery complaints",
    ])
  ) {
    return {
      confidence: 0.96,
      entities: { type: "delivery_complaint" },
      intent: "website_complaints",
      requiresTool: true,
      routedTo: "website.getComplaints",
      usedFollowUpContext: false,
    };
  }

  if (
    hasAny(text, [
      "high value inquiry",
      "high value inquiries",
      "high value lead",
      "high value leads",
      "show high value leads",
      "bulk order inquiries",
      "show bulk orders",
      "high value website leads",
      "show high value website leads",
      "website high value leads",
    ])
  ) {
    return {
      confidence: 0.96,
      entities: {},
      intent: "website_high_value_leads",
      requiresTool: true,
      routedTo: "website.getHighValueLeads",
      usedFollowUpContext: false,
    };
  }

  if (
    hasAny(text, [
      "website events",
      "check website",
      "check website events",
      "what happened on my website",
      "what happened on my website today",
      "website activity",
      "show website events",
      "website leads",
      "show website leads",
    ])
  ) {
    return {
      confidence: 0.96,
      entities: {},
      intent: "website_events",
      requiresTool: true,
      routedTo: "website.getEvents",
      usedFollowUpContext: false,
    };
  }

  if (
    hasAny(text, [
      "website summary",
      "website report",
      "how is my website doing",
      "what is happening on my website",
      "website",
    ]) ||
    /\bwebsite\b.*\bsummary\b/.test(text) ||
    /\bwebsite\b.*\breport\b/.test(text)
  ) {
    return {
      confidence: 0.95,
      entities: {},
      intent: "website_summary",
      requiresTool: true,
      routedTo: "website.getSummary",
      usedFollowUpContext: false,
    };
  }

  // ── End website connector intents ─────────────────────────────────────────

  // ── Google Sheets intents ─────────────────────────────────────────────────

  if (
    hasAny(text, [
      "what product sold the most from my sheet",
      "top product in my sheet",
      "best selling product in sheet",
      "what sold most in my sheet",
      "top seller from my sheet",
    ]) ||
    /\b(?:top|best)\s+(?:selling|seller|product)\b.*\bsheet\b/.test(text)
  ) {
    return {
      confidence: 0.96,
      entities: {},
      intent: "sheets_top_product",
      requiresTool: true,
      routedTo: "sheets.topProduct",
      usedFollowUpContext: false,
    };
  }

  if (
    hasAny(text, [
      "any low stock items in my sheet",
      "low stock items in sheet",
      "what is low stock in my sheet",
      "inventory low stock from sheet",
      "show low stock from sheet",
    ]) ||
    /\blow\s+stock\b.*\bsheet\b/.test(text)
  ) {
    return {
      confidence: 0.96,
      entities: {},
      intent: "sheets_low_stock",
      requiresTool: true,
      routedTo: "sheets.lowStock",
      usedFollowUpContext: false,
    };
  }

  if (
    hasAny(text, [
      "what issues are in my customer sheet",
      "customer issues from my sheet",
      "show customer issues in sheet",
      "any issues in my sheet",
      "problems in customer sheet",
    ]) ||
    /\bcustomer\s+issues?\b.*\bsheet\b/.test(text)
  ) {
    return {
      confidence: 0.96,
      entities: {},
      intent: "sheets_customer_issues",
      requiresTool: true,
      routedTo: "sheets.customerIssues",
      usedFollowUpContext: false,
    };
  }

  if (
    hasAny(text, [
      "what should i focus on from my sheet",
      "recommendations from my sheet",
      "sheet recommendations",
      "what does my sheet say to focus on",
      "sheet insights",
      "sheet priorities",
    ]) ||
    /\b(?:focus|recommend|priorit)\w*\b.*\bsheet\b/.test(text)
  ) {
    return {
      confidence: 0.95,
      entities: {},
      intent: "sheets_focus_recommendation",
      requiresTool: true,
      routedTo: "sheets.focusRecommendation",
      usedFollowUpContext: false,
    };
  }

  if (
    hasAny(text, [
      "check google sheets",
      "summarize my store sheet",
      "summarize my sheet",
      "what is in my sheet",
      "what does my sheet show",
      "sheet summary",
      "google sheets summary",
      "read my sheet",
      "sync google sheets",
      "check my sheet",
    ]) ||
    /\bgoogle\s+sheets?\b/.test(text) ||
    /\bmy\s+(?:store\s+)?sheet\b/.test(text)
  ) {
    return {
      confidence: 0.95,
      entities: {},
      intent: "sheets_summary",
      requiresTool: true,
      routedTo: "sheets.summary",
      usedFollowUpContext: false,
    };
  }

  // ── End Google Sheets intents ──────────────────────────────────────────────

  if (hasAny(text, ["check customer messages", "customer messages", "check messages", "support messages"])) {
    return {
      confidence: 0.93,
      entities: {},
      intent: "check_messages",
      requiresTool: true,
      routedTo: "operations.messages",
      usedFollowUpContext: false,
    };
  }

  if (hasAny(text, ["draft replies", "draft reply", "unanswered messages"])) {
    return {
      confidence: 0.94,
      entities: {},
      intent: "draft_message_replies",
      requiresTool: true,
      routedTo: "operations.draftReplies",
      usedFollowUpContext: false,
    };
  }

  if (hasAny(text, ["summarize today's orders", "summarize orders", "today's orders", "pending deliveries", "pending orders"])) {
    return {
      confidence: 0.92,
      entities: {},
      intent: "order_summary",
      requiresTool: true,
      routedTo: "operations.orders",
      usedFollowUpContext: false,
    };
  }

  if (hasAny(text, ["what leads should i focus on", "leads should i focus", "lead focus", "focus on leads"])) {
    return {
      confidence: 0.92,
      entities: {},
      intent: "lead_focus",
      requiresTool: true,
      routedTo: "operations.leads",
      usedFollowUpContext: false,
    };
  }

  if (hasAny(text, ["what actions have you taken", "actions have you taken", "action log", "actions today"])) {
    return {
      confidence: 0.92,
      entities: {},
      intent: "action_history",
      requiresTool: true,
      routedTo: "operations.actionHistory",
      usedFollowUpContext: false,
    };
  }

  if (hasAny(text, ["what connectors are available", "what tools are connected", "what tools are available", "what is connected", "connectors available"])) {
    return {
      confidence: 0.93,
      entities: {},
      intent: "connector_list",
      requiresTool: true,
      routedTo: "connectors.list",
      usedFollowUpContext: false,
    };
  }

  if (hasAny(text, ["what can you do with", "connector status", "tools connected"])) {
    return {
      confidence: 0.91,
      entities: {},
      intent: "connector_status",
      requiresTool: true,
      routedTo: "connectors.status",
      usedFollowUpContext: false,
    };
  }

  if (text.includes("sync") && (text.includes("connector") || connectorNames.some((name) => text.includes(name)))) {
    return {
      confidence: 0.93,
      entities: {},
      intent: "connector_sync",
      requiresTool: true,
      routedTo: "connectors.sync",
      usedFollowUpContext: false,
    };
  }

  if (hasAny(text, ["preview sending", "preview refunding", "prepare an approval request", "approval request for"])) {
    return {
      confidence: 0.93,
      entities: {},
      intent: "connector_preview_action",
      requiresTool: true,
      routedTo: "connectors.previewOrRequestApproval",
      usedFollowUpContext: false,
    };
  }

  if (/^(hi|hello|hey)\b/.test(text)) {
    return {
      confidence: 0.9,
      entities: {},
      intent: "general_help",
      requiresTool: false,
      routedTo: "general.greeting",
      usedFollowUpContext: false,
    };
  }

  return {
    confidence: 0.35,
    entities: {},
    intent: "unknown",
    requiresTool: false,
    routedTo: "general.fallback",
    usedFollowUpContext: false,
  };
}
