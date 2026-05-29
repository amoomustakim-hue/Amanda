import { fetchCachedJson } from "./client-cache.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(value) {
  if (!value) return "Just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Just now";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

async function getJson(url) {
  const response = await fetch(url, { credentials: "same-origin" });
  if (response.status === 401) {
    window.location.href = "/login";
    return null;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Unable to load Amanda operations.");
  }
  return data;
}

function ensureDashboardOpsShell() {
  let shell = document.getElementById("dashboard-operations-shell");
  if (shell) return shell;

  const main = document.querySelector("main");
  if (!main) return null;

  shell = document.createElement("section");
  shell.id = "dashboard-operations-shell";
  shell.className = "mt-gutter grid grid-cols-1 lg:grid-cols-12 gap-gutter";
  shell.innerHTML = `
    <div class="lg:col-span-12 glass-panel p-8 rounded-xl" id="ops-attention-card">
      <h2 class="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.2em] mb-6">Today's Attention</h2>
      <div class="state-panel">Amanda is ranking today's priorities...</div>
    </div>
    <div class="lg:col-span-4 glass-panel p-8 rounded-xl" id="ops-today-card">
      <h2 class="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.2em] mb-6">Today's Operations</h2>
      <div class="text-on-surface-variant">Loading Amanda's queue...</div>
    </div>
    <div class="lg:col-span-4 glass-panel p-8 rounded-xl" id="ops-approval-card">
      <h2 class="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.2em] mb-6">Needs Approval</h2>
      <div class="text-on-surface-variant">Checking drafts...</div>
    </div>
    <div class="lg:col-span-4 glass-panel p-8 rounded-xl" id="ops-actions-card">
      <h2 class="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.2em] mb-6">Amanda's Recent Actions</h2>
      <div class="text-on-surface-variant">Loading action log...</div>
    </div>
    <div class="lg:col-span-7 glass-panel p-8 rounded-xl" id="ops-tasks-card">
      <h2 class="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.2em] mb-6">Open Tasks</h2>
      <div class="text-on-surface-variant">Loading tasks...</div>
    </div>
    <div class="lg:col-span-5 glass-panel p-8 rounded-xl" id="ops-signals-card">
      <h2 class="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.2em] mb-6">Business Signals</h2>
      <div class="text-on-surface-variant">Scanning business signals...</div>
    </div>
    <div class="lg:col-span-12 glass-panel p-8 rounded-xl" id="ops-connectors-card">
      <div class="flex items-center justify-between gap-4 mb-6">
        <h2 class="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.2em]">Connector Watch</h2>
        <a class="text-label-md font-label-md text-primary-fixed-dim hover:underline" href="/connectors">Manage connectors</a>
      </div>
      <div class="text-on-surface-variant">Loading connector status...</div>
    </div>
  `;
  main.append(shell);
  return shell;
}

function renderMetric(label, value) {
  return `
    <div class="p-4 rounded-lg bg-white/5 border border-white/10">
      <p class="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-widest">${escapeHtml(label)}</p>
      <p class="text-headline-md font-headline-md text-primary mt-2">${escapeHtml(value)}</p>
    </div>
  `;
}

function renderPill(text, tone = "default") {
  const className =
    tone === "high"
      ? "badge-danger"
      : tone === "approval"
        ? "badge-warning"
        : "badge-neutral";
  return `<span class="badge ${className}">${escapeHtml(text)}</span>`;
}

function renderAttentionPanel(attention) {
  const card = document.getElementById("ops-attention-card");
  if (!card) return;
  const items = attention?.items?.slice(0, 5) || [];
  card.innerHTML = `
    <div class="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-6">
      <div>
        <h2 class="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.2em]">Today's Attention</h2>
        <p class="text-body-md font-body-md text-on-surface mt-3">${escapeHtml(attention?.summary || "Amanda is watching for priority signals.")}</p>
      </div>
      <span class="badge badge-info">${escapeHtml((attention?.sources || []).join(", ") || "watching")}</span>
    </div>
    ${
      items.length
        ? `<div class="grid grid-cols-1 md:grid-cols-5 gap-3">${items.map((entry) => `
            <article class="card bg-white/5">
              <div class="flex items-center justify-between gap-2 mb-3">
                ${renderPill(entry.source, "default")}
                ${renderPill(entry.priority, entry.priority === "high" ? "high" : entry.priority === "medium" ? "approval" : "default")}
              </div>
              <h3 class="text-label-md font-label-md text-on-surface">${escapeHtml(entry.title)}</h3>
              <p class="text-label-sm font-label-sm text-on-surface-variant mt-2">${escapeHtml(entry.recommendedAction)}</p>
            </article>
          `).join("")}</div>
          <p class="mt-5 text-label-md font-label-md text-primary-fixed-dim">${escapeHtml(attention?.topRecommendation || "")}</p>`
        : `<div class="state-panel">Nothing urgent right now. Amanda will surface new items as Gmail, Calendar, and approvals update.</div>`
    }
  `;
}

