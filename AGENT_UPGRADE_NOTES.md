# Amanda Agent Upgrade Notes

## Google Sheets Read-Only Connector

### What this adds

Amanda can connect to a Google Spreadsheet, read rows from configured ranges, summarize business data, and surface sheet insights in the Attention Engine and voice responses.

### Files added / changed

- `src/connectors/google-sheets.js` — OAuth connect/callback, token management, sheet reading, row parsing, and store summary analysis.
- `server.js` — Google Sheets OAuth callback, `POST /config`, `POST /sync`, `GET /status`, `GET /summary`, `GET /setup`, `POST /disconnect` endpoints.
- `src/agent/intent-router.js` — 5 new sheets intents.
- `src/agent/brain.js` — `sheets_summary` handler covering all sub-intents.
- `src/agent/attention-engine.js` — `collectSheetsSignals()` surfaces low stock, top product, and high-priority customer issues.
- `scripts/test-google-sheets-readonly.mjs` — full test suite.
- `.env.example` — `GOOGLE_SHEETS_SCOPES` and `GOOGLE_SHEETS_REDIRECT_URI` documented.
- `package.json` — new test added to `check` command.

### OAuth scope

```
https://www.googleapis.com/auth/spreadsheets.readonly
```

Uses the same `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` as Calendar and Gmail. The token is stored separately under `connectorTokensByUser[userId].google_sheets`.

### API endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/connectors/google_sheets/connect` | Starts OAuth flow |
| `GET` | `/api/connectors/google_sheets/callback` | OAuth callback (no session required) |
| `POST` | `/api/connectors/google_sheets/disconnect` | Revokes local token |
| `GET` | `/api/connectors/google_sheets/status` | Connection status |
| `GET` | `/api/connectors/google_sheets/setup` | Full setup info |
| `POST` | `/api/connectors/google_sheets/config` | Save spreadsheetId + ranges |
| `POST` | `/api/connectors/google_sheets/sync` | Read ranges from Google Sheets API |
| `GET` | `/api/connectors/google_sheets/summary` | Get locally cached summary |

### Default ranges

If no ranges are configured:

```
Orders!A1:H50
Products!A1:H50
Inventory!A1:F50
Customer Issues!A1:G50
Analytics!A1:F20
```

Ranges that do not exist in the spreadsheet are skipped with a warning. Other ranges continue syncing.

### Sheet analysis

`summarizeStoreSheet()` detects:

- **Top product** — row with highest `revenue` / `sales` / `total` column value
- **Low stock items** — rows where `stock` / `inventory` / `quantity` ≤ 5
- **Customer issues** — rows with `issue` / `complaint` / `problem` columns
- **Recommendations** — auto-generated from the above findings

Column headers are matched case-insensitively by keyword (e.g. "Product Name", "product_name", "ProductName" all match `product`).

### Attention Engine signals

| Type | Score | Priority |
|---|---|---|
| `low_stock_item` (0 units) | 85 | high |
| `low_stock_item` (1–2 units) | 82 | high |
| `low_stock_item` (3–5 units) | 70 | medium |
| `customer_issue_from_sheet` (high priority) | 80 | high |
| `top_selling_product` | 65 | medium |

### Voice commands

| Phrase | Intent |
|---|---|
| "Check Google Sheets" / "Summarize my store sheet" | `sheets_summary` |
| "What product sold the most from my sheet?" | `sheets_top_product` |
| "Any low stock items in my sheet?" | `sheets_low_stock` |
| "What issues are in my customer sheet?" | `sheets_customer_issues` |
| "What should I focus on from my sheet?" | `sheets_focus_recommendation` |

### Safety rules

- Read-only only. `readSheetValues` and `readMultipleRanges` perform GET requests only.
- No write, append, update, or delete Sheets API calls exist in this codebase.
- Tokens are encrypted at rest with AES-256-GCM using `AMANDA_TOKEN_SECRET`.
- Tokens are never returned in API responses or written to action logs.
- Full sheet contents are not returned in voice replies — only summarized insights.

### Setup steps

1. Enable Google Sheets API in Google Cloud for the same project as Calendar/Gmail.
2. Add `http://localhost:3010/api/connectors/google_sheets/callback` to Authorized redirect URIs.
3. Set `GOOGLE_SHEETS_REDIRECT_URI=http://localhost:3010/api/connectors/google_sheets/callback` in `.env`.
4. Restart Amanda.
5. Open `/connectors`, find Google Sheets, click Connect.
6. Complete Google OAuth.
7. Add Spreadsheet ID on the Connectors page and click Save Sheet.
8. Click Sync Sheet.

### Environment variables

```env
GOOGLE_SHEETS_SCOPES=https://www.googleapis.com/auth/spreadsheets.readonly
GOOGLE_SHEETS_REDIRECT_URI=http://localhost:3010/api/connectors/google_sheets/callback
```

### Tests run

```bash
npm run check
node scripts/test-google-sheets-readonly.mjs   # 6 unit + 6 integration
node scripts/test-voice-intents.mjs
node scripts/test-attention-engine.mjs
node scripts/test-website-connector.mjs
node scripts/test-gmail-readonly.mjs
node scripts/test-calendar-followups.mjs
node scripts/test-gemini-brain.mjs
```

All pass.

### Known limitations

- Google Sheets OAuth is a separate flow from Calendar and Gmail (separate token record).
- Sheet column detection is heuristic — columns must contain recognizable keywords like "product", "revenue", "stock", "issue".
- No real-time sync; user must trigger sync manually from `/connectors`.
- If the spreadsheet has non-standard tab names, configure the exact ranges using `POST /api/connectors/google_sheets/config`.

---

## Keyboard Text Input for Voice Mode

### Why it was added

Speech recognition sometimes mishears short commands during demos — especially business-specific phrases like `abandoned checkout`, `create latest email`, or `what needs my attention today`. Keyboard input gives a reliable fallback that produces identical behavior to spoken commands.

### How it works

A compact text input panel sits above the nav bar on `/voice`. The user can:

- Type a command and press **Enter** to send.
- Click **Send**.
- Click one of the four quick-command chips (fills and sends immediately).
- Use **Shift + Enter** for a multi-line input.

Typed commands go through the exact same handler as speech: `sendAmandaCommand(text, "keyboard")`. This means:

- Same `/api/voice/respond` backend route.
- Same intent routing, Gemini brain, and safety policy.
- Same TTS playback (ElevenLabs or Web Speech).
- Same duplicate-blocking (5-second window).
- Same approval queue, Gmail, Calendar, and website connector routing.
- Same debug panel update.

Filler-only filtering (`uh`, `um`, `okay`) is skipped for keyboard input — typed commands are always submitted if non-empty.

### `sendAmandaCommand(text, source)`

The former `submitTranscript(transcript)` was renamed to `sendAmandaCommand(text, source = "voice")`. Both call sites (speech recognition `onend` and the smoke-test hook) pass `source: "voice"`. The keyboard handlers pass `source: "keyboard"`.

### Debug field `inputSource`

Each voice turn now records the input source in the debug panel and in `debugSnapshot()`:

```json
{ "inputSource": "keyboard" }
{ "inputSource": "voice" }
```

### Quick-command chips

Four chips appear in the input panel for demo convenience:

```
Attention today         → "What needs my attention today?"
Abandoned checkout      → "Abandoned checkout"
Create latest email     → "Create latest email"
What needs approval     → "What needs approval?"
```

Clicking a chip fills the input and sends immediately.

### Send button state

The Send button is disabled while Amanda is thinking or speaking, preventing double-sends.

### Manual demo commands to test

| Typed command | Expected intent |
|---|---|
| `abandoned checkout` | `website_abandoned_checkouts` |
| `what happened on my website today` | `website_events` |
| `what needs my attention today` | `attention_summary` |
| `create latest email` | `gmail_draft_latest_email` |
| `what needs approval` | `needs_approval` |
| `check my calendar today` | `calendar_today` |
| `send the email` | `gmail_send_blocked` (safety blocked) |

### Tests run

```bash
npm run check
node scripts/test-voice-intents.mjs
node scripts/test-website-connector.mjs
node scripts/test-gmail-readonly.mjs
node scripts/test-calendar-followups.mjs
node scripts/test-attention-engine.mjs
```

All pass. No regressions.

---

## TTS Provider Switching

### How to switch TTS

**Development — use browser Web Speech (default, no API key needed):**

```env
AMANDA_TTS_PROVIDER=webspeech
```

**Demo — use ElevenLabs (requires `ELEVENLABS_API_KEY`):**

```env
AMANDA_TTS_PROVIDER=elevenlabs
```

Restart the server after changing `AMANDA_TTS_PROVIDER`.

The setting is exposed through `/api/bootstrap` as `ttsProvider` (a non-secret value). The voice client reads it on load and skips the backend TTS round-trip entirely when the provider is `webspeech`.

### Safety rules

- Never commit `.env`.
- Keep `ELEVENLABS_API_KEY` only in your local `.env` file.
- The ElevenLabs key is read only in `server.js` via `process.env`. It is never returned in API responses, never logged, and never sent to frontend JavaScript.

### Debug panel behavior by mode

| Mode | `ttsProvider` | `ttsFallbackUsed` |
|---|---|---|
| `AMANDA_TTS_PROVIDER=webspeech` | `webspeech` | `false` |
| `AMANDA_TTS_PROVIDER=elevenlabs`, key present, ElevenLabs succeeds | `elevenlabs` | `false` |
| `AMANDA_TTS_PROVIDER=elevenlabs`, key missing or ElevenLabs fails | `elevenlabs` | `true` |

---

## Voice Quality, Latency, and ElevenLabs TTS

### Backend TTS endpoint

Added `POST /api/tts/speak` to `server.js`.

- Requires authenticated session.
- Validates `text` (non-empty, max 1200 characters).
- If `AMANDA_TTS_PROVIDER` is not `elevenlabs`, returns `{ ok: false, fallback: true, reason: "tts_provider_disabled" }`.
- If ElevenLabs env vars are missing, returns `{ ok: false, fallback: true, reason: "elevenlabs_not_configured" }`.
- If configured, calls `https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}/stream` with a 13-second backend timeout.
- Streams `audio/mpeg` back to the frontend on success.
- On timeout, returns `{ ok: false, fallback: true, reason: "elevenlabs_timeout" }`.
- On other ElevenLabs errors, returns `{ ok: false, fallback: true, reason: "elevenlabs_error" }`.
- API key is never logged, never returned to the frontend, and never included in responses.

### Environment variables

Added to `.env.example`:

```env
AMANDA_TTS_PROVIDER=webspeech
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL
ELEVENLABS_MODEL_ID=eleven_turbo_v2
ELEVENLABS_OUTPUT_FORMAT=mp3_44100_128
```

- `AMANDA_TTS_PROVIDER=webspeech` — use browser Web Speech only (default, no API key required).
- `AMANDA_TTS_PROVIDER=elevenlabs` — try ElevenLabs first, then fall back to Web Speech.
- All ElevenLabs variables are backend-only. They are never sent to the frontend.

### ElevenLabs safety model

- ElevenLabs is called only from `server.js`, never from any frontend JavaScript.
- `ELEVENLABS_API_KEY` is read only via `process.env` in the backend.
- The key is not logged, not included in API responses, and not sent in debug metadata.
- If ElevenLabs is unavailable or times out, the frontend automatically falls back to Web Speech.

### Web Speech fallback

`speakFallback(text)` uses browser `SpeechSynthesisUtterance` with:

- `rate: 0.95`, `pitch: 1.0`, `volume: 1.0`
- Voice selection via `chooseBestVoice()` — prefers English, natural/online/neural, Google, Microsoft, then female/warm voices for Amanda.
- 30-second failsafe timer for stuck utterances.
- Graceful no-op if no voices are available.

### Voice state loop

```
listening → thinking → speaking → 500–700ms delay → listening
```

