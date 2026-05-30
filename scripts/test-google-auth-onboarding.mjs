import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appsFromScope,
  decodeIdToken,
  deriveConnectorStatus,
  extractGoogleProfile,
  googleAuthUrl,
  googleWorkspaceUrl,
  SCOPE_AUTH,
  SCOPE_CALENDAR,
  SCOPE_GMAIL,
  SCOPE_SHEETS,
} from "../src/auth-google.js";
import { routeIntent } from "../src/agent/intent-router.js";

const port = 3095;
const baseUrl = `http://localhost:${port}`;
const dbPath = join(tmpdir(), `amanda-google-auth-test-${Date.now()}.json`);

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

function extractCookie(response) {
  return (response.headers.get("set-cookie") || "").split(";")[0];
}

async function postJson(url, body, cookie = "") {
  return fetch(url, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    method: "POST",
  });
}

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not boot within ${timeoutMs}ms.`);
}

// ── Unit tests (no server needed) ──────────────────────────────────────────

function testGoogleAuthUrlIncludesIdentityScopes() {
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_AUTH_REDIRECT_URI = "http://localhost:3000/api/auth/google/callback";
  const url = googleAuthUrl("test-state-123");
  assert(url.includes("accounts.google.com"), "Auth URL should point to Google.");
  assert(url.includes("openid"), "Auth URL should include openid scope.");
  assert(url.includes("email"), "Auth URL should include email scope.");
  assert(url.includes("profile"), "Auth URL should include profile scope.");
  assert(url.includes("test-state-123"), "Auth URL should include state.");
  assert(!url.includes("gmail"), "Auth URL should NOT include Gmail scopes at sign-in.");
  assert(!url.includes("calendar"), "Auth URL should NOT include Calendar scopes at sign-in.");
  assert(!url.includes("spreadsheets"), "Auth URL should NOT include Sheets scopes at sign-in.");
}

function testWorkspaceUrlGmailOnly() {
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_WORKSPACE_REDIRECT_URI = "http://localhost:3000/api/auth/google/workspace/callback";
  const url = googleWorkspaceUrl("ws-state", ["gmail"]);
  assert(url.includes("gmail"), "Workspace URL should include Gmail scope when Gmail selected.");
  assert(!url.includes("calendar"), "Workspace URL should NOT include Calendar when not selected.");
  assert(!url.includes("spreadsheets"), "Workspace URL should NOT include Sheets when not selected.");
  assert(url.includes("openid"), "Workspace URL should always include identity scopes.");
}

function testWorkspaceUrlCalendarOnly() {
  const url = googleWorkspaceUrl("ws-state", ["calendar"]);
  assert(url.includes("calendar"), "Workspace URL should include Calendar scope.");
  assert(!url.includes("gmail"), "Should not include Gmail when not selected.");
  assert(!url.includes("spreadsheets"), "Should not include Sheets when not selected.");
}

function testWorkspaceUrlSheetsOnly() {
  const url = googleWorkspaceUrl("ws-state", ["sheets"]);
  assert(url.includes("spreadsheets"), "Workspace URL should include Sheets scope.");
  assert(!url.includes("gmail"), "Should not include Gmail when not selected.");
  assert(!url.includes("calendar"), "Should not include Calendar when not selected.");
}

function testWorkspaceUrlAllApps() {
  const url = googleWorkspaceUrl("ws-state", ["gmail", "calendar", "sheets"]);
  assert(url.includes("gmail"), "Should include Gmail.");
  assert(url.includes("calendar"), "Should include Calendar.");
  assert(url.includes("spreadsheets"), "Should include Sheets.");
}

function testDeriveConnectorStatus() {
  const scope = `${SCOPE_GMAIL} ${SCOPE_CALENDAR}`;
  const status = deriveConnectorStatus(scope);
  assert(status.gmail === true, "Should detect Gmail scope.");
  assert(status.calendar === true, "Should detect Calendar scope.");
  assert(status.sheets === false, "Should not detect Sheets scope when not granted.");
}

function testDeriveConnectorStatusSheets() {
  const status = deriveConnectorStatus(SCOPE_SHEETS);
  assert(status.sheets === true, "Should detect Sheets scope.");
  assert(status.gmail === false, "Should not detect Gmail.");
  assert(status.calendar === false, "Should not detect Calendar.");
}

function testAppsFromScope() {
  const apps = appsFromScope(`${SCOPE_GMAIL} ${SCOPE_SHEETS}`);
  assert(apps.includes("gmail"), "Should include gmail.");
  assert(apps.includes("sheets"), "Should include sheets.");
  assert(!apps.includes("calendar"), "Should not include calendar.");
}

function testDecodeIdToken() {
  // Create a fake JWT with a known payload
  const payload = { sub: "12345", email: "test@example.com", name: "Test User", picture: "https://example.com/pic.jpg" };
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const fakeToken = `${header}.${body}.fakesig`;
  const decoded = decodeIdToken(fakeToken);
  assert(decoded?.sub === "12345", `Expected sub=12345, got ${decoded?.sub}`);
  assert(decoded?.email === "test@example.com", "Should decode email.");
  assert(decoded?.name === "Test User", "Should decode name.");
}

function testExtractGoogleProfile() {
  const profile = extractGoogleProfile({ sub: "abc", email: "USER@Example.COM", name: "Jane Doe", picture: "https://pic.example.com/x" });
  assert(profile.sub === "abc", "Should preserve sub.");
  assert(profile.email === "user@example.com", "Should lowercase email.");
  assert(profile.name === "Jane Doe", "Should preserve name.");
  assert(profile.avatarUrl.includes("example.com"), "Should preserve picture URL.");
}

function testCreateUserFromGoogleProfile() {
  // Verify profile extraction gives all required fields for user creation
  const profile = extractGoogleProfile({ sub: "google_sub_001", email: "tester@gmail.com", name: "Tester", picture: "" });
  assert(profile.sub, "Profile must have sub.");
  assert(profile.email, "Profile must have email.");
  assert(typeof profile.name === "string", "Profile must have name string.");
}

// ── Integration tests (requires running server) ─────────────────────────────

async function runIntegrationTests() {
  let serverProcess;
  try {
    await writeFile(dbPath, JSON.stringify(emptyDb));
    const { spawn } = await import("node:child_process");
    serverProcess = spawn("node", ["server.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AMANDA_DB_PATH: dbPath,
        NODE_ENV: "development",
        PORT: String(port),
      },
      stdio: "pipe",
    });
    serverProcess.stderr.on("data", () => {});
    serverProcess.stdout.on("data", () => {});
    await waitForServer(`${baseUrl}/api/health`);

    // Sign up a normal user first (existing flow must still work)
    const signupRes = await postJson(`${baseUrl}/api/auth/signup`, {
      company: "Google Auth Test Co",
      email: `google-auth-test-${Date.now()}@example.com`,
      name: "Google Auth Tester",
      password: "Test1234!",
    });
    assert(signupRes.ok || signupRes.status === 201, `Signup failed: ${signupRes.status}`);
    const cookie = extractCookie(signupRes);
    assert(cookie.includes("Amanda_session"), "Expected session cookie after signup.");

    // Existing connector flows still work — verify gmail/calendar callback routes exist
    const calbackRes = await fetch(`${baseUrl}/api/connectors/google_calendar/callback?missing=true`);
    assert(calbackRes.status !== 404, "Existing calendar callback should still be routed.");
    const gmailCallbackRes = await fetch(`${baseUrl}/api/connectors/gmail/callback?missing=true`);
    assert(gmailCallbackRes.status !== 404, "Existing Gmail callback should still be routed.");

    // Google Sign-In start — not configured, should redirect to error
    const startRes = await fetch(`${baseUrl}/api/auth/google/start`, { redirect: "manual" });
    assert([302, 303].includes(startRes.status), `Expected redirect from /api/auth/google/start, got ${startRes.status}`);
    const location = startRes.headers.get("location") || "";
    // Not configured (no GOOGLE_CLIENT_ID in test env) → error redirect
    assert(location.includes("error") || location.includes("accounts.google.com"),
      `Expected error or Google redirect, got: ${location}`);

    // Workspace start — requires session, no apps selected → 400
    const wsStartBadRes = await postJson(`${baseUrl}/api/auth/google/workspace/start`, { apps: [] }, cookie);
    assert(wsStartBadRes.status === 400, `Expected 400 for empty apps, got ${wsStartBadRes.status}`);
    const wsStartBadData = await wsStartBadRes.json();
    assert(wsStartBadData.ok === false, "Should return ok:false for empty apps.");

    // Workspace callback missing params → redirect to error
    const wsCallbackRes = await fetch(`${baseUrl}/api/auth/google/workspace/callback`, { redirect: "manual" });
    assert([302, 303].includes(wsCallbackRes.status), "Workspace callback missing params should redirect.");
    const wsLocation = wsCallbackRes.headers.get("location") || "";
    assert(wsLocation.includes("error"), `Expected error in workspace callback redirect, got: ${wsLocation}`);

    // No tokens returned to frontend — verify /api/auth/me doesn't expose them
    const meRes = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie } });
    const meData = await meRes.json();
    const serialized = JSON.stringify(meData);
    assert(!serialized.includes("accessToken"), "No access tokens in /api/auth/me response.");
    assert(!serialized.includes("refreshToken"), "No refresh tokens in /api/auth/me response.");
    assert(!serialized.includes("client_secret"), "No client_secret in /api/auth/me response.");

    // Auth status endpoint
    const statusRes = await fetch(`${baseUrl}/api/auth/google/status`, { headers: { cookie } });
    assert(statusRes.ok, `Google status GET failed: ${statusRes.status}`);
    const statusData = await statusRes.json();
    assert(typeof statusData.configured === "boolean", "Status should return configured boolean.");
    assert(typeof statusData.hasGoogleSub === "boolean", "Status should return hasGoogleSub boolean.");

  } finally {
    if (serverProcess) serverProcess.kill();
    await rm(dbPath, { force: true });
  }
}

// ── Run all ──────────────────────────────────────────────────────────────────

testGoogleAuthUrlIncludesIdentityScopes();
testWorkspaceUrlGmailOnly();
testWorkspaceUrlCalendarOnly();
testWorkspaceUrlSheetsOnly();
testWorkspaceUrlAllApps();
testDeriveConnectorStatus();
testDeriveConnectorStatusSheets();
testAppsFromScope();
testDecodeIdToken();
testExtractGoogleProfile();
testCreateUserFromGoogleProfile();
await runIntegrationTests();

console.log("Google auth onboarding tests passed.");