function renderOperations({ overview, tasks, drafts, actionLogs, messages, orders, leads, connectors, approvals, attention }) {
  const summary = overview?.businessDataSummary || {};
  const pendingDraftsCount = drafts.filter((item) => item.status === "needs_approval").length;
  const todayCard = document.getElementById("ops-today-card");
  const approvalCard = document.getElementById("ops-approval-card");
  const actionsCard = document.getElementById("ops-actions-card");
  const tasksCard = document.getElementById("ops-tasks-card");
  const signalsCard = document.getElementById("ops-signals-card");
  const connectorsCard = document.getElementById("ops-connectors-card");

  renderAttentionPanel(attention);

  if (todayCard) {
    todayCard.innerHTML = `
      <h2 class="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.2em] mb-6">Today's Operations</h2>
      <div class="grid grid-cols-2 gap-3">
        ${renderMetric("Unanswered", summary.highPriorityMessages || messages.filter((item) => item.needsReply).length)}
        ${renderMetric("Pending Orders", summary.openOrders || orders.filter((item) => item.status !== "delivered").length)}
        ${renderMetric("Open Tasks", summary.openTasks || tasks.filter((item) => item.status === "open").length)}
        ${renderMetric("Active Leads", leads.length)}
        ${renderMetric("Unread Gmail", summary.gmailUnread || 0)}
        ${renderMetric("Needs Approval", (summary.draftsNeedingApproval || 0) + (summary.gmailDraftsNeedingApproval || 0) || pendingDraftsCount)}
      </div>
    `;
  }

  if (approvalCard) {
    const pending = drafts.filter((draft) => draft.status === "needs_approval").slice(0, 4);
    approvalCard.innerHTML = `
      <h2 class="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.2em] mb-6">Needs Approval</h2>
      ${
        pending.length
          ? `<div class="space-y-4">${pending
              .map(
                (draft) => `
                  <article class="card bg-primary-container/5 border-primary-container/20">
                    <div class="flex items-center justify-between gap-3">
                      <h3 class="text-label-md font-label-md text-on-surface">${escapeHtml(draft.connectorId === "gmail" ? `Review Gmail draft: ${draft.subject || "Draft reply"}` : draft.subject || "Draft reply")}</h3>
                      ${renderPill(draft.connectorId === "gmail" ? "Gmail draft" : "Draft", "approval")}
                    </div>
                    ${draft.connectorId === "gmail" ? `<p class="text-label-sm font-label-sm text-on-surface-variant mt-2">To: ${escapeHtml(draft.to || "No recipient")}</p>` : ""}
                    <p class="text-label-sm font-label-sm text-on-surface-variant mt-2 line-clamp-2">${escapeHtml(draft.body || "")}</p>
                  </article>
                `,
              )
              .join("")}</div>`
          : `<div class="state-panel">Nothing needs approval right now.</div>`
      }
    `;
  }

  if (actionsCard) {
    const logs = actionLogs.slice(0, 6);
    actionsCard.innerHTML = `
      <h2 class="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.2em] mb-6">Amanda's Recent Actions</h2>
      ${
        logs.length
          ? `<div class="space-y-3">${logs
              .map(
                (log) => `
                  <article class="flex items-start justify-between gap-4 border-b border-white/5 pb-3">
                    <div>
                      <p class="text-label-md font-label-md text-on-surface">${escapeHtml(log.action || "Action")}</p>
                      <p class="text-label-sm font-label-sm text-on-surface-variant">${escapeHtml(log.detail?.note || log.detail?.text || `${log.detail?.count ?? ""} local item${log.detail?.count === 1 ? "" : "s"}`.trim())}</p>
                    </div>
                    <div class="text-right">
                      <p class="text-label-sm font-label-sm text-on-surface-variant/60">${formatTime(log.createdAt)}</p>
                      ${renderPill(log.detail?.requiresApproval ? "Approval" : "Local")}
                    </div>
                  </article>
                `,
              )
              .join("")}</div>`
          : `<p class="text-on-surface-variant">No local actions logged yet.</p>`
      }
    `;
  }

  if (tasksCard) {
    const open = tasks.filter((task) => task.status !== "completed").slice(0, 6);
    tasksCard.innerHTML = `
      <h2 class="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.2em] mb-6">Open Tasks</h2>
      ${
        open.length
          ? `<div class="grid gap-3">${open
              .map(
                (task) => `
                  <article class="card bg-white/5 flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div>
                      <p class="text-body-md font-body-md text-on-surface">${escapeHtml(task.text)}</p>
                      <p class="text-label-sm font-label-sm text-on-surface-variant mt-1">${escapeHtml(task.source || "Amanda")} • ${formatTime(task.createdAt)}</p>
                    </div>
                    <div class="flex items-center gap-2">
                      ${renderPill(task.priority || "medium", task.priority === "high" ? "high" : "default")}
                      ${renderPill(task.status || "open")}
                    </div>
                  </article>
                `,
              )
              .join("")}</div>`
          : `<div class="state-panel">Nothing needs attention right now.</div>`
      }
    `;
  }

  if (signalsCard) {
    const highLead = leads[0];
    const pendingOrder = orders.find((order) => order.status !== "delivered");
    const purchaseIntent = messages.find((message) => message.needsReply && /price|plan|order|purchase|delivery/i.test(`${message.subject} ${message.body}`));
    const gmailConnector = connectors.find((connector) => connector.id === "gmail");
    const gmailImportant = summary.gmailImportant || gmailConnector?.gmailStats?.important || 0;
    const gmailDrafts = summary.gmailDraftsNeedingApproval || gmailConnector?.gmailStats?.draftsWaiting || 0;
    signalsCard.innerHTML = `
      <h2 class="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.2em] mb-6">Business Signals</h2>
      <div class="space-y-4">
        <article class="p-4 rounded-lg bg-white/5 border border-white/10">
          <p class="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-widest">High-priority lead</p>
          <p class="text-body-md font-body-md text-on-surface mt-2">${escapeHtml(highLead ? `${highLead.company} • ${highLead.score}% fit` : "No active leads")}</p>
        </article>
        <article class="p-4 rounded-lg bg-white/5 border border-white/10">
          <p class="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-widest">Pending delivery</p>
          <p class="text-body-md font-body-md text-on-surface mt-2">${escapeHtml(pendingOrder ? `${pendingOrder.publicId || pendingOrder.id}: ${pendingOrder.issue}` : "No pending deliveries")}</p>
        </article>
        <article class="p-4 rounded-lg bg-white/5 border border-white/10">
          <p class="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-widest">Purchase intent</p>
          <p class="text-body-md font-body-md text-on-surface mt-2">${escapeHtml(purchaseIntent ? purchaseIntent.subject : "No unanswered purchase-intent messages")}</p>
        </article>
        <article class="p-4 rounded-lg bg-white/5 border border-white/10">
          <p class="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-widest">Draft replies</p>
          <p class="text-body-md font-body-md text-on-surface mt-2">${escapeHtml(String(drafts.length))} prepared for review</p>
        </article>
        <article class="p-4 rounded-lg bg-white/5 border border-white/10">
          <p class="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-widest">Gmail attention</p>
          <p class="text-body-md font-body-md text-on-surface mt-2">${escapeHtml(`${gmailImportant} important, ${gmailDrafts} drafts waiting`)}</p>
        </article>
      </div>
    `;
  }

  if (connectorsCard) {
    const connected = connectors.filter((connector) => connector.mode === "real" || connector.status === "Connected");
    const waiting = connectors.filter((connector) => connector.mode === "not_connected");
    const pending = approvals.filter((approval) => approval.status === "pending");
    const gmailConnector = connectors.find((connector) => connector.id === "gmail");
    connectorsCard.innerHTML = `
      <div class="flex items-center justify-between gap-4 mb-6">
        <h2 class="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.2em]">Connector Watch</h2>
        <a class="text-label-md font-label-md text-primary-fixed-dim hover:underline" href="/connectors">Manage connectors</a>
      </div>
      ${
        connectors.length
          ? `<div class="grid grid-cols-1 md:grid-cols-4 gap-4">
              ${renderMetric("Available", connectors.length)}
              ${renderMetric("Connected", connected.length)}
              ${renderMetric("OAuth pending", waiting.length)}
              ${renderMetric("Approvals", pending.length)}
            </div>
            ${gmailConnector ? `<p class="mt-4 text-sm text-on-surface-variant">Gmail: ${escapeHtml(String(gmailConnector.gmailStats?.unread || 0))} unread, ${escapeHtml(String(gmailConnector.gmailStats?.important || 0))} important, ${escapeHtml(String(gmailConnector.gmailStats?.draftsWaiting || 0))} drafts waiting.</p>` : ""}
            <div class="mt-5 flex flex-wrap gap-2">
              ${connectors
                .slice(0, 8)
                .map(
                  (connector) => `
                    <span class="badge ${connector.mode === "real" || connector.status === "Connected" ? "badge-success" : connector.mode === "not_connected" ? "badge-neutral" : "badge-info"}">${escapeHtml(connector.label || connector.id)} • ${escapeHtml(connector.mode || "demo")}</span>
                  `,
                )
                .join("")}
            </div>
            <p class="mt-5 text-sm text-on-surface-variant">Amanda can sync connector snapshots and prepare risky actions for approval. She cannot execute external writes from this MVP.</p>`
          : `<div class="state-panel">Nothing needs attention right now.</div>`
      }
    `;
  }
}

