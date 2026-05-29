import { fetchCachedJson, formatShortTime } from "./client-cache.js";

function renderEntries(entries, query = "") {
  const filter = query.trim().toLowerCase();
  return entries
    .filter((entry) => !filter || entry.text.toLowerCase().includes(filter))
    .slice()
    .reverse()
    .map((entry) => {
      const icon =
        entry.role === "assistant"
          ? "chat_bubble"
          : entry.role === "user"
            ? "mic"
            : "task_alt";
      const badge =
        entry.role === "assistant"
          ? '<span class="badge badge-info">Assistant</span>'
          : '<span class="badge badge-neutral">Voice</span>';

      return `
        <div class="card-glass flex items-start gap-6 transition-all hover:bg-white/[0.02]">
          <div class="w-12 h-12 rounded-full glass-panel flex items-center justify-center shrink-0 border-primary-container/20">
            <span class="material-symbols-outlined text-primary-fixed-dim">${icon}</span>
          </div>
          <div class="flex-1">
            <div class="flex justify-between items-center mb-2">
              <h4 class="font-bold text-on-surface">${
                entry.role === "assistant" ? "Amanda Response" : "Voice Request"
              }</h4>
              <span class="text-label-sm font-label-sm text-on-surface-variant/40">${formatShortTime(
                entry.timestamp,
              )}</span>
            </div>
            <p class="text-on-surface-variant text-body-md mb-4">${entry.text}</p>
            <div class="flex gap-2">${badge}</div>
          </div>
        </div>
      `;
    })
    .join("");
}

async function bootstrapTranscript() {
  const data = await fetchCachedJson("/api/transcripts", {
    cacheKey: "transcripts",
    ttlMs: 30_000,
  });
  if (!data) return;

  const list = document.getElementById("transcript-feed");
  const search = document.getElementById("transcript-search");
  const voiceCount = document.getElementById("voice-events-count");
  const textCount = document.getElementById("text-threads-count");
  const decisionTitle = document.getElementById("decision-title");
  const decisionBody = document.getElementById("decision-body");

  const userEntries = data.entries.filter((entry) => entry.role === "user");
  const assistantEntries = data.entries.filter((entry) => entry.role === "assistant");
  const latestAssistant = assistantEntries[assistantEntries.length - 1];

  if (voiceCount) voiceCount.textContent = String(userEntries.length);
  if (textCount) textCount.textContent = String(assistantEntries.length);
  if (decisionTitle && latestAssistant) decisionTitle.textContent = "Latest Amanda Recommendation";
  if (decisionBody && latestAssistant) decisionBody.textContent = latestAssistant.text;

  const draw = () => {
    if (list) {
      list.innerHTML = renderEntries(data.entries, search?.value || "");
    }
  };

  search?.addEventListener("input", draw);
  draw();
}

bootstrapTranscript().catch((error) => {
  console.error(error);
});
