import {
  decryptToken,
  getConnectorToken,
  publicConnectorTokenStatus,
  saveConnectorToken,
} from "./google-calendar.js";

const authEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
const tokenEndpoint = "https://oauth2.googleapis.com/token";
const gmailDraftsEndpoint = "https://gmail.googleapis.com/gmail/v1/users/me/drafts";
const gmailMessagesEndpoint = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
const defaultScope = "https://www.googleapis.com/auth/gmail.readonly";
const composeScope = "https://www.googleapis.com/auth/gmail.compose";

function nowIso() {
  return new Date().toISOString();
}

function requiredEnv() {
  const missing = [];
  if (!process.env.GOOGLE_CLIENT_ID) missing.push("GOOGLE_CLIENT_ID");
  if (!process.env.GOOGLE_CLIENT_SECRET) missing.push("GOOGLE_CLIENT_SECRET");
  if (!process.env.AMANDA_TOKEN_SECRET) missing.push("AMANDA_TOKEN_SECRET");
  if (!process.env.GMAIL_SCOPES) missing.push("GMAIL_SCOPES");
  if (!process.env.GMAIL_REDIRECT_URI && !process.env.GOOGLE_REDIRECT_URI) {
    missing.push("GMAIL_REDIRECT_URI");
  }
  return missing;
}

