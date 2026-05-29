# Amanda Voice Debug Trace - Implementation Complete ✓

## What Was Implemented

### 1. **Debug Environment Variables** ✓
- Added `AMANDA_DEBUG_VOICE=true` to `.env`
- Server checks `NODE_ENV=development` or `AMANDA_DEBUG_VOICE=true` to enable debug mode

### 2. **Frontend Debug Panel** ✓
- **Location**: Bottom-left corner of `/voice` page
- **Visibility**: Only shows when debug mode is enabled
- **Toggle button**: "Debug" button that appears in bottom-left
- **Contents**: Displays all critical request metadata

#### Debug Panel Shows:
```
Request ID              → Unique ID for each voice request
Raw Transcript          → Exactly what speech recognition captured
Cleaned Transcript      → What was sent to the backend
Last Sent Time          → Timestamp of the request
Voice State             → Current voice mode (idle, listening, thinking, speaking, etc.)
Final Result            → Whether recognition completed
Recognition Count       → Number of speech recognition results
Duplicate Blocked       → If duplicate detection prevented a re-send

--- Intent & Routing ---
Intent                  → Detected intent (calendar_today, calendar_prepare_event, etc.)
Confidence              → Routing confidence (0-100%)
Routed To               → Which tool was selected (calendar.today, calendar.prepareEvent)
Used Follow-up Context  → Whether Amanda used previous pending clarification

--- Pending & Calendar ---
Pending Clarification   → What fields are missing (e.g., "time" or "location")
Calendar Parser         → Parsed calendar fields (title, date, time, location, missingFields)
Approval Action         → Whether approval was created, updated, or deduped
Approval ID             → ID of the approval request

--- Response ---
Backend Reply           → Amanda's actual response text
```

### 3. **Backend Debug Metadata** ✓
- Enhanced `/api/voice/respond` response to include safe debug data
- Response now includes `agent.calendarParser`, `agent.pendingClarification`, `agent.approval`
- All request IDs are echoed back: `response.requestId`
- Safe console logging: `[VOICE DEBUG]` lines in server output

### 4. **Request ID Tracking** ✓
- Generated format: `voice_${timestamp}_${random}`
- Example: `voice_1716902400123_a7e4d404`
- Used to correlate frontend and backend logs

### 5. **Duplicate Detection** ✓
- Tracks last transcript sent
- Blocks identical transcripts within 3-5 seconds
- Shows "Duplicate Blocked" indicator in debug panel
- Prevents accidental re-sends

### 6. **Recognition Result Counting** ✓
- Tracks `recognitionCount` from Web Speech API events
- Shows final count in debug panel

### 7. **Server-Side Logging** ✓
- Format: `[VOICE DEBUG] requestId="..." transcript="..." intent="..." confidence=... routedTo="..." followUp=true state="..."`
- Example:
  ```
  [VOICE DEBUG] requestId="voice_1716902400123_a7e4d404" transcript="Check my calendar today." intent="calendar_today" confidence=0.96 routedTo="calendar.readToday" followUp=false state="executed"
  ```

---

## How to Use the Debug Panel

### **Step 1: Ensure Debug is Enabled**
Check `.env`:
```env
NODE_ENV=development
AMANDA_DEBUG_VOICE=true
```

Server console will show:
```
Amanda app running at http://localhost:3000/
```

### **Step 2: Access Voice Mode**
1. Navigate to `/voice`
2. Login with your session
3. Look for "Debug" button in bottom-left corner

### **Step 3: Click the Debug Button**
- Toggle opens the debug panel
- Panel stays open until you close it
- Shows all data in real-time as you speak

### **Step 4: Speak a Test Command**
Example: "Check my calendar today."

### **Step 5: Read the Debug Output**

