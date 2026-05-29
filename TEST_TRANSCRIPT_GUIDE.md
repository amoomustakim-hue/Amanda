# Amanda Voice Debug - Expected Test Results

## Format for Recording Results

After you test each command, use this format:

```txt
I said:
[Your exact speech]

Amanda replied:
[What Amanda said back]

What I expected:
[What should have happened]

Debug Panel Output:
[Copy-paste the key fields from the debug panel]
```

---

## Test 1: Check Calendar Today

### You Say:
```
"Check my calendar today."
```

### Amanda Should Reply:
```
"I checked today's calendar. You have 3 meetings: 
- 10am Sales Review
- 2pm Client Call  
- 4pm Team Sync

The most important is the Sales Review at 10am."
```

### Expected Debug Panel:
```
Raw Transcript: "Check my calendar today."
Cleaned Transcript: "Check my calendar today."
Intent: calendar_today
Confidence: 96%
Routed To: calendar.readToday
Used Follow-up Context: false
Pending Clarification: —
Calendar Parser: —
Approval Action: —
Request ID: voice_XXXXX_XXXXX
Backend Reply: "I checked today's calendar..."
```

### Success Indicators ✓
- [x] Intent = `calendar_today` (not `calendar_summary` or `operations_summary`)
- [x] Routed To = `calendar.readToday`
- [x] Confidence >= 0.90
- [x] No pending clarification
- [x] Amanda lists today's events

---

## Test 2: Schedule Complete Event

### You Say:
```
"Schedule a supplier meeting tomorrow at 10am at Lekki office."
```

### Amanda Should Reply:
```
"I prepared this calendar event for approval: Supplier meeting, tomorrow at 10:00 AM, at Lekki office. 
I will not add it to Google Calendar until you approve it."
```

### Expected Debug Panel:
```
Raw Transcript: "Schedule a supplier meeting tomorrow at 10am at Lekki office."
Cleaned Transcript: "Schedule a supplier meeting tomorrow at 10am at Lekki office."
Intent: calendar_prepare_event
Confidence: 95%
Routed To: calendar.prepareEvent
Used Follow-up Context: false

Calendar Parser:
  title: Supplier meeting
  date: tomorrow
  time: 10am
  location: Lekki office
  missing: []

Approval Action: created
Approval ID: approval_xxxx_xxxxx
Request ID: voice_XXXXX_XXXXX
Backend Reply: "I prepared this calendar event for approval..."
```

### Success Indicators ✓
- [x] Intent = `calendar_prepare_event`
- [x] All fields parsed correctly (title, date, time, location)
- [x] missingFields = [] (empty array)
- [x] Approval Action = `created`
- [x] Approval ID generated
- [x] Amanda acknowledges it won't be added until approved

---

## Test 3: Incomplete Event (Missing Time)

### You Say:
```
"Schedule a meeting tomorrow."
```

### Amanda Should Reply:
```
"I need a couple more details to schedule that meeting. 
What should I call this meeting, and what time works best for you?"
```

### Expected Debug Panel:
```
Raw Transcript: "Schedule a meeting tomorrow."
Cleaned Transcript: "Schedule a meeting tomorrow."
Intent: calendar_prepare_event
Confidence: 95%
Routed To: calendar.prepareEvent
Used Follow-up Context: false

Calendar Parser:
  title: 
  date: tomorrow
  time: — (not found)
  location: 
  missing: ["title", "time"]

Pending Clarification:
  type: calendar_event
  missingFields: ["title", "time"]

Approval Action: —
Request ID: voice_XXXXX_XXXXX
Backend Reply: "I need a couple more details..."
```

### Success Indicators ✓
- [x] Intent = `calendar_prepare_event`
- [x] missingFields array contains `["title", "time"]`
- [x] Pending Clarification type = `calendar_event`
- [x] No approval created (Action is empty)
- [x] Amanda asks for missing details

---

## Test 4: Follow-up Context Usage (Time Clarification)

### You Say (in sequence):
```
1. "Schedule a meeting tomorrow."
   [Amanda asks for time and title]

2. "3pm."
```

### Amanda's Response to "3pm":
```
"I updated the meeting to 3:00 PM tomorrow. 
I still need to know what this meeting is about. What should I call it?"
```

### Expected Debug Panel (for "3pm" only):
```
Raw Transcript: "3pm."
Cleaned Transcript: "3pm."
Intent: calendar_prepare_event
Confidence: 90%
Routed To: calendar.prepareEvent
Used Follow-up Context: TRUE ✓✓✓ (THIS IS KEY!)

Calendar Parser:
  title: (carried from context)
  date: tomorrow (carried from context)
  time: 3pm (NEW - from "3pm.")
  location: 
  missing: ["title"]

Pending Clarification:
  type: calendar_event
  missingFields: ["title"]

Approval Action: updated
Request ID: voice_XXXXX_XXXXX
Backend Reply: "I updated the meeting to 3:00 PM..."
```

### Success Indicators ✓
- [x] Used Follow-up Context = TRUE (shows Amanda accessed previous pending clarification)
- [x] Date and location carried from previous context
- [x] Only "time" was added from this new input
- [x] Approval Action = `updated` (not created)
- [x] Amanda refers back to the conversation

---

## Test 5: Location Update to Existing Event

### You Say (in sequence):
```
1. "Schedule a call with John tomorrow at 2pm."
   [Amanda creates approval]

2. "At Lekki office."
```

### Amanda's Response to "At Lekki office.":
```
"I updated that call with John to include the location: Lekki office. 
The approval has been updated and is ready for your review."
```

