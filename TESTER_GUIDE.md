# Amanda — Tester Guide

Welcome to the Amanda controlled tester build.

Amanda is a voice-first AI operations worker for small businesses. She reads your Gmail, Calendar, and Google Sheets, surfaces what needs your attention, and prepares safe draft actions for your approval.

---

## Getting started

1. Open the Amanda link shared with you.
2. Click **Sign Up** and create your account.
3. Go to **Connectors** (bottom nav or header).
4. Connect **Gmail** → follow Google OAuth → approve read + draft access.
5. Connect **Google Calendar** → approve calendar access.
6. Optionally connect **Google Sheets** → paste your Spreadsheet ID → Save Sheet → Sync Sheet.
7. Open **Voice Mode**.
8. Start with keyboard input first (click the Keyboard button in the voice dock).

---

## Recommended test commands

Try these exact commands via keyboard or voice:

### Attention & Business Health

```
What needs my attention today?
How is my business doing?
Project my business for the next 3 months
What should I focus on to grow?
What is hurting my business right now?
```

### Gmail

```
Sync Gmail
Summarize my unread emails
What emails need my attention?
Create latest email
Draft replies for important emails
What needs approval?
```

### Calendar

```
Check my calendar today
What meetings do I have tomorrow?
Schedule a meeting tomorrow at 10am
What needs approval?
```

### Google Sheets (if connected)

```
Check Google Sheets
What product sold the most from my sheet?
Any low stock items in my sheet?
What should I focus on from my sheet?
```

### Website Events (demo)

```
What happened on my website today?
Show abandoned checkouts
Any failed payments?
Show high value website leads
```

### Safety tests (should be blocked)

```
Send the email
```

Expected: "I cannot send emails yet."

---

## Voice mode tips

- Click the **mic button** to start listening.
- Click the **Keyboard** button (Type) to type commands instead.
- Use quick-command chips in the keyboard panel for common phrases.
- The **Debug** button (bottom-left, only in development mode) shows routing details.

---

## What Amanda can do

| Feature | Status |
|---|---|
| Gmail read + sync | ✅ Available |
| Gmail draft creation (after approval) | ✅ Available |
| Gmail sending | ❌ Blocked by design |
| Calendar read | ✅ Available |
| Calendar event creation (after approval) | ✅ Available |
| Calendar event deletion | ❌ Blocked by design |
| Google Sheets read | ✅ Available |
| Google Sheets write/edit | ❌ Blocked by design |
| Approval Queue | ✅ Available |
| Business Health & Projection | ✅ Available |
| Voice + Keyboard input | ✅ Available |

---

## Approval Queue

When Amanda prepares a draft Gmail reply or a Calendar event, it appears in the **Approval Queue**.

- **Approve** → creates the real Gmail draft or Calendar event.
- **Reject** → discards the action. Nothing external is changed.

Amanda never sends emails or modifies your calendar without your explicit approval.

---

## Bug report format

Please use this format when reporting bugs:

```
Command: (exact text typed or spoken)
Page: (voice / connectors / workspace / dashboard)
Input source: voice / keyboard
Expected: (what should have happened)
Actual: (what actually happened)
Screenshot: (attach if possible)
Console error: (open browser DevTools → Console, paste any red errors)
Time: (approximate time so we can check logs)
```

Send bug reports to: [your contact]

---

## Known limitations

- Google Sheets data is read from your configured spreadsheet. Results depend on column names in your sheet.
- Voice commands depend on browser speech recognition — Chrome/Edge give the best results.
- Gmail drafts are created locally first and only posted to Gmail Drafts after you approve them in the Approval Queue.
- Business projections are directional estimates based on available synced data, not financial guarantees.

---

## Your data

- Amanda stores a copy of your Gmail message summaries (not full bodies), Calendar events, and Sheet data locally to answer your questions quickly.
- OAuth tokens are encrypted on the server. They are never sent to the browser.
- To disconnect any connector and delete its stored token, go to **Connectors** and click **Disconnect**.

---

Thank you for testing Amanda.
