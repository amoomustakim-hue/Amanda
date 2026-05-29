export const voiceStates = ["idle", "listening", "thinking", "speaking", "executing"];

export const stateMeta = {
  idle: {
    label: "Idle",
    status: "Ready",
    line: "Amanda is ready for the next business request.",
    activity: "Monitoring workspace context...",
  },
  listening: {
    label: "Listening",
    status: "Listening...",
    line: "Listening for customer, sales, and operations instructions.",
    activity: "Capturing voice input...",
  },
  thinking: {
    label: "Thinking",
    status: "Thinking...",
    line: "Understanding the request and planning the next action.",
    activity: "Prioritizing business context...",
  },
  speaking: {
    label: "Responding",
    status: "Responding...",
    line: "Explaining the next steps with concise business context.",
    activity: "Preparing suggested response...",
  },
  executing: {
    label: "Working",
    status: "Working...",
    line: "Executing a simulated operations workflow for review.",
    activity: "Coordinating task actions...",
  },
};

export const taskActivities = [
  "Checking customer messages...",
  "Identifying serious leads...",
  "Drafting follow-up replies...",
  "Reviewing pending orders...",
  "Preparing today's summary...",
  "Updating business records...",
];

export const transcriptEntries = [
  {
    id: "u-1",
    speaker: "User",
    kind: "user",
    time: "09:41",
    text: "Check today's customer messages and show me the important ones.",
  },
  {
    id: "a-1",
    speaker: "Amanda",
    kind: "assistant",
    time: "09:41",
    text:
      "I'll review your customer messages, identify urgent conversations, and prepare suggested replies.",
  },
  {
    id: "t-1",
    speaker: "Task",
    kind: "task",
    time: "09:42",
    text: "Scanning inbox labels, open leads, and pending order notes.",
  },
  {
    id: "a-2",
    speaker: "Amanda",
    kind: "assistant",
    time: "09:42",
    text: "I found three priority conversations and one order that needs confirmation.",
  },
];

export function getNextState(currentState) {
  const flow = ["idle", "listening", "thinking", "speaking", "executing", "idle"];
  return flow[flow.indexOf(currentState) + 1] || "idle";
}