### Expected Debug Panel (for "At Lekki office." only):
```
Raw Transcript: "At Lekki office."
Cleaned Transcript: "At Lekki office."
Intent: calendar_prepare_event
Confidence: 90%
Routed To: calendar.prepareEvent
Used Follow-up Context: TRUE ✓✓✓

Calendar Parser:
  title: Call with John (carried from context)
  date: tomorrow (carried from context)
  time: 2pm (carried from context)
  location: Lekki office (NEW)
  missing: []

Pending Clarification: — (all fields now complete!)

Approval Action: updated
Approval ID: (same ID as first approval)
Request ID: voice_XXXXX_XXXXX
Backend Reply: "I updated that call with John..."
```

### Success Indicators ✓
- [x] Used Follow-up Context = TRUE
- [x] Title, date, time all carried from context
- [x] Location added from new input
- [x] missingFields = [] (now complete)
- [x] Approval Action = `updated` (not created again)
- [x] Same approval ID (deduplication worked)

---

## Test 6: Check What Needs Approval

### You Say:
```
"What needs approval?"
```

### Amanda Should Reply:
```
"You have 2 items waiting for approval:
1. Supplier meeting tomorrow at 10am
2. Call with John tomorrow at 2pm at Lekki office

Review and approve these before they're added to your calendar."
```

### Expected Debug Panel:
```
Raw Transcript: "What needs approval?"
Cleaned Transcript: "What needs approval?"
Intent: needs_approval
Confidence: 94%
Routed To: approvals.list
Used Follow-up Context: false

Calendar Parser: —
Pending Clarification: —
Approval Action: —

Request ID: voice_XXXXX_XXXXX
Backend Reply: "You have 2 items waiting for approval..."
```

### Success Indicators ✓
- [x] Intent = `needs_approval` (not `attention_today` or `operations_summary`)
- [x] Routed To = `approvals.list`
- [x] No calendar parser (this isn't a calendar action)
- [x] Amanda lists pending approvals

---

## Summary: What the Debug Panel Tells You

### **For Test 1 & 6 (Reading/Querying)**
- ✅ Check `Intent` matches expected value
- ✅ Check `Confidence` is high (>0.90)
- ✅ Check `Routed To` is the right tool
- ✅ Verify Amanda lists correct information

### **For Test 2 (Complete Info)**
- ✅ Check `Calendar Parser` has all fields (title, date, time, location)
- ✅ Check `missingFields` = [] (empty)
- ✅ Check `Approval Action` = `created`
- ✅ Check Approval ID generated

### **For Test 3 (Missing Info)**
- ✅ Check `missingFields` array lists what's missing
- ✅ Check `Pending Clarification` is set
- ✅ Check NO approval created yet

### **For Test 4 & 5 (Follow-up)**
- ✅✅✅ Check `Used Follow-up Context` = TRUE (most important!)
- ✅ Check previous fields are preserved
- ✅ Check `Approval Action` = `updated` (not created)
- ✅ Check Approval ID is same as before

---

## Debugging Strategy Using These Tests

If a test fails, use the debug panel to identify WHERE:

```
Test 2 fails (event not scheduled)?
├─ Check Raw Transcript - is speech recognition wrong?
├─ Check Intent - did router choose wrong action?
├─ Check Confidence - is router uncertain?
├─ Check Calendar Parser - are fields extracted correctly?
├─ Check missingFields - are required fields detected?
└─ Check Approval Action - was approval created?

Test 4 fails (follow-up doesn't work)?
├─ Check Used Follow-up Context - is it TRUE?
├─ Check Calendar Parser - are old fields preserved?
├─ Check Pending Clarification - was it set after Test 3?
└─ Check Approval Action - should be "updated", not "created"
```

---

## Quick Reference: Key Fields to Watch

| Field | Meaning | Success = |
|-------|---------|-----------|
| `Intent` | What action Amanda chose | Matches expected (calendar_today, calendar_prepare_event, needs_approval) |
| `Confidence` | How sure the router is | >= 0.90 (90% or higher) |
| `Routed To` | Which tool was selected | Matches expected (calendar.today, calendar.prepareEvent, approvals.list) |
| `Used Follow-up Context` | Did Amanda access previous pending clarification | TRUE for follow-up tests, FALSE for new tests |
| `missingFields` | What info is still needed | Empty [] for complete events, ["title", "time"] for incomplete |
| `Pending Clarification` | Is Amanda waiting for more info | Set when missingFields is not empty |
| `Calendar Parser → title/date/time/location` | Extracted event details | Should match what you said |
| `Approval Action` | What happened to the approval | "created" for new, "updated" for follow-up, empty if no approval |
| `Approval ID` | Unique ID for this approval | Same ID across all follow-ups of same event |
| `Backend Reply` | What Amanda will say | Should reference the user's input |

---

## The Most Important Test

**Test 4 and 5 are the CRITICAL tests** because they show whether Amanda's memory system works:

- If `Used Follow-up Context` = FALSE when it should be TRUE, that's the bug
- If Approval Action = "created" instead of "updated", that's the bug
- If Approval ID changes instead of staying the same, that's the bug

These tests prove whether Amanda can:
1. Remember what you said before ✓
2. Use that memory in new requests ✓
3. Not duplicate approvals ✓

---

## After Running These Tests

1. **Collect all debug panel outputs** (you can screenshot or copy-paste)
2. **Look for discrepancies** between what the panel shows and what you expect
3. **Report the exact failing point** to the developer with:
   - What you said
   - What debug panel showed
   - What you expected vs. what happened

Example report:
```
TEST 4 FAILED:
I said: "3pm."
Expected: Used Follow-up Context = TRUE
Actual: Used Follow-up Context = FALSE
Debug shows: Intent=calendar_prepare_event, but it lost the previous context
The date and location from "Schedule a meeting tomorrow" are not appearing.
```

This tells the developer EXACTLY where to look, instead of guessing.
