import { fetchCachedJson, formatShortTime } from "./client-cache.js";

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
  if (!response.ok) throw new Error(data.error || "Unable to load workspace operations.");
  return data;
}

function statusPill(status) {
  const tone =
    status === "success"
      ? "badge-success"
      : status === "active" || status === "thinking"
        ? "badge-info"
        : "badge-neutral";
  const label =
    status === "thinking"
      ? "Thinking..."
      : status === "active"
        ? "Active"
        : status === "success"
          ? "Success"
          : "Queued";
  return `<span class="badge ${tone}">${label}</span>`;
}

function integrationColor(id) {
  return {
    intercom: "#0057FF",
    salesforce: "#00A1E0",
    shopify: "#95BF47",
  }[id] || "#00f0ff";
}

function ensureWorkspaceOpsShell() {
  let shell = document.getElementById("workspace-operations-shell");
  if (shell) return shell;
  const main = document.querySelector("main");
  if (!main) return null;
  shell = document.createElement("section");
  shell.id = "workspace-operations-shell";
  shell.className = "mt-gutter grid grid-cols-1 lg:grid-cols-12 gap-gutter";
  shell.innerHTML = `
    <div class="lg:col-span-12 card-glass" id="workspace-unified-attention-card">
      <h2 class="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.2em] mb-6">Today's Attention</h2>
      <div class="state-panel">Amanda is ranking today's priorities...</div>
    </div>
    <div class="lg:col-span-4 card-glass" id="workspace-attention-card">
      <h2 class="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.2em] mb-6">Needs Attention</h2>
      <div class="state-panel">Loading Amanda's workspace...</div>
    </div>
    <div class="lg:col-span-4 card-glass" id="workspace-approval-card">
      <h2 class="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.2em] mb-6">Approval Queue</h2>
      <div class="state-panel">Loading Amanda's workspace...</div>
    </div>
    <div class="lg:col-span-4 card-glass" id="workspace-actions-card">
      <h2 class="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.2em] mb-6">Recent Actions</h2>
      <div class="state-panel">Loading Amanda's workspace...</div>
    </div>
  `;
  main.append(shell);
  return shell;
}

function renderWorkspaceMetric(label, value) {
  return `
    <div class="flex items-center justify-between border-b border-white/5 py-3">
      <span class="text-label-md font-label-md text-on-surface-variant">${escapeHtml(label)}</span>
      <strong class="text-headline-md font-headline-md text-primary">${escapeHtml(value)}</strong>
    </div>
  `;
}

function renderPriorityBadge(value) {
  const tone = value === "high" ? "badge-danger" : value === "medium" ? "badge-warning" : "badge-neutral";
  return `<span class="badge ${tone}">${escapeHtml(value || "low")}</span>`;
}

function renderWorkspaceUnifiedAttention(attention) {
  const card = document.getElementById("workspace-unified-attention-card");
  if (!card) return;
  const items = attention?.items?.slice(0, 5) || [];
  card.innerHTML = `
    <div class="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-6">
      <div>
        <h2 class="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.2em]">Today's Attention</h2>
        <p class="text-body-md font-body-md text-on-surface mt-3">${escapeHtml(attention?.summary || "Amanda is watching the workspace.")}</p>
      </div>
      <span class="badge badge-info">${escapeHtml((attention?.sources || []).join(", ") || "watching")}</span>
    </div>
    ${
      items.length
        ? `<div class="space-y-3">${items.map((entry) => `
            <article class="card bg-white/5 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <div class="flex flex-wrap items-center gap-2 mb-2">
                  <span class="badge badge-neutral">${escapeHtml(entry.source)}</span>
                  ${renderPriorityBadge(entry.priority)}
                </div>
                <h3 class="text-label-md font-label-md text-on-surface">${escapeHtml(entry.title)}</h3>
                <p class="text-label-sm font-label-sm text-on-surface-variant mt-1">${escapeHtml(entry.recommendedAction)}</p>
              </div>
              <strong class="text-primary text-label-md font-label-md">${escapeHtml(entry.score)}</strong>
            </article>
          `).join("")}</div>
          <p class="mt-5 text-label-md font-label-md text-primary-fixed-dim">${escapeHtml(attention?.topRecommendation || "")}</p>`
        : `<div class="state-panel">Nothing urgent right now. Amanda will surface new items as Gmail, Calendar, and approvals update.</div>`
    }
  `;
}

