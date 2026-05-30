import {
  decryptToken,
  getConnectorToken,
  publicConnectorTokenStatus,
  saveConnectorToken,
} from "./google-calendar.js";

const authEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
const tokenEndpoint = "https://oauth2.googleapis.com/token";
const sheetsReadScope = "https://www.googleapis.com/auth/spreadsheets.readonly";

const DEFAULT_RANGES = [
  "Orders!A1:H50",
  "Products!A1:H50",
  "Inventory!A1:F50",
  "Customer Issues!A1:G50",
  "Analytics!A1:F20",
];

function requiredEnv() {
  const missing = [];
  if (!process.env.GOOGLE_CLIENT_ID) missing.push("GOOGLE_CLIENT_ID");
  if (!process.env.GOOGLE_CLIENT_SECRET) missing.push("GOOGLE_CLIENT_SECRET");
  if (!process.env.AMANDA_TOKEN_SECRET) missing.push("AMANDA_TOKEN_SECRET");
  if (!process.env.GOOGLE_SHEETS_SCOPES && !process.env.GOOGLE_SHEETS_REDIRECT_URI) {
    // At minimum we need these to be configured for Sheets OAuth
  }
  return missing;
}

function sheetsRedirectUri() {
  if (process.env.GOOGLE_SHEETS_REDIRECT_URI) return process.env.GOOGLE_SHEETS_REDIRECT_URI;
  const base = process.env.GOOGLE_REDIRECT_URI || process.env.GOOGLE_CALENDAR_REDIRECT_URI || "";
  if (!base) return "";
  try {
    const url = new URL(base);
    url.pathname = "/api/connectors/google_sheets/callback";
    return url.toString();
  } catch {
    return base.replace(/google_calendar\/callback$/i, "google_sheets/callback");
  }
}

export function googleSheetsSetupStatus() {
  const missing = requiredEnv();
  const redirectUri = sheetsRedirectUri();
  const isConfigured = missing.length === 0 && Boolean(redirectUri) && Boolean(process.env.GOOGLE_CLIENT_ID);
  return {
    isConfigured,
    message: isConfigured
      ? "Google Sheets OAuth is configured."
      : "Google Sheets OAuth is not configured yet.",
    missingEnv: missing,
    scope: sheetsReadScope,
  };
}

export function hasSheetsReadScope(scope = "") {
  const scopes = String(scope || "").split(/\s+/).filter(Boolean);
  return (
    scopes.includes(sheetsReadScope) ||
    scopes.includes("https://www.googleapis.com/auth/spreadsheets") ||
    scopes.includes("https://www.googleapis.com/auth/drive") ||
    scopes.includes("https://www.googleapis.com/auth/drive.readonly")
  );
}

