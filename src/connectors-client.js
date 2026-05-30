const state = {
  approvals: [],
  connectors: [],
  demoMode: false,
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(value) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  }).format(date);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(options.headers || {}),
    },
    ...options,
  });
  if (response.status === 401) {
    window.location.href = "/login";
    return null;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || "Connector request failed.");
  return data;
}

function connectorActionFor(connector) {
  const action = connector.writeActions?.[0];
  if (action) return action;
  if (connector.kind === "commerce") return "refund_order";
  if (connector.kind === "payments") return "refund_payment";
  if (connector.kind === "calendar") return "create_event";
  if (connector.kind === "spreadsheet") return "update_row";
  if (connector.kind === "messaging") return "send_message";
  return "send_email";
}

function defaultPayloadForAction(connectorId, action) {
  if (connectorId === "google_calendar" && action === "create_event") {
    const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
    start.setHours(10, 0, 0, 0);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    return {
      description: "Prepared by Amanda.",
      end: end.toISOString(),
      location: "",
      start: start.toISOString(),
      subject: "Create calendar event: Supplier follow-up",
      timeZone: "Africa/Lagos",
      title: "Supplier follow-up",
    };
  }
  return { subject: `Approval required: ${action.replaceAll("_", " ")}` };
}

function statusTone(connector) {
  if (connector.mode === "real" || connector.status === "Connected") return "badge badge-success";
  if (connector.mode === "demo") return state.demoMode ? "badge badge-info" : "badge badge-neutral";
  if (connector.mode === "not_connected") return "badge badge-neutral";
  return "badge badge-neutral";
}

function missingEnvHtml(prefix, missingEnv = []) {
  if (!missingEnv.length) return `${escapeHtml(prefix)} OAuth setup is missing.`;
  return `
    <div>${escapeHtml(prefix)} OAuth setup is missing.</div>
    <div class="mt-2">Missing:</div>
    <ul class="mt-1 list-disc pl-5 space-y-1">
      ${missingEnv.map((name) => `<li>${escapeHtml(name)}</li>`).join("")}
    </ul>
  `;
}

function connectorNote(connector) {
  if (connector.id === "gmail") {
    if (!connector.oauth?.isConfigured) {
      return missingEnvHtml("Gmail", connector.oauth?.missingEnv || []);
    }
    if (connector.mode === "real") {
      return connector.gmailAccess?.canCreateDrafts
        ? "Draft creation enabled. Amanda can sync Gmail, prepare local replies, and create real Gmail drafts after you approve them. She still cannot send mail."
        : "Read-only connected. Amanda can sync recent Gmail messages, classify business emails, and prepare local drafts for review. Reconnect Gmail with compose permission to let her create drafts in Gmail Drafts.";
    }
    if (connector.mode === "demo") {
      return state.demoMode
        ? "Demo Gmail data is available. Connect real Gmail for read-only inbox sync."
        : "Ready to connect Gmail in read-only mode.";
    }
    return "OAuth is configured. Ready to connect Gmail. Compose permission enables real Gmail draft creation after approval.";
  }
  if (connector.id === "google_sheets") {
    const sh = connector.sheetsStatus;
    if (!sh) return "Google Sheets read-only connector.";
    if (!connector.oauth?.isConfigured) return missingEnvHtml("Google Sheets", connector.oauth?.missingEnv || []);
    if (!sh.connected) return "Connect Google Sheets to read your spreadsheet. OAuth is configured — click Connect.";
    if (!sh.spreadsheetId) return "Connected. Paste your Spreadsheet ID below and click Save Sheet.";
    if (!sh.lastSyncedAt) return `Sheet ID saved. Click Sync Sheet to read data from Google Sheets (read-only).`;
    const s = sh.summary;
    if (!s) return `Synced ${sh.totalRows} row${sh.totalRows === 1 ? "" : "s"}. No structured summary found — check column names.`;
    const parts = [];
    if (s.topProduct) parts.push(`Top: ${s.topProduct}`);
    if (s.lowStockCount) parts.push(`Low stock: ${s.lowStockCount}`);
    if (s.customerIssueCount) parts.push(`Issues: ${s.customerIssueCount}`);
    return `Sheet synced — ${sh.totalRows} rows. ${parts.join(" · ") || "Summary ready."}`;
  }
  if (connector.id !== "google_calendar") {
    if (state.demoMode && connector.mode === "demo") return "Demo only. No real external actions execute.";
    return "Coming soon. Not connected to a real external system yet.";
  }
  if (!connector.oauth?.isConfigured) {
    return missingEnvHtml("Google Calendar", connector.oauth?.missingEnv || []);
  }
  if (connector.mode === "real") {
    if (connector.calendarAccess?.canCreateEvents) {
      return "Event creation enabled. Amanda can create Google Calendar events only after you approve a prepared request.";
    }
    return "Read-only connected. To let Amanda create approved calendar events, set GOOGLE_CALENDAR_SCOPES to https://www.googleapis.com/auth/calendar.events, restart Amanda, disconnect Calendar, then reconnect.";
  }
  if (connector.mode === "demo") {
    return state.demoMode
      ? "Demo calendar data is available. Connect real Google Calendar for event sync."
      : "Not connected.";
  }
  return "OAuth is configured. Ready to connect Google Calendar. Event creation requires https://www.googleapis.com/auth/calendar.events.";
}

