import { routeIntent } from "../src/agent/intent-router.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function check(command, expectedIntent, options = {}) {
  const result = routeIntent(command, options);
  assert(
    result.intent === expectedIntent,
    `Expected "${command}" to route to ${expectedIntent}, got ${result.intent}.`,
  );
  if (options.routedTo) {
    assert(
      result.routedTo === options.routedTo,
      `Expected "${command}" routedTo ${options.routedTo}, got ${result.routedTo}.`,
    );
  }
  if (options.followUp !== undefined) {
    assert(
      result.usedFollowUpContext === options.followUp,
      `Expected "${command}" followUp=${options.followUp}, got ${result.usedFollowUpContext}.`,
    );
  }
  return result;
}

const pendingCalendarMemory = {
  lastIntent: "calendar_prepare_event",
  pendingCalendarApproval: {
    action: "create_event",
    connectorId: "google_calendar",
    payload: {
      title: "Supplier meeting",
      start: "2026-05-30T10:00:00.000+01:00",
      end: "2026-05-30T10:30:00.000+01:00",
      location: "Lekki office",
      timeZone: "Africa/Lagos",
    },
    status: "pending",
  },
};

check("Check my calendar today.", "calendar_today", { routedTo: "calendar.today" });
check("What is on my calendar today?", "calendar_today");
check("What meetings do I have tomorrow?", "calendar_tomorrow");
check("Summarize my calendar.", "calendar_summary");
check("Find free slots tomorrow.", "calendar_find_slots");

check("Schedule a supplier meeting tomorrow at 10am.", "calendar_prepare_event");
check("Schedule a supplier meeting tomorrow at 10 a.m.", "calendar_prepare_event");
check("Schedule a meeting tomorrow.", "calendar_prepare_event");
check("3pm.", "calendar_prepare_event_followup", {
  followUp: true,
  memory: pendingCalendarMemory,
  routedTo: "calendar.updatePendingApproval",
});
const tenAm = check("10 a.m.", "calendar_prepare_event_followup", {
  followUp: true,
  memory: {
    pendingClarification: {
      missingFields: ["time"],
      partialPayload: { title: "Meeting", dateLabel: "tomorrow" },
      type: "calendar_event",
    },
  },
  routedTo: "calendar.updatePendingApproval",
});
assert(tenAm.entities.followUpType === "time", `Expected 10 a.m. followUpType=time, got ${tenAm.entities.followUpType}.`);
check("10 a.m.", "calendar_followup_needs_target", {
  followUp: false,
});
check("location is at Lagos State.", "calendar_prepare_event_followup", {
  followUp: true,
  memory: pendingCalendarMemory,
});
check("location is at Lagos State.", "calendar_followup_needs_target", {
  followUp: false,
});
check("Schedule a product review Friday at 2pm for 1 hour at Ikeja office.", "calendar_prepare_event");

check("Sync Gmail.", "gmail_sync");
check("Summarize my unread emails.", "gmail_summarize_unread");
check("What emails need my attention?", "gmail_attention");
check("Find emails from Google.", "gmail_search_sender");
check("Find emails about invoice.", "gmail_search_keyword");
check("Draft a reply to the latest Gmail email.", "gmail_draft_latest_email");
for (const phrase of [
  // legacy phrases that must keep working
  "draught latest email",
  "draft latest email",
  "draft last email",
  "draught last email",
  "prepare latest email",
  "reply latest email",
  "create gmail draft",
  "email draft",
  "gmail draft",
  // new "create" phrases
  "Create latest email.",
  "Create email reply.",
  "Create latest reply.",
  "Create Gmail reply.",
  "Create reply for latest email.",
  "Create reply for my latest email.",
  "Create a reply to the latest email.",
  "Create a Gmail draft.",
  "Create latest Gmail draft.",
]) {
  check(phrase, "gmail_draft_latest_email", { routedTo: "gmail.draftLatestEmail" });
}
check("Draft replies for important Gmail emails.", "gmail_draft_replies");
check("draft important emails", "gmail_draft_replies");
check("draught important emails", "gmail_draft_replies");
check("Send the email.", "gmail_send_blocked");

check("What needs approval?", "needs_approval", { routedTo: "approvals.list" });
check("What actions are waiting for approval?", "needs_approval");
check("Show approval queue.", "needs_approval");

check("What needs my attention today?", "attention_summary", { routedTo: "attention.getUnifiedAttentionSummary" });
check("What should I focus on today?", "attention_summary");
check("What should I handle first?", "attention_summary");
check("What is urgent today?", "attention_summary");
check("Give me my business priorities.", "attention_summary");
check("What are my top priorities?", "attention_summary");

console.log("Voice intent regression tests passed.");