export function googleSheetsAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    redirect_uri: sheetsRedirectUri(),
    response_type: "code",
    scope: sheetsReadScope,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${authEndpoint}?${params}`;
}

export async function exchangeSheetsCodeForTokens(code) {
  const res = await fetch(tokenEndpoint, {
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      code,
      grant_type: "authorization_code",
      redirect_uri: sheetsRedirectUri(),
    }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  if (!res.ok) throw new Error(`Sheets token exchange failed: ${res.status}`);
  return res.json();
}

export function saveSheetsToken(db, userId, tokenPayload) {
  saveConnectorToken(db, userId, "google_sheets", tokenPayload);
}

export function getSheetsToken(db, userId) {
  return getConnectorToken(db, userId, "google_sheets");
}

export function sheetsTokenStatus(db, userId) {
  return publicConnectorTokenStatus(db, userId, "google_sheets");
}

export function markSheetsConnected(db, userId, tokenPayload) {
  if (!Array.isArray(db.connectorsByUser[userId])) db.connectorsByUser[userId] = [];
  let connector = db.connectorsByUser[userId].find((c) => c.id === "google_sheets");
  if (!connector) {
    connector = { id: "google_sheets", label: "Google Sheets", kind: "spreadsheet", capabilities: ["read_rows", "summarize_sheet"], writeActions: [] };
    db.connectorsByUser[userId].push(connector);
  }
  connector.mode = "real";
  connector.status = "Connected";
  connector.connectedAt = new Date().toISOString();
  connector.scope = tokenPayload.scope || sheetsReadScope;
}

export function markSheetsDisconnected(db, userId) {
  if (!Array.isArray(db.connectorsByUser[userId])) return;
  const connector = db.connectorsByUser[userId].find((c) => c.id === "google_sheets");
  if (connector) {
    connector.mode = "not_connected";
    connector.status = "Not connected";
    connector.connectedAt = null;
    connector.scope = "";
    connector.lastSyncAt = null;
  }
  if (db.connectorTokensByUser?.[userId]) {
    delete db.connectorTokensByUser[userId].google_sheets;
  }
}

// ── Sheet Reading ──────────────────────────────────────────

export async function readSheetValues({ accessToken, spreadsheetId, range }) {
  if (!accessToken || !spreadsheetId || !range) {
    throw new Error("readSheetValues requires accessToken, spreadsheetId, and range.");
  }
  const encodedRange = encodeURIComponent(range);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodedRange}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = body?.error?.message || `HTTP ${res.status}`;
    throw new Error(`Sheets API error for range "${range}": ${msg}`);
  }
  const data = await res.json();
  return data.values || [];
}

export async function readMultipleRanges({ accessToken, spreadsheetId, ranges }) {
  if (!accessToken || !spreadsheetId || !ranges?.length) {
    throw new Error("readMultipleRanges requires accessToken, spreadsheetId, and ranges.");
  }
  const params = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join("&");
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchGet?${params}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Sheets batch read error: ${body?.error?.message || `HTTP ${res.status}`}`);
  }
  const data = await res.json();
  const result = {};
  for (const valueRange of data.valueRanges || []) {
    const range = valueRange.range || "";
    result[range] = valueRange.values || [];
  }
  return result;
}

export function parseSheetRows(values = []) {
  if (!values.length) return [];
  const [headers, ...rows] = values;
  if (!headers?.length) return [];
  return rows
    .filter((row) => row.some((cell) => String(cell || "").trim()))
    .map((row) => {
      const obj = {};
      headers.forEach((header, index) => {
        const key = String(header || `col_${index}`).trim().toLowerCase().replace(/\s+/g, "_");
        obj[key] = String(row[index] ?? "").trim();
      });
      return obj;
    });
}

// ── Sheet Analysis ─────────────────────────────────────────

