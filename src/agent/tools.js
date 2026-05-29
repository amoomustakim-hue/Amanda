function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function includesText(value, query) {
  return cleanText(value).toLowerCase().includes(cleanText(query).toLowerCase());
}

function makeLocalId(prefix) {
  return `${prefix}_${Math.random().toString(16).slice(2, 10)}${Date.now().toString(16).slice(-6)}`;
}

function ensureArray(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function sortByPriority(items) {
  const weight = { urgent: 4, high: 3, medium: 2, low: 1 };
  return items.slice().sort((a, b) => {
    const byPriority = (weight[b.priority] || 0) - (weight[a.priority] || 0);
    if (byPriority) return byPriority;
    return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  });
}

function customerName(data, customerId) {
  return data.customers?.find((customer) => customer.id === customerId)?.name || "customer";
}

function buildReplyBody(data, message, tone = "Professional") {
  const customer = customerName(data, message.customerId);
  const order = data.orders?.find((item) => item.id === message.orderId);
  const greeting = tone === "Casual" ? `Hi ${customer.split(" ")[0]},` : `Hi ${customer},`;
  const context = order
    ? `I checked ${order.publicId || order.id}, and the current status is ${order.status}.`
    : `I checked your message about ${message.subject}.`;
  const nextStep = order?.issue
    ? `I am flagging ${order.issue.toLowerCase()} with operations and will keep you posted with the next update.`
    : "I am checking the details and will follow up with the clearest next step.";
  return `${greeting}\n\n${context} ${nextStep}\n\nThanks for your patience,\nAmanda`;
}

export function approvalBoundaryFor(action) {
  const guarded = [
    "send_message",
    "email_customer",
    "delete_record",
    "refund_order",
    "cancel_order",
    "change_external_system",
  ];
  return {
    allowedWithoutApproval: !guarded.includes(action),
    requiresApproval: guarded.includes(action),
  };
}

function gmailReplyTemplate(message) {
  const subject = `${message.subject || ""} ${message.snippet || ""}`.toLowerCase();
  switch (message.category) {
    case "quote_request":
    case "pricing_inquiry":
      return "Hello, thank you for reaching out. I’d be happy to help with this request. Could you share the quantity, timeline, and delivery location so we can prepare an accurate quote?";
    case "customer_complaint":
      return "Hello, thank you for bringing this to our attention. I’m sorry about the issue. Please share your order details so we can review it and respond with the next step.";
    case "booking_request":
      return "Hello, thank you for your booking request. Please confirm your preferred date, time, and contact number so we can check availability.";
    case "partnership":
      return "Hello, thank you for reaching out about a partnership opportunity. Please share your goals, audience, and timeline so we can review the fit and respond properly.";
    case "support_request":
      return "Hello, thank you for reaching out. Please share the key details of the issue, including any order or account reference, so we can review it and respond with the next step.";
    case "follow_up":
      return "Hello, thank you for following up. I’m reviewing this now and will come back with a clear next step shortly.";
    default:
      if (/\bbulk order|quote|pricing\b/.test(subject)) {
        return "Hello, thank you for reaching out. I’d be happy to help with this request. Could you share the quantity, timeline, and delivery location so we can prepare an accurate quote?";
      }
      return "Hello, thank you for reaching out. I’m reviewing your message now and will follow up with the clearest next step shortly.";
  }
}

function gmailApprovalAction(request = {}) {
  return request.action === "review_local_draft" ? "create_gmail_draft" : request.action;
}

const GMAIL_DRAFTABLE_CATEGORIES = new Set([
  "lead",
  "quote_request",
  "pricing_inquiry",
  "customer_complaint",
  "support_request",
  "booking_request",
  "partnership",
  "follow_up",
]);

function summarizeEmailCategory(messages = []) {
  const counts = messages.reduce((acc, message) => {
    acc[message.category] = (acc[message.category] || 0) + 1;
    return acc;
  }, {});
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return entries.slice(0, 3).map(([category, count]) => `${count} ${category.replaceAll("_", " ")}`);
}

function uniqueBy(items = [], keyFn = (item) => item?.id) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export function createAmandaTools({ businessData, makeId = makeLocalId, now = () => new Date(), userId = "" }) {
  const data = businessData || {};

  function logAction(action, detail = {}) {
    const logs = ensureArray(data, "actionLogs");
    const entry = {
      action,
      createdAt: now().toISOString(),
      detail,
      id: makeId("log"),
    };
    logs.push(entry);
    return entry;
  }

  function listTasks(filters = {}) {
    const tasks = ensureArray(data, "tasks");
    const result = sortByPriority(
      tasks.filter((task) => !filters.status || task.status === filters.status),
    );
    logAction("listTasks", { count: result.length, filters });
    return result;
  }

  function createTask(input = {}) {
    const tasks = ensureArray(data, "tasks");
    const task = {
      createdAt: now().toISOString(),
      dueAt: input.dueAt || null,
      id: makeId("task"),
      priority: input.priority || "medium",
      source: input.source || "Amanda",
      status: "open",
      text: cleanText(input.text) || "Follow up on business operation",
    };
    tasks.push(task);
    logAction("createTask", { taskId: task.id, text: task.text });
    return task;
  }

  function completeTask(taskId) {
    const tasks = ensureArray(data, "tasks");
    const task = tasks.find((item) => item.id === taskId);
    if (!task) {
      logAction("completeTask", { found: false, taskId });
      return null;
    }
    task.status = "completed";
    task.completedAt = now().toISOString();
    logAction("completeTask", { found: true, taskId });
    return task;
  }

  function listUnansweredMessages(filters = {}) {
    const messages = ensureArray(data, "messages");
    const result = sortByPriority(
      messages.filter((message) => {
        const unanswered = message.status === "unanswered" || message.needsReply === true;
        if (!unanswered) return false;
        if (filters.priority && message.priority !== filters.priority) return false;
        return true;
      }),
    );
    logAction("listUnansweredMessages", { count: result.length, filters });
    return result;
  }

  function draftCustomerReply(input = {}) {
    const messages = ensureArray(data, "messages");
    const drafts = ensureArray(data, "drafts");
    const selectedMessages = input.messageId
      ? messages.filter((message) => message.id === input.messageId)
      : listUnansweredMessages(input).slice(0, input.limit || 3);

    const created = selectedMessages.map((message) => {
      const existing = drafts.find((draft) => draft.messageId === message.id && draft.status === "needs_approval");
      if (existing) return existing;
      const draft = {
        body: input.body || buildReplyBody(data, message, input.tone),
        channel: message.channel || "email",
        createdAt: now().toISOString(),
        customerId: message.customerId,
        id: makeId("draft"),
        messageId: message.id,
        status: "needs_approval",
        subject: `Re: ${message.subject}`,
      };
      drafts.push(draft);
      return draft;
    });

    logAction("draftCustomerReply", {
      count: created.length,
      draftIds: created.map((draft) => draft.id),
    });
    return created;
  }

  function listOrders(filters = {}) {
    const orders = ensureArray(data, "orders");
    const result = orders.filter((order) => {
      if (filters.status && order.status !== filters.status) return false;
      if (filters.pendingOnly && ["delivered", "cancelled", "refunded"].includes(order.status)) return false;
      return true;
    });
    logAction("listOrders", { count: result.length, filters });
    return result;
  }

  function getOrderSummary(filters = {}) {
    const orders = listOrders(filters);
    const summary = orders.reduce(
      (acc, order) => {
        acc.total += 1;
        acc[order.status] = (acc[order.status] || 0) + 1;
        if (!["delivered", "cancelled", "refunded"].includes(order.status)) acc.pending += 1;
        if (order.priority === "high" || order.priority === "urgent") acc.needsAttention += 1;
        return acc;
      },
      { needsAttention: 0, pending: 0, total: 0 },
    );
    logAction("getOrderSummary", { filters, summary });
    return {
      orders,
      summary,
    };
  }

  function listLeads(filters = {}) {
    const leads = ensureArray(data, "leads");
    const result = leads
      .filter((lead) => !filters.stage || lead.stage === filters.stage)
      .slice()
      .sort((a, b) => (b.score || 0) - (a.score || 0));
    logAction("listLeads", { count: result.length, filters });
    return result;
  }

  function updateLeadStage(input = {}) {
    const leads = ensureArray(data, "leads");
    const lead = leads.find((item) => item.id === input.leadId);
    if (!lead) {
      logAction("updateLeadStage", { found: false, leadId: input.leadId });
      return null;
    }
    const previousStage = lead.stage;
    lead.stage = cleanText(input.stage) || lead.stage;
    lead.updatedAt = now().toISOString();
    logAction("updateLeadStage", {
      leadId: lead.id,
      previousStage,
      stage: lead.stage,
    });
    return lead;
  }

  function searchCustomers(query = "") {
    const customers = ensureArray(data, "customers");
    const result = customers.filter((customer) => {
      if (!query) return true;
      return [customer.name, customer.company, customer.email, customer.tags?.join(" ")]
        .some((value) => includesText(value, query));
    });
    logAction("searchCustomers", { count: result.length, query });
    return result;
  }

  function generateDailySummary() {
    const unanswered = listUnansweredMessages();
    const orderSummary = getOrderSummary();
    const leads = listLeads().slice(0, 3);
    const openTasks = listTasks({ status: "open" }).slice(0, 5);
    const gmailImportant = gmailFindImportantEmails().slice(0, 3);
    const summary = {
      createdAt: now().toISOString(),
      date: todayKey(now()),
      gmailImportantCount: gmailImportant.length,
      id: makeId("summary"),
      leadFocus: leads.map((lead) => `${lead.company} (${lead.score}%)`),
      openTaskCount: openTasks.length,
      orderSummary: orderSummary.summary,
      recommendation:
        gmailImportant.length > 0
          ? `Handle ${gmailImportant[0].subject || "the top Gmail message"} first.`
          : unanswered.length > 0
          ? "Clear unanswered customer messages before sales follow-up."
          : "Focus on the highest-fit sales leads and pending deliveries.",
      unansweredMessageCount: unanswered.length,
    };
    ensureArray(data, "summaries").push(summary);
    logAction("generateDailySummary", { summaryId: summary.id });
    return summary;
  }

  function searchTranscripts(transcripts = [], query = "") {
    const result = transcripts.filter((entry) => {
      if (!query) return true;
      return includesText(entry.text, query) || includesText(entry.role, query);
    });
    logAction("searchTranscripts", { count: result.length, query });
    return result;
  }

  function gmailMessages(filters = {}) {
    const messages = ensureArray(data, "gmailMessages");
    return messages.filter((message) => {
      if (filters.status && message.status !== filters.status) return false;
      if (filters.category && message.category !== filters.category) return false;
      if (filters.needsReply === true && !message.needsReply) return false;
      if (filters.priority && message.priority !== filters.priority) return false;
      if (filters.query) {
        const haystack = `${message.subject || ""} ${message.snippet || ""} ${message.bodyPreview || ""}`;
        if (!includesText(haystack, filters.query)) return false;
      }
      if (filters.receivedOn) {
        const received = String(message.receivedAt || "").slice(0, 10);
        if (received !== filters.receivedOn) return false;
      }
      return true;
    }).sort((a, b) => String(b.receivedAt || "").localeCompare(String(a.receivedAt || "")));
  }

  function gmailSearchMessages(input = {}) {
    const query = cleanText(input.query || "");
    const senderNameOrEmail = cleanText(input.senderNameOrEmail || "");
    const keyword = cleanText(input.keyword || "");
    const category = cleanText(input.category || "");
    const limit = input.limit || 10;
    const matches = gmailMessages()
      .filter((message) => {
        if (category && message.category !== category) return false;
        if (query) {
          const haystack = [
            message.from,
            message.subject,
            message.snippet,
            message.bodyPreview,
          ].join(" ");
          if (!includesText(haystack, query)) return false;
        }
        if (senderNameOrEmail) {
          if (!includesText(message.from, senderNameOrEmail)) return false;
        }
        if (keyword) {
          const haystack = `${message.subject || ""} ${message.snippet || ""} ${message.bodyPreview || ""}`;
          if (!includesText(haystack, keyword)) return false;
        }
        return true;
      })
      .slice(0, limit);
    logAction("gmailSearchMessages", {
      category,
      count: matches.length,
      keyword,
      query,
      senderNameOrEmail,
    });
    return matches;
  }

  function gmailSearchBySender(senderNameOrEmail, options = {}) {
    const result = gmailSearchMessages({ ...options, senderNameOrEmail });
    logAction("gmailSearchBySender", { count: result.length, senderNameOrEmail });
    return result;
  }

  function gmailSearchByKeyword(keyword, options = {}) {
    const result = gmailSearchMessages({ ...options, keyword });
    logAction("gmailSearchByKeyword", { count: result.length, keyword });
    return result;
  }

  function gmailSummarizeSearchResults(query, options = {}) {
    const matches = gmailSearchMessages({ ...options, query });
    const summary = {
      count: matches.length,
      latest: matches[0] || null,
      needsReplyCount: matches.filter((message) => message.needsReply).length,
      categories: summarizeEmailCategory(matches),
    };
    logAction("gmailSummarizeSearchResults", { query, summary });
    return summary;
  }

  function gmailDrafts() {
    return ensureArray(data, "gmailDrafts");
  }

  function gmailIsDraftableMessage(message = {}) {
    return Boolean(
      message.needsReply === true ||
      message.priority === "high" ||
      message.priority === "medium" ||
      GMAIL_DRAFTABLE_CATEGORIES.has(message.category),
    );
  }

  function ensureGmailDraftApproval(draft) {
    const requests = ensureArray(data, "approvalRequests");
    let existing = requests.find(
      (request) =>
        request.connectorId === "gmail" &&
        ["create_gmail_draft", "review_local_draft"].includes(request.action) &&
        request.payload?.draftId === draft.id &&
        request.status !== "dismissed",
    );
    if (existing) {
      existing.payload = {
        ...existing.payload,
        bodyPreview: String(draft.body || "").slice(0, 240),
        draftId: draft.id,
        gmailDraftId: draft.gmailDraftId || existing.payload?.gmailDraftId || "",
        messageId: draft.messageId,
        subject: draft.subject,
        to: draft.to,
      };
      existing.action = "create_gmail_draft";
      existing.status =
        draft.status === "needs_approval"
          ? "pending"
          : draft.status === "created_in_gmail"
            ? "approved"
            : draft.status;
      existing.subject = `Create Gmail draft: ${draft.subject}`;
      existing.summary = existing.subject;
      existing.updatedAt = now().toISOString();
      draft.approvalRequestId = existing.id;
      return existing;
    }

    const request = {
      action: "create_gmail_draft",
      connectorId: "gmail",
      createdAt: draft.createdAt || now().toISOString(),
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
      source: "gmail",
      status: draft.status === "needs_approval" ? "pending" : draft.status,
      subject: `Create Gmail draft: ${draft.subject}`,
      summary: `Create Gmail draft: ${draft.subject}`,
      type: "gmail_draft_review",
      userId,
    };
    requests.push(request);
    draft.approvalRequestId = request.id;
    return request;
  }

  function gmailListRecentEmails(filters = {}) {
    const result = gmailMessages(filters).slice(0, filters.limit || 10);
    logAction("gmailListRecentEmails", { count: result.length, filters });
    return result;
  }

  function gmailListUnreadEmails(filters = {}) {
    const result = gmailMessages({ ...filters, status: "unread" });
    logAction("gmailListUnreadEmails", { count: result.length, filters });
    return result;
  }

  function gmailFindImportantEmails(filters = {}) {
    const result = gmailMessages(filters).filter(
      (message) => message.priority === "high" || message.needsReply,
    );
    logAction("gmailFindImportantEmails", { count: result.length, filters });
    return result;
  }

  function gmailListDraftableEmails(filters = {}) {
    const result = gmailMessages(filters).filter((message) => gmailIsDraftableMessage(message));
    logAction("gmailListDraftableEmails", { count: result.length, filters });
    return result;
  }

  function gmailFindEmailsNeedingReply(filters = {}) {
    const result = gmailMessages({ ...filters, needsReply: true });
    logAction("gmailFindEmailsNeedingReply", { count: result.length, filters });
    return result;
  }

  function gmailSummarizeUnreadEmails() {
    const unread = gmailListUnreadEmails();
    const important = unread.filter((message) => message.priority === "high" || message.needsReply);
    const summary = {
      categories: summarizeEmailCategory(important),
      highPriorityCount: important.filter((message) => message.priority === "high").length,
      needsReplyCount: important.filter((message) => message.needsReply).length,
      unreadCount: unread.length,
    };
    logAction("gmailSummarizeUnreadEmails", summary);
    return summary;
  }

  function gmailDraftLocalReply(messageId) {
    const message = gmailMessages().find((item) => item.id === messageId || item.providerMessageId === messageId);
    if (!message) {
      logAction("gmailDraftLocalReply", { found: false, messageId });
      return null;
    }
    const drafts = gmailDrafts();
    const existing = drafts.find(
      (draft) =>
        draft.messageId === message.id &&
        ["needs_approval", "approved_local", "ready_to_send_later"].includes(draft.status),
    );
    if (existing) {
      ensureGmailDraftApproval(existing);
      logAction("gmailDraftLocalReply", { found: true, messageId: message.id, reused: true });
      return existing;
    }
    const draft = {
      body: gmailReplyTemplate(message),
      approvedAt: null,
      approvalRequestId: null,
      connectorId: "gmail",
      createdAt: now().toISOString(),
      id: makeId("gmail_draft"),
      messageId: message.id,
      rejectedAt: null,
      source: "gmail",
      status: "needs_approval",
      subject: `Re: ${message.subject}`,
      to: message.from,
      type: "email_reply",
      userId,
    };
    drafts.push(draft);
    const approvalRequest = ensureGmailDraftApproval(draft);
    logAction("gmailDraftLocalReply", { found: true, draftId: draft.id, messageId: message.id });
    logAction("gmailDraftReviewQueued", { approvalRequestId: approvalRequest.id, draftId: draft.id });
    return draft;
  }

  function gmailDraftRepliesForImportantEmails(input = {}) {
    const important = gmailFindImportantEmails();
    const draftable = important
      .filter((message) => gmailIsDraftableMessage(message))
      .slice(0, input.limit || 3);
    const created = draftable
      .map((message) => gmailDraftLocalReply(message.id))
      .filter(Boolean);
    logAction("gmailDraftRepliesForImportantEmails", {
      count: created.length,
      draftableCount: draftable.length,
      importantCount: important.length,
    });
    return created;
  }

  function gmailDraftLatestEmail() {
    const latest = gmailMessages()[0] || null;
    const draft = latest ? gmailDraftLocalReply(latest.id) : null;
    logAction("gmailDraftLatestEmail", {
      draftId: draft?.id || "",
      latestMessageId: latest?.id || "",
    });
    return draft;
  }

  function gmailDraftReplyToSearchResult(query, options = {}) {
    const matches = gmailSearchMessages({ ...options, query, limit: 1 });
    const match = matches[0];
    const draft = match ? gmailDraftLocalReply(match.id) : null;
    logAction("gmailDraftReplyToSearchResult", {
      draftId: draft?.id || "",
      matchId: match?.id || "",
      query,
    });
    return draft;
  }

  function listNeedsApproval() {
    const drafts = ensureArray(data, "drafts").filter((draft) => draft.status === "needs_approval");
    const gmailDraftList = gmailDrafts()
      .filter((draft) => draft.status === "needs_approval")
      .filter((draft) => !draft.approvalRequestId);
    const requests = ensureArray(data, "approvalRequests").filter(
      (request) => request.status === "needs_approval" || request.status === "pending",
    );
    const result = [
      ...drafts.map((draft) => ({ ...draft, type: "draft" })),
      ...gmailDraftList.map((draft) => ({ ...draft, type: "gmail_draft" })),
      ...requests.map((request) => ({ ...request, type: "approval_request" })),
    ];
    logAction("listNeedsApproval", { count: result.length });
    return result;
  }

  return {
    completeTask,
    createTask,
    draftCustomerReply,
    gmailDraftLocalReply,
    gmailDraftLatestEmail,
    gmailDraftRepliesForImportantEmails,
    gmailFindEmailsNeedingReply,
    gmailFindImportantEmails,
    gmailListDraftableEmails,
    gmailListRecentEmails,
    gmailListUnreadEmails,
    gmailSearchByKeyword,
    gmailSearchBySender,
    gmailSearchMessages,
    gmailSummarizeSearchResults,
    gmailDraftReplyToSearchResult,
    gmailSummarizeUnreadEmails,
    generateDailySummary,
    getOrderSummary,
    listLeads,
    listNeedsApproval,
    listOrders,
    listTasks,
    listUnansweredMessages,
    logAction,
    searchCustomers,
    searchTranscripts,
    updateLeadStage,
  };
}