function googleCalendarAccessLabel(connector) {
  if (connector.id !== "google_calendar" || connector.mode !== "real") return "";
  return connector.calendarAccess?.canCreateEvents ? "Event creation enabled" : "Read-only connected";
}

function syncLabel(connector) {
  if (connector.id === "gmail") return "Sync Gmail";
  if (connector.id !== "google_calendar") return "Sync";
  if (connector.mode === "real") return "Sync Calendar";
  if (connector.mode === "demo") return "Sync demo";
  return "Sync";
}

function connectorActions(connector, action) {
  if (connector.id === "google_sheets") return ""; // controls handled in connectorControls
  if (!state.demoMode && !["google_calendar", "gmail"].includes(connector.id)) {
    return `
      <button class="btn btn-disabled" type="button" disabled>Coming Soon</button>
    `;
  }
  if (connector.id === "gmail") {
    return `
      <button class="connector-sync btn btn-secondary" data-id="${escapeHtml(connector.id)}" type="button">${escapeHtml(syncLabel(connector))}</button>
      <button class="btn btn-disabled" type="button" disabled>${connector.gmailAccess?.canCreateDrafts ? "Drafts Ready" : "Read-only"}</button>
      <button class="btn btn-disabled" type="button" disabled>No Send</button>
    `;
  }
  return `
    <button class="connector-sync btn btn-secondary" data-id="${escapeHtml(connector.id)}" type="button">${escapeHtml(syncLabel(connector))}</button>
    <button class="connector-preview btn btn-secondary" data-action="${escapeHtml(action)}" data-id="${escapeHtml(connector.id)}" type="button">Preview</button>
    <button class="connector-approval btn btn-primary" data-action="${escapeHtml(action)}" data-id="${escapeHtml(connector.id)}" type="button">Request</button>
  `;
}