- Recognition results captured while `isAmandaSpeaking === true` are ignored and tracked with `ignoredBecauseSpeaking: true` in debug.
- Recognition does not restart while Amanda is in the `speaking` state.
- Session restarts automatically after speech ends if continuous mode is still active.
- User tapping mic while active pauses/stops the session.
- Escape stops the session and exits immersive mode.

### Latency metrics

Tracked and exposed in the debug panel:

| Field | Description |
|---|---|
| `backendLatencyMs` | Time from transcript send to `/api/voice/respond` response received |
| `ttsLatencyMs` | Time from TTS request to first audio byte received |
| `speechDurationMs` | Time from speech start to speech end |
| `totalTurnLatencyMs` | Time from transcript sent to speech ended |
| `ttsProvider` | `elevenlabs`, `webspeech`, or `webspeech_fallback` |
| `ttsFallbackUsed` | Whether ElevenLabs was tried but fell back to Web Speech |
| `voiceName` | Name of the voice used (`ElevenLabs` or browser voice name) |

Progressive latency feedback:

- Immediately on transcript send: "Thinking..."
- After 1 second: "Amanda is preparing a response..."
- After 5 seconds: "Still working on it..."
- Cleared immediately when the backend response arrives.

### Duplicate blocking

- Same cleaned transcript within 5 seconds is blocked.
- Debug field: `duplicateBlocked: true`, `duplicateWindowMs: 5000`.

### Self-hearing prevention

- `recognition.onresult` returns immediately if `isAmandaSpeaking === true` or `mode === "speaking"`.
- Debug field: `ignoredBecauseSpeaking: true`.
- Critical for ElevenLabs because the clearer synthetic voice is more likely to be picked up by the microphone.

### Debug panel additions

New fields added to `voice.html` debug panel and `debugSnapshot()`:

```
ignoredBecauseSpeaking
backendLatencyMs
ttsProvider
ttsFallbackUsed
ttsLatencyMs
speechDurationMs
totalTurnLatencyMs
voiceName
```

### Response shape safety

`submitTranscript()` now maps multiple backend reply shapes:

```js
const reply = result.reply || result.spokenReply || result.message || "I could not generate a reply for that. Please try again.";
```

Amanda never fails silently.

### Error handling

Categorized error messages for:

- 401 / Unauthorized: "Session expired. Please log in again."
- 500 / 502: "Amanda's server returned an error. Please try again."
- Network failure: "Network error. Check your connection and try again."
- Mic blocked: "Microphone permission is blocked. Please allow mic access in your browser settings."
- No mic: "No microphone detected."
- Unsupported browser: "Speech recognition is not supported in this browser. Please use Chrome."

### Tests run

- `npm run check` — passes.
- `node scripts/test-voice-intents.mjs` — passes.
- `node scripts/test-calendar-followups.mjs` — passes.
- `node scripts/test-gmail-readonly.mjs` — passes.
- `node scripts/test-attention-engine.mjs` — passes.
- `node scripts/test-gemini-brain.mjs` — passes.

### Known browser limitations

- ElevenLabs audio playback uses `new Audio(blobUrl)` which requires autoplay permission. Some browsers require a user gesture before audio plays. Voice mode is always triggered by a mic tap, which counts as a user gesture.
- Web Speech voices vary significantly across Chrome, Edge, Safari, and Firefox. Chrome on desktop provides the best selection.
- `SpeechRecognition` is not available in Firefox or Safari without a polyfill.
- iOS Safari requires special handling for audio context; ElevenLabs playback is recommended to be tested on desktop Chrome first.

## Unified Attention Engine

What changed:

- Added `src/agent/attention-engine.js`.
- Added protected API endpoint `GET /api/attention/today`.
- Added compact `Today's Attention` panels to `/dashboard` and `/workspace`.
- Updated voice routing so `What needs my attention today?`, `What should I focus on today?`, `What should I handle first?`, `What is urgent today?`, `Give me my business priorities.`, and `What are my top priorities?` route to `attention_summary`.

Attention item shape:

- `id`
- `source`
- `type`
- `title`
- `description`
- `priority`
- `score`
- `reason`
- `recommendedAction`
- `relatedRecordId`
- `createdAt`

Sources:

- `gmail`
- `calendar`
- `approval_queue`
- `tasks`
- `connector_status`

Types:

- `important_email`
- `email_needs_reply`
- `gmail_draft_waiting_review`
- `calendar_event_today`
- `calendar_event_soon`
- `calendar_approval_pending`
- `gmail_draft_approval_pending`
- `task_due`
- `connector_needs_sync`

Deterministic scoring:

- High priority, `80-100`:
  - high-priority Gmail messages
  - quote requests and pricing inquiries
  - customer complaints, booking requests, and support requests
  - pending Gmail draft approvals
  - pending Calendar event approvals
  - Calendar events within the next two hours
  - overdue tasks
- Medium priority, `50-79`:
  - unread Gmail messages
  - Gmail drafts waiting for review
  - Calendar events later today
  - connectors that have not synced recently
- Low priority, `10-49`:
  - general upcoming calendar events
  - lower-priority messages
  - normal workspace follow-up signals

Gemini ranking:

- The engine collects and scores signals deterministically first.
- Gemini receives only compact safe signal context: id, source, type, title, description, priority, and score.
- Gemini can return `summary`, `rankedItemIds`, `topRecommendation`, and `spokenReply`.
- If Gemini fails, is unavailable, or returns malformed output, Amanda uses the deterministic ranking.
- Gemini does not execute tools and does not receive OAuth tokens, API keys, connector secrets, or full private email bodies.

Voice behavior:

- `attention_summary` uses `attention.getUnifiedAttentionSummary`.
- Voice replies are capped to the ranked business priorities rather than reading raw records aloud.
- `/api/voice/respond` debug metadata can include:
  - `brain`
  - `routedTo`
  - `safetyDecision`
  - `attention.itemsFound`
  - `attention.highPriorityCount`
  - `attention.sources`

Dashboard/workspace:

- `/dashboard` now shows a full-width `Today's Attention` panel above the operations cards.
- `/workspace` now shows a full-width `Today's Attention` panel above the workspace queue cards.
- Each panel shows up to five items with source badge, priority badge, score/recommendation, and an empty state.

Tests:

- Added `scripts/test-attention-engine.mjs`.
- Verified:
  - Gmail important message creates an attention item.
  - Gmail draft review creates an attention item.
  - Calendar event today/soon creates an attention item.
  - Pending Calendar approval creates an attention item.
  - Items are ranked by score.
  - Gemini failure falls back to deterministic ranking.
  - `What needs my attention today?` routes to `attention_summary`.
  - The API payload shape does not include tokens, secrets, or full private email bodies.
- Test commands run:
  - `npm run check`
  - `node scripts/test-gemini-brain.mjs`
  - `node scripts/test-voice-intents.mjs`
  - `node scripts/test-calendar-followups.mjs`
  - `node scripts/test-gmail-readonly.mjs`
  - `node scripts/test-attention-engine.mjs`

Known limitations:

- Attention scoring is intentionally heuristic and local-first.
- The panel does not yet support resolving or drilling into attention items directly.
- Gemini improves ranking/explanation only; backend safety and approval rules still own execution.

## Gemini Brain Upgrade

Architecture:

- Amanda is now set up as a hybrid full-stack AI agent.
- The frontend still uses the existing voice and command-center UI.
- The backend still owns auth, local data, connector tools, approval execution, transcripts, and safety enforcement.
- Gemini is a backend-only reasoning layer. The Gemini API key is never sent to the frontend.
- Deterministic routing remains in place for critical known flows such as Calendar, Gmail, approvals, and blocked send/delete/cancel actions.

Environment:

- `.env.example` now includes:
  - `GEMINI_API_KEY=`
  - `GEMINI_MODEL=gemini-1.5-flash`
- `.env` remains local-only and ignored.
- If `GEMINI_API_KEY` is missing, Amanda falls back to the local deterministic brain without crashing.

New backend modules:

- `src/agent/gemini.js`
  - `generateAgentDecision({ userMessage, context, availableTools })`
  - `summarizeBusinessContext({ gmail, calendar, approvals, tasks })`
  - `draftEmailReply({ email, businessContext })`
  - `rankAttentionItems({ signals })`
- `src/agent/tool-registry.js`
  - declares safe callable tool names, descriptions, risks, and approval requirements.
- `src/agent/safety-policy.js`
  - enforces backend tool policy after Gemini suggests a tool.

Tool registry:

- `calendar.today`
- `calendar.tomorrow`
- `calendar.summary`
- `calendar.findSlots`
- `calendar.prepareEvent`
- `gmail.sync`
- `gmail.searchMessages`
- `gmail.summarizeUnread`
- `gmail.draftReply`
- `gmail.draftLatestEmail`
- `approvals.list`
- `attention.today`

Safety policy:

- Read actions are allowed.
- Local drafts are allowed.
- Real Gmail draft creation remains approval-gated.
- Real Calendar event creation remains approval-gated.
- Email sending is blocked.
- Email deletion is blocked.
- Email archiving/mailbox mutation is blocked.
- Calendar delete/cancel/move remains blocked for this phase.
- Payments/refunds remain blocked.
- Gemini can suggest a tool, but the backend decides whether it is allowed, approval-required, or blocked.

Hybrid routing behavior:

- Deterministic router handles high-confidence known commands first.
- Gemini is used for flexible/unknown natural language when the local route is weak or generic.
- Gemini can improve Gmail draft wording after the deterministic Gmail draft tool creates local approval items.
- Gemini can rank attention signals for `What needs my attention today?` while using only safe local context.
- If Gemini returns malformed JSON, fails, or is unavailable, Amanda falls back to the deterministic local brain.

Gmail drafting:

- Gmail draft commands still create local drafts and linked Approval Queue records first.
- When Gemini is configured, Amanda asks Gemini for a better reply body using only safe email fields such as sender, subject, category, snippet, and body preview.
- The linked approval request is updated with a short `bodyPreview`.
- No email is sent.

Debug metadata:

- In development/debug mode, `/api/voice/respond` can include safe agent metadata such as:
  - `brain`
  - `intent`
  - `confidence`
  - `tool`
  - `routedTo`
  - `safetyDecision`
- Debug metadata does not include API keys, OAuth tokens, or connector secrets.

Tests:

- Added `scripts/test-gemini-brain.mjs`.
- Covers:
  - Gemini unavailable fallback.
  - Malformed Gemini JSON fallback.
  - Blocked Gemini tool suggestion.
  - Gemini-assisted Gmail draft body generation.
  - Tool registry and safety policy checks.
- Verified:
  - `npm run check`
  - `node scripts/test-gemini-brain.mjs`
  - `node scripts/test-voice-intents.mjs`
  - `node scripts/test-calendar-followups.mjs`
  - `node scripts/test-gmail-readonly.mjs`

Known limitations:

- Normal tests mock Gemini and do not require a real API key.
- Gemini currently augments routing, drafting, and ranking; it does not directly execute connector actions.
- Gemini output is still treated as untrusted until the backend policy approves it.

## Latest Gmail Draft Fix

- Unified Gmail draft selection with the broader business-priority rules instead of relying only on `needsReply === true`.
- Added a dedicated `gmail_draft_latest_email` route for commands like `Draft a reply to the latest Gmail email.`
- Local Gmail drafting now reports safe debug counts for:
  - `syncedMessagesCount`
  - `importantCandidatesCount`
  - `draftableMessagesCount`
  - `draftsCreated`
  - `approvalRequestsCreated`
- Honest reply behavior now distinguishes between:
  - important messages found but no drafts created
  - drafts created but no approval items linked
  - successful draft plus Approval Queue linking
- Test coverage now includes a 12-message Gmail workspace with 7 important messages, plus latest-email draft creation.

## Final Voice Sweep

Problem fixed:

- Voice mode could still send noisy or repeated transcripts during a continuous session.
- Some debug traces were too thin to tell whether a failure came from speech recognition, routing, parser output, or tool execution.
- Gmail and approval voice commands needed to be covered in the same regression matrix as Calendar so future connector work does not reintroduce drift.

Voice state machine behavior:

- The voice client keeps separate concepts for visual fullscreen and the active voice session.
- The session flow is `listening -> thinking -> speaking -> listening` until the user manually stops it.
- Speech recognition only submits final transcript text. Interim text can update the UI, but it is not sent to `/api/voice/respond`.
- If the browser returns multiple final fragments for one turn, Amanda combines them into one cleaned transcript before sending.
- After speech synthesis ends, Amanda waits about `700ms` before restarting recognition so she is less likely to hear the tail end of her own reply.

Duplicate and noise prevention:

- The voice client blocks the same cleaned transcript if it repeats inside a 5 second window.
- The debug panel records `duplicateBlocked=true` when this happens.
- Empty filler such as `uh`, `um`, `hm`, and `hmm` is ignored.
- Short answers such as `yes`, `no`, `okay`, and `yeah` are ignored unless Amanda is actively waiting on a clarification.
- Recognition results received while Amanda is in the `speaking` state are ignored and are not sent to the backend.

Debug panel additions:

- `/voice` now includes a development-only `Copy Debug JSON` button.
- The debug JSON includes request id, raw transcript, cleaned transcript, voice state, final-result flag, duplicate-block state, intent, confidence, route, follow-up usage, pending clarification, calendar parser output, Gmail debug counts, approval action/id, and backend reply.
- Gmail debug output is summarized with counts only. It does not expose tokens, secrets, or full private email bodies.

Intent regression matrix:

- Added `scripts/test-voice-intents.mjs`.
- The script verifies Calendar read commands route to `calendar_today`, `calendar_tomorrow`, `calendar_summary`, and `calendar_find_slots`.
- The script verifies Calendar write/follow-up commands route to `calendar_prepare_event`, `calendar_prepare_event_followup`, and `calendar_followup_needs_target`.
- The script verifies Gmail commands route to `gmail_sync`, `gmail_summarize_unread`, `gmail_attention`, `gmail_search_sender`, `gmail_search_keyword`, `gmail_draft_latest_email`, `gmail_draft_replies`, and `gmail_send_blocked`.
- The script verifies approval commands route to `needs_approval`.

Validation:

- `npm run check`
- `node scripts/test-voice-intents.mjs`
- `node scripts/test-calendar-followups.mjs`
- `node scripts/test-gmail-readonly.mjs`

Known browser limitations:

- Browser speech recognition behavior still varies by Chrome/Edge version, microphone quality, OS permission state, and background noise.
- The automated tests verify routing and backend behavior without microphone access; final STT quality still needs live browser listening during demos.
- Voice approval by a bare `yes` is intentionally not implemented yet because approval actions should stay explicit in the UI for this phase.

Next recommended phase:

- Unified Attention Engine: make `What needs my attention today?` combine Gmail, Calendar, messages, orders, leads, drafts, approvals, and action logs into one ranked operator briefing.

## Current Architecture Summary

Amanda is a zero-dependency Node.js app. `server.js` creates an HTTP server, maps friendly page routes to static HTML files, serves assets from the project root, and handles all `/api/*` requests. Browser pages use small ES modules in `src/` to call the backend, cache bootstrap responses in `localStorage`, and update the existing cinematic UI.

The app persists local state in `data/db.json`. The server keeps an in-memory `dbCache`, writes changes through a serialized write queue, and uses short-lived response caching with ETags for bootstrap, settings, and transcripts.

## Existing Backend Routes

- `GET /api/health`: Returns a basic health payload.
- `POST /api/auth/signup`: Creates a local user, hashes the password with `scrypt`, initializes default workspace state, creates an `Amanda_session` cookie, and redirects the client toward onboarding.
- `POST /api/auth/login`: Verifies credentials, creates an `Amanda_session`, and redirects to `/workspace`.
- `POST /api/auth/logout`: Removes the current session and clears the cookie.
- `GET /api/auth/me`: Returns the sanitized current user.
- `GET /api/bootstrap`: Returns sanitized user, settings, tasks, integrations, and a transcript preview.
- `GET /api/transcripts`: Returns all transcript entries for the current user.
- `GET /api/settings`: Returns persona, tone, reasoning intensity, and voice selection.
- `POST /api/settings`: Updates persona, tone, reasoning intensity, and voice selection.
- `POST /api/voice/respond`: Accepts a spoken transcript, generates Amanda's response, stores user and assistant transcript entries, updates tasks, invalidates caches, and returns the response to the voice UI.

Static protected routes include `/dashboard`, `/onboarding/*`, `/settings`, `/transcript`, `/voice`, and `/workspace`. Requests to these pages redirect to `/login` when no valid `Amanda_session` exists.

## Current Data Model In `db.json`

The existing local database contains:

- `users`: User records with `id`, `name`, `company`, `email`, `createdAt`, `passwordHash`, and `passwordSalt`.
- `sessions`: Session records with `id`, `userId`, `createdAt`, and `expiresAt`.
- `settingsByUser`: Per-user Amanda settings.
- `tasksByUser`: Per-user operational task rows shown in workspace, dashboard, and voice mode.
- `integrationsByUser`: Per-user simulated connected apps such as Shopify, Salesforce, and Intercom.
- `transcriptsByUser`: Per-user interaction history.

This upgrade adds:

- `businessDataByUser`: Local mock business context for inbox items, leads, orders, calendar events, and CRM records.
- `agentMemoryByUser`: Lightweight agent memory such as open loops, last intent, and follow-up notes.

The second operations upgrade expands `businessDataByUser[userId]` to include:

- `customers`: Local customer profiles with company, email, tags, and value context.
- `messages`: Customer messages with channel, status, priority, sentiment, and reply state.
- `orders`: Demo order records with status, priority, issue, customer, and total.
- `leads`: Sales leads with stage, score, value, and next step.
- `tasks`: Internal operational tasks Amanda can create and organize locally.
- `drafts`: Customer reply drafts that require approval before sending.
- `summaries`: Generated business summaries.
- `integrations`: Demo/local integration status for Shopify, Salesforce, Intercom, Gmail, and Calendar.
- `actionLogs`: Every local tool action Amanda takes or reads.
- `approvalRequests`: Reserved queue for future guarded actions beyond drafts.

## Voice Request Flow

1. `voice.html` loads `src/voice-client.js`.
2. The browser captures speech with `SpeechRecognition`.
3. Final speech text is sent to `POST /api/voice/respond` as `{ transcript }`.
4. The server verifies the session, loads the user workspace, generates Amanda's response, appends transcript entries, updates the task list, and returns `{ ok, reply, tasks, transcript }`.
5. `src/voice-client.js` updates the visible transcript preview, task strip, transcript drawer, and uses `speechSynthesis` to speak Amanda's reply.

## What Will Change

- `/api/voice/respond` will call a dedicated agent brain module instead of using the old inline keyword reply function.
- The agent brain will receive user, message, workspace, settings, transcripts, mock business data, and agent memory.
- The local fallback brain will classify intent, inspect mock business context, produce a concrete operational response, and return task objects.
- If `OPENAI_API_KEY` is available, the brain can optionally call the OpenAI Responses API for richer reasoning, then safely fall back to local logic if the call fails or returns invalid output.
- New local data defaults will make Amanda feel like she is reviewing an actual business workspace, even before real external integrations exist.

## What Will Be Preserved

- Existing auth and session behavior.
- Existing protected route behavior.
- Existing voice UI, immersive mode, transcript drawer, and speech synthesis flow.
- Existing transcript persistence.
- Existing onboarding pages.
- Existing dashboard and workspace bootstrap contract.
- The no-dependency Node setup.

## Assumptions

- This MVP should remain runnable without external services.
- Real integrations will be added later behind the same `businessData` shape.
- The first agent upgrade should improve believability and extensibility without changing the front-end contract.
- An OpenAI key is optional for now; local agent behavior remains the default fallback.

## Operations Tools Added

`src/agent/tools.js` now provides a local operations toolbox:

- `listTasks`
- `createTask`
- `completeTask`
- `listUnansweredMessages`
- `draftCustomerReply`
- `listOrders`
- `getOrderSummary`
- `listLeads`
- `updateLeadStage`
- `searchCustomers`
- `generateDailySummary`
- `searchTranscripts`
- `logAction`
- `listNeedsApproval`

Every tool writes to `businessData.actionLogs`, including read-style tools such as list and summary operations. This makes Amanda's work inspectable even when no external systems are connected.

## Backend Endpoints Added

- `GET /api/business/overview`
- `GET /api/tasks`
- `POST /api/tasks`
- `GET /api/drafts`
- `GET /api/action-logs`
- `GET /api/messages`
- `GET /api/orders`
- `GET /api/leads`

These endpoints are session-protected and use the same `Amanda_session` auth model as the rest of the app.

## Approval Boundaries

Amanda can act locally without approval when she summarizes, searches local data, creates internal tasks, drafts replies, generates summaries, and organizes leads.

Amanda must ask for approval before sending messages, emailing customers, deleting records, refunding orders, cancelling orders, or changing external systems. Drafts are stored with `status: "needs_approval"` and returned through `listNeedsApproval`.

## Commands Tested

The following commands were tested directly through `POST /api/voice/respond`:

- "Amanda, what needs my attention today?"
- "Check customer messages."
- "Draft replies for unanswered messages."
- "Summarize today's orders."
- "Show me pending deliveries."
- "Create a task to follow up with the wholesale lead."
- "What leads should I focus on?"
- "Give me a daily business summary."
- "What actions have you taken today?"
- "What needs approval?"

Each returned HTTP 200 with the existing `reply`, `tasks`, and `transcript` fields, plus extra metadata such as `agent.intent`, `actions`, `drafts`, and `needsApproval`.

## Manual Test Steps

1. Run `npm run check`.
2. Start the app with `npm start`.
3. Sign up or log in.
4. Open `/voice`.
5. Speak or submit the tested commands above.
6. Confirm Amanda's spoken reply still works and the task strip updates.
7. Inspect local operational data through:
   - `/api/business/overview`
   - `/api/messages?unanswered=true`
   - `/api/orders?pendingOnly=true`
   - `/api/leads`

## UI Demo Script

Use this flow to demo Amanda as an active AI operations worker:

1. Sign up or log in.
2. Open `/dashboard` or `/workspace`.
3. Show Today's Operations / Needs Attention: unanswered messages, pending orders, open tasks, active leads, and approvals.
4. Open `/voice`.
5. Say: "Amanda, what needs my attention today?"
6. Say: "Check customer messages."
7. Say: "Draft replies for unanswered messages."
8. Return to `/dashboard`.
9. Show the Needs Approval card with draft replies waiting for review.
10. Show Amanda's Recent Actions / action logs.
11. Return to voice mode and say: "Summarize today's orders."
12. Open `/transcript` and show that the voice exchanges were saved.

## Safe Test Database Mode

The server supports `AMANDA_DB_PATH` for test runs. Set it to a temporary JSON path so signup/API tests do not write to the real `data/db.json`.

Example:

```powershell
$env:AMANDA_DB_PATH="C:\tmp\amanda-ui-test-db.json"
$env:AMANDA_SKIP_LISTEN="true"
node your-test-runner.js
```

Normal app runs still use `data/db.json`. If old manual tests already created throwaway users, they can be removed from `data/db.json` by deleting users with emails like `amanda-test-...@example.com` and their matching `sessions`, `settingsByUser`, `tasksByUser`, `transcriptsByUser`, `businessDataByUser`, and `agentMemoryByUser` entries.

## UI Smoke Test Results

Visual smoke testing was run against a temporary database server session, not the primary `data/db.json` path.

Pages checked:

- `/dashboard`: Protected route redirects to `/login` when signed out. After signup, the page rendered Today's Operations, Amanda's Recent Actions, Needs Approval, Open Tasks, and Business Signals.
- `/workspace`: Rendered Needs Attention, Approval Queue, and Recent Actions alongside the existing workspace overview.
- `/voice`: Rendered the cinematic voice page, Amanda identity, Ready state, transcript controls, and no missing-field console errors during page load.
- `/transcript`: Rendered Interaction Workspace, Voice Events, and Text Threads.
- `/settings`: Rendered Configure Persona, Voice Selection, and Business Logic.

APIs verified during the smoke test:

- `GET /api/business/overview`
- `GET /api/tasks`
- `GET /api/drafts`
- `GET /api/action-logs`
- `GET /api/messages`
- `GET /api/orders`
- `GET /api/leads`
- `POST /api/voice/respond`

Temporary DB result:

- `AMANDA_DB_PATH` successfully isolated API/signup tests when pointed at `data/test-db-ui.json`; the temp file was removed after the test.
- The documented temp filename is `amanda-ui-test-db.json`.
- A later Windows background-process attempt became unresponsive while serving from a temp DB; the completed visual checks above came from the first temporary server session.

Known UI limitations:

- Dashboard/workspace operation panels are read-only command-center surfaces for now.
- Approval items are visible, but there is no approve/send workflow yet.
- Voice metadata badges are displayed only for the current live response object; historical transcript API entries currently store text only.
- Voice smoke testing without microphone permission uses an invisible `window.amandaSubmitTranscriptForSmokeTest(...)` hook in `voice-client.js`; normal users still use the microphone flow.
- Empty states are defensive, but there is not yet a dedicated design pass for fully empty workspaces.

Next recommended phase:

- Build the connector system: define connector interfaces, local mock connector adapters, approval-gated external actions, and later real providers such as Gmail, Calendar, Shopify, CRM, and support inboxes.

## Connector System V1

Connector System v1 is backend-only and additive. It does not perform real OAuth or external writes yet.

Files added:

- `src/connectors/adapters.js`: Mock/local connector adapter definitions.
- `src/connectors/system.js`: Connector registry, sync, action preview, and approval request helpers.

V1 connectors:

- `gmail`: read messages, draft email, request send approval.

## Calendar Follow-Up Routing Fix

Amanda now applies a high-priority calendar follow-up guard before generic fallback logic. When a user has active calendar context, short follow-up messages such as location-only, time-only, date-only, and duration-only updates are routed to `calendar_prepare_event_followup` instead of drifting into generic workspace responses.

Calendar context is considered active when any of these are true:

- `pendingClarification.type === "calendar_event"`
- `lastIntent === "calendar_prepare_event"`
- `lastTaskType === "calendar_event"`
- there is a pending `google_calendar / create_event` approval

### Location-Only Follow-Up Handling

`src/agent/calendar-parser.js` now extracts clean locations from phrases such as:

- `location is at Lagos State`
- `location is Lagos State`
- `the location is at Lagos State`
- `set location to Lagos State`
- `make the location Abuja`
- `use Lagos State as the location`
- `at Lekki office`
- `in Abuja`
- `on Zoom`
- `on Google Meet`

For `location is at Lagos State`, the parser now returns `location: "Lagos State"` and strips the extra `at`.

### Pending Approval Update Behavior

When Amanda already has a pending Google Calendar `create_event` approval, follow-up updates mutate the existing approval payload instead of creating a duplicate request.

The update path now:

- preserves existing title, start, end, location, and time zone unless a new value is provided
- updates the same approval id
- dedupes repeated follow-ups through the calendar fingerprint logic
- treats changed location, changed title, changed time, changed date, and changed time zone as real updates

### Debug Metadata

`POST /api/voice/respond` now exposes safer calendar follow-up debug metadata through the existing debug panel response contract, including:

- `intent`
- `confidence`
- `usedFollowUpContext`
- `followUpType`
- `routedTo`
- `calendarParser.location/dateText/timeText`
- `approval.action`
- `approval.updatedExisting`
- `approval.deduped`

### Automated Tests

Added:

- `scripts/test-calendar-followups.mjs`
- `npm run test:calendar-followups`

The test harness uses `AMANDA_DB_PATH`, boots Amanda in-process on a temporary port, signs up isolated users, exercises `/api/voice/respond`, and validates `/api/approval-requests`.

Covered scenarios:

1. `Schedule a supplier meeting tomorrow at 10am.` then `location is at Lagos State`
2. `Schedule a meeting tomorrow.` then `3pm.` then `location is Lagos State.`
3. `location is at Lagos State` with no active calendar context
4. `Schedule a product review Friday at 2pm for 1 hour at Ikeja office.`

### Test Results

Passed:

- `npm run check`
- `npm run test:calendar-followups`
- server boot test on `http://localhost:3101/api/health`

### Known Limitations

- The debug panel renders the new follow-up type inside the existing calendar parser section rather than adding a brand-new row.
- Follow-up title edits are still minimal; the current fix is focused on location, time, date, and duration continuity.
- Manual browser verification of `/voice` and `/connectors` still depends on an interactive browser session; the automated coverage added here verifies the same API flow and approval state transitions end to end.
- `google_calendar`: read events/windows, request event approval.
- `google_sheets`: read local business rows, request sheet update approval.
- `shopify`: read/summarize orders, request refund/cancel/fulfillment approval.
- `whatsapp_business`: read threads, draft messages, request send approval.
- `paystack`: read/summarize payment-like demo data, request refund approval.
- `flutterwave`: read/summarize payment-like demo data, request refund approval.

Connector APIs:

- `GET /api/connectors`
- `GET /api/connectors/:id`
- `POST /api/connectors/:id/sync`
- `POST /api/connectors/all/sync`
- `POST /api/connectors/:id/actions/preview`
- `POST /api/connectors/:id/approval-requests`

Connector approval model:

- Reads and local sync snapshots are allowed.
- V1 write actions are never executed externally.
- Sending messages/emails, creating or updating calendar events, updating sheets, refunding, cancelling, deleting, or changing external systems creates or previews an approval-gated request.
- Approval requests are stored in `businessData.approvalRequests` and appear through existing `listNeedsApproval` behavior.

Connector voice commands supported:

- "What connectors are available?"
- "Sync connectors."
- "Check integrations."
- "Send email to the customer."
- "Refund the delayed order."

All write-like connector requests should return a plain spoken `reply` plus `needsApproval` metadata, without mutating any external system.

## Real Connector Readiness

Current connector API shape:

- `GET /api/connectors`: Returns public connector records.
- `GET /api/connectors/:id`: Returns one connector record.
- `POST /api/connectors/:id/sync`: Runs a safe local/mock sync snapshot for one connector.
- `POST /api/connectors/all/sync`: Runs safe local/mock sync snapshots for all connectors.
- `POST /api/connectors/:id/actions/preview`: Builds a preview of a risky action without executing it.
- `POST /api/connectors/:id/approval-requests`: Creates a local approval request for a risky action.
- `GET /api/approval-requests`: Returns connector approval requests and draft approvals.
- `POST /api/approval-requests/:id/approve`: Marks a request approved locally. It does not execute externally.
- `POST /api/approval-requests/:id/reject`: Marks a request rejected locally.

Connector state model:

- Connector records live in `connectorsByUser[userId]`.
- The user's `businessData.connectors` points at the same connector state during request handling.
- Public connector fields include `id`, `label`, `kind`, `status`, `mode`, `capabilities`, `writeActions`, `connectedAt`, and `lastSyncAt`.
- `mode: "not_connected"` means real OAuth is not configured.
- `mode: "demo"` means Amanda can use local/mock data only.

Approval request model:

- Connector approval requests live in `businessData.approvalRequests`.
- Draft approvals continue to live in `businessData.drafts` with `status: "needs_approval"`.
- Approval queue responses normalize both shapes for the UI.
- Approving a request sets `status: "approved"` and `executedExternally: false`.
- Rejecting sets `status: "rejected"`.
- No real send, refund, cancel, delete, or external update is executed in v1.

Connector UI behavior:

- `/connectors` is the dedicated connector command-center page.
- `/dashboard` includes a Connector Watch panel.
- `/settings` links to `/connectors`.
- Connector cards show provider, kind, status, mode, capabilities, approval-gated actions, last sync, pending approval count, and safe buttons for Sync, Preview, and Request.
- Preview explains that Amanda prepared the action but approval is required before anything external happens.
- Approval queue cards show provider/action summary, risk note, status, created time, and local approve/reject controls.

What is still mock/local:

- All connector reads and syncs use `data/db.json` business data.
- Gmail, Calendar, Sheets, Shopify, WhatsApp Business, Slack, Paystack, Flutterwave, HubSpot, Notion, and Airtable are adapter stubs.
- OAuth is not implemented.
- No secrets, tokens, refresh tokens, or provider credentials are stored.
- No external APIs are called.

Recommended first real connector:

- Google Calendar should be first because read-only calendar availability is useful, low-risk, and fits Amanda's scheduling workflow.

Before real Google Calendar OAuth:

- Add provider config and token storage with encryption or a secure secret store.
- Add OAuth callback routes.
- Add explicit scopes, preferably starting read-only.
- Keep write scopes behind approval and separate consent.
- Add token refresh and revocation handling.
- Add audit logging for every provider API call.

Future Google Calendar environment variables:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `GOOGLE_CALENDAR_SCOPES`
- `AMANDA_ENCRYPTION_KEY` or a platform-specific secret encryption provider

Connector UI smoke notes:

- `connectors.html` is intentionally command-center styled, not a generic admin table.
- It exposes unavailable OAuth connectors as "Not connected" / "OAuth not configured yet".
- It exposes demo connectors as mock/local and repeats the no-external-execution safety boundary.
   - `/api/drafts`
   - `/api/action-logs`

## Google Calendar OAuth Read-Only

This phase adds the first real connector path while preserving mock/local fallback behavior.

Files added or updated:

- `src/connectors/google-calendar.js`: Google Calendar OAuth, token encryption, token helpers, read-only event list, and sync mapping.
- `server.js`: OAuth connect/callback/disconnect routes, Google Calendar real sync override, public connector decoration, and voice sync context.
- `src/connectors-client.js`: Google Calendar card states for setup missing, connect, demo, real connected, sync, and disconnect.
- `src/agent/brain.js`: Calendar read intents, read-only calendar summaries, free-slot responses, and approval-only calendar write handling.
- `package.json`: `npm run check` now includes the Google Calendar connector module.

Required environment variables:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `AMANDA_TOKEN_SECRET`
- `GOOGLE_CALENDAR_SCOPES` is supported, but this phase forces the read-only scope: `https://www.googleapis.com/auth/calendar.readonly`.

OAuth flow:

1. User opens `/connectors`.
2. Google Calendar card calls `GET /api/connectors/google_calendar/connect`.
3. The server validates session and required env vars.
4. The server creates a short-lived OAuth `state` in `db.oauthStates`.
5. The user is redirected to Google's OAuth consent URL.
6. Google redirects back to `GET /api/connectors/google_calendar/callback`.
7. The callback validates `state`, exchanges the code for tokens, stores tokens server-side only, marks the connector `mode: "real"`, and redirects to `/connectors?connected=google_calendar`.

Token storage notes:

- Token records live under `connectorTokensByUser[userId].google_calendar`.
- Stored fields include encrypted access token, encrypted refresh token, expiry, scope, and timestamps.
- Tokens are encrypted with Node `crypto` AES-256-GCM using a key derived from `AMANDA_TOKEN_SECRET`.
- This is suitable for local MVP development, not a replacement for a managed production secret store.
- Tokens are not returned by connector APIs, shown in the frontend, written to transcripts, or written to action logs.
- If `AMANDA_TOKEN_SECRET` is missing, real OAuth connection is treated as not configured and tokens are not stored.

Sync behavior:

