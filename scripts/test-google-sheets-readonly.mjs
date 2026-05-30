import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseSheetRows,
  summarizeStoreSheet,
  hasSheetsReadScope,
  googleSheetsSetupStatus,
} from "../src/connectors/google-sheets.js";
import { getUnifiedAttentionSummary } from "../src/agent/attention-engine.js";
import { routeIntent } from "../src/agent/intent-router.js";

const port = 3096;
const baseUrl = `http://localhost:${port}`;
const dbPath = join(tmpdir(), `amanda-sheets-test-${Date.now()}.json`);

const emptyDb = {
  agentMemoryByUser: {},
  businessDataByUser: {},
  connectorsByUser: {},
  connectorTokensByUser: {},
  integrationsByUser: {},
  oauthStates: {},
  sessions: [],
  settingsByUser: {},
  tasksByUser: {},
  transcriptsByUser: {},
  users: [],
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function postJson(url, body, cookie = "") {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    method: "POST",
  });
  return response;
}

async function getJson(url, cookie = "") {
  return fetch(url, { headers: cookie ? { cookie } : {} });
}

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not boot within ${timeoutMs}ms.`);
}

function extractCookie(response) {
  return (response.headers.get("set-cookie") || "").split(";")[0];
}

// ── Unit tests (no server needed) ──────────────────────────────────────────

function testParseSheetRows() {
  const values = [
    ["Product Name", "Revenue", "Units Sold", "Stock"],
    ["Premium Sneakers Bundle", "500000", "142", "12"],
    ["HydraSteel Bottle", "25000", "29", "3"],
    ["Noir Oud Perfume", "210000", "55", "4"],
    ["", "", "", ""],
  ];
  const rows = parseSheetRows(values);
  assert(rows.length === 3, `Expected 3 rows (blank row skipped), got ${rows.length}`);
  assert(rows[0].product_name === "Premium Sneakers Bundle", "First row name not parsed.");
  assert(rows[0].revenue === "500000", "Revenue not parsed correctly.");
  assert(rows[1].stock === "3", "Stock not parsed correctly.");
}

function testParseSheetRowsEmpty() {
  assert(parseSheetRows([]).length === 0, "Empty input should return empty array.");
  assert(parseSheetRows([["Header"]]).length === 0, "Header-only should return empty array.");
}

function testSummarizeStoreSheet() {
  const parsedRanges = {
    "Products!A1:H50": [
      { product_name: "Premium Sneakers Bundle", revenue: "500000", stock: "12", units_sold: "142" },
      { product_name: "HydraSteel Bottle", revenue: "25000", stock: "3", units_sold: "29" },
      { product_name: "Noir Oud Perfume", revenue: "210000", stock: "2", units_sold: "55" },
    ],
    "Customer Issues!A1:G50": [
      { customer: "Chinedu Nwosu", issue: "Delayed delivery for Leather Backpack order", priority: "high" },
      { customer: "Funmilayo Adeyemi", issue: "Wrong item received — needs return", priority: "high" },
    ],
  };

  const summary = summarizeStoreSheet(parsedRanges);
  assert(summary.topProduct === "Premium Sneakers Bundle", `Expected top product to be Premium Sneakers Bundle, got "${summary.topProduct}"`);
  assert(summary.topProductRevenue === 500000, `Expected top revenue 500000, got ${summary.topProductRevenue}`);
  assert(summary.lowStockItems.length >= 2, `Expected at least 2 low-stock items (Bottle=3, Perfume=2), got ${summary.lowStockItems.length}`);
  assert(summary.customerIssues.length === 2, `Expected 2 customer issues, got ${summary.customerIssues.length}`);
  assert(summary.totalRevenue === 735000, `Expected total revenue 735000, got ${summary.totalRevenue}`);
  assert(summary.recommendations.length > 0, "Expected at least one recommendation.");
}

function testHasSheetsReadScope() {
  assert(hasSheetsReadScope("https://www.googleapis.com/auth/spreadsheets.readonly"), "Should detect readonly scope.");
  assert(hasSheetsReadScope("https://www.googleapis.com/auth/spreadsheets"), "Should detect full sheets scope.");
  assert(hasSheetsReadScope("https://www.googleapis.com/auth/drive"), "Should detect drive scope.");
  assert(!hasSheetsReadScope(""), "Empty scope should return false.");
  assert(!hasSheetsReadScope("https://www.googleapis.com/auth/gmail.readonly"), "Gmail scope should not satisfy sheets.");
}

function testVoiceRouting() {
  const cases = [
    ["Check Google Sheets",                      "sheets_summary"],
    ["Summarize my store sheet",                 "sheets_summary"],
    ["Summarize my sheet",                       "sheets_summary"],
    ["What product sold the most from my sheet", "sheets_top_product"],
    ["Any low stock items in my sheet",          "sheets_low_stock"],
    ["What issues are in my customer sheet",     "sheets_customer_issues"],
    ["What should I focus on from my sheet",     "sheets_focus_recommendation"],
    ["Sheet recommendations",                    "sheets_focus_recommendation"],
  ];
  for (const [phrase, expected] of cases) {
    const result = routeIntent(phrase);
    assert(result.intent === expected, `"${phrase}" → expected "${expected}", got "${result.intent}"`);
  }
}

async function testAttentionEngineSheetSignals() {
  const summary = await getUnifiedAttentionSummary("user_test", {
    businessData: {
      googleSheets: {
        connected: true,
        lastSyncedAt: new Date().toISOString(),
        spreadsheetId: "test_sheet_id",
        summary: {
          topProduct: "Premium Sneakers Bundle",
          topProductRevenue: 500000,
          lowStockItems: [
            { name: "HydraSteel Bottle", stock: 3, revenue: 25000 },
            { name: "Noir Oud Perfume", stock: 2, revenue: 210000 },
          ],
          customerIssues: [
            { customer: "Chinedu", issue: "Delayed delivery", priority: "high" },
          ],
          recommendations: ["Restock HydraSteel Bottle"],
          totalRevenue: 735000,
        },
      },
    },
    useGemini: false,
  });

  assert(
    summary.items.some((i) => i.type === "low_stock_item" && i.source === "google_sheets"),
    "Expected low_stock_item from google_sheets in attention items.",
  );
  assert(
    summary.items.some((i) => i.type === "top_selling_product" && i.source === "google_sheets"),
    "Expected top_selling_product from google_sheets in attention items.",
  );
  assert(
    summary.items.some((i) => i.type === "customer_issue_from_sheet" && i.source === "google_sheets"),
    "Expected customer_issue_from_sheet from google_sheets in attention items.",
  );

  const serialized = JSON.stringify(summary);
  assert(!serialized.includes("test_sheet_secret"), "No secrets should appear in attention summary.");
}

// ── Integration tests (requires running server) ─────────────────────────────

async function runIntegrationTests() {
  let serverProcess;
  try {
    await writeFile(dbPath, JSON.stringify(emptyDb));
    const { spawn } = await import("node:child_process");
    serverProcess = spawn("node", ["server.js"], {
      cwd: process.cwd(),
      env: { ...process.env, AMANDA_DB_PATH: dbPath, NODE_ENV: "development", PORT: String(port) },
      stdio: "pipe",
    });
    serverProcess.stderr.on("data", () => {});
    serverProcess.stdout.on("data", () => {});
    await waitForServer(`${baseUrl}/api/health`);

    // Sign up
    const signupRes = await postJson(`${baseUrl}/api/auth/signup`, {
      company: "Sheets Test Co",
      email: `sheets-test-${Date.now()}@example.com`,
      name: "Sheets Tester",
      password: "Test1234!",
    });
    const cookie = extractCookie(signupRes);
    assert(cookie.includes("Amanda_session"), "Expected session cookie.");

    // Test 1: Config saves spreadsheet ID
    const configRes = await postJson(`${baseUrl}/api/connectors/google_sheets/config`, {
      spreadsheetId: "abc123test",
      ranges: ["Products!A1:H20", "Orders!A1:H20"],
    }, cookie);
    assert(configRes.ok, `Config POST failed: ${configRes.status}`);
    const configData = await configRes.json();
    assert(configData.ok === true, "Expected ok:true from config.");
    assert(configData.spreadsheetId === "abc123test", "Spreadsheet ID not saved.");

    // Test 2: Sync fails safely with no token
    const syncRes = await postJson(`${baseUrl}/api/connectors/google_sheets/sync`, {}, cookie);
    const syncData = await syncRes.json();
    assert(syncData.ok === false, "Sync without token should fail.");
    assert(syncData.error, "Sync failure should include error message.");

    // Test 3: Status returns configured state
    const statusRes = await getJson(`${baseUrl}/api/connectors/google_sheets/status`, cookie);
    assert(statusRes.ok, `Status GET failed: ${statusRes.status}`);
    const statusData = await statusRes.json();
    assert(statusData.ok === true, "Expected ok:true from status.");
    assert(statusData.spreadsheetId === "abc123test", "Status should show saved spreadsheet ID.");
    assert(statusData.connected === false, "Should not be connected without token.");

    // Test 4: Setup endpoint returns correct structure
    const setupRes = await getJson(`${baseUrl}/api/connectors/google_sheets/setup`, cookie);
    assert(setupRes.ok, `Setup GET failed: ${setupRes.status}`);
    const setupData = await setupRes.json();
    assert(setupData.ok === true, "Expected ok:true from setup.");
    assert(typeof setupData.configured === "boolean", "Setup should return configured boolean.");

    // Test 5: Summary returns empty state gracefully
    const summaryRes = await getJson(`${baseUrl}/api/connectors/google_sheets/summary`, cookie);
    assert(summaryRes.ok, `Summary GET failed: ${summaryRes.status}`);
    const summaryData = await summaryRes.json();
    assert(summaryData.ok === true, "Expected ok:true from summary.");

    // Test 6: No secrets returned
    const serialized = JSON.stringify(summaryData);
    assert(!serialized.toLowerCase().includes("token"), "No token data should appear in summary response.");

  } finally {
    if (serverProcess) serverProcess.kill();
    await rm(dbPath, { force: true });
  }
}

// ── Run all tests ────────────────────────────────────────────────────────────

testParseSheetRows();
testParseSheetRowsEmpty();
testSummarizeStoreSheet();
testHasSheetsReadScope();
testVoiceRouting();
await testAttentionEngineSheetSignals();
await runIntegrationTests();

console.log("Google Sheets read-only tests passed.");