function connectorControls(connector) {
  if (connector.id === "gmail") {
    if (connector.mode === "real") {
      return `
        <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button class="btn btn-disabled" type="button" disabled>Connected</button>
          <button class="gmail-disconnect btn btn-danger" type="button">Disconnect</button>
        </div>
      `;
    }
    const configured = Boolean(connector.oauth?.isConfigured);
    const connectDisabled = configured ? "" : "disabled";
    const connectClass = configured ? "gmail-connect btn btn-secondary" : "btn btn-disabled";
    const label = configured ? "Connect Gmail" : "OAuth Not Configured";
    return `
      <div class="mt-3 grid grid-cols-1 gap-2">
        <button class="${connectClass}" type="button" ${connectDisabled}>${label}</button>
      </div>
    `;
  }
  if (connector.id === "google_sheets") {
    const sh = connector.sheetsStatus || {};
    const configured = Boolean(connector.oauth?.isConfigured);
    if (!configured) {
      return `
        <div class="mt-3">
          <button class="btn btn-disabled w-full" type="button" disabled>OAuth Not Configured</button>
        </div>
      `;
    }
    if (!sh.connected) {
      return `
        <div class="mt-3 grid grid-cols-1 gap-2">
          <button class="google-sheets-connect btn btn-secondary" type="button">Connect Google Sheets</button>
        </div>
      `;
    }
    // Connected: show spreadsheet ID form + sync controls
    const spreadsheetId = escapeHtml(sh.spreadsheetId || "");
    const summaryHtml = sh.summary ? `
      <div class="mt-3 p-3 rounded-lg bg-white/5 border border-white/10 space-y-1 text-xs">
        ${sh.summary.topProduct ? `<div class="flex justify-between"><span class="text-on-surface-variant">Top product</span><span class="text-on-surface font-medium">${escapeHtml(sh.summary.topProduct)}</span></div>` : ""}
        <div class="flex justify-between"><span class="text-on-surface-variant">Rows synced</span><span class="text-on-surface">${sh.totalRows}</span></div>
        <div class="flex justify-between"><span class="text-on-surface-variant">Low stock</span><span class="${sh.summary.lowStockCount > 0 ? "text-warning" : "text-on-surface"}">${sh.summary.lowStockCount}</span></div>
        <div class="flex justify-between"><span class="text-on-surface-variant">Customer issues</span><span class="${sh.summary.customerIssueCount > 0 ? "text-warning" : "text-on-surface"}">${sh.summary.customerIssueCount}</span></div>
        ${sh.summary.recommendations?.[0] ? `<div class="pt-1 text-primary-fixed-dim">${escapeHtml(sh.summary.recommendations[0])}</div>` : ""}
      </div>` : "";
    return `
      <div class="mt-3 space-y-3">
        <div>
          <label class="text-[10px] uppercase tracking-widest text-on-surface-variant block mb-1">Spreadsheet ID</label>
          <input
            class="sheets-id-input w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/50 font-mono"
            placeholder="Paste spreadsheet ID from the Sheet URL"
            type="text"
            value="${spreadsheetId}"
          />
          <p class="text-[10px] text-on-surface-variant/50 mt-1">From URL: …/spreadsheets/d/<strong>ID</strong>/edit</p>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <button class="sheets-save btn btn-secondary" type="button">Save Sheet</button>
          <button class="sheets-sync btn btn-primary" type="button">Sync Sheet</button>
        </div>
        ${sh.lastSyncedAt ? `<p class="text-[10px] text-on-surface-variant">Last synced: ${formatTime(sh.lastSyncedAt)}</p>` : ""}
        ${summaryHtml}
        <button class="google-sheets-disconnect btn btn-danger w-full" type="button">Disconnect</button>
      </div>
    `;
  }
  if (connector.id !== "google_calendar") return "";
  if (connector.mode === "real") {
    return `
      <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
        <button class="btn btn-disabled" type="button" disabled>Connected</button>
        <button class="google-calendar-disconnect btn btn-danger" type="button">Disconnect</button>
      </div>
    `;
  }
  const configured = Boolean(connector.oauth?.isConfigured);
  const connectDisabled = configured ? "" : "disabled";
  const connectClass = configured
    ? "google-calendar-connect btn btn-secondary"
    : "btn btn-disabled";
  const label = configured ? "Connect Google Calendar" : "OAuth Not Configured";
  return `
    <div class="mt-3 grid grid-cols-1 gap-2">
      <button class="${connectClass}" type="button" ${connectDisabled}>${label}</button>
    </div>
  `;
}