function renderWorkspaceOperations({ overview, drafts, actionLogs, messages, orders, leads, tasks, attentionSummary }) {
  const summary = overview?.businessDataSummary || {};
  const pendingDraftsCount = drafts.filter((draft) => draft.status === "needs_approval").length;
  const attention = document.getElementById("workspace-attention-card");
  const approvals = document.getElementById("workspace-approval-card");
  const actions = document.getElementById("workspace-actions-card");

  renderWorkspaceUnifiedAttention(attentionSummary);

  if (attention) {
    const purchaseIntent = messages.find((message) => message.needsReply && /price|plan|order|purchase|delivery/i.test(`${message.subject} ${message.body}`));
    const lead = leads[0];
    const order = orders.find((item) => item.status !== "delivered");
    attention.innerHTML = `
      <h2 class="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.2em] mb-6">Needs Attention</h2>
      <div>
        ${renderWorkspaceMetric("Unanswered messages", summary.highPriorityMessages || messages.filter((item) => item.needsReply).length)}
        ${renderWorkspaceMetric("Pending orders", summary.openOrders || orders.length)}
        ${renderWorkspaceMetric("Open tasks", summary.openTasks || tasks.length)}
        ${renderWorkspaceMetric("Active leads", leads.length)}
        ${renderWorkspaceMetric("Unread Gmail", summary.gmailUnread || 0)}
        ${renderWorkspaceMetric("Needs approval", (summary.draftsNeedingApproval || 0) + (summary.gmailDraftsNeedingApproval || 0) || pendingDraftsCount)}
      </div>
      <div class="mt-6 p-4 rounded-lg bg-white/5 border border-white/10">
        <p class="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-widest">Amanda's read</p>
        <p class="text-body-md font-body-md text-on-surface mt-2">${escapeHtml(
          purchaseIntent?.subject || (summary.gmailImportant ? `${summary.gmailImportant} important Gmail thread(s)` : "") || lead?.company || order?.publicId || "No urgent signal detected",
        )}</p>
      </div>
    `;
  }

  if (approvals) {
    const pending = drafts.filter((draft) => draft.status === "needs_approval").slice(0, 3);
    approvals.innerHTML = `
      <h2 class="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.2em] mb-6">Approval Queue</h2>
      ${
        pending.length
          ? `<div class="space-y-3">${pending
              .map(
                (draft) => `
                  <article class="card bg-primary-container/5 border-primary-container/20">
                    <p class="text-label-md font-label-md text-on-surface">${escapeHtml(draft.connectorId === "gmail" ? `Review Gmail draft: ${draft.subject || "Draft reply"}` : draft.subject || "Draft reply")}</p>
                    ${draft.connectorId === "gmail" ? `<p class="text-label-sm font-label-sm text-on-surface-variant mt-2">To: ${escapeHtml(draft.to || "No recipient")}</p>` : ""}
                    <p class="text-label-sm font-label-sm text-on-surface-variant mt-2 line-clamp-2">${escapeHtml(draft.body || "")}</p>
                    <span class="badge badge-warning mt-3">${draft.connectorId === "gmail" ? "Pending review" : "Needs approval"}</span>
                  </article>
                `,
              )
              .join("")}</div>`
          : `<div class="state-panel">Nothing needs approval right now.</div>`
      }
    `;
  }

  if (actions) {
    const logs = actionLogs.slice(0, 5);
    actions.innerHTML = `
      <h2 class="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.2em] mb-6">Recent Actions</h2>
      ${
        logs.length
          ? `<div class="space-y-3">${logs
              .map(
                (log) => `
                  <article class="flex items-start justify-between gap-4 border-b border-white/5 pb-3">
                    <div>
                      <p class="text-label-md font-label-md text-on-surface">${escapeHtml(log.action || "Action")}</p>
                      <p class="text-label-sm font-label-sm text-on-surface-variant">${escapeHtml(log.detail?.text || log.detail?.note || "Local workspace action")}</p>
                    </div>
                    <span class="text-label-sm font-label-sm text-on-surface-variant/60">${formatTime(log.createdAt)}</span>
                  </article>
                `,
              )
              .join("")}</div>`
          : `<div class="state-panel">Nothing needs attention right now.</div>`
      }
    `;
  }
}

function renderWorkspaceOperationsError(error) {
  const shell = ensureWorkspaceOpsShell();
  if (!shell) return;
  shell.querySelectorAll(".glass-panel").forEach((card) => {
    card.innerHTML = `
      <h2 class="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.2em] mb-4">Amanda Operations</h2>
      <div class="state-panel state-error">${escapeHtml(error.message || "Amanda could not load this section. Try refreshing the page.")}</div>
    `;
  });
}

