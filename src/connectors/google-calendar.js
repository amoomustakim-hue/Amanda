import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const authEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
const tokenEndpoint = "https://oauth2.googleapis.com/token";
const calendarEventsEndpoint =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const defaultScope = "https://www.googleapis.com/auth/calendar.readonly";
const eventWriteScope = "https://www.googleapis.com/auth/calendar.events";

function nowIso() {
  return new Date().toISOString();
}

function requiredEnv() {
  const missing = [];
  if (!process.env.GOOGLE_CLIENT_ID) missing.push("GOOGLE_CLIENT_ID");
  if (!process.env.GOOGLE_CLIENT_SECRET) missing.push("GOOGLE_CLIENT_SECRET");
  if (!process.env.AMANDA_TOKEN_SECRET) missing.push("AMANDA_TOKEN_SECRET");
  if (!process.env.GOOGLE_CALENDAR_SCOPES) missing.push("GOOGLE_CALENDAR_SCOPES");
  if (!process.env.GOOGLE_CALENDAR_REDIRECT_URI && !process.env.GOOGLE_REDIRECT_URI) {
    missing.push("GOOGLE_CALENDAR_REDIRECT_URI");
  }
  return missing;
}

function calendarScopes() {
  const configured = String(process.env.GOOGLE_CALENDAR_SCOPES || defaultScope)
    .split(/\s+/)
    .filter(Boolean);
  return configured.includes(eventWriteScope) ? eventWriteScope : defaultScope;
}