function renderConnectors() {
  const grid = document.getElementById("connectors-grid");
  const count = document.getElementById("connector-count");
  if (!grid) return;
  if (count) count.textContent = `${state.connectors.length} connectors`;
  if (!state.connectors.length) {
    grid.innerHTML = `<div class="state-panel">Nothing needs attention right now.</div>`;
    return;
  }

  grid.innerHTML = `
    ${state.demoMode ? `<div class="lg:col-span-3 md:col-span-2 col-span-1 badge badge-info mb-2">Demo Mode Enabled</div>` : ""}
    ${state.connectors
    .map((connector) => {
      const action = connectorActionFor(connector);
      const pendingCount = state.approvals.filter(
        (approval) => approval.connectorId === connector.id && approval.status === "pending",
      ).length;
      return `
        <article class="card-glass flex flex-col min-h-[360px]">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h3 class="card-title">${escapeHtml(connector.label || connector.id)}</h3>
              <p class="card-subtitle mt-1">${escapeHtml(connector.kind || "connector")}</p>
            </div>
            <div class="flex flex-col items-end gap-2">
              <span class="${statusTone(connector)}">${escapeHtml(connector.status || connector.mode || "Unknown")}</span>
              ${googleCalendarAccessLabel(connector) ? `<span class="badge ${connector.calendarAccess?.canCreateEvents ? "badge-success" : "badge-info"}">${escapeHtml(googleCalendarAccessLabel(connector))}</span>` : ""}
            </div>
          </div>
          <div class="mt-5 grid grid-cols-2 gap-3 text-sm">
            <div class="p-3 rounded-lg bg-white/5 border border-white/10">
              <p class="text-on-surface-variant uppercase text-[10px] tracking-widest">Mode</p>
              <p class="mt-1 text-on-surface">${escapeHtml(connector.mode || "demo")}</p>
            </div>
            <div class="p-3 rounded-lg bg-white/5 border border-white/10">
              <p class="text-on-surface-variant uppercase text-[10px] tracking-widest">Last sync</p>
              <p class="mt-1 text-on-surface">${formatTime(connector.lastSyncAt)}</p>
            </div>
          </div>
          ${
            connector.id === "gmail"
              ? `<div class="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div class="p-3 rounded-lg bg-white/5 border border-white/10">
                    <p class="text-on-surface-variant uppercase text-[10px] tracking-widest">Messages</p>
                    <p class="mt-1 text-on-surface">${escapeHtml(connector.gmailStats?.messagesSynced || 0)}</p>
                  </div>
                  <div class="p-3 rounded-lg bg-white/5 border border-white/10">
                    <p class="text-on-surface-variant uppercase text-[10px] tracking-widest">Unread</p>
                    <p class="mt-1 text-on-surface">${escapeHtml(connector.gmailStats?.unread || 0)}</p>
                  </div>
                  <div class="p-3 rounded-lg bg-white/5 border border-white/10">
                    <p class="text-on-surface-variant uppercase text-[10px] tracking-widest">Important</p>
                    <p class="mt-1 text-on-surface">${escapeHtml(connector.gmailStats?.important || 0)}</p>
                  </div>
                  <div class="p-3 rounded-lg bg-white/5 border border-white/10">
                    <p class="text-on-surface-variant uppercase text-[10px] tracking-widest">Drafts Waiting</p>
                    <p class="mt-1 text-on-surface">${escapeHtml(connector.gmailStats?.draftsWaiting || 0)}</p>
                  </div>
                </div>`
              : connector.id === "google_sheets" && connector.sheetsStatus?.totalRows
              ? `<div class="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div class="p-3 rounded-lg bg-white/5 border border-white/10">
                    <p class="text-on-surface-variant uppercase text-[10px] tracking-widest">Rows</p>
                    <p class="mt-1 text-on-surface">${escapeHtml(connector.sheetsStatus.totalRows)}</p>
                  </div>
                  <div class="p-3 rounded-lg bg-white/5 border border-white/10">
                    <p class="text-on-surface-variant uppercase text-[10px] tracking-widest">Top Product</p>
                    <p class="mt-1 text-on-surface truncate">${escapeHtml(connector.sheetsStatus.summary?.topProduct || "—")}</p>
                  </div>
                  <div class="p-3 rounded-lg bg-white/5 border border-white/10">
                    <p class="text-on-surface-variant uppercase text-[10px] tracking-widest">Low Stock</p>
                    <p class="mt-1 text-on-surface">${escapeHtml(connector.sheetsStatus.summary?.lowStockCount || 0)}</p>
                  </div>
                  <div class="p-3 rounded-lg bg-white/5 border border-white/10">
                    <p class="text-on-surface-variant uppercase text-[10px] tracking-widest">Issues</p>
                    <p class="mt-1 text-on-surface">${escapeHtml(connector.sheetsStatus.summary?.customerIssueCount || 0)}</p>
                  </div>
                </div>`
              : ""
          }
          <div class="mt-5">
            <p class="text-xs uppercase tracking-[0.2em] text-on-surface-variant mb-2">Amanda can</p>
            <div class="flex flex-wrap gap-2">
              ${(connector.capabilities || [])
                .slice(0, 5)
                .map((capability) => `<span class="px-2 py-1 rounded bg-white/5 text-xs text-on-surface-variant">${escapeHtml(capability.replaceAll("_", " "))}</span>`)
                .join("") || `<span class="text-sm text-on-surface-variant">No capabilities listed.</span>`}
            </div>
          </div>
          <div class="mt-5">
            <p class="text-xs uppercase tracking-[0.2em] text-on-surface-variant mb-2">Approval required for</p>
            <p class="text-sm text-on-surface-variant">${escapeHtml((connector.writeActions || []).map((item) => item.replaceAll("_", " ")).join(", ") || (connector.id === "gmail" ? "local draft review only" : "external writes"))}</p>
            <p class="text-xs text-primary-fixed-dim mt-2">${pendingCount} pending approval${pendingCount === 1 ? "" : "s"}</p>
          </div>
          <div class="mt-auto pt-6 grid grid-cols-1 sm:grid-cols-3 gap-2">
            ${connectorActions(connector, action)}
          </div>
          ${connectorControls(connector)}
          <div class="mt-3 text-xs text-on-surface-variant">${connectorNote(connector)}</div>
        </article>
      `;
    })
    .join("")}
  `;
}