The panel will immediately show:
- ✅ **Raw Transcript**: The exact words Amanda heard
- ✅ **Cleaned Transcript**: What was sent to the server
- ✅ **Intent**: Which action Amanda detected (e.g., `calendar_today`)
- ✅ **Confidence**: How sure Amanda is (96%)
- ✅ **Routed To**: Which tool was selected (e.g., `calendar.readToday`)
- ✅ **Backend Reply**: What Amanda will say

---

## Test Cases to Run

### **Test 1: Check Calendar Today**
```
Command: "Check my calendar today."

Expected Debug Output:
  Intent: calendar_today
  Confidence: 96%
  Routed To: calendar.readToday
  Used Follow-up Context: false
  Calendar Parser: —
  Pending Clarification: —
  Reply: "I checked today's calendar..."
```

### **Test 2: Schedule a Complete Event**
```
Command: "Schedule a supplier meeting tomorrow at 10am at Lekki office."

Expected Debug Output:
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
  Approval ID: approval_xxx
  Reply: "I prepared this calendar event for approval..."
```

### **Test 3: Incomplete Scheduling Request**
```
Command: "Schedule a meeting tomorrow."

Expected Debug Output:
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
  Reply: "I need a couple more details. What should I call this meeting, and what time works best?"
```

### **Test 4: Follow-up with Context**
*First say: "Schedule a meeting tomorrow."* (System asks for time)
```
Then say: "3pm."

Expected Debug Output:
  Intent: calendar_prepare_event
  Confidence: 90%
  Routed To: calendar.prepareEvent
  Used Follow-up Context: TRUE ✓ (This is the key!)
  Calendar Parser:
    title: (from context)
    date: tomorrow (from context)
    time: 3pm (new)
    location:
    missing: ["title"]
  Pending Clarification:
    type: calendar_event
    missingFields: ["title"]
  Reply: "I still need to know what this meeting is called..."
```

### **Test 5: Location Update to Pending**
*First: "Schedule a meeting tomorrow at 3pm."* (System asks for title)
```
Then say: "At Lekki office."

Expected Debug Output:
  Intent: calendar_prepare_event
  Confidence: 90%
  Routed To: calendar.prepareEvent
  Used Follow-up Context: TRUE ✓
  Calendar Parser:
    title: (from context)
    date: tomorrow (from context)
    time: 3pm (from context)
    location: Lekki office (new)
    missing: ["title"]
  Approval Action: updated (existing approval ID)
```

### **Test 6: Needs Approval Query**
```
Command: "What needs approval?"

Expected Debug Output:
  Intent: needs_approval
  Confidence: 94%
  Routed To: approvals.list
  Used Follow-up Context: false
  Reply: "You have X approvals waiting..."
```

---

## Reading the Debug Output

### **Real-Time Tracing Path**

When you speak, Amanda follows this path. The debug panel shows each step:

```
1. Speech Recognition
   ↓
   Raw Transcript: "Schedule a supplier meeting..." → Appears immediately

2. Cleaning & Validation
   ↓
   Cleaned Transcript: "Schedule a supplier meeting tomorrow at 10am at Lekki office."
   Duplicate Blocked: false

3. Intent Router
   ↓
   Intent: calendar_prepare_event
   Confidence: 0.95
   Routed To: calendar.prepareEvent

4. Calendar Parser
   ↓
   Calendar Parser:
     title: "Supplier meeting"
     date: "tomorrow"
     time: "10am"
     location: "Lekki office"
     missing: []

5. Approval System
   ↓
   Approval Action: created
   Approval ID: approval_123

6. Brain Response
   ↓
   Backend Reply: "I prepared this calendar event for approval: Supplier meeting, tomorrow at 10am, at Lekki office. I will not add it to Google Calendar until you approve it."
```

---

## Troubleshooting with Debug Output

### **Problem: "Amanda chose wrong intent"**
- Check `Intent` field
- If it says `calendar_summary` but you asked to schedule, the router pattern matched wrong keywords
- Example: Saying "summarize my calendar" might trigger `calendar_summary` instead of `calendar_prepare_event`

