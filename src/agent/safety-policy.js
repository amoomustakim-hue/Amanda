const TOOL_POLICY = {
  "approvals.list": "allowed",
  "attention.today": "allowed",
  "calendar.createEvent": "approval_required",
  "calendar.deleteEvent": "blocked",
  "calendar.findSlots": "allowed",
  "calendar.prepareEvent": "approval_required",
  "calendar.summary": "allowed",
  "calendar.today": "allowed",
  "calendar.tomorrow": "allowed",
  "gmail.createDraft": "approval_required",
  "gmail.deleteEmail": "blocked",
  "gmail.draftLatestEmail": "allowed",
  "gmail.draftReply": "allowed",
  "gmail.searchMessages": "allowed",
  "gmail.sendEmail": "blocked",
  "gmail.summarizeUnread": "allowed",
  "gmail.sync": "allowed",
};

const BLOCKED_ACTION_COPY = {
  "calendar.deleteEvent": "I cannot delete calendar events. I can prepare a review note, but Amanda does not cancel or delete calendar items in this phase.",
  "gmail.deleteEmail": "I cannot delete emails or change mailbox state.",
  "gmail.sendEmail": "I cannot send emails. I can draft replies and keep them in the Approval Queue for review.",
};

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function safetyDecisionForTool(toolName = "") {
  const normalized = cleanText(toolName);
  const decision = TOOL_POLICY[normalized] || "blocked";
  return {
    allowed: decision === "allowed" || decision === "approval_required",
    decision,
    requiresApproval: decision === "approval_required",
    blocked: decision === "blocked",
    reply: decision === "blocked"
      ? BLOCKED_ACTION_COPY[normalized] || "I cannot perform that external action. I can prepare a safe draft or approval request instead."
      : "",
    tool: normalized,
  };
}

export function enforceGeminiDecision(decision = {}) {
  const tool = cleanText(decision.tool || decision.routedTo || "");
  return safetyDecisionForTool(tool);
}

export { TOOL_POLICY };