function renderApprovalsLegacy() {
  const queue = document.getElementById("approval-queue");
  if (!queue) return;
  const approvals = state.approvals.slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  if (!approvals.length) {
    queue.innerHTML = `<div class="state-panel">Nothing needs approval right now.</div>`;
    return;
  }
  queue.innerHTML = approvals
    .slice(0, 8)
    .map(
      (approval) => `
        <article class="card bg-white/5">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-sm font-semibold text-on-surface">${escapeHtml(approval.subject || approval.action || "Approval request")}</p>
              <p class="text-xs text-on-surface-variant mt-1">${escapeHtml(approval.connectorId || approval.type || "connector")} • ${formatTime(approval.createdAt)}</p>
            </div>
            <span class="badge ${approval.status === "rejected" ? "badge-danger" : approval.status === "approved" ? "badge-success" : "badge-warning"}">${escapeHtml(approval.status || "needs_approval")}</span>
          </div>
          <p class="text-sm text-on-surface-variant mt-3">${escapeHtml(approval.reason || "External side effect requires human approval.")}</p>
          <div class="inline-actions mt-3">
            <button class="approval-decision btn btn-primary" data-decision="approve" data-id="${escapeHtml(approval.id)}" type="button">Approve local</button>
            <button class="approval-decision btn btn-danger" data-decision="reject" data-id="${escapeHtml(approval.id)}" type="button">Reject</button>
          </div>
          <p class="mt-2 text-[10px] uppercase tracking-widest text-on-surface-variant">Approve only marks local state. It does not execute externally.</p>
        </article>
      `,
    )
    .join("");
}

function renderApprovalsV2() {
  const queue = document.getElementById("approval-queue");
  if (!queue) return;
  const sorted = state.approvals.slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const active = sorted.filter((approval) => approval.status === "pending");
  const history = sorted.filter((approval) => approval.status !== "pending");
  const renderApprovalCard = (approval, { historyItem = false } = {}) => {
    const isCalendarCreate = approval.connectorId === "google_calendar" && approval.action === "create_event";
    const isGmailDraftReview = approval.connectorId === "gmail" && ["create_gmail_draft", "review_local_draft"].includes(approval.action);
    const payload = approval.payload || {};
    const statusClass =
      approval.status === "rejected" || approval.status === "approval_failed"
        ? "badge-danger"
        : approval.status === "approved" || approval.status === "approved_local" || approval.status === "ready_to_send_later"
          ? "badge-success"
        : "badge-warning";
    const calendarDetails = isCalendarCreate
      ? `
        <div class="mt-3 grid grid-cols-1 gap-2 text-xs text-on-surface-variant">
          <p><span class="text-on-surface">Event:</span> ${escapeHtml(payload.title || approval.subject || "Calendar event")}</p>
          <p><span class="text-on-surface">When:</span> ${escapeHtml(formatTime(payload.start))} - ${escapeHtml(formatTime(payload.end))}</p>
          <p><span class="text-on-surface">Location:</span> ${escapeHtml(payload.location || "No location")}</p>
          <p><span class="text-on-surface">Risk:</span> ${escapeHtml(approval.riskLevel || "medium")}</p>
        </div>
      `
      : "";
    const gmailDraftDetails = isGmailDraftReview
      ? `
        <div class="mt-3 grid grid-cols-1 gap-2 text-xs text-on-surface-variant">
          <p><span class="text-on-surface">To:</span> ${escapeHtml(payload.to || "No recipient")}</p>
          <p><span class="text-on-surface">Subject:</span> ${escapeHtml(payload.subject || approval.subject || "Draft reply")}</p>
          <div>
            <p class="text-on-surface mb-1">Preview:</p>
            <p class="text-on-surface-variant whitespace-pre-line line-clamp-4">${escapeHtml(payload.bodyPreview || payload.body || "")}</p>
          </div>
          <p><span class="text-on-surface">Status:</span> ${escapeHtml(approval.status === "pending" ? "Pending review" : approval.status)}</p>
        </div>
      `
      : "";
    return `
      <article class="card bg-white/5">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-sm font-semibold text-on-surface">${escapeHtml(approval.subject || approval.action || "Approval request")}</p>
            <p class="text-xs text-on-surface-variant mt-1">${escapeHtml(approval.connectorId || approval.type || "connector")} - ${formatTime(approval.createdAt)}</p>
          </div>
          <span class="badge ${statusClass}">${escapeHtml(approval.status || "needs_approval")}</span>
        </div>
        <p class="text-sm text-on-surface-variant mt-3">${escapeHtml(approval.reason || "External side effect requires human approval.")}</p>
        ${calendarDetails}
        ${gmailDraftDetails}
        ${approval.reviewNote ? `<p class="text-xs text-primary-fixed-dim mt-3">${escapeHtml(approval.reviewNote)}</p>` : ""}
        ${isCalendarCreate && approval.execution?.status === "created" ? `<p class="badge badge-success mt-3 inline-flex">Created in Google Calendar</p>` : ""}
        ${isGmailDraftReview && approval.execution?.status === "created" ? `<p class="badge badge-success mt-3 inline-flex">Created in Gmail Drafts</p>` : ""}
        ${approval.status === "approval_failed" ? `<p class="badge badge-danger mt-3 inline-flex">Failed</p>` : ""}
        ${isGmailDraftReview && approval.execution?.draftId ? `<p class="text-xs text-on-surface-variant mt-2">Draft ID: ${escapeHtml(approval.execution.draftId)}</p>` : ""}
        ${isGmailDraftReview && approval.execution?.draftsUrl ? `<p class="text-xs mt-1"><a class="text-primary-fixed-dim hover:underline" href="${escapeHtml(approval.execution.draftsUrl)}" target="_blank" rel="noreferrer">Open Gmail Drafts</a></p>` : ""}
        ${historyItem && approval.reviewedAt ? `<p class="text-xs text-on-surface-variant mt-2">Resolved ${escapeHtml(formatTime(approval.reviewedAt))}</p>` : ""}
        ${historyItem && approval.execution?.createdAt ? `<p class="text-xs text-on-surface-variant mt-1">Executed ${escapeHtml(formatTime(approval.execution.createdAt))}</p>` : ""}
        ${historyItem ? `<div class="inline-actions mt-3"><button class="approval-dismiss btn btn-ghost" data-id="${escapeHtml(approval.id)}" type="button">Dismiss</button></div>` : `
        <div class="inline-actions mt-3">
          <button class="approval-decision btn btn-primary" data-decision="approve" data-id="${escapeHtml(approval.id)}" type="button">${isCalendarCreate ? "Approve and Create" : isGmailDraftReview ? "Create Gmail Draft" : "Approve Local"}</button>
          <button class="approval-decision btn btn-danger" data-decision="reject" data-id="${escapeHtml(approval.id)}" type="button">Reject</button>
        </div>
        <p class="mt-2 text-[10px] uppercase tracking-widest text-on-surface-variant">${isCalendarCreate ? "Approval creates this event in Google Calendar only if event access is enabled." : isGmailDraftReview ? "Approval creates a Gmail draft only. Amanda will not send any email." : "Approve only marks local state. It does not execute externally."}</p>`}
      </article>
    `;
  };
  queue.innerHTML = `
    <div class="space-y-3">
      ${active.length ? active.slice(0, 8).map((approval) => renderApprovalCard(approval)).join("") : `<div class="state-panel">No actions waiting for approval.</div>`}
    </div>
    <div class="mt-6">
      <h3 class="text-xs uppercase tracking-[0.2em] text-on-surface-variant mb-3">Approval History</h3>
      ${
        history.length
          ? `<div class="space-y-3 opacity-90">${history.slice(0, 6).map((approval) => renderApprovalCard(approval, { historyItem: true })).join("")}</div>`
          : `<div class="state-panel">No resolved approvals yet.</div>`
      }
    </div>
  `;
}