async function bootstrapWorkspace() {
  const data = await fetchCachedJson("/api/bootstrap", {
    cacheKey: "bootstrap",
    ttlMs: 45_000,
  });
  if (!data) return;

  const heading = document.getElementById("workspace-heading");
  const subcopy = document.getElementById("workspace-subcopy");
  const liveStatus = document.getElementById("workspace-live-status");
  const taskTotal = document.getElementById("workspace-task-total");
  const taskDelta = document.getElementById("workspace-task-delta");
  const liveBody = document.getElementById("live-activity-body");
  const integrationsGrid = document.getElementById("integrations-grid");

  if (heading) {
    heading.textContent = `${data.user.company} Workspace`;
  }
  if (subcopy) {
    subcopy.textContent = `${data.user.name} is currently overseeing ${data.tasks.length} operational streams across your connected tools.`;
  }
  if (liveStatus) {
    liveStatus.textContent = data.tasks[0]?.text || "No active automation queue.";
  }
  if (taskTotal) {
    taskTotal.textContent = String(data.transcriptPreview.length + data.tasks.length * 12);
  }
  if (taskDelta) {
    taskDelta.textContent = `Synced ${formatShortTime(new Date().toISOString())}`;
  }
  if (liveBody) {
    liveBody.innerHTML = data.tasks
      .map(
        (task) => `
          <tr class="hover:bg-white/5 transition-colors group">
            <td class="px-4 py-4 text-on-surface">${task.text}</td>
            <td class="px-4 py-4 text-on-surface-variant">${task.source}</td>
            <td class="px-4 py-4 text-right">${statusPill(task.status)}</td>
          </tr>
        `,
      )
      .join("");
  }
  if (integrationsGrid) {
    const cards = data.integrations.map((item) => {
      const color = integrationColor(item.id);
      return `
        <div class="p-6 rounded-lg bg-white/5 border border-outline-variant hover:border-primary-container transition-all group">
          <div class="flex items-center gap-3 mb-4">
            <div class="w-10 h-10 rounded flex items-center justify-center" style="background:${color}33;color:${color};">
              <span class="material-symbols-outlined">${
                item.id === "shopify"
                  ? "shopping_cart"
                  : item.id === "salesforce"
                    ? "groups"
                    : "chat"
              }</span>
            </div>
            <div>
              <h3 class="text-label-md font-label-md text-white">${item.label}</h3>
              <p class="text-[10px] text-primary uppercase font-bold tracking-tighter">${item.status}</p>
            </div>
          </div>
          <p class="text-label-sm font-label-sm text-on-surface-variant mb-4">${
            item.id === "shopify"
              ? "Managing orders and inventory sync."
              : item.id === "salesforce"
                ? "Automating lead and record updates."
                : "Drafting customer support replies."
          }</p>
          <div class="flex justify-between items-center text-label-sm font-label-sm">
            <span class="text-on-surface-variant">${
              item.id === "intercom" ? "24/7 Monitoring" : "Active Sync"
            }</span>
            <span class="material-symbols-outlined text-on-surface-variant group-hover:translate-x-1 transition-transform">arrow_forward</span>
          </div>
        </div>
      `;
    });

    cards.push(`
      <div class="p-6 rounded-lg border-2 border-dashed border-outline-variant hover:border-primary-container/50 flex flex-col items-center justify-center cursor-pointer transition-all group">
        <span class="material-symbols-outlined text-3xl text-on-surface-variant group-hover:text-primary transition-colors">add_link</span>
        <p class="text-label-sm font-label-sm text-on-surface-variant mt-2">Add Integration</p>
      </div>
    `);

    integrationsGrid.innerHTML = cards.join("");
  }
}

async function bootstrapWorkspaceOperations() {
  ensureWorkspaceOpsShell();
  try {
    const [overview, drafts, actionLogs, messages, orders, leads, tasks, attentionSummary] = await Promise.all([
      getJson("/api/business/overview"),
      getJson("/api/drafts"),
      getJson("/api/action-logs"),
      getJson("/api/messages"),
      getJson("/api/orders?pendingOnly=true"),
      getJson("/api/leads"),
      getJson("/api/tasks"),
      getJson("/api/attention/today"),
    ]);
    renderWorkspaceOperations({
      actionLogs: actionLogs?.actionLogs || [],
      drafts: drafts?.drafts || [],
      leads: leads?.leads || [],
      messages: messages?.messages || [],
      orders: orders?.orders || [],
      overview: overview?.overview || {},
      tasks: tasks?.tasks || [],
      attentionSummary,
    });
  } catch (error) {
    renderWorkspaceOperationsError(error);
  }
}

bootstrapWorkspace().catch((error) => {
  console.error(error);
});

bootstrapWorkspaceOperations().catch((error) => {
  console.error(error);
  renderWorkspaceOperationsError(error);
});
