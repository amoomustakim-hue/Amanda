/* ============================================================
   src/auth-google.js
   Google Sign-In + Google Workspace permissions helper.
   All token values stay server-side only.
   ============================================================ */

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export const SCOPE_AUTH      = "openid email profile";
export const SCOPE_GMAIL     = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose";
export const SCOPE_CALENDAR  = "https://www.googleapis.com/auth/calendar.events";
export const SCOPE_SHEETS    = "https://www.googleapis.com/auth/spreadsheets.readonly";

// ── Config helpers ─────────────────────────────────────────

export function googleAuthRedirectUri() {
  return String(process.env.GOOGLE_AUTH_REDIRECT_URI || "").trim();
}

export function googleWorkspaceRedirectUri() {
  return String(process.env.GOOGLE_WORKSPACE_REDIRECT_URI || "").trim();
}

export function isGoogleAuthConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.AMANDA_TOKEN_SECRET &&
    googleAuthRedirectUri(),
  );
}

export function googleAuthSetupStatus() {
  const missing = [];
  if (!process.env.GOOGLE_CLIENT_ID) missing.push("GOOGLE_CLIENT_ID");
  if (!process.env.GOOGLE_CLIENT_SECRET) missing.push("GOOGLE_CLIENT_SECRET");
  if (!process.env.AMANDA_TOKEN_SECRET) missing.push("AMANDA_TOKEN_SECRET");
  if (!googleAuthRedirectUri()) missing.push("GOOGLE_AUTH_REDIRECT_URI");
  return { configured: missing.length === 0, missingEnv: missing };
}

// ── URL builders ───────────────────────────────────────────

export function googleAuthUrl(state) {
  const params = new URLSearchParams({
    access_type: "offline",
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    prompt: "select_account",
    redirect_uri: googleAuthRedirectUri(),
    response_type: "code",
    scope: SCOPE_AUTH,
    state,
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${params}`;
}

export function googleWorkspaceUrl(state, apps = []) {
  const scopeParts = [SCOPE_AUTH];
  if (apps.includes("gmail"))    scopeParts.push(SCOPE_GMAIL);
  if (apps.includes("calendar")) scopeParts.push(SCOPE_CALENDAR);
  if (apps.includes("sheets"))   scopeParts.push(SCOPE_SHEETS);

  const params = new URLSearchParams({
    access_type: "offline",
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    prompt: "consent",
    redirect_uri: googleWorkspaceRedirectUri(),
    response_type: "code",
    scope: scopeParts.join(" "),
    state,
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${params}`;
}

// ── Token exchange ─────────────────────────────────────────

export async function exchangeGoogleCode(code, redirectUri) {
  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Google token exchange failed ${res.status}: ${body.error_description || body.error || "unknown"}`);
  }
  return res.json();
}

// ── ID token decoding ──────────────────────────────────────
// The token was just obtained from Google via HTTPS with our client secret,
// so decoding without cryptographic verification is safe in this context.

export function decodeIdToken(idToken) {
  if (!idToken) return null;
  const parts = String(idToken).split(".");
  if (parts.length < 2) return null;
  const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
  try {
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

export function extractGoogleProfile(payload = {}) {
  return {
    avatarUrl: String(payload.picture || ""),
    email:     String(payload.email || "").toLowerCase().trim(),
    name:      String(payload.name || payload.given_name || "").trim(),
    sub:       String(payload.sub || "").trim(),
  };
}

// ── Scope / connector derivation ──────────────────────────

export function deriveConnectorStatus(scope = "") {
  const parts = String(scope || "").split(/\s+/).filter(Boolean);
  return {
    calendar: parts.some((s) => s.includes("calendar")),
    gmail:    parts.some((s) => s.includes("gmail") || s.includes("mail.google")),
    sheets:   parts.some((s) => s.includes("spreadsheets") || s.includes("drive")),
  };
}

export function appsFromScope(scope = "") {
  const status = deriveConnectorStatus(scope);
  return Object.entries(status).filter(([, v]) => v).map(([k]) => k);
}