function setFeedback(message, tone = "success") {
  const feedback = document.getElementById("connector-feedback");
  if (!feedback) return;
  feedback.hidden = false;
  feedback.className = `mt-3 text-sm ${tone === "error" ? "text-error" : "text-primary-fixed-dim"}`;
  feedback.textContent = message;
}

function renderPreview(preview) {
  const panel = document.getElementById("connector-preview");
  if (!panel) return;
  if (!preview) {
    panel.innerHTML = `<div class="state-panel">Preview a risky action from a connector card. Amanda will prepare it, not execute it.</div>`;
    return;
  }
  panel.innerHTML = `
    <article class="card bg-primary-container/5 border-primary-container/20">
      <p class="text-sm font-semibold text-on-surface">${escapeHtml(preview.connector?.label || "Connector action")}</p>
      <p class="text-sm text-on-surface-variant mt-2">${escapeHtml(preview.action?.replaceAll("_", " ") || "external action")}</p>
      <p class="text-sm text-primary-fixed-dim mt-3">Amanda prepared this action, but it requires approval before anything external happens.</p>
      <p class="text-xs text-on-surface-variant mt-3">${escapeHtml(preview.risk || "External side effect requires human approval.")}</p>
    </article>
  `;
}

async function loadAll() {
  try {
    const [connectors, approvals] = await Promise.all([
      api("/api/connectors"),
      api("/api/approval-requests"),
    ]);
    state.connectors = connectors?.connectors || [];
    state.demoMode = Boolean(connectors?.demoMode);
    state.approvals = approvals?.approvalRequests || [];
    renderConnectors();
    renderApprovalsV2();
  } catch (error) {
    setFeedback(error.message || "Unable to load connectors.", "error");
    document.getElementById("connectors-grid").innerHTML = `<div class="state-panel state-error">${escapeHtml(error.message || "Amanda could not load this section. Try refreshing the page.")}</div>`;
  }
}