function parseNumber(value) {
  const n = Number(String(value || "").replace(/[₦,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function findColumn(row, candidates) {
  for (const key of Object.keys(row)) {
    if (candidates.some((c) => key.includes(c))) return key;
  }
  return null;
}

export function summarizeStoreSheet(parsedRanges = {}) {
  const summary = {
    topProduct: null,
    topProductRevenue: 0,
    lowStockItems: [],
    customerIssues: [],
    totalRevenue: 0,
    totalOrders: 0,
    recommendations: [],
    warnings: [],
  };

  // Products / Inventory analysis
  for (const [, rows] of Object.entries(parsedRanges)) {
    if (!rows.length) continue;
    const sample = rows[0];

    // Detect product-like sheets by column names
    const nameKey = findColumn(sample, ["product", "name", "item"]);
    const revenueKey = findColumn(sample, ["revenue", "sales", "total"]);
    const stockKey = findColumn(sample, ["stock", "inventory", "quantity", "qty", "units_left", "remaining"]);
    const soldKey = findColumn(sample, ["sold", "units_sold", "orders"]);

    if (nameKey) {
      for (const row of rows) {
        const name = String(row[nameKey] || "").trim();
        if (!name) continue;

        const revenue = revenueKey ? parseNumber(row[revenueKey]) : 0;
        const stock = stockKey ? parseNumber(row[stockKey]) : null;
        const sold = soldKey ? parseNumber(row[soldKey]) : 0;

        // Track revenue
        summary.totalRevenue += revenue;

        // Top product by revenue
        if (revenue > summary.topProductRevenue) {
          summary.topProductRevenue = revenue;
          summary.topProduct = name;
        }

        // Low stock detection (below threshold of 5)
        if (stock !== null && stock <= 5 && stock >= 0) {
          summary.lowStockItems.push({ name, stock, revenue });
        }
      }
    }

    // Detect customer issue sheets
    const issueKey = findColumn(sample, ["issue", "complaint", "problem", "message", "description"]);
    const priorityKey = findColumn(sample, ["priority", "status", "type"]);
    const customerKey = findColumn(sample, ["customer", "name", "client"]);

    if (issueKey) {
      for (const row of rows) {
        const issue = String(row[issueKey] || "").trim();
        const customer = customerKey ? String(row[customerKey] || "").trim() : "";
        const priority = priorityKey ? String(row[priorityKey] || "").trim().toLowerCase() : "";
        if (issue) {
          summary.customerIssues.push({ issue: issue.slice(0, 120), customer, priority });
        }
      }
    }

    // Count orders
    const orderKey = findColumn(sample, ["order", "order_id", "id"]);
    if (orderKey && !issueKey && !nameKey) {
      summary.totalOrders += rows.length;
    }
  }

  // Build recommendations
  if (summary.lowStockItems.length > 0) {
    const top = summary.lowStockItems.slice(0, 3).map((i) => i.name).join(", ");
    summary.recommendations.push(`Restock ${top} — inventory is critically low.`);
  }
  if (summary.topProduct) {
    summary.recommendations.push(`Promote ${summary.topProduct} — it is your top revenue driver.`);
  }
  if (summary.customerIssues.length > 0) {
    const highPriority = summary.customerIssues.filter((i) => i.priority === "high" || i.priority === "urgent");
    if (highPriority.length > 0) {
      summary.recommendations.push(`Address ${highPriority.length} high-priority customer issue${highPriority.length === 1 ? "" : "s"} in your sheet.`);
    }
  }

  return summary;
}

export async function syncGoogleSheets(db, userId, makeId) {
  const tokenRecord = getSheetsToken(db, userId);
  const sheetState = db.businessDataByUser?.[userId]?.googleSheets || {};

  if (!tokenRecord?.accessTokenEncrypted) {
    return { ok: false, error: "Google Sheets is not connected or missing spreadsheet read scope." };
  }

  if (!hasSheetsReadScope(tokenRecord.scope || "")) {
    return { ok: false, error: "Google Sheets token does not include spreadsheet read scope." };
  }

  const spreadsheetId = sheetState.spreadsheetId;
  if (!spreadsheetId) {
    return { ok: false, error: "No spreadsheet ID configured. Add one from the Connectors page." };
  }

  const accessToken = decryptToken(tokenRecord.accessTokenEncrypted);
  if (!accessToken) {
    return { ok: false, error: "Could not decrypt Sheets access token. Reconnect Google Sheets." };
  }

  const rangesToRead = sheetState.ranges?.length ? sheetState.ranges : DEFAULT_RANGES;
  const parsedRanges = {};
  const warnings = [];
  let totalRows = 0;

  for (const range of rangesToRead) {
    try {
      const values = await readSheetValues({ accessToken, spreadsheetId, range });
      parsedRanges[range] = parseSheetRows(values);
      totalRows += parsedRanges[range].length;
    } catch (error) {
      warnings.push(`Range "${range}" skipped: ${error.message}`);
    }
  }

  const summary = summarizeStoreSheet(parsedRanges);
  summary.warnings = warnings;

  const data = db.businessDataByUser[userId];
  data.googleSheets = {
    ...sheetState,
    connected: true,
    lastSyncedAt: new Date().toISOString(),
    parsedRanges,
    summary,
    totalRows,
  };

  // Update connector record
  const connector = (db.connectorsByUser[userId] || []).find((c) => c.id === "google_sheets");
  if (connector) {
    connector.lastSyncAt = data.googleSheets.lastSyncedAt;
    connector.lastSyncSummary = `${totalRows} rows synced. ${warnings.length ? warnings.length + " range(s) skipped." : ""}`;
  }

  return { ok: true, summary, totalRows, warnings };
}

export const DEFAULT_SHEET_RANGES = DEFAULT_RANGES;