- `POST /api/connectors/google_calendar/sync` uses real Google Calendar only when the connector is `mode: "real"` and a token is present.
- Real sync calls Google Calendar's read-only events list endpoint for the primary calendar.
- Synced events are mapped into `businessData.calendarEvents`.
- Event cache shape includes `providerEventId`, title, description, location, start/end, status, `htmlLink`, source, and `syncedAt`.
- All-day events are normalized safely from `date` fields.
- If the connector is not real-connected, existing mock/local sync behavior remains unchanged.
- `POST /api/connectors/all/sync` also refreshes Google Calendar in real read-only mode when connected.

Voice commands supported:

- "Sync Google Calendar."
- "What is on my calendar today?"
- "What meetings do I have tomorrow?"
- "Summarize my calendar."
- "Summarize my week."
- "Find free slots tomorrow."
- "Schedule a meeting tomorrow."

Read questions use `businessData.calendarEvents` when real events have been synced. If Google Calendar is not connected, Amanda says it is not connected yet and points the user to the Connectors page or demo calendar data. Calendar write requests create approval requests only; they do not create, move, or delete real events.

Disconnect behavior:

- `POST /api/connectors/google_calendar/disconnect` deletes the stored token, marks the connector as `mode: "not_connected"`, removes cached Google Calendar events, and logs a local action.
- Disconnect does not call external revocation yet.

Manual setup steps:

1. Create Google OAuth credentials for a web application.
2. Configure the redirect URI to match `GOOGLE_REDIRECT_URI`, for example `http://localhost:3000/api/connectors/google_calendar/callback`.
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and `AMANDA_TOKEN_SECRET`.
4. Optionally set `GOOGLE_CALENDAR_SCOPES`; Amanda still uses read-only calendar scope in this phase.
5. Start Amanda, log in, open `/connectors`, and click Connect Google Calendar.
6. After consent, return to `/connectors` and click Sync Calendar.

Known limitations:

- Real Google Calendar writes are not implemented.
- Approval of calendar write requests only marks local state; it does not execute against Google Calendar.
- Token revocation on disconnect is not implemented yet.
- Real OAuth was not exercised unless valid Google env vars are configured locally.
- This phase supports OAuth connection and read-only event sync only.

Google Calendar test results:

- `npm run check` passes with `src/connectors/google-calendar.js` included.
- Temp DB missing-config test passed:
  - unauthenticated `GET /api/connectors/google_calendar/connect` returns `401`.
  - authenticated missing-config connect returns `400` with missing env names.
  - `GET /api/connectors` does not return access token, refresh token, or encrypted token fields.
  - `POST /api/connectors/google_calendar/sync` preserves mock/local fallback when not real-connected.
  - voice commands for sync, today, tomorrow, calendar summary, free slots, and scheduling return plain `reply` strings plus metadata.
  - calendar write voice command creates a Google Calendar approval request only.
- Temp DB OAuth URL test with fake env vars passed:
  - connect route redirects to Google's OAuth consent URL.
  - generated URL uses `https://www.googleapis.com/auth/calendar.readonly`.
  - `access_type=offline`, `prompt=consent`, and a secure state are present.
  - state is stored locally against the user.
  - invalid callback state redirects safely to `/connectors?error=google_calendar_invalid_state`.
- Temp DB files from these tests were removed after completion.

## Google Calendar Manual Validation Pass

Google Cloud setup requirements:

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/api/connectors/google_calendar/callback
GOOGLE_CALENDAR_SCOPES=https://www.googleapis.com/auth/calendar.readonly
AMANDA_TOKEN_SECRET=
```

Expected redirect URI format:

- Default local app: `http://localhost:3000/api/connectors/google_calendar/callback`
- Alternate local port: `http://localhost:4000/api/connectors/google_calendar/callback`
- The `GOOGLE_REDIRECT_URI` value must exactly match the authorized redirect URI in the Google Cloud OAuth client.
- If Amanda is started with `PORT=4000`, use the `4000` redirect URI. If started with the default `npm start`, use `3000`.

Google Cloud notes:

- Use an OAuth client of type Web application.
- Enable the Google Calendar API for the Google Cloud project.
- Add the local callback URL to Authorized redirect URIs.
- Request only the read-only Calendar scope for this phase: `https://www.googleapis.com/auth/calendar.readonly`.
- Amanda sends `access_type=offline`, `prompt=consent`, `response_type=code`, and a server-generated `state`.

Real browser OAuth validation result:

- Real Google consent was not completed in this pass because the workspace currently has no `.env` or `.env.local`, and the active local shell does not expose the required Google OAuth env vars.
- Browser validation was run against `http://localhost:3010` with `AMANDA_DB_PATH=data\amanda-gcal-ui-test-db.json` so the real `data/db.json` was not touched.
- Opening `/connectors` without a session redirected to `/login` as expected.
- Signing up in the temp DB succeeded and landed in onboarding.
- Opening `/connectors` after signup rendered the connector command-center page with no console errors.
- Google Calendar rendered as not connected with an `OAuth Not Configured` disabled button.
- The Google Calendar card listed the missing env vars by name: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and `AMANDA_TOKEN_SECRET`.
- The authenticated connect route returned a safe setup response: `Google Calendar OAuth is not configured yet.`
- Automated fake-env validation confirmed Amanda generates a Google OAuth consent URL with the read-only scope and stores OAuth state.
- Manual browser validation should be rerun after starting Amanda with the required env vars.

Manual browser validation checklist:

1. Start Amanda with the env vars above.
2. Log in.
3. Open `/connectors`.
4. Confirm Google Calendar shows either Ready to connect or Real connected.
5. Click Connect Google Calendar.
6. Confirm the browser redirects to Google consent.
7. Approve read-only Calendar access.
8. Confirm Google redirects back to `/connectors?connected=google_calendar`.
9. Confirm the Google Calendar card shows Connected in real read-only mode.
10. Click Sync Calendar.
11. Confirm synced events are stored in `businessData.calendarEvents`.
12. Open `/voice` and ask:
    - "What is on my calendar today?"
    - "What meetings do I have tomorrow?"
    - "Summarize my calendar."
    - "Find free slots tomorrow."

Calendar UI states:

- OAuth setup missing: missing env vars are listed by name, with no secrets shown.
- Ready to connect: OAuth is configured and the card shows Connect Google Calendar.
- Demo connected: mock/local calendar data is available and sync remains safe.
- Real connected: card shows Connected, Sync Calendar, Last sync, and Disconnect.
- Syncing: sync button changes to `Syncing...` without changing layout.
- Last synced: shown through the existing Last sync field.
- Sync failed: message says the token may have expired or the API request failed and suggests reconnecting.
- Disconnected: disconnect deletes the stored token, marks the connector not connected, and removes cached Google Calendar events.

Token safety verification:

- `GET /api/connectors` does not return access token, refresh token, or encrypted token fields.
- `GET /api/connectors/google_calendar` returns public OAuth/credential status only.
- Token values are not written to transcripts.
- Token values are not written to action logs.
- Missing `AMANDA_TOKEN_SECRET` blocks real OAuth setup and token storage.
- Invalid OAuth state redirects safely to `/connectors?error=google_calendar_invalid_state`.
- Disconnect removes the stored local token record.

Calendar read behavior:

- No events today: Amanda says no synced events were found and suggests syncing if needed.
- All-day events: date-only Google event fields are normalized to start-of-day ISO values.
- Missing end time: Amanda still summarizes using the start time and does not crash.
- Location: synced event summaries include the event location when present.
- Google Meet links: synced event records store a `meetingLink`; voice summaries mention when a Meet link exists.
- Expired/failed token refresh: sync returns a helpful reconnect-oriented error.
- Disconnected connector: Amanda says Google Calendar is not connected yet and points to demo data or the Connectors page.
- Mock fallback: mock/local sync remains available when the connector is not real-connected.

Approval-only calendar write validation:

- "Schedule a meeting tomorrow."
- "Move my meeting."
- "Cancel my meeting."
- "Create a calendar event."

Expected behavior: Amanda creates a local Google Calendar approval request only and says she will not modify the real calendar until approval-based execution is implemented.

Validation test results:

- `npm run check` passes.
- Server import boot test passes.
- Browser UI validation on `localhost:3010` passed for protected redirect, temp signup, `/connectors`, and Google Calendar missing-config state.
- Temp DB missing-config test passes.
- Temp DB OAuth URL/state test passes.
- Temp DB voice calendar commands pass.
- Temp validation DB files from automated and browser checks were removed.
- Current real `data/db.json` hash after the browser pass remained `113A7EABA4AC579671D4DD1DCAD0451656C3399D21C996E898D94C049BBC73E5`.

Next recommended connector:

- Gmail read-only + draft-only replies.
- After Gmail, Google Sheets read-only.

## Environment Configuration

Amanda now loads local environment variables through `dotenv` from `.env` during local development. The import lives at the top of `server.js`, before `PORT`, `AMANDA_DB_PATH`, Google Calendar config, or token encryption settings are read.

Files and safety model:

- `.env.example` is the committed safe template. It contains variable names and non-secret defaults only.
- `.env` is local-only and must not be committed.
- `.gitignore` protects `.env`, `.env.local`, and `.env.*.local`.
- `AMANDA_DB_PATH` still works for temp DB testing and is not required for normal local development.
- Missing-env API responses list variable names only. They do not return secret values.
- No Google client secrets, OAuth tokens, or encryption secrets should be placed in frontend HTML, frontend JS, transcripts, action logs, or this notes file.

Required for real Google Calendar OAuth:

- `AMANDA_TOKEN_SECRET` is required before Amanda stores real OAuth tokens.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and `GOOGLE_CALENDAR_SCOPES` are required for Google Calendar real OAuth.
- Google Calendar currently uses read-only scope only: `https://www.googleapis.com/auth/calendar.readonly`.
- The redirect URI must exactly match the local Amanda server port and the Google Cloud Authorized redirect URI.
- Example redirect URI: `http://localhost:3000/api/connectors/google_calendar/callback`.

Local setup checklist:

1. Copy `.env.example` to `.env`.
2. Fill `AMANDA_TOKEN_SECRET` with a long random local secret.
3. Create Google OAuth credentials in Google Cloud.
4. Add the exact redirect URI to Google Cloud Authorized redirect URIs.
5. Fill `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
6. Start Amanda.
7. Open `/connectors`.
8. Connect Google Calendar.

Validation expectations:

- With Google env vars empty, `/connectors` should show Google Calendar as OAuth not configured.
- `GET /api/connectors/google_calendar/connect` should return `Google Calendar OAuth is not configured yet.` and list missing variable names only.
- With fake local env values, Amanda should build a Google OAuth URL using the read-only Calendar scope, `access_type=offline`, `prompt=consent`, and a stored state.
- Fake env validation must not attempt a real Google callback.

Environment configuration test results:

- `npm run check` passes after adding `dotenv`.
- Server import boot test passes with `.env` loading enabled.
- Missing-env temp DB test returned only missing variable names: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and `AMANDA_TOKEN_SECRET`.
- Fake-env temp DB test built a Google OAuth URL with the read-only Calendar scope, `access_type=offline`, `prompt=consent`, and a stored state.
- Fake-env test confirmed `GOOGLE_CLIENT_SECRET` and `AMANDA_TOKEN_SECRET` are not included in the OAuth redirect URL.
- Temp DB files from env validation were removed.
- `.env` exists locally and is protected by `.gitignore`; `.env.example` remains trackable.
- Real `data/db.json` hash remained `113A7EABA4AC579671D4DD1DCAD0451656C3399D21C996E898D94C049BBC73E5`.

## Google Calendar Approval Execution

Amanda now supports one real Google Calendar write path:

`prepare event -> approval request -> user approves -> create event in Google Calendar`

Scope requirements:

- Read-only sync still works with `GOOGLE_CALENDAR_SCOPES=https://www.googleapis.com/auth/calendar.readonly`.
- Approved event creation requires `GOOGLE_CALENDAR_SCOPES=https://www.googleapis.com/auth/calendar.events`.
- Existing read-only tokens do not gain write access automatically. To enable approved event creation, update `.env`, restart Amanda, disconnect Google Calendar, reconnect it, and approve the new Google consent scope.
- If the connected token does not include event write scope, approval execution fails safely with: `Google Calendar needs event creation permission. Reconnect Calendar with event access.`

