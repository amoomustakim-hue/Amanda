# Amanda — Deployment Guide

This document covers deploying Amanda for a controlled tester build.

---

## Current deployment mode

**Single-user controlled demo** (or small invited tester group).

Data is stored in `data/db.json`. This works for 1–3 testers but is not suitable for high-scale multi-user SaaS. Before inviting multiple testers with personal Gmail/Calendar:

- Confirm `data/db.json` is not shared across users (it is per-user scoped inside the JSON).
- Confirm the server host has persistent disk storage for `data/db.json`.
- Consider migrating to Firestore or Neon Postgres for larger tester groups.

---

## Local setup

```bash
# 1. Clone the repo
git clone <repo-url>
cd amara

# 2. Install dependencies
npm install

# 3. Copy env template
cp .env.example .env

# 4. Fill in .env (see required variables below)

# 5. Start
npm start
```

---

## Required environment variables

| Variable | Required | Notes |
|---|---|---|
| `PORT` | Yes (Cloud Run auto-injects) | Default: 3000 |
| `NODE_ENV` | Yes | `production` for deployment |
| `AMANDA_TOKEN_SECRET` | Yes | Long random secret for encrypting OAuth tokens |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth 2.0 Web Application client |
| `GOOGLE_CLIENT_SECRET` | Yes | Same |
| `GMAIL_REDIRECT_URI` | Yes | Must match Google Cloud console |
| `GMAIL_SCOPES` | Yes | `gmail.readonly gmail.compose` for draft creation |
| `GOOGLE_CALENDAR_REDIRECT_URI` | Yes | Must match Google Cloud console |
| `GOOGLE_CALENDAR_SCOPES` | Yes | `calendar.events` for approved event creation |
| `GOOGLE_SHEETS_REDIRECT_URI` | Yes | Must match Google Cloud console |
| `GOOGLE_SHEETS_SCOPES` | Yes | `spreadsheets.readonly` |
| `BASE_URL` | Production | Your backend URL e.g. `https://amanda-api.run.app` |
| `FRONTEND_URL` | Production | Your frontend URL (used for CORS) |
| `GEMINI_API_KEY` | Optional | Enables Gemini brain. Falls back to local brain if missing. |
| `ELEVENLABS_API_KEY` | Optional | Enables premium TTS. Falls back to Web Speech. |
| `WEBSITE_CONNECTOR_SECRET` | Optional | For mock store webhook integration |

---

## Google Cloud OAuth setup

1. Go to [console.cloud.google.com](https://console.cloud.google.com).
2. Create a project (or use an existing one).
3. Enable these APIs:
   - Gmail API
   - Google Calendar API
   - Google Sheets API
4. Create an OAuth 2.0 Web Application credential.
5. Add all of these to **Authorized redirect URIs**:
   ```
   https://YOUR_BACKEND_URL/api/connectors/gmail/callback
   https://YOUR_BACKEND_URL/api/connectors/google_calendar/callback
   https://YOUR_BACKEND_URL/api/connectors/google_sheets/callback
   http://localhost:3000/api/connectors/gmail/callback
   http://localhost:3000/api/connectors/google_calendar/callback
   http://localhost:3000/api/connectors/google_sheets/callback
   ```
6. If OAuth app is in Testing mode, add tester Google accounts under **OAuth consent screen → Test users**.
7. Copy `Client ID` and `Client Secret` into `.env`.

---

## Backend deployment (Google Cloud Run)

```bash
# 1. Build the container
docker build -t amanda-backend .

# 2. Tag for Google Artifact Registry
docker tag amanda-backend gcr.io/YOUR_PROJECT/amanda-backend

# 3. Push
docker push gcr.io/YOUR_PROJECT/amanda-backend

# 4. Deploy to Cloud Run
gcloud run deploy amanda-backend \
  --image gcr.io/YOUR_PROJECT/amanda-backend \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars "NODE_ENV=production,BASE_URL=https://YOUR_BACKEND_URL,..." \
  --memory 512Mi
```

Set ALL required env vars using `--set-env-vars` or Cloud Run secrets.

> Cloud Run automatically sets `PORT`. Do not hardcode it.

---

## Frontend deployment

Amanda's frontend is static HTML/CSS/JS served by the same Node.js backend.

For a combined deployment (frontend + backend on same Cloud Run instance), no separate frontend deployment is needed. The server serves all `.html` files and `/src/` assets.

If deploying frontend separately (e.g. Firebase Hosting), add a config before the voice-client script:

```html
<script>
  window.__AMANDA_BASE_URL__ = "https://YOUR_BACKEND_URL";
</script>
```

For the mock website, set the same:
```html
<script>
  window.__AMANDA_BASE_URL__ = "https://YOUR_BACKEND_URL";
</script>
```

---

## Data persistence note

`data/db.json` is a local JSON file. For Cloud Run:

- Mount a persistent volume, OR
- Use `AMANDA_DB_PATH` to point to a mounted disk path, OR
- Migrate to Firestore (recommended for multi-tester scale)

Cloud Run instances may restart and lose in-memory state. With `data/db.json` on a persistent disk, this is safe.

---

## Running tests before deployment

```bash
npm run check
node scripts/test-business-projection.mjs
node scripts/test-google-sheets-readonly.mjs
node scripts/test-website-connector.mjs
node scripts/test-attention-engine.mjs
node scripts/test-voice-intents.mjs
node scripts/test-gmail-readonly.mjs
node scripts/test-calendar-followups.mjs
node scripts/test-gemini-brain.mjs
```

All must pass before deploying.

---

## Adding test users

For OAuth Testing mode, add tester Google email addresses at:

**Google Cloud Console → APIs & Services → OAuth consent screen → Test users**

---

## CORS

When `FRONTEND_URL` is set, the backend restricts `Access-Control-Allow-Origin` to that URL only.

In development (no `FRONTEND_URL`), all origins are allowed for convenience.

---

## Known limitations

- `data/db.json` is file-based — not suitable for horizontally scaled deployments.
- Session tokens are scoped to a single server instance.
- Gmail sending is permanently blocked (by design).
- Calendar event deletion is blocked (by design).
- Google Sheets is read-only (by design).
- Tester OAuth tokens are stored encrypted in `data/db.json` — rotate `AMANDA_TOKEN_SECRET` to invalidate all tokens.

---

## Rollback

To rollback a Cloud Run deployment:

```bash
gcloud run revisions list --service amanda-backend
gcloud run services update-traffic amanda-backend --to-revisions=REVISION_ID=100
```

To clear all tester data:

```bash
# Stop server, delete data/db.json, restart
rm data/db.json
npm start
```