function scopeList(scope = "") {
  return String(scope || "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function hasGoogleCalendarEventWriteScope(scope = "") {
  const scopes = scopeList(scope);
  return scopes.includes(eventWriteScope) || scopes.includes("https://www.googleapis.com/auth/calendar");
}

export function getGoogleCalendarConfig() {
  const missingEnv = requiredEnv().filter((key) => !process.env[key]);
  const redirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI || "";
  return {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    isConfigured: missingEnv.length === 0 && Boolean(redirectUri),
    missingEnv,
    redirectUri,
    scopes: calendarScopes(),
  };
}

export function googleCalendarSetupStatus() {
  const config = getGoogleCalendarConfig();
  return {
    isConfigured: config.isConfigured,
    message: config.isConfigured
      ? "Google Calendar OAuth is configured."
      : "Google Calendar OAuth is not configured yet.",
    missingEnv: config.missingEnv,
    scope: config.scopes,
  };
}

function tokenKey() {
  const secret = process.env.AMANDA_TOKEN_SECRET;
  if (!secret) {
    throw new Error("AMANDA_TOKEN_SECRET is required to store OAuth tokens.");
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptToken(value) {
  if (!value) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptToken(value) {
  if (!value) return null;
  const [ivRaw, tagRaw, encryptedRaw] = String(value).split(".");
  if (!ivRaw || !tagRaw || !encryptedRaw) return null;
  const decipher = createDecipheriv("aes-256-gcm", tokenKey(), Buffer.from(ivRaw, "base64"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

function ensureTokenStore(db) {
  if (!db.connectorTokensByUser) db.connectorTokensByUser = {};
  return db.connectorTokensByUser;
}

export function saveConnectorToken(db, userId, connectorId, tokenPayload) {
  const store = ensureTokenStore(db);
  if (!store[userId]) store[userId] = {};
  const existing = store[userId][connectorId];
  const createdAt = existing?.createdAt || nowIso();
  const expiresAt = tokenPayload.expires_in
    ? new Date(Date.now() + Number(tokenPayload.expires_in) * 1000).toISOString()
    : tokenPayload.expiresAt || existing?.expiresAt || null;

  const record = {
    accessTokenEncrypted: encryptToken(tokenPayload.access_token),
    connectorId,
    createdAt,
    expiresAt,
    id: existing?.id || `tok_${connectorId}_${userId}`,
    refreshTokenEncrypted: tokenPayload.refresh_token
      ? encryptToken(tokenPayload.refresh_token)
      : existing?.refreshTokenEncrypted || null,
    scope: tokenPayload.scope || existing?.scope || defaultScope,
    updatedAt: nowIso(),
    userId,
  };
  store[userId][connectorId] = record;
  return record;
}

export function getConnectorToken(db, userId, connectorId) {
  return db.connectorTokensByUser?.[userId]?.[connectorId] || null;
}

export function deleteConnectorToken(db, userId, connectorId) {
  if (db.connectorTokensByUser?.[userId]) {
    delete db.connectorTokensByUser[userId][connectorId];
  }
}

export function publicConnectorTokenStatus(db, userId, connectorId) {
  const token = getConnectorToken(db, userId, connectorId);
  return {
    expiresAt: token?.expiresAt || null,
    hasAccessToken: Boolean(token?.accessTokenEncrypted),
    hasRefreshToken: Boolean(token?.refreshTokenEncrypted),
    scope: token?.scope || null,
  };
}

export function publicTokenStatus(db, userId, connectorId = "google_calendar") {
  const token = publicConnectorTokenStatus(db, userId, connectorId);
  return {
    ...token,
    writeCapability: token.hasAccessToken
      ? hasGoogleCalendarEventWriteScope(token.scope)
        ? "event_write_enabled"
        : "missing_write_scope"
      : "disconnected",
  };
}

export function createGoogleCalendarAuthUrl(state) {
  const config = getGoogleCalendarConfig();
  if (!config.isConfigured) return null;
  const params = new URLSearchParams({
    access_type: "offline",
    client_id: config.clientId,
    prompt: "consent",
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: config.scopes,
    state,
  });
  return `${authEndpoint}?${params.toString()}`;
}

export async function exchangeGoogleCalendarCode(code) {
  const config = getGoogleCalendarConfig();
  if (!config.isConfigured) {
    const error = new Error("Google Calendar OAuth is not configured yet.");
    error.missingEnv = config.missingEnv;
    throw error;
  }

  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error_description || payload.error || "Token exchange failed.");
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function refreshAccessToken(db, userId, tokenRecord) {
  const config = getGoogleCalendarConfig();
  const refreshToken = decryptToken(tokenRecord.refreshTokenEncrypted);
  if (!refreshToken) {
    throw new Error("Google Calendar refresh token is missing.");
  }

  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || "Token refresh failed.");
  }
  return saveConnectorToken(db, userId, "google_calendar", {
    ...payload,
    refresh_token: refreshToken,
    scope: payload.scope || tokenRecord.scope,
  });
}

async function validAccessToken(db, userId) {
  let tokenRecord = getConnectorToken(db, userId, "google_calendar");
  if (!tokenRecord) throw new Error("Google Calendar is not connected.");
  const expiresAt = tokenRecord.expiresAt ? new Date(tokenRecord.expiresAt).getTime() : 0;
  if (expiresAt && expiresAt - Date.now() < 60_000) {
    tokenRecord = await refreshAccessToken(db, userId, tokenRecord);
  }
  const accessToken = decryptToken(tokenRecord.accessTokenEncrypted);
  if (!accessToken) throw new Error("Google Calendar access token is missing.");
  return accessToken;
}

function eventTime(value) {
  if (!value) return null;
  if (value.dateTime) return new Date(value.dateTime).toISOString();
  if (value.date) return new Date(`${value.date}T00:00:00.000Z`).toISOString();
  return null;
}

function mapGoogleEvent(userId, item) {
  return {
    connectorId: "google_calendar",
    description: item.description || "",
    end: eventTime(item.end),
    htmlLink: item.htmlLink || "",
    id: `gcal_event_${item.id}`,
    location: item.location || "",
    meetingLink: item.hangoutLink || item.conferenceData?.entryPoints?.find((entry) => entry.uri)?.uri || "",
    providerEventId: item.id,
    source: "google_calendar",
    start: eventTime(item.start),
    status: item.status || "confirmed",
    syncedAt: nowIso(),
    title: item.summary || "(No title)",
    userId,
  };
}

export async function listEvents(db, userId, options = {}) {
  const accessToken = await validAccessToken(db, userId);
  const timeMin = options.timeMin || new Date().toISOString();
  const timeMax =
    options.timeMax || new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
  const params = new URLSearchParams({
    maxResults: String(options.maxResults || 20),
    orderBy: "startTime",
    singleEvents: "true",
    timeMax,
    timeMin,
  });

  const response = await fetch(`${calendarEventsEndpoint}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || "Google Calendar events request failed.");
  }
  return (payload.items || []).map((item) => mapGoogleEvent(userId, item));
}

function normalizeEventDateTime(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function googleEventPayload(eventPayload = {}) {
  const timeZone = eventPayload.timeZone || "Africa/Lagos";
  const start = normalizeEventDateTime(eventPayload.start);
  const end =
    normalizeEventDateTime(eventPayload.end) ||
    (start ? new Date(new Date(start).getTime() + 30 * 60 * 1000).toISOString() : null);
  if (!eventPayload.title || !start || !end) {
    throw new Error("Calendar event approval is missing a title, start time, or end time.");
  }
  return {
    description: eventPayload.description || "Prepared by Amanda after user approval.",
    location: eventPayload.location || "",
    start: {
      dateTime: start,
      timeZone,
    },
    end: {
      dateTime: end,
      timeZone,
    },
    summary: eventPayload.title,
  };
}

export async function createEvent(db, userId, businessData, eventPayload = {}) {
  const tokenRecord = getConnectorToken(db, userId, "google_calendar");
  if (!tokenRecord) {
    throw new Error("Google Calendar is not connected.");
  }
  if (!hasGoogleCalendarEventWriteScope(tokenRecord.scope)) {
    const error = new Error(
      "Google Calendar needs event creation permission. Reconnect Calendar with event access.",
    );
    error.code = "missing_write_scope";
    throw error;
  }

  const accessToken = await validAccessToken(db, userId);
  const body = googleEventPayload(eventPayload);
  const response = await fetch(calendarEventsEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || "Google Calendar event creation failed.");
    error.status = response.status;
    throw error;
  }

  const event = mapGoogleEvent(userId, payload);
  if (!Array.isArray(businessData.calendarEvents)) businessData.calendarEvents = [];
  const withoutExisting = businessData.calendarEvents.filter(
    (item) => item.providerEventId !== event.providerEventId,
  );
  businessData.calendarEvents = [...withoutExisting, event];
  businessData.updatedAt = nowIso();
  return {
    connectorId: "google_calendar",
    event,
    eventId: payload.id,
    htmlLink: payload.htmlLink || "",
    mode: "real",
    ok: true,
  };
}

export async function syncEvents(db, userId, businessData, options = {}) {
  const events = await listEvents(db, userId, options);
  if (!Array.isArray(businessData.calendarEvents)) businessData.calendarEvents = [];
  const others = businessData.calendarEvents.filter(
    (event) => event.connectorId !== "google_calendar",
  );
  businessData.calendarEvents = [...others, ...events];
  businessData.updatedAt = nowIso();
  return {
    connectorId: "google_calendar",
    events,
    eventsSynced: events.length,
    lastSyncedAt: nowIso(),
    mode: "real",
    ok: true,
  };
}