Connector state:

- `disconnected`: Google Calendar is not connected.
- `read_only`: Google Calendar is connected for event sync and calendar questions only.
- `event_write_enabled`: Amanda may create a calendar event only after an approval request is explicitly approved.
- `missing_write_scope`: a token exists but does not allow event creation.

Implementation notes:

- `src/connectors/google-calendar.js` now detects Calendar event write scope and exposes `createEvent`.
- `POST /api/approval-requests/:id/approve` executes only `google_calendar` + `create_event` approvals.
- Event creation uses `POST https://www.googleapis.com/calendar/v3/calendars/primary/events`.
- Event payloads use `Africa/Lagos` unless a future user timezone setting is added.
- Created Google event IDs and links are stored on the approval execution record and cached in `businessData.calendarEvents`.
- Approval failures are marked `approval_failed`; failed approvals are not marked approved.
- Other calendar writes remain blocked: no delete, move, cancel, or existing-event modification.

Voice behavior:

- "Schedule a meeting tomorrow."
- "Create a supplier follow-up for tomorrow morning."
- "Book a calendar event for Friday at 2pm."

Expected reply: `I prepared that calendar event for your approval. I will not add it to Google Calendar until you approve it.`

Manual real test checklist:

1. Set `GOOGLE_CALENDAR_SCOPES=https://www.googleapis.com/auth/calendar.events`.
2. Restart Amanda.
3. Disconnect Google Calendar.
4. Reconnect Google Calendar and approve event access.
5. Ask Amanda: "Schedule a supplier meeting tomorrow at 10am."
6. Open the approval queue.
7. Confirm no event exists in Google Calendar before approval.
8. Approve the request.
9. Confirm the event appears in Google Calendar.
10. Confirm Amanda logs the action and the approval shows `Created in Google Calendar`.

Approval execution tests:

- `npm run check` passes after adding event creation approval execution.
- Server import boot test passes.
- Read-only fake OAuth token test passes: approval fails safely with `approval_failed` and no Google event creation call.
- Event-scope fake OAuth token test passes: OAuth URL requests `calendar.events`, no secrets are exposed, no event is created before approval, and one event is created after approval.
- Voice preparation test passes: Amanda creates a `create_event` approval payload with title, start, end, and `Africa/Lagos` timezone.
- Automated tests used `AMANDA_DB_PATH` and removed temp DB files.
- A separate Amanda server was already listening on `localhost:3000` during final verification. The real `data/db.json` hash changed to `F57910E85A0BEEA116F3971AC7C78BAA34A11B64A019AB819A120CEB12D2A68A`; the automated approval execution tests themselves used temp DB paths.

Manual real approval result:

- `.env` was updated locally to `GOOGLE_CALENDAR_SCOPES=https://www.googleapis.com/auth/calendar.events`.
- Amanda was restarted on `localhost:3000`.
- Google OAuth consent requested the broader `calendar.events` scope.
- Google Calendar reconnected successfully for the local test Amanda user with `event_write_enabled`.
- The first prepared voice approval exposed a timezone formatting issue before approval; it was rejected locally and no Google event was created.
- The timezone payload was fixed so "tomorrow at 10am" becomes `10:00-10:30 Africa/Lagos`.
- A fresh approval was prepared for `Supplier follow-up` on May 29, 2026, 10:00-10:30 Africa/Lagos.
- The event was created in Google Calendar only after approving `approval_2058707b39aca2cd`.
- Amanda marked the approval `approved`, stored a Google event id/link on the approval execution record, and logged the action.
- A follow-up Google Calendar sync succeeded in real mode and returned one synced event.
- `GET /api/connectors/google_calendar` did not expose token or secret fields.

## Local Runtime Data Policy

`data/db.json` is local runtime state and should not be committed.

Current policy:

- `.gitignore` ignores `data/`, so `data/db.json` remains local-only.
- `.gitignore` also ignores `.env`, `.env.local`, `.env.*.local`, `*.log`, and `node_modules/`.
- `.env.example` is the safe committed environment template.
- Tests should continue to use `AMANDA_DB_PATH` with a temporary DB file.

Real DB inspection result:

- `data/db.json` is not tracked by Git.
- The file currently contains runtime users, sessions, transcripts, settings, business data, connector state, action logs, OAuth state, and one Google Calendar connector token record.
- The token record uses encrypted token fields (`accessTokenEncrypted`, `refreshTokenEncrypted`) plus token metadata such as scope and expiry.
- No raw Google client secret, `AMANDA_TOKEN_SECRET`, or OAuth credential value should ever be committed.
- Private transcripts, approvals, synced calendar events, sessions, OAuth state, and connector tokens must remain local-only.

Seed policy:

- Amanda currently creates default demo/runtime data from `server.js`, so a committed `data/db.example.json` is not required yet.
- If a seed file is added later, it should be a sanitized `data/seed.json` or unignored `data/db.example.json` with no users, sessions, OAuth state, transcripts, tokens, private customer data, or real calendar event details.

## Real Mode vs Demo Mode

Amanda now separates product UI data into Real Mode and Demo Mode.

Configuration:

- `AMANDA_DEMO_MODE=false` is the default when the env var is missing.
- `.env.example` documents `AMANDA_DEMO_MODE=false`.
- Keep demo mode off for real connector testing.
- Set `AMANDA_DEMO_MODE=true` only when you want seeded mock/demo operations in the UI.

Real Mode behavior:

- Shows real connected connectors, setup-required connectors, real approval requests, real synced data, and real connector state.
- Hides seeded demo messages, demo drafts, demo orders, demo leads, demo tasks, demo action logs, and demo approval cards from normal product APIs.
- Shows Gmail/Google Sheets as not connected setup states.
- Shows Shopify, WhatsApp Business, Slack, Paystack, Flutterwave, HubSpot, Notion, and Airtable as coming soon unless demo mode is enabled.
- Keeps real Google Calendar connector state, synced events, approval execution records, and action logs visible.

Demo Mode behavior:

- Shows seeded mock business data and demo connector cards.
- Demo connectors can still sync local snapshots and create demo approval requests.
- Demo-seeded records include `isDemo: true` and `source: "demo"` going forward.
- The connectors page shows a `Demo Mode Enabled` badge.

Safe cleanup:

- `POST /api/dev/clear-demo-data` is available only when `NODE_ENV=development`.
- It removes only demo-marked or legacy seeded demo records.
- It does not remove users, sessions, connector tokens, real Google Calendar connector state, real calendar events, or real approval requests.
- Tests should continue to use `AMANDA_DB_PATH` for temp databases.

Validation:

- Real-mode temp DB test passed: connectors showed clean setup states, mock approvals were hidden, and seeded messages/drafts were hidden.
- Demo-mode temp DB test passed: demo data appeared, demo approvals appeared, and mock connector sync still worked.
- Development cleanup endpoint test passed: demo records were removed while preserving the app shell.

## Approval Queue Cleanup

Approval status model:

- `pending`: waiting for user approval.
- `approved`: approved and completed locally or externally, depending on action type.
- `rejected`: rejected by the user.
- `approval_failed`: attempted approval could not execute safely.
- `executed`: reserved for future explicit execution state.
- `cancelled`: reserved for future cancellation state.

UI behavior:

- The main Approval Queue now shows only `pending` approvals.
- Legacy `needs_approval` records are normalized to `pending` in API responses.
- `approved`, `rejected`, `approval_failed`, `executed`, and `cancelled` approvals no longer appear as active work.
- Resolved and failed approvals appear in the secondary Approval History section.
- History items do not render `Approve`, `Approve and Create`, or `Reject` buttons.
- `approval_failed` items show a failed badge and the safe review/error message.

Dismiss behavior:

- `POST /api/approval-requests/:id/dismiss` marks non-pending approvals with `dismissedAt`.
- Pending approvals cannot be dismissed.
- Dismiss does not delete the record.
- Dismiss does not affect Google Calendar events, connector tokens, or external systems.
- Dismissed approvals are hidden from active queue and history by default.

Validation:

- Pending calendar approval appears in the active queue.
- Rejected approval moves to history and can be dismissed.
- Failed approval moves to history and does not expose approval buttons.
- Successful Calendar event approval creates exactly one event after approval and then appears only in history.
- No-pending state displays `No actions waiting for approval.`
- `npm run check` passes.

## Calendar Event Parsing And Deduplication

Calendar event preparation now uses a dedicated parser in `src/agent/calendar-parser.js`.

Parsing improvements:

- Extracts title, date, time, duration, location, and timezone from common scheduling phrases.
- Supports examples such as `tomorrow at 10am`, `Friday at 2pm`, `May 30 at 4pm`, `for 1 hour`, `for 45 minutes`, `at Lekki office`, `in Ikeja`, and `on Google Meet`.
- Defaults duration to 30 minutes.
- Uses `Africa/Lagos` unless a future user timezone setting is added.
- Avoids generic `An event` when meaningful title text exists.
- Asks clarification instead of creating weak approvals when required fields are missing.

Clarification behavior:

- `Schedule a meeting tomorrow.` asks what time to use and creates no approval.
- `Schedule a meeting at 3pm.` asks for title/date and creates no approval.

Deduplication behavior:

- Calendar create approvals now get a deterministic `fingerprint`.
- Duplicate detection uses user id, connector id, action, normalized title, start, end, and location.
- Repeating the same scheduling command returns the existing pending approval instead of creating another card.
- If the user adds useful details, such as a missing location, Amanda updates the existing pending approval instead of creating a duplicate.

Cleanup:

- `POST /api/dev/dedupe-approval-requests` is available only in development.
- It finds duplicate pending Google Calendar `create_event` approvals, keeps the newest/most complete one, and marks duplicates as `cancelled` with `dismissedAt`.
- It does not delete records, affect approved/executed Google Calendar events, or touch tokens.

Validation:

- Parser unit checks passed for supplier meeting, location extraction, Friday product review, one-hour duration, and clarification cases.
- Voice/API dedupe test passed: repeated command created one pending approval and returned the existing request.
- Voice/API update test passed: adding `at Lekki office` updated the existing pending approval.
- Weak scheduling commands created no approval and asked clarification.
- Dev dedupe cleanup test passed.
- Local runtime cleanup was run for the Calendar approval test user; pending duplicate calendar approvals went from 2 to 1.

## Continuous Voice Session

Problem fixed:

- Voice mode previously stopped after one recognized request and Amanda's spoken reply.
- The user had to leave fullscreen or tap the microphone again to continue.

State behavior:

- Voice mode now separates `fullscreen/immersive visual mode` from the `voice session listening loop`.
- Voice states are treated as `idle`, `listening`, `thinking`, `speaking`, `paused`, and `error`.
- Starting the mic sets a continuous session active and begins listening.
- After speech recognition captures a final transcript, Amanda moves to `thinking`, sends the transcript to `/api/voice/respond`, updates the transcript drawer, then speaks only the plain `reply` string.
- While Amanda is speaking, speech recognition is not restarted. This prevents Amanda from hearing herself.
- After `speechSynthesis` finishes, Amanda automatically returns to listening if the voice session is still active and the user has not manually stopped it.

Stop/pause behavior:

- Tapping the mic during an active session stops the voice session, aborts recognition, cancels current speech, and shows `Voice paused`.
- Escape also stops the voice session and exits immersive visuals.
- Leaving fullscreen is not required to restart or continue voice.

Error handling:

- `no-speech` keeps the session alive and retries listening.
- `not-allowed` stops the session and asks the user to allow microphone access.
- `audio-capture` stops the session and reports that no microphone was detected.
- `aborted` is ignored when caused by a manual stop.

Known browser limitations:

- Browser speech recognition behavior varies, especially around automatic `onend` events and microphone permissions.
- Continuous mode is best in Chrome or Edge where `SpeechRecognition`/`webkitSpeechRecognition` is available.
- Speech synthesis voices depend on the OS/browser voice list.

Validation:

- `npm run check` passes after the continuous voice state-machine update.

## Task Adherence, Intent Routing, and Follow-Up Context

Findings:

- Voice capture was mixing interim and final recognition text in one field, so unstable partial transcript text could be submitted after `SpeechRecognition.onend`.
- The backend used a broad keyword scorer in `src/agent/brain.js`; generic words such as `today`, `summary`, or `calendar` could overpower the specific task the user asked for.
- Calendar follow-ups like `3pm` or `at Lekki office` did not have a dedicated context path, so they could route as generic chat or a non-calendar connector action.
- Generic fallback was too eager and could answer as an operations helper even when a tool intent was clearly present.

Changes made:

- Added `src/agent/intent-router.js` with strict routing for operations, messages, drafts, orders, leads, approvals, connectors, and Google Calendar intents.
- `src/agent/brain.js` now routes through the strict router before falling back to legacy keyword scoring.
- `/api/voice/respond` now returns safe development metadata for routing: `intent`, `confidence`, `routedTo`, and `usedFollowUpContext`.
- Calendar preparation now stores lightweight follow-up context in `agentMemoryByUser`: `lastIntent`, `lastTaskType`, and `pendingClarification`.
- If Amanda asks for a missing calendar detail, replies such as `3pm`, `at Lekki office`, `tomorrow morning`, or `for one hour` are merged into the pending calendar task.
- Amanda now asks focused clarification questions instead of creating weak approvals when calendar title/date/time are missing.
- Calendar parser support was expanded for `morning`, `afternoon`, `evening`, word durations such as `one hour`, and location changes such as `change the location to Ikeja`.
- Voice mode now submits final speech recognition results only, ignores tiny filler noise, debounces duplicate transcripts for 3 seconds, and waits about 700ms before restarting listening after Amanda speaks.
- Agent result normalization no longer re-runs the local brain when the local result is already complete, preventing accidental duplicate tool execution during fallback handling.

Supported routed intents:

- Operations: `operations_summary`, `check_messages`, `draft_message_replies`, `order_summary`, `lead_focus`, `action_history`, `needs_approval`.
- Calendar: `calendar_sync`, `calendar_today`, `calendar_tomorrow`, `calendar_summary`, `calendar_find_slots`, `calendar_prepare_event`, `calendar_approve_explanation`.
- Connectors: `connector_list`, `connector_status`, `connector_sync`, `connector_preview_action`.
- General: `general_help`, `unknown`.

Validation:

- `npm run check` passes.
- Server boot test passed on port `3099` using a temporary `AMANDA_DB_PATH`.
- Direct router matrix passed for operations, connector, approval, and calendar commands.
- Clarification test passed: `Schedule a meeting tomorrow.` asks for time and creates no approval.
- Follow-up test passed: after that clarification, `3pm.` routes to `calendar_prepare_event` with `usedFollowUpContext=true`.
- Calendar dedupe/update test passed: repeating the same event reuses the pending approval, and `at Lekki office.` updates the existing pending approval instead of creating another one.

Known limitations:

- The router is deterministic and intentionally conservative. Unusual natural-language scheduling phrasing may still need more parser rules.
- Voice browsers can still behave differently around `SpeechRecognition` timing, especially on mobile.
- Approval execution remains safety-gated; Amanda still prepares calendar changes first and only executes event creation after explicit in-app approval.

## Voice Debug Trace Pass

Debug visibility added:

- `/voice` has a collapsible debug panel in development/debug mode.
- The panel is controlled by `NODE_ENV=development` or `AMANDA_DEBUG_VOICE=true`.
- `.env.example` now documents `AMANDA_DEBUG_VOICE=false`.
- The panel shows request id, raw transcript, cleaned transcript, last sent time, voice state, final-result flag, recognition count, duplicate-send blocking, intent, confidence, routed tool, follow-up usage, pending clarification, calendar parser output, approval action/id, and backend reply.
- `/api/voice/respond` returns a `requestId` for every response.
- In development/debug mode, `/api/voice/respond` returns safe agent metadata only: routing, pending clarification summary, calendar parser output, and approval create/reuse/update details.
- Development/debug mode logs one safe line per voice request using `[VOICE DEBUG]`; no secrets, tokens, credentials, or private OAuth data are logged.

Trace findings from temp DB test:

- `Check my calendar today.` incorrectly routed to `calendar_followup_needs_target` with `routedTo=calendar.askFollowUpTarget`.
- The failure is not speech recognition in the temp test; the exact transcript sent was `Check my calendar today.`
- The likely failing layer is intent routing: the router is treating `today` as a date-style follow-up before honoring the explicit `check my calendar` command.
- `Schedule a supplier meeting tomorrow at 10am at Lekki office.` routed correctly to `calendar_prepare_event`, parsed title/time/location correctly, and created one approval.
- After an existing pending approval, `Schedule a meeting tomorrow.` routed as `calendar_prepare_event_followup` and reused the existing approval instead of asking for missing time. This shows follow-up context is too broad for a new scheduling command.
- `3pm.` correctly used follow-up context and updated the pending calendar approval time.
- `At Lekki office.` correctly used follow-up context, but reused the existing approval because the location was already the same.
- `What needs approval?` routed correctly to `needs_approval`, but the debug `approval` field mirrors the first approval in `needsApproval`; for list-only intents this should be interpreted as queue visibility, not a newly created approval.

Debug test results:

- `npm run check` passes.
- Temp DB protected-session voice debug test passed with `AMANDA_DEBUG_VOICE=true`.
- Server was restarted on `localhost:3000` after the debug panel and metadata changes.

Next precise fix:

- Reorder intent routing so explicit calendar read commands such as `Check my calendar today` win before date-only follow-up detection.
- Narrow follow-up context so full commands beginning with `schedule`, `book`, `create`, or `set` are treated as new scheduling requests unless the user clearly says `make it`, `change it`, `at...`, `3pm`, or similar update language.

## Calendar Router Priority Fix

Problem fixed:

- `Check my calendar today.` was previously routed as `calendar_followup_needs_target` because the router saw `today` as a date-style follow-up before checking explicit calendar-read commands.
- A pending calendar approval could hijack a new command like `Schedule a meeting tomorrow.` and turn it into an update/reuse response.

Routing priority now:

- Explicit Google Calendar read commands are handled before follow-up detection.
- Explicit calendar sync is handled before follow-up detection.
- Explicit new scheduling commands are handled before pending-approval follow-up detection.
- Approval-list commands such as `What needs approval?` are handled before generic operations fallback.
- Calendar follow-up detection runs only after explicit commands fail.

Explicit calendar read examples:

- `Check my calendar today.` -> `calendar_today`, `routedTo=calendar.today`
- `What is on my calendar today?` -> `calendar_today`
- `What meetings do I have today?` -> `calendar_today`
- `What meetings do I have tomorrow?` -> `calendar_tomorrow`, `routedTo=calendar.tomorrow`
- `Summarize my calendar.` -> `calendar_summary`
- `Find free slots tomorrow.` -> `calendar_find_slots`

New scheduling vs follow-up:

- New commands such as `Schedule a meeting tomorrow.`, `Schedule a supplier meeting tomorrow at 10am.`, `Create a calendar event tomorrow at 3pm.`, and `Book a call Friday at 2pm.` route to `calendar_prepare_event` even if a pending calendar approval exists.
- Follow-up routing now requires update-shaped language such as `3pm`, `make it 3pm`, `location is Lagos State`, `set location to Ikeja`, `for one hour`, or `move it to Friday`.
- A pending approval alone is not enough to update an event; the message must look like a calendar update.
- Broad `lastTaskType=calendar_event` is no longer enough to trigger follow-up routing.

Regression tests:

- `Check my calendar today.` routes to `calendar_today`, not `calendar_followup_needs_target`.
- `What meetings do I have tomorrow?` routes to `calendar_tomorrow`.
- `Find free slots tomorrow.` routes to `calendar_find_slots`.
- With an existing pending calendar approval, `Schedule a meeting tomorrow.` routes to `calendar_prepare_event`, asks for missing time, and does not update the existing approval.
- With an existing pending calendar approval, `location is at Lagos State` routes to `calendar_prepare_event_followup`, uses follow-up context, and updates the existing approval.
- With no pending calendar context, `location is at Lagos State` routes to `calendar_followup_needs_target`, asks what the update is for, and creates no approval.

Validation:

- `npm run check` passes.
- `node scripts/test-calendar-followups.mjs` passes with the new regression cases.

Known limitations:

- The router is still deterministic. More natural calendar phrases can be added as explicit patterns as they appear in real voice traces.

## Gmail Draft Approval Path Fix

Problem fixed:

- The active workspace had Gmail connected and synced, with 12 messages and 7 important messages, but no local Gmail drafts or pending Gmail approvals.
- The Gmail draft tool path was working in seeded tests, but one live command form was still routing to generic drafting: `Create a reply for the latest Gmail email.`
- Gmail draft approval payloads from the tool layer included the full draft body instead of the safer `bodyPreview` shape used elsewhere.

Changes made:

- `gmail_draft_replies` now reports `routedTo=gmail.draftRepliesForImportantEmails` in agent/debug metadata.
- Added routing for latest-email command variants:
  - `Draft a reply to the latest Gmail email.`
  - `Create a reply for the latest Gmail email.`
  - `Write a reply for the latest Gmail email.`
- Gmail draft approval payloads created by `src/agent/tools.js` now include `bodyPreview` instead of full `body`.
- Existing Gmail draft behavior remains local and approval-gated: Amanda creates local draft review items and pending `create_gmail_draft` approvals only. No email is sent.

Live active workspace verification:

- Before command via `/api/session/debug`:
  - `gmailConnected=true`
  - `gmailMessagesCount=12`
  - `importantGmailMessagesCount=7`
  - `gmailDraftsCount=0`
  - `pendingGmailApprovalCount=0`
- Command run through protected `/api/voice/respond`:
  - `Draft a reply to the latest Gmail email.`
- Voice response metadata:
  - `intent=gmail_draft_latest_email`
  - `routedTo=gmail.draftLatestEmail`
  - `draftsCreated=1`
  - `approvalRequestsCreated=1`
- After command via `/api/session/debug`:
  - `gmailDraftsCount=1`
  - `pendingGmailApprovalCount=1`
- `/api/approval-requests` now shows a pending Gmail `create_gmail_draft` approval with a linked `draftId`, `riskLevel=low`, and `bodyPreview`.

Regression tests:

- `Draft replies for important emails.`
- `Draft replies for important Gmail emails.`
- `Create replies for important Gmail emails.`
- `Write replies for important Gmail emails.`
- `Draft a reply to the latest Gmail email.`
- `Create a reply for the latest Gmail email.`

Validation:

- `npm run check` passes.
- `node scripts/test-gmail-readonly.mjs` passes.
- `node scripts/test-calendar-followups.mjs` passes.

## Gmail Read-Only Connector

Scope and OAuth:

- Added Gmail read-only OAuth support using `https://www.googleapis.com/auth/gmail.readonly`.
- Gmail now has its own connector token record and connector status; it does not reuse Google Calendar token state.
- Added/verified routes:
  - `GET /api/connectors/gmail/connect`
  - `GET /api/connectors/gmail/callback`
  - `GET /api/connectors/gmail/setup`
  - `POST /api/connectors/gmail/disconnect`
  - `POST /api/connectors/gmail/sync`

Sync behavior:

- Amanda syncs a small recent Gmail window only.
- Default sync target is recent inbox mail from the last 7 days.
- Gmail sync stores only lightweight local records:
  - sender/recipient
  - subject
  - snippet/body preview
  - labels
  - category
  - priority
  - reply-needed flag
