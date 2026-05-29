const TOOL_REGISTRY = [
  {
    description: "Read today's synced Google Calendar events.",
    name: "calendar.today",
    requiresApproval: false,
    risk: "read",
  },
  {
    description: "Read tomorrow's synced Google Calendar events.",
    name: "calendar.tomorrow",
    requiresApproval: false,
    risk: "read",
  },
  {
    description: "Summarize locally synced calendar events.",
    name: "calendar.summary",
    requiresApproval: false,
    risk: "read",
  },
  {
    description: "Find open time windows from locally synced calendar events.",
    name: "calendar.findSlots",
    requiresApproval: false,
    risk: "read",
  },
  {
    description: "Prepare a calendar event approval request. Does not create the external event until approved.",
    name: "calendar.prepareEvent",
    requiresApproval: true,
    risk: "approval_required",
  },
  {
    description: "Sync Gmail in read-only mode.",
    name: "gmail.sync",
    requiresApproval: false,
    risk: "read",
  },
  {
    description: "Search Gmail messages by sender, keyword, or topic from synced/local-safe data.",
    name: "gmail.searchMessages",
    requiresApproval: false,
    risk: "read",
  },
  {
    description: "Summarize unread Gmail messages from synced/local-safe data.",
    name: "gmail.summarizeUnread",
    requiresApproval: false,
    risk: "read",
  },
  {
    description: "Create a local Gmail reply draft review item. Does not send email.",
    name: "gmail.draftReply",
    requiresApproval: false,
    risk: "local_draft",
  },
  {
    description: "Create a local draft reply to the latest synced Gmail email. Does not send email.",
    name: "gmail.draftLatestEmail",
    requiresApproval: false,
    risk: "local_draft",
  },
  {
    description: "List pending approval requests.",
    name: "approvals.list",
    requiresApproval: false,
    risk: "read",
  },
  {
    description: "Rank today's important business signals from safe local context.",
    name: "attention.today",
    requiresApproval: false,
    risk: "read",
  },
];

export function getAvailableTools() {
  return TOOL_REGISTRY.map((tool) => ({ ...tool }));
}

export function getToolDefinition(name) {
  return TOOL_REGISTRY.find((tool) => tool.name === name) || null;
}

export { TOOL_REGISTRY };