function gmailScopes() {
  return String(process.env.GMAIL_SCOPES || defaultScope)
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

function scopeList(scope = "") {
  return String(scope || "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function hasGmailComposeScope(scope = "") {
  const scopes = scopeList(scope);
  return scopes.includes(composeScope) || scopes.includes("https://mail.google.com/");
}

export function hasGmailReadOnlyScope(scope = "") {
  const scopes = scopeList(scope);
  return scopes.includes(defaultScope) || scopes.includes("https://mail.google.com/");
}

export function gmailAccessState(scope = "", hasAccessToken = false) {
  if (!hasAccessToken) return "disconnected";
  if (hasGmailComposeScope(scope)) return "compose_enabled";
  if (hasGmailReadOnlyScope(scope)) return "read_only_connected";
  return "missing_compose_scope";
}

function gmailRedirectUri() {
  if (process.env.GMAIL_REDIRECT_URI) return process.env.GMAIL_REDIRECT_URI;
  const base = process.env.GOOGLE_REDIRECT_URI;
  if (!base) return "";
  try {
    const url = new URL(base);
    url.pathname = "/api/connectors/gmail/callback";
    return url.toString();
  } catch {
    return base.replace(/google_calendar\/callback$/i, "gmail/callback");
  }
}

function parseAddress(value) {
  const text = String(value || "").trim();
  const match = text.match(/<([^>]+)>/);
  return (match?.[1] || text).trim();
}

function extractHeader(headers = [], name) {
  const match = headers.find((header) => String(header.name || "").toLowerCase() === name.toLowerCase());
  return match?.value || "";
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function classifyGmailMessage(message) {
  const haystack = `${message.subject || ""} ${message.snippet || ""} ${message.bodyPreview || ""}`.toLowerCase();
  const labels = new Set(message.labels || []);
  const from = String(message.from || "").toLowerCase();
  const automatedSender = /(no-?reply|newsletter|updates@|mailer-daemon|notifications?@)/.test(from);

  let category = "unknown";
  if (automatedSender || /\bnewsletter|digest|unsubscribe|promotion\b/.test(haystack)) {
    category = "newsletter";
  } else if (/\bquote|quotation|rfq|bulk order|50 units|100 units\b/.test(haystack)) {
    category = "quote_request";
  } else if (/\bprice|pricing|cost|rate card\b/.test(haystack)) {
    category = "pricing_inquiry";
  } else if (/\bcomplaint|refund|angry|damaged|issue|problem|delivery issue\b/.test(haystack)) {
    category = "customer_complaint";
  } else if (/\bsupport|help|unable|error|not working\b/.test(haystack)) {
    category = "support_request";
  } else if (/\bbook|booking|availability|reserve|appointment\b/.test(haystack)) {
    category = "booking_request";
  } else if (/\bpartnership|proposal|collaboration|reseller|affiliate\b/.test(haystack)) {
    category = "partnership";
  } else if (/\bfollow up|following up|just checking in\b/.test(haystack)) {
    category = "follow_up";
  } else if (/\blead|interested|demo|purchase|buy\b/.test(haystack)) {
    category = "lead";
  } else if (/\blow priority|fyi|just sharing\b/.test(haystack)) {
    category = "low_priority";
  }

  let priority = "low";
  if (
    /\burgent|quote|pricing|bulk order|complaint|refund|delivery issue|booking|proposal|partnership|payment|invoice\b/.test(haystack)
  ) {
    priority = "high";
  } else if (labels.has("UNREAD") || category === "follow_up" || category === "support_request" || category === "lead") {
    priority = "medium";
  }

  const needsReply = !automatedSender && (
    labels.has("UNREAD") ||
    ["lead", "quote_request", "pricing_inquiry", "customer_complaint", "support_request", "booking_request", "partnership", "follow_up"].includes(category)
  );

  return { category, needsReply, priority };
}

function mapGmailMessage(userId, detail) {
  const headers = detail.payload?.headers || [];
  const from = parseAddress(extractHeader(headers, "From"));
  const to = parseAddress(extractHeader(headers, "To"));
  const subject = cleanText(extractHeader(headers, "Subject")) || "(No subject)";
  const dateHeader = extractHeader(headers, "Date");
  const receivedAt = detail.internalDate
    ? new Date(Number(detail.internalDate)).toISOString()
    : dateHeader
      ? new Date(dateHeader).toISOString()
      : nowIso();
  const base = {
    bodyPreview: cleanText(detail.snippet || ""),
    connectorId: "gmail",
    from,
    id: `gmail_${detail.id}`,
    labels: detail.labelIds || [],
    providerMessageId: detail.id,
    receivedAt,
    snippet: cleanText(detail.snippet || ""),
    source: "gmail",
    status: (detail.labelIds || []).includes("UNREAD") ? "unread" : "read",
    subject,
    syncedAt: nowIso(),
    threadId: detail.threadId || "",
    to,
    userId,
  };
  return {
    ...base,
    ...classifyGmailMessage(base),
  };
}

export function getGmailConfig() {
  const missingEnv = requiredEnv().filter((key) => !process.env[key]);
  const redirectUri = gmailRedirectUri();
  return {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    isConfigured: missingEnv.length === 0 && Boolean(redirectUri),
    missingEnv,
    redirectUri,
    scopes: gmailScopes(),
  };
}

export function gmailSetupStatus() {
  const config = getGmailConfig();
  return {
    isConfigured: config.isConfigured && Boolean(config.redirectUri),
    message: config.isConfigured && config.redirectUri
      ? "Gmail OAuth is configured."
      : "Gmail OAuth is not configured yet.",
    missingEnv: config.missingEnv,
    scope: config.scopes,
  };
}

export function buildGmailAuthUrl(state) {
  const config = getGmailConfig();
  if (!config.isConfigured || !config.redirectUri) return null;
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

export async function exchangeGmailCodeForTokens(code) {
  const config = getGmailConfig();
  if (!config.isConfigured || !config.redirectUri) {
    const error = new Error("Gmail OAuth is not configured yet.");
    error.missingEnv = gmailSetupStatus().missingEnv;
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
    const error = new Error(payload.error_description || payload.error || "Gmail token exchange failed.");
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function refreshGmailAccessToken(db, userId, tokenRecord) {
  const config = getGmailConfig();
  const refreshToken = decryptToken(tokenRecord.refreshTokenEncrypted);
  if (!refreshToken) {
    throw new Error("Gmail refresh token is missing.");
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
    throw new Error(payload.error_description || payload.error || "Gmail token refresh failed.");
  }
  return saveConnectorToken(db, userId, "gmail", {
    ...payload,
    refresh_token: refreshToken,
    scope: payload.scope || tokenRecord.scope || gmailScopes(),
  });
}

export async function refreshGmailAccessTokenIfNeeded(db, userId) {
  let tokenRecord = getConnectorToken(db, userId, "gmail");
  if (!tokenRecord) throw new Error("Gmail is not connected.");
  const expiresAt = tokenRecord.expiresAt ? new Date(tokenRecord.expiresAt).getTime() : 0;
  if (expiresAt && expiresAt - Date.now() < 60_000) {
    tokenRecord = await refreshGmailAccessToken(db, userId, tokenRecord);
  }
  const accessToken = decryptToken(tokenRecord.accessTokenEncrypted);
  if (!accessToken) throw new Error("Gmail access token is missing.");
  return accessToken;
}

export async function listRecentGmailMessages(db, userId, options = {}) {
  const accessToken = await refreshGmailAccessTokenIfNeeded(db, userId);
  const params = new URLSearchParams({
    includeSpamTrash: "false",
    maxResults: String(options.maxResults || 12),
    q: options.query || "newer_than:7d in:inbox -category:social -category:promotions",
  });
  const response = await fetch(`${gmailMessagesEndpoint}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || "Gmail messages request failed.");
  }
  return payload.messages || [];
}

export async function getGmailMessageDetails(db, userId, messageId, options = {}) {
  const accessToken = options.accessToken || await refreshGmailAccessTokenIfNeeded(db, userId);
  const params = new URLSearchParams({
    format: "metadata",
    metadataHeaders: "Date",
  });
  ["From", "To", "Subject"].forEach((header) => params.append("metadataHeaders", header));
  const response = await fetch(`${gmailMessagesEndpoint}/${encodeURIComponent(messageId)}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || "Gmail message details request failed.");
  }
  return payload;
}

export function publicGmailTokenStatus(db, userId) {
  const token = publicConnectorTokenStatus(db, userId, "gmail");
  const connectionState = gmailAccessState(token.scope, token.hasAccessToken);
  return {
    ...token,
    composeEnabled: connectionState === "compose_enabled",
    connectionState,
    draftCapability: token.hasAccessToken
      ? connectionState === "compose_enabled"
        ? "compose_enabled"
        : "missing_compose_scope"
      : "disconnected",
  };
}

function base64UrlEncode(text) {
  return Buffer.from(String(text || ""), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function buildRawDraftMessage(draftPayload = {}) {
  const lines = [
    `To: ${draftPayload.to || ""}`,
    `Subject: ${draftPayload.subject || "(No subject)"}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    String(draftPayload.body || ""),
  ];
  return lines.join("\r\n");
}

export async function createGmailDraft(db, userId, draftPayload = {}) {
  const tokenRecord = getConnectorToken(db, userId, "gmail");
  if (!tokenRecord) {
    throw new Error("Gmail is not connected.");
  }
  if (!hasGmailComposeScope(tokenRecord.scope)) {
    const error = new Error(
      "Gmail draft creation requires compose permission. Reconnect Gmail with draft creation access.",
    );
    error.code = "missing_compose_scope";
    throw error;
  }

  const accessToken = await refreshGmailAccessTokenIfNeeded(db, userId);
  const rawMessage = buildRawDraftMessage(draftPayload);
  const response = await fetch(gmailDraftsEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      message: {
        raw: base64UrlEncode(rawMessage),
      },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || "Gmail draft creation failed.");
    error.status = response.status;
    throw error;
  }
  return {
    draftId: payload.id || "",
    draftsUrl: "https://mail.google.com/mail/u/0/#drafts",
    messageId: payload.message?.id || "",
    ok: true,
    threadId: payload.message?.threadId || "",
  };
}

export async function searchGmailMessages(db, userId, query, options = {}) {
  const accessToken = await refreshGmailAccessTokenIfNeeded(db, userId);
  const refs = await listRecentGmailMessages(db, userId, {
    maxResults: options.maxResults || 10,
    query: query || "newer_than:30d in:inbox",
  });
  if (!refs.length) return [];
  const details = [];
  for (const ref of refs) {
    details.push(await getGmailMessageDetails(db, userId, ref.id, { accessToken }));
  }
  return details.map((detail) => mapGmailMessage(userId, detail));
}

export async function syncGmailMessages(db, userId, businessData, options = {}) {
  const accessToken = await refreshGmailAccessTokenIfNeeded(db, userId);
  const refs = await listRecentGmailMessages(db, userId, options);
  const details = [];
  for (const ref of refs) {
    details.push(await getGmailMessageDetails(db, userId, ref.id, { accessToken }));
  }
  const mapped = details.map((detail) => mapGmailMessage(userId, detail));
  if (!Array.isArray(businessData.gmailMessages)) businessData.gmailMessages = [];
  const others = businessData.gmailMessages.filter((message) => message.connectorId !== "gmail");
  businessData.gmailMessages = [...others, ...mapped]
    .sort((a, b) => String(b.receivedAt || "").localeCompare(String(a.receivedAt || "")));
  businessData.updatedAt = nowIso();

  const unreadCount = mapped.filter((message) => message.status === "unread").length;
  const needsReplyCount = mapped.filter((message) => message.needsReply).length;
  const highPriorityCount = mapped.filter((message) => message.priority === "high").length;

  return {
    connectorId: "gmail",
    highPriorityCount,
    lastSyncedAt: nowIso(),
    messages: mapped,
    messagesSynced: mapped.length,
    mode: "real",
    needsReplyCount,
    ok: true,
    unreadCount,
  };
}