- Full email bodies are not stored in this phase.

Email classification:

- Local deterministic categories:
  - `lead`
  - `quote_request`
  - `pricing_inquiry`
  - `customer_complaint`
  - `support_request`
  - `booking_request`
  - `partnership`
  - `follow_up`
  - `newsletter`
  - `low_priority`
  - `unknown`
- Local priority bands:
  - `high`
  - `medium`
  - `low`

Local draft replies:

- Amanda now creates local Gmail drafts only.
- Drafts are stored in `businessData.gmailDrafts`.
- Drafts appear in Amanda's review/approval queue.
- Approving a Gmail draft changes local state to `approved_local`.
- Approval message clearly states that no email was sent.

Gmail draft review queue:

- Local Gmail drafts now create or update linked approval queue items.
- Queue records use:
  - `connectorId: "gmail"`
  - `action: "review_local_draft"`
  - `status: "pending" | "approved_local" | "rejected" | "dismissed"`
- Active queue cards show:
  - review title
  - recipient
  - subject
  - body preview
  - pending-review status
  - `Approve Local`
  - `Reject`
- Resolved Gmail draft reviews move into approval history and can be dismissed from history without sending anything.

Local-only approval behavior:

- Approve:
  - approval request is marked `approved_local`
  - linked Gmail draft is marked `approved_local`
  - Amanda returns: `Gmail draft approved locally. No email was sent.`
- Reject:
  - approval request is marked `rejected`
  - linked Gmail draft is marked `rejected`
  - Amanda returns: `Gmail draft rejected. No email was sent.`
- Dismiss from history:
  - history item is hidden from the active approval history view
  - linked Gmail draft is marked `dismissed`

Approval queue integration:

- `/api/approval-requests` is the canonical review queue for Gmail draft reviews.
- `/api/drafts` still returns local drafts for dashboard/workspace summary cards.
- Added protected Gmail inspection endpoints:
  - `GET /api/gmail/drafts`
  - `GET /api/gmail/messages`
- Product rule enforced:
  - if Amanda says she prepared Gmail replies, the user can now see them in the Approval Queue.

Voice and attention routing:

- Added Gmail-specific voice routing for:
  - connect Gmail
  - sync Gmail
  - summarize unread emails
  - find important/quote-request emails
  - draft local replies
  - block send-email attempts
- `Amanda, what needs my attention today?` now includes Gmail signals such as:
  - important unread emails
  - quote requests
  - complaints
  - local email drafts waiting for review

UI behavior:

- `/connectors` Gmail card now shows:
  - OAuth setup state
  - ready-to-connect state
  - real connected state
  - last synced time
  - unread count
  - important count
  - draft count
- Dashboard and workspace now surface Gmail counts without redesigning the pages.

Real Gmail draft creation after approval:

- Amanda still drafts replies locally first.
- Approving a Gmail draft review item now attempts to create a real draft in the user's Gmail Drafts folder.
- This requires Gmail compose scope in addition to Gmail read-only scope.
- Required scope set:
  - `https://www.googleapis.com/auth/gmail.readonly`
  - `https://www.googleapis.com/auth/gmail.compose`
- Gmail approval flow is now:
  1. Amanda creates a local draft
  2. User reviews it in Approval Queue
  3. User clicks `Create Gmail Draft`
  4. Amanda creates a real Gmail draft
  5. No email is sent

Gmail OAuth setup for draft creation:

- `.env.example` now documents the compose-enabled scope set:
  - `GMAIL_SCOPES=https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose`
- After changing Gmail scopes:
  1. restart Amanda
  2. disconnect Gmail
  3. reconnect Gmail
  4. approve the updated Google permission prompt

Gmail connector state:

- The Gmail connector now exposes a read capability state and a draft capability state.
- UI labels now distinguish:
  - `Read-only connected`
  - `Draft creation enabled`
  - `Not connected`
- If the stored token does not include compose permission, Amanda keeps Gmail connected in read-only mode and explains that draft creation in Gmail requires reconnecting with compose scope.

Approval/review behavior:

- Gmail approval queue items still use the existing Approval Queue.
- Approval card button text is now `Create Gmail Draft`.
- On success:
  - local draft is marked `created_in_gmail`
  - approval request is marked resolved
  - approval history shows `Created in Gmail Drafts`
  - approval response says `Gmail draft created. No email was sent.`
- On missing compose scope:
  - the approval stays pending
  - no Gmail draft is created
  - Amanda returns `Gmail draft creation requires compose permission. Reconnect Gmail with draft creation access.`

Safety boundaries:

- Gmail sending is not implemented.
- Real Gmail draft creation only happens after explicit in-app approval.
- Amanda does not:
  - send email
  - delete email
  - archive email
  - mark read/unread
  - modify labels
  - change mailbox state

Manual real test steps:

1. Enable the Gmail API in Google Cloud.
2. Keep the OAuth app in Testing mode.
3. Add your Google account as a test user.
4. Restart Amanda with valid Google env vars plus `GMAIL_SCOPES=https://www.googleapis.com/auth/gmail.readonly`.
5. Open `/connectors`.
6. Connect Gmail.
7. Sync Gmail.
8. Ask Amanda to summarize unread emails.
9. Ask Amanda to draft replies for important emails.
10. Open Approval Queue and click `Create Gmail Draft`.
11. Open Gmail Drafts and confirm the draft appears there.
12. Confirm that no email is sent and no mailbox state changes.

Validation:

- `npm run check`
- `npm run test:gmail-readonly`
- Gmail sender and keyword search coverage now includes:
  - `Find emails from ...`
  - `Summarize emails from ...`
  - `Find emails about ...`
  - `Draft a reply to the latest email from ...`
- Server boot verified through the Gmail test harness on a temporary `AMANDA_DB_PATH`
- Gmail draft review verification now also checks:
  - draft persistence
  - linked approval queue record creation
  - read-only approval failure path
  - local reject path
  - no send side effects
  - compose OAuth URL scope generation
  - direct Gmail draft adapter success path
- Live queue trace verified on `localhost:3010` with a seeded Gmail debug user:
  - important messages found: `1`
  - local Gmail drafts created: `1`
  - pending approval requests created: `1`
  - approval action: `create_gmail_draft`
  - approval status: `pending`
  - `/api/gmail/drafts` returned the draft
  - `/api/approval-requests` returned the linked Gmail approval

Follow-up fix:

- Expanded Gmail draft-reply routing so natural variants like `create a reply for important email` and `write replies for important emails` route to `gmail_draft_replies` instead of the generic draft path.
- Added `/api/session/debug` so the active workspace can be inspected safely without exposing OAuth secrets or full private message bodies.
- Added Gmail read-only sender and keyword search with local-sync fallback when live Gmail API search is unavailable.
- Tightened Gmail draft-reply honesty so Amanda only says drafts are waiting in the Approval Queue when local drafts and linked approval requests were actually created.

Known limitations:

- Gmail matching is intentionally heuristic for this phase and can be improved with richer thread analysis later.
- Gmail sync is intentionally narrow and does not yet support paging through larger inboxes.
- Gmail sending is still not implemented.
- Amanda creates real Gmail drafts only after approval; she still cannot send them.

## UI Consistency Audit

Pages checked:

- `index.html`
- `login.html`
- `signup.html`
- `dashboard.html`
- `workspace.html`
- `voice.html`
- `transcript.html`
- `settings.html`
- `connectors.html`

Major inconsistencies found:

- Buttons were hand-styled per page, with different heights, border radii, hover behavior, and label casing.
- Connector, approval, task, transcript, and voice metadata badges used unrelated colors and padding.
- Cards shared the glass direction but varied in padding, radius, border strength, and empty/error treatment.
- Protected pages had similar but not identical headers and navigation labels.
- Loading and empty states used different copy and visual treatments.
- Risky/local approval actions were not always visually separated from safe actions.

Components standardized:

- Shared button classes: `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-danger`, `.btn-disabled`.
- Shared card classes: `.card`, `.card-glass`, `.card-header`, `.card-title`, `.card-subtitle`.
- Shared page/section classes: `.page-shell`, `.page-header`, `.page-title`, `.page-description`, `.section`, `.section-header`, `.section-title`, `.section-description`.
- Shared badge classes: `.badge`, `.badge-success`, `.badge-warning`, `.badge-danger`, `.badge-neutral`, `.badge-info`.
- Shared layout helpers: `.grid`, `.grid-2`, `.grid-3`, `.stack`, `.inline-actions`.
- Shared state panels: `.state-panel`, `.state-error`.

Changes made:

- Added `src/styles.css` and linked it from the main public/protected pages.
- Updated `/connectors` to use the shared page shell, cards, buttons, badges, loading states, approval queue styling, and preview state.
- Updated `src/connectors-client.js` so connector cards use shared card/button/badge classes and stable action rows.
- Updated settings save/update-source controls and tone chips to use shared classes.
- Updated login/signup primary and unavailable provider buttons to use shared button classes.
- Updated workspace hero actions and workspace operation shell badges/states.
- Updated dashboard dynamic pills and empty/error states to use shared badges and state panels.
- Updated transcript feed badges/cards to use shared badge/card classes.
- Updated voice transcript metadata chips to use shared badge classes while preserving the cinematic voice mode.

Still needs manual design review:

- Top navigation content is still partly inherited from the earlier cinematic page templates and should get one dedicated nav component later.
- Some legacy static cards still use Tailwind utility classes directly; they now inherit the shared glass/button rules but are not fully componentized.
- Onboarding pages were not part of this requested pass and still use their existing local styling.

Testing notes:

- Use `AMANDA_DB_PATH` for visual/API checks.
- Confirm `npm run check`.
- Confirm protected route redirects, dashboard/workspace/connectors/settings/transcript/voice load, and no console errors.
- Confirm `data/db.json` hash is unchanged after temp-DB tests.

## Gmail Draft Voice Phrase Fix

Problem fixed:

- Browser speech recognition can hear `draft` as `draught`, which caused Gmail draft commands like `draught latest email` to miss the Gmail drafting route.
- Short commands like `draft latest email`, `draft last email`, `prepare latest email`, `reply latest email`, `create Gmail draft`, `email draft`, and `Gmail draft` were too easy to route away from `gmail_draft_latest_email`.
- Important-email draft commands now also accept shorter forms like `draft important emails`, `draught important emails`, and `prepare important emails`.

Changes made:

- `src/voice-client.js` normalizes `draught` to `draft` before sending the transcript to `/api/voice/respond`, while preserving the raw transcript in the debug panel.
- `src/agent/intent-router.js` normalizes `draught` to `draft` and explicitly routes the new Gmail latest/important draft phrases.
- `src/agent/tools.js` now uses the same draftable-message definition for important Gmail selection: `needsReply`, high/medium priority, or actionable categories like quote requests, pricing inquiries, complaints, support requests, bookings, partnerships, and follow-ups.
- `voice.html` cache-busts the updated voice client so the browser picks up the transcript normalization.

Safety behavior:

- Gmail voice drafting still creates only a local Amanda draft plus a pending `create_gmail_draft` approval request.
- No email is sent.
- No real Gmail Draft is created until the user approves from Amanda.
- Approval payloads expose only safe previews such as `bodyPreview`, not full private draft bodies or OAuth tokens.

Expected debug metadata:

- Raw transcript can show `draught latest email`.
- Clean transcript should show `draft latest email`.
- Agent metadata should show `intent=gmail_draft_latest_email`, `routedTo=gmail.draftLatestEmail`, `latestMessageFound=true`, `draftsCreated=1`, and `approvalRequestsCreated=1` when Gmail is connected and synced.

Testing:

- `scripts/test-voice-intents.mjs` covers the new draught/draft latest-email and important-email phrases.
- `scripts/test-gmail-readonly.mjs` verifies the phrases create or reuse a local Gmail draft, create a linked pending approval request, and expose the approval in the Approval Queue without sending mail.
