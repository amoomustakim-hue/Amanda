import { rankAttentionSignals } from "./gemini.js";

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function makeId(prefix, value) {
  return `${prefix}_${String(value || Math.random().toString(16).slice(2)).replace(/[^a-z0-9_:-]/gi, "_").slice(0, 48)}`;
}

function nowDate() {
  return new Date();
}

function priorityFromScore(score) {
  if (score >= 80) return "high";
  if (score >= 50) return "medium";
  return "low";
}

function safeDate(value) {
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hoursUntil(value, now = nowDate()) {
  const date = safeDate(value);
  if (!date) return Infinity;
  return (date.getTime() - now.getTime()) / 36e5;
}

function isSameLocalDay(value, offsetDays = 0, now = nowDate()) {
  const date = safeDate(value);
  if (!date) return false;
  const target = new Date(now);
  target.setDate(target.getDate() + offsetDays);
  return date.getFullYear() === target.getFullYear() &&
    date.getMonth() === target.getMonth() &&
    date.getDate() === target.getDate();
}

function formatTime(value) {
  const date = safeDate(value);
  if (!date) return "time not listed";
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function item(input) {
  const score = Math.max(0, Math.min(100, Number(input.score || 0)));
  return {
    createdAt: input.createdAt || new Date().toISOString(),
    description: cleanText(input.description).slice(0, 220),
    id: input.id || makeId("attention", `${input.source}_${input.type}_${input.relatedRecordId}`),
    priority: input.priority || priorityFromScore(score),
    reason: cleanText(input.reason).slice(0, 180),
    recommendedAction: cleanText(input.recommendedAction).slice(0, 180),
    relatedRecordId: input.relatedRecordId || "",
    score,
    source: input.source || "tasks",
    title: cleanText(input.title).slice(0, 120),
    type: input.type || "general",
  };
}

function gmailCategoryScore(message = {}) {
  if (message.priority === "high") return 92;
  if (["quote_request", "pricing_inquiry"].includes(message.category)) return 90;
  if (["customer_complaint", "booking_request", "support_request"].includes(message.category)) return 86;
  if (message.needsReply) return 82;
  if (message.status === "unread") return 62;
  if (message.priority === "medium") return 58;
  return 35;
}

function gmailTitle(message = {}) {
  const from = cleanText(message.from).replace(/<.*?>/g, "").trim();
  if (["quote_request", "pricing_inquiry"].includes(message.category)) {
    return `Quote request${from ? ` from ${from}` : ""}`;
  }
  if (message.category === "customer_complaint") return `Customer complaint${from ? ` from ${from}` : ""}`;
  if (message.category === "booking_request") return `Booking request${from ? ` from ${from}` : ""}`;
  return message.subject || `Email${from ? ` from ${from}` : ""}`;
}

function collectGmailSignals(data = []) {
  return data
    .filter((message) =>
      message.priority === "high" ||
      message.priority === "medium" ||
      message.needsReply ||
      message.status === "unread" ||
      ["quote_request", "pricing_inquiry", "customer_complaint", "booking_request", "support_request"].includes(message.category),
    )
    .map((message) => {
      const score = gmailCategoryScore(message);
      return item({
        createdAt: message.receivedAt || message.createdAt,
        description: cleanText(message.snippet || message.bodyPreview || "Email needs review.").slice(0, 180),
        id: makeId("attention", `gmail_${message.id}`),
        priority: priorityFromScore(score),
        reason: message.needsReply
          ? "Business email appears to need a reply."
          : "Unread or high-priority Gmail message.",
        recommendedAction: "Review the email or ask Amanda to prepare a draft reply.",
        relatedRecordId: message.id || message.providerMessageId,
        score,
        source: "gmail",
        title: gmailTitle(message),
        type: message.needsReply ? "email_needs_reply" : "important_email",
      });
    });
}

function collectDraftSignals(data = {}) {
  const drafts = data.gmailDrafts || [];
  return drafts
    .filter((draft) => draft.status === "needs_approval")
    .map((draft) => item({
      createdAt: draft.createdAt,
      description: `Draft reply to ${draft.to || "a Gmail contact"} is ready for review.`,
      id: makeId("attention", `gmail_draft_${draft.id}`),
      reason: "Amanda prepared a local Gmail draft that needs review.",
      recommendedAction: "Open the Approval Queue and review the Gmail draft.",
      relatedRecordId: draft.id,
      score: 84,
      source: "approval_queue",
      title: `Gmail draft waiting review: ${draft.subject || "Draft reply"}`,
      type: "gmail_draft_waiting_review",
    }));
}

function approvalType(request = {}) {
  if (request.connectorId === "google_calendar" && request.action === "create_event") return "calendar_approval_pending";
  if (request.connectorId === "gmail" && request.action === "create_gmail_draft") return "gmail_draft_approval_pending";
  return "approval_pending";
}

function collectApprovalSignals(data = {}) {
  return (data.approvalRequests || [])
    .filter((request) => request.status === "pending" || request.status === "needs_approval")
    .map((request) => {
      const isCalendar = request.connectorId === "google_calendar";
      const isGmail = request.connectorId === "gmail";
      return item({
        createdAt: request.createdAt,
        description: cleanText(request.summary || request.subject || "Approval request is waiting.").slice(0, 180),
        id: makeId("attention", `approval_${request.id}`),
        reason: isCalendar
          ? "Calendar action needs approval before Amanda can create the event."
          : isGmail
            ? "Gmail draft creation needs approval before Amanda creates it in Gmail Drafts."
            : "A protected action is waiting for your approval.",
        recommendedAction: "Review the approval request.",
        relatedRecordId: request.id,
        score: isCalendar || isGmail ? 88 : 76,
        source: "approval_queue",
        title: request.summary || request.subject || "Approval request waiting",
        type: approvalType(request),
      });
    });
}

function collectCalendarSignals(events = [], now = nowDate()) {
  return events
    .filter((event) => isSameLocalDay(event.start, 0, now) || hoursUntil(event.start, now) <= 24)
    .map((event) => {
      const hours = hoursUntil(event.start, now);
      const soon = hours >= 0 && hours <= 2;
      const today = isSameLocalDay(event.start, 0, now);
      const score = soon ? 82 : today ? 62 : 36;
      return item({
        createdAt: event.createdAt || event.syncedAt,
        description: `${event.title || "Calendar event"} at ${formatTime(event.start)}${event.location ? `, ${event.location}` : ""}.`,
        id: makeId("attention", `calendar_${event.id || event.providerEventId}`),
        reason: soon
          ? "Calendar event starts within the next two hours."
          : today
            ? "Calendar event is scheduled for today."
            : "Upcoming calendar event.",
        recommendedAction: soon ? "Prepare for this meeting now." : "Keep this on today's operating radar.",
        relatedRecordId: event.id || event.providerEventId,
        score,
        source: "calendar",
        title: event.title || "Calendar event",
        type: soon ? "calendar_event_soon" : today ? "calendar_event_today" : "calendar_event_upcoming",
      });
    });
}

function collectTaskSignals(tasks = [], now = nowDate()) {
  return tasks
    .filter((task) => task.status !== "completed")
    .map((task) => {
      const due = task.dueAt || task.due || "";
      const dueDate = safeDate(due);
      const overdue = dueDate && dueDate.getTime() < now.getTime();
      const score = overdue ? 86 : task.priority === "high" ? 74 : task.priority === "medium" ? 56 : 36;
      return item({
        createdAt: task.createdAt,
        description: task.text || task.title || "Open task.",
        id: makeId("attention", `task_${task.id}`),
        reason: overdue ? "Task is overdue." : "Open task in Amanda's workspace.",
        recommendedAction: "Complete or reschedule the task.",
        relatedRecordId: task.id,
        score,
        source: "tasks",
        title: task.title || task.text || "Open task",
        type: "task_due",
      });
    });
}

function collectConnectorSignals(connectors = [], now = nowDate()) {
  return connectors
    .filter((connector) => {
      if (connector.mode === "not_connected") return false;
      const syncedAt = connector.lastSyncedAt || connector.lastSyncAt || "";
      if (!syncedAt) return connector.mode === "real" || connector.status === "connected";
      return hoursUntil(syncedAt, now) < -24;
    })
    .map((connector) => item({
      createdAt: connector.updatedAt || connector.lastSyncedAt || new Date().toISOString(),
      description: `${connector.label || connector.id} has not synced recently.`,
      id: makeId("attention", `connector_${connector.id}`),
      reason: "Connector data may be stale.",
      recommendedAction: `Sync ${connector.label || connector.id}.`,
      relatedRecordId: connector.id,
      score: 52,
      source: "connector_status",
      title: `${connector.label || connector.id} may need sync`,
      type: "connector_needs_sync",
    }));
}

function dedupeAndRank(items = []) {
  const seen = new Set();
  return items
    .filter((entry) => {
      const key = `${entry.source}|${entry.type}|${entry.relatedRecordId || entry.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.score - a.score || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

function deterministicSummary(items = []) {
  if (!items.length) {
    return {
      spokenReply: "Nothing urgent needs your attention right now. I will surface new items as Gmail, Calendar, approvals, and tasks update.",
      summary: "Nothing urgent right now.",
      topRecommendation: "Keep Amanda connected and let her keep watching for new signals.",
    };
  }
  const top = items.slice(0, 5);
  const summary = `You have ${items.length} thing${items.length === 1 ? "" : "s"} that need attention today.`;
  const spokenReply = `${summary} ${top.map((entry, index) => `${index + 1}. ${entry.title}`).join("; ")}. I recommend starting with ${top[0].title} because ${top[0].reason.toLowerCase()}`;
  return {
    spokenReply,
    summary,
    topRecommendation: `Start with ${top[0].title}: ${top[0].recommendedAction}`,
  };
}

async function applyGeminiRanking(items, deterministic, useGemini) {
  if (!useGemini || !items.length) return { ...deterministic, brain: "deterministic", items };
  try {
    const ranked = await rankAttentionSignals({ signals: items });
    if (!ranked) return { ...deterministic, brain: "deterministic", items };
    const idOrder = Array.isArray(ranked?.rankedItemIds) ? ranked.rankedItemIds : [];
    const byId = new Map(items.map((entry) => [entry.id, entry]));
    const rankedItems = [
      ...idOrder.map((id) => byId.get(id)).filter(Boolean),
      ...items.filter((entry) => !idOrder.includes(entry.id)),
    ];
    return {
      brain: "gemini",
      items: rankedItems,
      spokenReply: cleanText(ranked?.spokenReply) || deterministic.spokenReply,
      summary: cleanText(ranked?.summary) || deterministic.summary,
      topRecommendation: cleanText(ranked?.topRecommendation) || deterministic.topRecommendation,
    };
  } catch (error) {
    return {
      ...deterministic,
      brain: "deterministic",
      fallbackReason: error.message,
      items,
    };
  }
}

function websiteEventScore(event = {}) {
  const value = Number(event.value || 0);
  const type = String(event.type || "").toLowerCase();
  if (type === "high_value_inquiry") return 95;
  if (type === "abandoned_checkout" && value >= 100000) return 92;
  if (type === "bulk_order_inquiry") return 90;
  if (type === "failed_payment") return 88;
  if (type === "delivery_complaint") return 85;
  if (type === "refund_request" && value >= 100000) return 80;
  if (type === "new_order") return 60;
  if (type === "support_message" || type === "contact_form") return 50;
  return 30;
}

function websiteAttentionType(event = {}) {
  const map = {
    abandoned_checkout: "website_abandoned_checkout",
    failed_payment: "website_failed_payment",
    bulk_order_inquiry: "website_bulk_order_inquiry",
    high_value_inquiry: "website_high_value_inquiry",
    delivery_complaint: "website_delivery_complaint",
    refund_request: "website_refund_request",
    new_order: "website_new_order",
    support_message: "website_support_message",
    contact_form: "website_contact_form",
  };
  return map[String(event.type || "").toLowerCase()] || "website_event";
}

function websiteEventTitle(event = {}) {
  const name = cleanText(event.customerName || "Customer");
  const value = Number(event.value || 0);
  const formatted = value > 0 ? ` ₦${value.toLocaleString("en-NG")}` : "";
  const type = String(event.type || "").toLowerCase();
  if (type === "abandoned_checkout") return `Abandoned checkout${formatted} from ${name}`;
  if (type === "failed_payment") return `Failed payment${formatted} from ${name}`;
  if (type === "bulk_order_inquiry") return `Bulk order inquiry from ${name}`;
  if (type === "high_value_inquiry") return `High-value inquiry${formatted} from ${name}`;
  if (type === "delivery_complaint") return `Delivery complaint from ${name}`;
  if (type === "refund_request") return `Refund request${formatted} from ${name}`;
  if (type === "new_order") return `New order${formatted} from ${name}`;
  return `Website event from ${name}`;
}

function collectWebsiteSignals(events = []) {
  return events
    .filter((event) => event.status === "new" || event.status === "reviewed")
    .map((event) => {
      const score = websiteEventScore(event);
      const product = cleanText(event.product || "");
      const value = Number(event.value || 0);
      const formatted = value > 0 ? ` ₦${value.toLocaleString("en-NG")}` : "";
      const description = cleanText(
        event.message ||
        `${websiteEventTitle(event)}${product ? ` for ${product}` : ""}${formatted ? ` (${formatted})` : ""}.`,
      ).slice(0, 180);
      return item({
        createdAt: event.createdAt,
        description,
        id: makeId("attention", `web_${event.id}`),
        priority: event.priority || priorityFromScore(score),
        reason: "Business event from your website that may need a follow-up.",
        recommendedAction: "Review the event or ask Amanda to prepare a follow-up draft.",
        relatedRecordId: event.id,
        score,
        source: "website",
        title: websiteEventTitle(event),
        type: websiteAttentionType(event),
      });
    });
}

function collectSheetsSignals(googleSheets = {}) {
  const summary = googleSheets?.summary;
  if (!summary || !googleSheets.lastSyncedAt) return [];
  const results = [];

  // Low stock items — high priority
  for (const stockEntry of (summary.lowStockItems || []).slice(0, 5)) {
    results.push(item({
      createdAt: googleSheets.lastSyncedAt,
      description: `Only ${stockEntry.stock} unit${stockEntry.stock === 1 ? "" : "s"} of ${stockEntry.name} remaining in your sheet.`,
      id: makeId("attention", `sheets_low_stock_${String(stockEntry.name).replace(/\W/g, "_")}`),
      priority: stockEntry.stock === 0 ? "high" : stockEntry.stock <= 2 ? "high" : "medium",
      reason: "Low inventory may block sales.",
      recommendedAction: `Restock ${stockEntry.name} as soon as possible.`,
      score: stockEntry.stock === 0 ? 85 : stockEntry.stock <= 2 ? 82 : 70,
      source: "google_sheets",
      title: `${stockEntry.name} is ${stockEntry.stock === 0 ? "out of stock" : "low stock"} (${stockEntry.stock} left)`,
      type: "low_stock_item",
    }));
  }

  // Top product — medium priority (opportunity)
  if (summary.topProduct && summary.topProductRevenue > 0) {
    results.push(item({
      createdAt: googleSheets.lastSyncedAt,
      description: `${summary.topProduct} is generating ₦${(summary.topProductRevenue).toLocaleString("en-NG")} in revenue.`,
      id: makeId("attention", `sheets_top_product_${String(summary.topProduct).replace(/\W/g, "_")}`),
      priority: "medium",
      reason: "Top revenue product — promote and keep in stock.",
      recommendedAction: `Ensure ${summary.topProduct} is well-stocked and promoted.`,
      score: 65,
      source: "google_sheets",
      title: `Top seller: ${summary.topProduct}`,
      type: "top_selling_product",
    }));
  }

  // High-priority customer issues from sheet
  const highIssues = (summary.customerIssues || []).filter((i) => i.priority === "high" || i.priority === "urgent").slice(0, 3);
  for (const issue of highIssues) {
    results.push(item({
      createdAt: googleSheets.lastSyncedAt,
      description: cleanText(issue.issue).slice(0, 180),
      id: makeId("attention", `sheets_issue_${String(issue.customer || issue.issue).replace(/\W/g, "_").slice(0, 30)}`),
      priority: "high",
      reason: "High-priority customer issue recorded in your sheet.",
      recommendedAction: "Follow up with the customer immediately.",
      score: 80,
      source: "google_sheets",
      title: `Customer issue${issue.customer ? ` from ${issue.customer}` : ""}`,
      type: "customer_issue_from_sheet",
    }));
  }

  return results;
}

export async function getUnifiedAttentionSummary(userId, { businessData = {}, connectors = [], now = new Date(), useGemini = true } = {}) {
  const items = dedupeAndRank([
    ...collectGmailSignals(businessData.gmailMessages || []),
    ...collectDraftSignals(businessData),
    ...collectApprovalSignals(businessData),
    ...collectCalendarSignals(businessData.calendarEvents || [], now),
    ...collectTaskSignals(businessData.tasks || [], now),
    ...collectWebsiteSignals(businessData.websiteEvents || []),
    ...collectSheetsSignals(businessData.googleSheets || {}),
    ...collectConnectorSignals(connectors.length ? connectors : businessData.connectors || [], now),
  ]);
  const deterministic = deterministicSummary(items);
  const ranked = await applyGeminiRanking(items, deterministic, useGemini);
  const sources = [...new Set(ranked.items.map((entry) => entry.source))];
  return {
    brain: ranked.brain,
    fallbackReason: ranked.fallbackReason || "",
    generatedAt: new Date().toISOString(),
    items: ranked.items,
    sources,
    spokenReply: ranked.spokenReply,
    summary: ranked.summary,
    topRecommendation: ranked.topRecommendation,
    userId,
  };
}