### **Problem: "Missing calendar fields not detected"**
- Check `Calendar Parser` → `missing` array
- If empty but Amanda asked for clarification, the parser isn't extracting fields correctly
- Example: "Schedule a call with John" should extract `title="Call with John"` but might show empty title

### **Problem: "Follow-up context isn't being used"**
- Check `Used Follow-up Context` field
- If `false` when it should be `true`, the system didn't detect previous pending clarification
- Check `Pending Clarification` field - should show the missing fields

### **Problem: "Approval not created"**
- Check `Approval Action` field
- Should be `created` for new events, `updated` for existing ones
- If `—` (empty), the approval system didn't run

### **Problem: "Duplicate blocked incorrectly"**
- Check `Duplicate Blocked` field
- Check `Last Sent Time` and `Raw Transcript`
- If you speak different words but it shows "Duplicate Blocked: true", there's a normalization issue

---

## Server-Side Logs

The server also logs safe debug info. Check the console where you ran `npm run dev`:

```
[VOICE DEBUG] requestId="voice_1716902400123_a7e4d404" transcript="Schedule a supplier meeting tomorrow at 10am at Lekki office." intent="calendar_prepare_event" confidence=0.95 routedTo="calendar.prepareEvent" followUp=false state="executed"
```

### **Log Fields Explained:**
- `requestId`: Matches the frontend request ID - use this to correlate logs
- `transcript`: What the user said (not full, but key parts)
- `intent`: The detected intent
- `confidence`: How confident the router is
- `routedTo`: Which tool was selected
- `followUp`: Whether follow-up context was used
- `state`: "executed" = request completed

---

## Files Modified

1. **`.env`** - Added `AMANDA_DEBUG_VOICE=true`
2. **`voice.html`** - Added debug panel HTML and styling
3. **`src/voice-client.js`**:
   - Added `debugData` object to track all request details
   - Added `updateDebugPanel()` function to refresh UI
   - Enhanced `submitTranscript()` to generate request IDs and track duplicates
   - Added duplicate blocking with counter
   - Added request ID to API call
   - Added debug toggle button listeners
4. **`server.js`**:
   - Updated `/api/voice/respond` to include full debug metadata
   - Updated `bootstrapForUser()` to send `NODE_ENV` and `debugVoice` flags
   - Added safe console logging with `[VOICE DEBUG]` prefix
   - Included `calendarParser`, `pendingClarification`, and `approval` in response

---

## Summary

The debug system provides **complete visibility** into Amanda's voice processing chain:

1. ✅ **Speech Recognition** - See exactly what the mic captured
2. ✅ **Cleaning** - See what was sent to the backend
3. ✅ **Intent Detection** - See which action Amanda chose
4. ✅ **Confidence** - See how sure Amanda is (0-100%)
5. ✅ **Routing** - See which tool was selected
6. ✅ **Calendar Parsing** - See extracted title/date/time/location/missing fields
7. ✅ **Follow-up Context** - See if Amanda used previous context
8. ✅ **Pending Clarification** - See what fields are missing
9. ✅ **Approval Actions** - See whether approval was created or updated
10. ✅ **Response** - See exactly what Amanda will say

This allows you to identify the **exact failure point** in Amanda's voice handling:
- Is the transcript wrong? (Check Raw Transcript)
- Is the intent wrong? (Check Intent + Confidence)
- Are calendar fields missing? (Check Calendar Parser → missing)
- Is follow-up context lost? (Check Used Follow-up Context)
- Is approval not created? (Check Approval Action)

---

## Next Steps After Debugging

Once you've identified the failing layer using this debug panel:

1. **If speech recognition is wrong** → Check microphone permissions or background noise
2. **If intent is wrong** → Update intent-router.js pattern matching
3. **If calendar parsing fails** → Update calendar-parser.js field extraction
4. **If follow-up context is lost** → Check memory.pendingClarification handling
5. **If approval isn't created** → Check connectors.requestApproval() logic

The debug panel makes it **visible where the problem is**, not just that there is one.