document.addEventListener("click", async (event) => {
  const sync = event.target.closest(".connector-sync");
  const preview = event.target.closest(".connector-preview");
  const approval = event.target.closest(".connector-approval");
  const decision = event.target.closest(".approval-decision");
  const dismiss = event.target.closest(".approval-dismiss");
  const connectCalendar = event.target.closest(".google-calendar-connect");
  const disconnectCalendar = event.target.closest(".google-calendar-disconnect");
  const connectGmail = event.target.closest(".gmail-connect");
  const disconnectGmail = event.target.closest(".gmail-disconnect");
  const connectSheets = event.target.closest(".google-sheets-connect");
  const disconnectSheets = event.target.closest(".google-sheets-disconnect");
  const sheetsSave = event.target.closest(".sheets-save");
  const sheetsSync = event.target.closest(".sheets-sync");
  if (!sync && !preview && !approval && !decision && !dismiss && !connectCalendar && !disconnectCalendar && !connectGmail && !disconnectGmail && !connectSheets && !disconnectSheets && !sheetsSave && !sheetsSync) return;

  try {
    if (connectCalendar) {
      window.location.href = "/api/connectors/google_calendar/connect";
      return;
    }
    if (connectGmail) {
      window.location.href = "/api/connectors/gmail/connect";
      return;
    }
    if (connectSheets) {
      window.location.href = "/api/connectors/google_sheets/connect";
      return;
    }
    if (disconnectSheets) {
      disconnectSheets.disabled = true;
      await api("/api/connectors/google_sheets/disconnect", { method: "POST", body: "{}" });
      setFeedback("Google Sheets disconnected. Stored OAuth token deleted locally.");
      await loadAll();
    }
    if (sheetsSave) {
      const card = sheetsSave.closest("article");
      const input = card?.querySelector(".sheets-id-input");
      const spreadsheetId = (input?.value || "").trim();
      if (!spreadsheetId) { setFeedback("Paste a Spreadsheet ID first.", "error"); return; }
      sheetsSave.disabled = true;
      sheetsSave.textContent = "Saving...";
      await api("/api/connectors/google_sheets/config", {
        method: "POST",
        body: JSON.stringify({
          spreadsheetId,
          ranges: ["Orders!A1:H50", "Products!A1:G50", "Inventory!A1:F50", "Customer Issues!A1:I50", "Analytics!A1:C50"],
        }),
      });
      setFeedback("Sheet saved. Click Sync Sheet to read the latest data.");
      await loadAll();
    }
    if (sheetsSync) {
      sheetsSync.disabled = true;
      sheetsSync.textContent = "Syncing...";
      try {
        const result = await api("/api/connectors/google_sheets/sync", { method: "POST", body: "{}" });
        setFeedback(result?.totalRows !== undefined
          ? `Sheet synced — ${result.totalRows} row${result.totalRows === 1 ? "" : "s"} read. Read-only, no changes made to your spreadsheet.`
          : "Sheet synced. No changes made to your spreadsheet.");
        await loadAll();
      } catch (syncErr) {
        setFeedback(syncErr.message || "Sheet sync failed. Check that Google Sheets is connected and the Spreadsheet ID is correct.", "error");
      } finally {
        sheetsSync.disabled = false;
        sheetsSync.textContent = "Sync Sheet";
      }
    }
    if (disconnectCalendar) {
      disconnectCalendar.disabled = true;
      await api("/api/connectors/google_calendar/disconnect", { method: "POST", body: "{}" });
      setFeedback("Google Calendar disconnected. Stored OAuth token was deleted locally.");
      await loadAll();
    }
    if (disconnectGmail) {
      disconnectGmail.disabled = true;
      await api("/api/connectors/gmail/disconnect", { method: "POST", body: "{}" });
      setFeedback("Gmail disconnected. Stored OAuth token was deleted locally.");
      await loadAll();
    }
    if (sync) {
      const id = sync.dataset.id;
      sync.disabled = true;
      sync.textContent = id === "google_calendar" ? "Syncing..." : id === "gmail" ? "Syncing..." : "Syncing...";
      const result = await api(`/api/connectors/${encodeURIComponent(id)}/sync`, { method: "POST", body: "{}" });
      const eventsSynced = result?.sync?.eventsSynced;
      const messagesSynced = result?.sync?.messagesSynced;
      setFeedback(
        id === "google_calendar" && Number.isFinite(eventsSynced)
          ? `Google Calendar synced ${eventsSynced} read-only event${eventsSynced === 1 ? "" : "s"}. No calendar writes executed.`
          : id === "gmail" && Number.isFinite(messagesSynced)
            ? `Gmail synced ${messagesSynced} recent message${messagesSynced === 1 ? "" : "s"} in read-only mode. No mailbox changes were made.`
          : `${id} synced locally. No external writes executed.`,
      );
      await loadAll();
    }
    if (preview) {
      const id = preview.dataset.id;
      const action = preview.dataset.action;
      const result = await api(`/api/connectors/${encodeURIComponent(id)}/actions/preview`, {
        method: "POST",
        body: JSON.stringify({ action, payload: { subject: `Preview ${action.replaceAll("_", " ")}` } }),
      });
      renderPreview(result.preview);
      setFeedback("Preview prepared. Approval is required before external execution.");
    }
    if (approval) {
      const id = approval.dataset.id;
      const action = approval.dataset.action;
      await api(`/api/connectors/${encodeURIComponent(id)}/approval-requests`, {
        method: "POST",
        body: JSON.stringify({ action, payload: defaultPayloadForAction(id, action) }),
      });
      setFeedback("Approval request created. Nothing external was executed.");
      await loadAll();
    }
    if (decision) {
      const id = decision.dataset.id;
      const action = decision.dataset.decision;
      const result = await api(`/api/approval-requests/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
        body: "{}",
      });
      setFeedback(result?.message || (action === "approve" ? "Approval processed." : "Approval request rejected locally."));
      await loadAll();
    }
    if (dismiss) {
      const id = dismiss.dataset.id;
      await api(`/api/approval-requests/${encodeURIComponent(id)}/dismiss`, {
        method: "POST",
        body: "{}",
      });
      setFeedback("Resolved approval dismissed from history.");
      await loadAll();
    }
  } catch (error) {
    const id = sync?.dataset?.id || "";
    setFeedback(
      id === "google_calendar"
        ? "Google Calendar could not sync. Your token may have expired or the API request failed. Try reconnecting Calendar."
        : id === "gmail"
          ? "Gmail could not sync. Your token may have expired or the API request failed. Try reconnecting Gmail."
        : error.message || "Connector action failed.",
      "error",
    );
  } finally {
    if (sync) {
      sync.disabled = false;
      sync.textContent = syncLabel(state.connectors.find((connector) => connector.id === sync.dataset.id) || { id: sync.dataset.id });
    }
    if (disconnectCalendar) disconnectCalendar.disabled = false;
    if (disconnectGmail) disconnectGmail.disabled = false;
    if (disconnectSheets) disconnectSheets.disabled = false;
    if (sheetsSave) { sheetsSave.disabled = false; sheetsSave.textContent = "Save Sheet"; }
  }
});

document.getElementById("sync-all-connectors")?.addEventListener("click", async (event) => {
  event.currentTarget.disabled = true;
  try {
    await api("/api/connectors/all/sync", { method: "POST", body: "{}" });
    setFeedback("All connector snapshots synced locally. No external writes executed.");
    await loadAll();
  } catch (error) {
    setFeedback(error.message || "Unable to sync connectors.", "error");
  } finally {
    event.currentTarget.disabled = false;
  }
});

const params = new URLSearchParams(window.location.search);
if (params.get("connected") === "google_calendar") {
  setFeedback("Google Calendar connected. Sync it to bring read-only events into Amanda.");
}
if (params.get("connected") === "gmail") {
  setFeedback("Gmail connected in read-only mode. Sync it to bring recent business emails into Amanda.");
}
if (params.get("error")?.startsWith("google_calendar")) {
  setFeedback("Google Calendar connection did not complete. No tokens were exposed or stored from the failed attempt.", "error");
}
if (params.get("error")?.startsWith("gmail")) {
  setFeedback("Gmail connection did not complete. No tokens were exposed or stored from the failed attempt.", "error");
}
if (params.get("connected") === "google_sheets") {
  setFeedback("Google Sheets connected. Paste your Spreadsheet ID, save it, then sync to read your data.");
}
if (params.get("error")?.startsWith("google_sheets")) {
  setFeedback("Google Sheets connection did not complete. No tokens were exposed or stored from the failed attempt.", "error");
}

loadAll();