function renderOperationsError(error) {
  const shell = ensureDashboardOpsShell();
  if (!shell) return;
  shell.querySelectorAll(".glass-panel").forEach((card) => {
    card.innerHTML = `
      <h2 class="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.2em] mb-4">Amanda Operations</h2>
      <div class="state-panel state-error">${escapeHtml(error.message || "Amanda could not load this section. Try refreshing the page.")}</div>
    `;
  });
}

async function bootstrapDashboard() {
  const data = await fetchCachedJson("/api/bootstrap", {
    cacheKey: "bootstrap",
    ttlMs: 45_000,
  });
  if (!data) return;

  const company = document.getElementById("dashboard-company");
  const summary = document.getElementById("dashboard-summary");
  const actions = document.getElementById("dashboard-actions");
  const efficiency = document.getElementById("dashboard-efficiency");
  const nodes = document.getElementById("dashboard-nodes");
  const load = document.getElementById("dashboard-load");

  if (company) company.textContent = data.user.company;
  if (summary) {
    summary.textContent = `Amanda is currently optimizing ${data.user.company}'s funnel and triaging ${data.tasks.length} active business workflows.`;
  }
  if (actions) {
    actions.innerHTML = data.tasks
      .slice(0, 3)
      .map(
        (task) => `
          <li class="flex items-start gap-4">
            <span class="material-symbols-outlined text-primary-fixed-dim mt-1">${
              task.status === "success"
                ? "task_alt"
                : task.text.toLowerCase().includes("lead")
                  ? "person_search"
                  : "schedule_send"
            }</span>
            <div>
              <p class="text-body-md font-body-md text-on-surface">${task.text}</p>
              <p class="text-label-sm font-label-sm text-on-surface-variant">${task.source} workflow</p>
            </div>
          </li>
        `,
      )
      .join("");
  }
  if (efficiency) efficiency.textContent = `+${18 + data.tasks.length}%`;
  if (nodes) nodes.textContent = String(1200 + data.transcriptPreview.length * 4);
  if (load) load.textContent = data.settings.reasoningIntensity > 70 ? "Deep Analysis" : "Balanced";
}

async function bootstrapOperations() {
  ensureDashboardOpsShell();
  try {
    const [overview, tasks, drafts, actionLogs, messages, orders, leads, connectors, approvals, attention] = await Promise.all([
      getJson("/api/business/overview"),
      getJson("/api/tasks"),
      getJson("/api/drafts"),
      getJson("/api/action-logs"),
      getJson("/api/messages"),
      getJson("/api/orders?pendingOnly=true"),
      getJson("/api/leads"),
      getJson("/api/connectors"),
      getJson("/api/approval-requests"),
      getJson("/api/attention/today"),
    ]);

    renderOperations({
      actionLogs: actionLogs?.actionLogs || [],
      approvals: approvals?.approvalRequests || [],
      connectors: connectors?.connectors || [],
      drafts: drafts?.drafts || [],
      leads: leads?.leads || [],
      messages: messages?.messages || [],
      orders: orders?.orders || [],
      overview: overview?.overview || {},
      tasks: tasks?.tasks || [],
      attention,
    });
  } catch (error) {
    renderOperationsError(error);
  }
}

bootstrapDashboard().catch((error) => {
  console.error(error);
});

bootstrapOperations().catch((error) => {
  console.error(error);
  renderOperationsError(error);
});
