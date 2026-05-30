import {
  clearCacheGroup,
  fetchCachedJson,
  formatShortTime,
  postJson,
} from "./client-cache.js";

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const synth = window.speechSynthesis;

const body = document.getElementById("main-body");
const container = document.getElementById("particle-container");
const stateBadge = document.getElementById("voice-state-badge");
const statusHeading = document.getElementById("voice-status-heading");
const statusSubline = document.getElementById("voice-status-subline");
const workspaceLabel = document.getElementById("voice-workspace");
const taskStrip = document.getElementById("voice-task-strip");
const transcriptShell = document.getElementById("voice-transcript-shell");
const userBubble = document.getElementById("voice-user-text");
const assistantBubble = document.getElementById("voice-assistant-text");
const micButton = document.getElementById("mic-btn");
const micIcon = document.getElementById("mic-icon");
const muteButton = document.getElementById("mute-btn");
const transcriptButton = document.getElementById("transcript-btn");
const transcriptDrawer = document.getElementById("voice-transcript-drawer");
const transcriptList = document.getElementById("voice-transcript-list");
let availableVoices = [];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const appState = {
  finalTranscript: "",
  immersive: false,
  interimTranscript: "",
  isMuted: false,
  isRecording: false,
  recognition: null,
  settings: {
    voice: "Lumina Female",
  },
  tasks: [],
  transcriptEntries: [],
  transcriptOpen: false,
  ttsProvider: "webspeech",
  user: null,
};

const labels = {
  executing: "Working",
  error: "Error",
  idle: "Idle",
  listening: "Listening",
  paused: "Paused",
  speaking: "Responding",
  thinking: "Thinking",
};

let mode = "idle";
let autoListenEnabled = false;
let isAmandaSpeaking = false;
let isThinking = false;
let lastRecognitionError = "";
let lastSentAt = 0;
let lastSentTranscript = "";
let manuallyStopped = false;
let restartTimer = null;
let thinkingTimer1 = null;
let thinkingTimer2 = null;
let voiceSessionActive = false;

// Debug tracking
let debugData = {
  requestId: "",
  rawTranscript: "",
  cleanedTranscript: "",
  lastSentTime: "",
  voiceState: "idle",
  isFinal: false,
  intent: "",
  confidence: "",
  routedTo: "",
  usedFollowupContext: false,
  pendingClarification: "",
  calendarParser: "",
  gmailDebug: "",
  approvalAction: "",
  approvalId: "",
  backendReply: "",
  brain: "",
  inputSource: "voice",
  recognitionCount: 0,
  safetyDecision: "",
  duplicateBlocked: false,
  ignoredBecauseSpeaking: false,
  // latency
  requestStartedAt: 0,
  responseReceivedAt: 0,
  backendLatencyMs: 0,
  ttsRequestStartedAt: 0,
  ttsAudioReceivedAt: 0,
  ttsLatencyMs: 0,
  speechStartedAt: 0,
  speechEndedAt: 0,
  speechDurationMs: 0,
  totalTurnLatencyMs: 0,
  // tts
  ttsProvider: "",
  ttsFallbackUsed: false,
  voiceName: "",
};

const isDebugEnabled = () => {
  const isDev = document.body.dataset.nodeEnv === "development";
  const isDebugMode = document.body.dataset.debugVoice === "true";
  return isDev || isDebugMode;
};

function syncDebugVisibility() {
  const debugToggle = document.getElementById("voice-debug-toggle");
  if (isDebugEnabled()) {
    debugToggle?.classList.remove("hidden");
    updateDebugPanel();
    return;
  }
  debugToggle?.classList.add("hidden");
  document.getElementById("voice-debug-panel")?.classList.add("hidden");
}

function hasActiveClarification() {
  const value = String(debugData.pendingClarification || "").trim();
  return Boolean(value && value !== "-" && value !== "—" && value !== "—");
}

function isFillerOnly(transcript) {
  const clean = String(transcript || "").trim().toLowerCase().replace(/[.!?]+$/g, "");
  if (!clean) return true;
  if (/^(uh|um|hm|hmm)$/.test(clean)) return true;
  if (/^(okay|yeah|yes|no)$/.test(clean) && !hasActiveClarification()) return true;
  return false;
}

function normalizeVoiceTranscript(transcript) {
  return String(transcript || "")
    .replace(/\bdraught\b/gi, "draft")
    .replace(/\s+/g, " ")
    .trim();
}

function debugSnapshot() {
  return {
    // request identity
    requestId: debugData.requestId || "",
    rawTranscript: debugData.rawTranscript || "",
    cleanTranscript: debugData.cleanedTranscript || "",
    voiceState: debugData.voiceState || mode,
    finalResult: Boolean(debugData.isFinal),
    // safety flags
    inputSource: debugData.inputSource || "voice",
    duplicateBlocked: Boolean(debugData.duplicateBlocked),
    ignoredBecauseSpeaking: Boolean(debugData.ignoredBecauseSpeaking),
    // routing
    intent: debugData.intent || "",
    confidence: debugData.confidence || "",
    routedTo: debugData.routedTo || "",
    brain: debugData.brain || "",
    safetyDecision: debugData.safetyDecision || "",
    usedFollowUpContext: Boolean(debugData.usedFollowupContext),
    pendingClarification: debugData.pendingClarification || "",
    // context
    calendarParser: debugData.calendarParser || "",
    gmailDebug: debugData.gmailDebug || "",
    approvalAction: debugData.approvalAction || "",
    approvalId: debugData.approvalId || "",
    backendReply: debugData.backendReply || "",
    // latency
    backendLatencyMs: debugData.backendLatencyMs || 0,
    ttsProvider: debugData.ttsProvider || "",
    ttsFallbackUsed: Boolean(debugData.ttsFallbackUsed),
    ttsLatencyMs: debugData.ttsLatencyMs || 0,
    speechDurationMs: debugData.speechDurationMs || 0,
    totalTurnLatencyMs: debugData.totalTurnLatencyMs || 0,
    voiceName: debugData.voiceName || "",
  };
}

function setMode(nextMode, line) {
  mode = nextMode;
  debugData.voiceState = nextMode;
  if (stateBadge) stateBadge.textContent = labels[nextMode] || "Idle";
  if (statusHeading) {
    statusHeading.textContent =
      nextMode === "listening"
        ? "Listening..."
        : nextMode === "thinking"
          ? "Thinking..."
          : nextMode === "speaking"
            ? "Amanda is speaking..."
            : nextMode === "executing"
              ? "Working..."
              : nextMode === "paused"
                ? "Voice paused"
                : nextMode === "error"
                  ? "Voice error"
                  : "Ready";
  }
  if (statusSubline) {
    statusSubline.textContent =
      line ||
      (nextMode === "idle"
        ? "Tell Amanda what you want done"
        : nextMode === "listening"
          ? "Ready. Speak now."
          : nextMode === "thinking"
            ? "Understanding your request and planning the workflow."
            : nextMode === "speaking"
              ? "Amanda is replying. Listening will resume after she finishes."
              : nextMode === "paused"
                ? "Tap the microphone to resume the continuous voice session."
                : nextMode === "error"
                  ? "Check microphone permissions and try again."
                  : "Coordinating the requested business workflow.");
  }
  if (stateBadge) {
    stateBadge.parentElement?.classList.toggle("bg-primary/5", nextMode !== "idle");
  }
  updateDebugPanel();
}

function updateDebugPanel() {
  if (!isDebugEnabled()) return;

  const panel = document.getElementById("voice-debug-panel");
  if (!panel) return;

  const update = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value ?? "—");
  };

  const updateHtml = (id, html) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  };

  update("debug-request-id", debugData.requestId || "—");
  update("debug-raw-transcript", debugData.rawTranscript || "—");
  update("debug-cleaned-transcript", debugData.cleanedTranscript || "—");
  update("debug-last-sent-time", debugData.lastSentTime || "—");
  update("debug-voice-state", debugData.voiceState);
  update("debug-final-result", debugData.isFinal);
  update("debug-recognition-count", debugData.recognitionCount);
  update("debug-input-source", debugData.inputSource || "voice");
  update("debug-duplicate-blocked", debugData.duplicateBlocked ? "YES" : "false");
  update("debug-ignored-speaking", debugData.ignoredBecauseSpeaking ? "YES" : "false");
  update("debug-intent", debugData.intent || "—");
  update("debug-confidence", debugData.confidence ? `${Math.round(Number(debugData.confidence) * 100)}%` : "—");
  update("debug-routed-to", debugData.routedTo || "—");
  update("debug-brain", debugData.brain || "—");
  update("debug-safety-decision", debugData.safetyDecision || "—");
  update("debug-used-followup", debugData.usedFollowupContext ? "YES" : "false");
  update("debug-pending-clarification", debugData.pendingClarification || "—");

  const calendarHtml = debugData.calendarParser
    ? debugData.calendarParser
      .split("\n")
      .map((line) => `<div>${escapeHtml(line)}</div>`)
      .join("")
    : "—";
  updateHtml("debug-calendar-parser", calendarHtml);

  const gmailHtml = debugData.gmailDebug
    ? debugData.gmailDebug
      .split("\n")
      .map((line) => `<div>${escapeHtml(line)}</div>`)
      .join("")
    : "—";
  updateHtml("debug-gmail", gmailHtml);

  update("debug-approval-action", debugData.approvalAction || "—");
  update("debug-approval-id", debugData.approvalId || "—");
  update("debug-backend-reply", debugData.backendReply || "—");

  // Latency
  update("debug-backend-latency", debugData.backendLatencyMs ? `${debugData.backendLatencyMs}ms` : "—");
  update("debug-tts-provider", debugData.ttsProvider || "—");
  update("debug-tts-fallback", debugData.ttsFallbackUsed ? "YES" : "false");
  update("debug-tts-latency", debugData.ttsLatencyMs ? `${debugData.ttsLatencyMs}ms` : "—");
  update("debug-speech-duration", debugData.speechDurationMs ? `${debugData.speechDurationMs}ms` : "—");
  update("debug-total-latency", debugData.totalTurnLatencyMs ? `${debugData.totalTurnLatencyMs}ms` : "—");
  update("debug-voice-name", debugData.voiceName || "—");
}

function renderTasks() {
  if (!taskStrip) return;
  taskStrip.innerHTML = appState.tasks.length
    ? appState.tasks
      .slice(0, 3)
      .map(
        (task, index) => `
            <div class="${index === 0 ? "" : index === 1 ? "opacity-40 " : "opacity-20 "}glass-panel px-4 py-2 rounded-full flex items-center gap-3">
              ${index === 0
            ? '<span class="material-symbols-outlined text-primary-fixed-dim text-[16px] animate-spin">refresh</span>'
            : ""
          }
              <span class="text-label-sm font-label-sm text-on-surface-variant">${escapeHtml(task.text)}</span>
            </div>
          `,
      )
      .join("")
    : `
        <div class="glass-panel px-4 py-2 rounded-full flex items-center gap-3">
          <span class="material-symbols-outlined text-primary-fixed-dim text-[16px]">hub</span>
          <span class="text-label-sm font-label-sm text-on-surface-variant">Waiting for the next instruction...</span>
        </div>
      `;
}

function renderTranscriptPreview() {
  const userEntries = appState.transcriptEntries.filter((entry) => entry.role === "user");
  const assistantEntries = appState.transcriptEntries.filter(
    (entry) => entry.role === "assistant",
  );
  const latestUser = userEntries[userEntries.length - 1];
  const latestAssistant = assistantEntries[assistantEntries.length - 1];

  if (userBubble) {
    userBubble.textContent = latestUser
      ? `"${latestUser.text}"`
      : '"Check today\'s customer messages and show me the important ones."';
  }
  if (assistantBubble) {
    assistantBubble.textContent = latestAssistant
      ? `"${latestAssistant.text}"`
      : '"I\'ll review your customer messages, identify urgent conversations, and prepare suggested replies."';
  }
}

function renderTranscriptDrawer() {
  if (!transcriptDrawer || !transcriptList) return;
  transcriptDrawer.classList.toggle("hidden", !appState.transcriptOpen);
  transcriptButton?.classList.toggle("text-primary", appState.transcriptOpen);
  transcriptList.innerHTML = appState.transcriptEntries
    .slice()
    .reverse()
    .map(
      (entry) => `
        <article class="glass-panel rounded-xl p-4 flex items-start gap-4">
          <div class="w-9 h-9 rounded-full bg-primary-container/10 border border-primary-container/20 flex items-center justify-center">
            <span class="material-symbols-outlined text-primary-fixed-dim">${entry.role === "assistant" ? "chat_bubble" : "mic"
        }</span>
          </div>
          <div class="flex-1">
            <div class="flex items-center justify-between gap-4">
              <strong class="text-sm">${entry.role === "assistant" ? "Amanda" : "You"}</strong>
              <time class="text-xs text-on-surface-variant/60">${formatShortTime(entry.timestamp)}</time>
            </div>
            <p class="text-sm text-on-surface-variant mt-2">${escapeHtml(entry.text)}</p>
            ${renderEntryMeta(entry)}
          </div>
        </article>
      `,
    )
    .join("");
}

function renderEntryMeta(entry) {
  const meta = entry.agentMeta;
  if (!meta) return "";
  const chips = [];
  if (meta.intent) chips.push(`Intent: ${meta.intent}`);
  if (Number.isFinite(Number(meta.confidence))) {
    chips.push(`${Math.round(Number(meta.confidence) * 100)}% confidence`);
  }
  if (meta.actionCount) chips.push(`${meta.actionCount} action${meta.actionCount === 1 ? "" : "s"}`);
  if (meta.draftCount) chips.push(`${meta.draftCount} draft${meta.draftCount === 1 ? "" : "s"}`);
  if (meta.needsApprovalCount) {
    chips.push(`${meta.needsApprovalCount} needs approval`);
  }
  if (meta.taskCount) chips.push(`${meta.taskCount} task${meta.taskCount === 1 ? "" : "s"}`);
  if (!chips.length) return "";
  return `
    <div class="flex flex-wrap gap-2 mt-3">
      ${chips
      .map(
        (chip) => `
            <span class="badge ${chip.includes("needs approval") ? "badge-warning" : "badge-neutral"}">${escapeHtml(chip)}</span>
          `,
      )
      .join("")}
    </div>
  `;
}

function scoreVoice(voice) {
  const name = `${voice.name || ""} ${voice.voiceURI || ""}`.toLowerCase();
  const lang = (voice.lang || "").toLowerCase();
  let score = 0;

  if (lang.startsWith("en-us")) score += 4;
  else if (lang.startsWith("en")) score += 2;

  if (name.includes("natural")) score += 5;
  if (name.includes("online")) score += 4;
  if (name.includes("neural")) score += 4;
  if (name.includes("enhanced")) score += 3;
  if (name.includes("google")) score += 3;
  if (name.includes("microsoft")) score += 2;

  const femaleNames = [
    "female", "woman", "aria", "jenny", "sonia", "sara", "samantha",
    "victoria", "natasha", "libby", "michelle", "emma", "olivia", "ava",
    "amy", "luna", "zira",
  ];
  if (femaleNames.some((n) => name.includes(n))) score += 3;

  if (voice.default) score += 1;
  return score;
}

function chooseBestVoice() {
  const voices = availableVoices.length ? availableVoices : synth?.getVoices?.() || [];
  if (!voices.length) return null;
  return voices
    .slice()
    .sort((a, b) => scoreVoice(b) - scoreVoice(a))[0] || null;
}

function primeVoices() {
  if (!synth) return;
  const loaded = synth.getVoices?.() || [];
  if (loaded.length) availableVoices = loaded;
}

function shouldAutoRestartListening() {
  return (
    voiceSessionActive &&
    autoListenEnabled &&
    !manuallyStopped &&
    !isThinking &&
    !isAmandaSpeaking &&
    mode !== "error"
  );
}

function clearRestartTimer() {
  if (restartTimer) {
    window.clearTimeout(restartTimer);
    restartTimer = null;
  }
}

function restartListeningSoon(delay = 700) {
  clearRestartTimer();
  if (!shouldAutoRestartListening()) return;
  restartTimer = window.setTimeout(() => {
    restartTimer = null;
    if (shouldAutoRestartListening()) startRecognition();
  }, delay);
}

function startThinkingFeedback() {
  clearThinkingFeedback();
  thinkingTimer1 = window.setTimeout(() => {
    if (mode === "thinking" && statusSubline) {
      statusSubline.textContent = "Amanda is preparing a response...";
    }
  }, 1000);
  thinkingTimer2 = window.setTimeout(() => {
    if (mode === "thinking" && statusSubline) {
      statusSubline.textContent = "Still working on it...";
    }
  }, 5000);
}

function clearThinkingFeedback() {
  if (thinkingTimer1) { window.clearTimeout(thinkingTimer1); thinkingTimer1 = null; }
  if (thinkingTimer2) { window.clearTimeout(thinkingTimer2); thinkingTimer2 = null; }
}

// Play a Blob of audio/mpeg and resolve when done. Falls back to Web Speech on error.
function playAudioBlob(blob, fallbackText) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);

    let settled = false;
    const finish = (withFallback = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(failsafe);
      URL.revokeObjectURL(url);
      if (withFallback && fallbackText) {
        debugData.ttsFallbackUsed = true;
        speakFallback(fallbackText).then(resolve);
      } else {
        resolve();
      }
    };

    const failsafe = setTimeout(() => finish(), 30000);
    audio.onended = () => finish();
    audio.onerror = () => finish(true);
    audio.play().catch(() => finish(true));
  });
}

// Web Speech fallback
async function speakFallback(text) {
  if (!synth || !text) return;
  synth.cancel();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(failsafe);
      resolve();
    };

    const estimatedMs = Math.min(30000, Math.max(5000, String(text).length * 55));
    const failsafe = setTimeout(() => {
      try { synth.cancel(); } catch { /* ignore */ }
      finish();
    }, estimatedMs);

    const utterance = new SpeechSynthesisUtterance(text);
    const chosen = chooseBestVoice();
    if (chosen) {
      utterance.voice = chosen;
      debugData.voiceName = chosen.name;
    } else {
      debugData.voiceName = "browser default";
    }
    utterance.rate = 0.95;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    utterance.onend = finish;
    utterance.onerror = finish;
    synth.speak(utterance);

    setTimeout(() => {
      try { if (synth.paused) synth.resume(); } catch { /* ignore */ }
    }, 250);
  });
}

// Try backend TTS (ElevenLabs) then fallback to Web Speech
async function speakWithProvider(text) {
  const ttsStart = Date.now();
  debugData.ttsRequestStartedAt = ttsStart;
  debugData.ttsFallbackUsed = false;
  debugData.ttsProvider = appState.ttsProvider || "webspeech";

  // Skip backend call when provider is webspeech — no round-trip needed
  if (appState.ttsProvider !== "elevenlabs") {
    debugData.ttsProvider = "webspeech";
    debugData.ttsFallbackUsed = false;
    await speakFallback(text);
    return;
  }

  try {
    const controller = new AbortController();
    const ttsTimeout = setTimeout(() => controller.abort(), 12000);
    let ttsResponse;
    try {
      ttsResponse = await fetch("/api/tts/speak", {
        body: JSON.stringify({ text }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(ttsTimeout);
    }

    const contentType = ttsResponse.headers.get("content-type") || "";
    if (ttsResponse.ok && contentType.includes("audio/mpeg")) {
      debugData.ttsProvider = "elevenlabs";
      debugData.ttsAudioReceivedAt = Date.now();
      debugData.ttsLatencyMs = debugData.ttsAudioReceivedAt - ttsStart;
      debugData.voiceName = "ElevenLabs";
      const blob = await ttsResponse.blob();
      await playAudioBlob(blob, text);
      return;
    }
    // Backend returned fallback JSON (not_configured / error)
    debugData.ttsFallbackUsed = true;
    debugData.ttsProvider = "elevenlabs";
  } catch {
    debugData.ttsFallbackUsed = true;
    debugData.ttsProvider = "elevenlabs";
  }

  await speakFallback(text);
}

// Main speak orchestrator
async function speak(text) {
  if (!text?.trim()) return;
  if (appState.isMuted) return;

  isAmandaSpeaking = true;
  setMode("speaking");
  debugData.speechStartedAt = Date.now();

  try {
    await speakWithProvider(text);
  } finally {
    isAmandaSpeaking = false;
    const now = Date.now();
    debugData.speechEndedAt = now;
    debugData.speechDurationMs = now - (debugData.speechStartedAt || now);
    if (debugData.requestStartedAt) {
      debugData.totalTurnLatencyMs = now - debugData.requestStartedAt;
    }
    updateDebugPanel();
  }
}

// Shared entry point for both speech and keyboard input.
async function sendAmandaCommand(transcript, source = "voice") {
  const cleanTranscript = normalizeVoiceTranscript(transcript);
  if (!cleanTranscript) return;

  // Filler-only filtering only applies to voice (mic) — not typed commands
  if (source === "voice" && isFillerOnly(cleanTranscript)) {
    debugData.rawTranscript = transcript;
    debugData.cleanedTranscript = cleanTranscript;
    debugData.duplicateBlocked = false;
    debugData.inputSource = source;
    updateDebugPanel();
    setMode("listening", "I heard a little noise. Listening again...");
    restartListeningSoon(700);
    return;
  }

  const now = Date.now();
  if (
    cleanTranscript.toLowerCase() === lastSentTranscript.toLowerCase() &&
    now - lastSentAt < 5000
  ) {
    debugData.rawTranscript = transcript;
    debugData.cleanedTranscript = cleanTranscript;
    debugData.duplicateBlocked = true;
    debugData.ignoredBecauseSpeaking = false;
    debugData.inputSource = source;
    updateDebugPanel();
    if (source === "keyboard") {
      setMode(mode, "That command was just sent. Give Amanda a moment.");
    } else {
      setMode("listening", "Already handling that request. Listening again...");
      restartListeningSoon(700);
    }
    return;
  }

  debugData.duplicateBlocked = false;
  debugData.ignoredBecauseSpeaking = false;
  debugData.inputSource = source;
  lastSentTranscript = cleanTranscript;
  lastSentAt = now;
  isThinking = true;
  setMode("thinking");
  startThinkingFeedback();

  debugData.requestId = `voice_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  debugData.requestStartedAt = Date.now();
  debugData.rawTranscript = transcript;
  debugData.cleanedTranscript = cleanTranscript;
  debugData.lastSentTime = new Date().toLocaleTimeString();
  debugData.isFinal = true;
  debugData.backendLatencyMs = 0;
  debugData.ttsLatencyMs = 0;
  debugData.speechDurationMs = 0;
  debugData.totalTurnLatencyMs = 0;
  updateDebugPanel();

  try {
    const result = await postJson("/api/voice/respond", {
      transcript: cleanTranscript,
      requestId: debugData.requestId,
    });
    clearThinkingFeedback();

    if (!result) return;

    debugData.responseReceivedAt = Date.now();
    debugData.backendLatencyMs = debugData.responseReceivedAt - debugData.requestStartedAt;

    if (result.requestId) debugData.requestId = result.requestId;
    if (result.agent) {
      debugData.intent = result.agent.intent || "";
      debugData.confidence = result.agent.confidence || "";
      debugData.routedTo = result.agent.routedTo || "";
      debugData.brain = result.agent.brain || "";
      debugData.safetyDecision = result.agent.safetyDecision || "";
      debugData.usedFollowupContext = result.agent.usedFollowUpContext || false;
      debugData.pendingClarification = result.agent.pendingClarification
        ? JSON.stringify(result.agent.pendingClarification, null, 2)
        : "";
    }

    debugData.calendarParser = "";
    debugData.gmailDebug = "";
    debugData.approvalAction = "";
    debugData.approvalId = "";
    if (result.agent?.calendarParser) {
      const cp = result.agent.calendarParser;
      const lines = [];
      if (result.agent.followUpType || cp.followUpType) {
        lines.push(`follow-up: ${result.agent.followUpType || cp.followUpType}`);
      }
      if (cp.title) lines.push(`title: ${cp.title}`);
      if (cp.dateText) lines.push(`date: ${cp.dateText}`);
      if (cp.timeText) lines.push(`time: ${cp.timeText}`);
      if (cp.location) lines.push(`location: ${cp.location}`);
      if (cp.start) lines.push(`start: ${cp.start}`);
      if (cp.end) lines.push(`end: ${cp.end}`);
      if (cp.durationMinutes) lines.push(`duration: ${cp.durationMinutes} minutes`);
      if (cp.missingFields?.length) lines.push(`missing: ${cp.missingFields.join(", ")}`);
      debugData.calendarParser = lines.join("\n") || "—";
    }

    if (result.agent?.approval) {
      debugData.approvalAction = result.agent.approval.action || "—";
      debugData.approvalId = result.agent.approval.id || "—";
    }

    if (result.agent?.gmail) {
      const gmail = result.agent.gmail;
      const lines = [];
      if (Number.isFinite(Number(gmail.syncedMessagesCount))) lines.push(`synced: ${gmail.syncedMessagesCount}`);
      if (Number.isFinite(Number(gmail.importantCandidatesCount))) lines.push(`important: ${gmail.importantCandidatesCount}`);
      if (Number.isFinite(Number(gmail.draftableMessagesCount))) lines.push(`draftable: ${gmail.draftableMessagesCount}`);
      if (Number.isFinite(Number(gmail.draftsCreated))) lines.push(`drafts: ${gmail.draftsCreated}`);
      if (Number.isFinite(Number(gmail.approvalRequestsCreated))) lines.push(`approvals: ${gmail.approvalRequestsCreated}`);
      if (gmail.routedTo) lines.push(`tool: ${gmail.routedTo}`);
      if (gmail.query) lines.push(`query: ${gmail.query}`);
      debugData.gmailDebug = lines.join("\n") || "—";
    }

    // Normalize reply — handle different backend shapes safely
    const reply =
      String(result.reply || result.spokenReply || result.message || "").trim() ||
      "I could not generate a reply for that. Please try again.";
    debugData.backendReply = reply;

    if (isDebugEnabled()) {
      console.log(`[VOICE DEBUG] requestId="${debugData.requestId}" transcript="${cleanTranscript}" intent="${debugData.intent}" confidence=${debugData.confidence} routedTo="${debugData.routedTo}" backendLatency=${debugData.backendLatencyMs}ms followUp=${debugData.usedFollowupContext} state="${mode}"`);
    }

    updateDebugPanel();
    clearCacheGroup(["bootstrap", "transcripts"]);
    appState.tasks = result.tasks || [];
    const transcriptEntries = result.transcript || [];
    const assistantEntry = transcriptEntries.findLast?.((entry) => entry.role === "assistant")
      || transcriptEntries.filter((entry) => entry.role === "assistant").pop();
    if (assistantEntry) {
      assistantEntry.agentMeta = {
        actionCount: result.actions?.length || 0,
        confidence: result.agent?.confidence,
        draftCount: result.drafts?.length || 0,
        intent: result.agent?.intent,
        needsApprovalCount: result.needsApproval?.length || 0,
        taskCount: result.tasks?.length || 0,
      };
    }
    appState.transcriptEntries.push(...transcriptEntries);
    renderTasks();
    renderTranscriptPreview();
    renderTranscriptDrawer();
    setMode("speaking");
    await speak(reply);
    setMode(
      shouldAutoRestartListening() ? "listening" : "executing",
      shouldAutoRestartListening()
        ? "Ready for your next request."
        : "Amanda finished the reply.",
    );
  } catch (error) {
    clearThinkingFeedback();
    const message = error?.message || "";
    if (message.includes("401") || message.includes("Unauthorized")) {
      setMode("error", "Session expired. Please log in again.");
    } else if (message.includes("500") || message.includes("502")) {
      setMode("error", "Amanda's server returned an error. Please try again.");
    } else if (message.includes("Failed to fetch") || message.includes("NetworkError")) {
      setMode("error", "Network error. Check your connection and try again.");
    } else {
      setMode("error", message || "Unable to reach Amanda right now.");
    }
  } finally {
    isThinking = false;
    if (shouldAutoRestartListening()) {
      restartListeningSoon(600);
    } else if (voiceSessionActive && !manuallyStopped && mode !== "error") {
      setMode("paused");
    } else if (!voiceSessionActive) {
      setMode("idle");
    }
  }
}

function stopVoiceSession({ cancelSpeech = false } = {}) {
  clearRestartTimer();
  clearThinkingFeedback();
  manuallyStopped = true;
  voiceSessionActive = false;
  autoListenEnabled = false;
  isThinking = false;
  appState.isRecording = false;
  appState.finalTranscript = "";
  appState.interimTranscript = "";
  if (micIcon) micIcon.textContent = "mic";
  try {
    appState.recognition?.abort?.();
  } catch {
    appState.recognition?.stop?.();
  }
  if (cancelSpeech) {
    synth?.cancel?.();
    isAmandaSpeaking = false;
  }
  setMode("paused", "Voice paused. Tap the microphone to resume.");
}

function startRecognition() {
  if (!Recognition) {
    setMode("error", "Speech recognition is not supported in this browser. Please use Chrome.");
    return;
  }
  if (appState.isRecording || isThinking || isAmandaSpeaking) return;

  if (!appState.recognition) {
    const recognition = new Recognition();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onstart = () => {
      appState.isRecording = true;
      appState.finalTranscript = "";
      appState.interimTranscript = "";
      setMode("listening");
      if (micIcon) micIcon.textContent = "graphic_eq";
    };

    recognition.onresult = (event) => {
      if (isAmandaSpeaking || mode === "speaking") {
        debugData.ignoredBecauseSpeaking = true;
        updateDebugPanel();
        return;
      }
      debugData.ignoredBecauseSpeaking = false;
      debugData.recognitionCount = event.results.length;
      let finalTranscript = "";
      let interimTranscript = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) finalTranscript += result[0].transcript;
        else interimTranscript += result[0].transcript;
      }
      appState.interimTranscript = interimTranscript;
      if (userBubble && appState.interimTranscript) {
        userBubble.textContent = `"${appState.interimTranscript.trim()}"`;
      }
      if (finalTranscript.trim()) {
        const combinedTranscript = `${appState.finalTranscript} ${finalTranscript.trim()}`
          .replace(/\s+/g, " ")
          .trim();
        debugData.rawTranscript = combinedTranscript;
        debugData.isFinal = true;
        appState.finalTranscript = combinedTranscript;
        appState.interimTranscript = "";
        if (userBubble) userBubble.textContent = `"${appState.finalTranscript}"`;
        updateDebugPanel();
      }
    };

    recognition.onend = async () => {
      appState.isRecording = false;
      if (micIcon) micIcon.textContent = voiceSessionActive ? "graphic_eq" : "mic";
      if (isAmandaSpeaking || mode === "speaking") {
        appState.finalTranscript = "";
        appState.interimTranscript = "";
        return;
      }
      const transcript = appState.finalTranscript.trim();
      if (manuallyStopped || !voiceSessionActive) {
        if (!transcript) setMode("paused");
        return;
      }
      if (transcript) {
        appState.finalTranscript = "";
        appState.interimTranscript = "";
        await sendAmandaCommand(transcript, "voice");
      } else {
        setMode("listening", "I didn't catch that. Listening again...");
        restartListeningSoon(700);
      }
    };

    recognition.onerror = (event) => {
      appState.isRecording = false;
      if (micIcon) micIcon.textContent = "mic";
      lastRecognitionError = event?.error || "unknown";
      if (lastRecognitionError === "no-speech") {
        setMode("listening", "I didn't catch that. Listening again...");
        restartListeningSoon(600);
        return;
      }
      if (lastRecognitionError === "aborted" && manuallyStopped) return;
      if (lastRecognitionError === "not-allowed") {
        voiceSessionActive = false;
        autoListenEnabled = false;
        setMode("error", "Microphone permission is blocked. Please allow mic access in your browser settings.");
        return;
      }
      if (lastRecognitionError === "audio-capture") {
        voiceSessionActive = false;
        autoListenEnabled = false;
        setMode("error", "No microphone detected.");
        return;
      }
      if (shouldAutoRestartListening()) {
        setMode("listening", "Voice capture paused for a moment. Listening again...");
        restartListeningSoon(700);
      } else {
        setMode("error", "Microphone access failed. Please allow microphone permission.");
      }
    };

    appState.recognition = recognition;
  }

  manuallyStopped = false;
  try {
    appState.recognition.start();
  } catch {
    restartListeningSoon(500);
  }
}

function startVoiceSession() {
  manuallyStopped = false;
  voiceSessionActive = true;
  autoListenEnabled = true;
  enterImmersiveMode();
  startRecognition();
}

function enterImmersiveMode() {
  appState.immersive = true;
  body?.classList.add("immersive-mode");
  if (document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => { });
  }
}

function exitImmersiveMode() {
  appState.immersive = false;
  body?.classList.remove("immersive-mode");
  if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => { });
  }
}

function buildParticles() {
  if (!container || !window.THREE) return;

  const scene = new window.THREE.Scene();
  const camera = new window.THREE.PerspectiveCamera(75, 1, 0.1, 1000);
  const renderer = new window.THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(800, 800);
  container.replaceChildren(renderer.domElement);

  const particlesCount = 12000;
  const positions = new Float32Array(particlesCount * 3);
  const colors = new Float32Array(particlesCount * 3);

  for (let i = 0; i < particlesCount; i += 1) {
    const angle = i * 0.05;
    const radius = Math.sqrt(i) * 0.2;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = Math.sin(angle) * radius;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 2;
    colors[i * 3] = 0;
    colors[i * 3 + 1] = 0.9 + Math.random() * 0.1;
    colors[i * 3 + 2] = 1;
  }

  const geometry = new window.THREE.BufferGeometry();
  geometry.setAttribute("position", new window.THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new window.THREE.BufferAttribute(colors, 3));

  const material = new window.THREE.PointsMaterial({
    blending: window.THREE.AdditiveBlending,
    opacity: 0.82,
    size: 0.04,
    transparent: true,
    vertexColors: true,
  });

  const particleSystem = new window.THREE.Points(geometry, material);
  scene.add(particleSystem);
  camera.position.z = 12;

  const resize = () => {
    const size = Math.min(window.innerWidth, window.innerHeight) * (appState.immersive ? 0.96 : 0.8);
    renderer.setSize(size, size);
    camera.aspect = 1;
    camera.updateProjectionMatrix();
  };

  const animate = () => {
    requestAnimationFrame(animate);
    const now = Date.now();
    const scale =
      mode === "speaking"
        ? 1 + Math.sin(now * 0.008) * 0.12
        : mode === "listening"
          ? 1 + Math.sin(now * 0.004) * 0.08
          : 1 + Math.sin(now * 0.002) * 0.05;
    particleSystem.rotation.z += mode === "thinking" ? 0.004 : 0.002;
    particleSystem.rotation.y += mode === "executing" ? 0.0025 : 0.001;
    particleSystem.scale.set(scale, scale, scale);
    renderer.render(scene, camera);
  };

  resize();
  window.addEventListener("resize", resize);
  animate();
}

async function bootstrapVoice() {
  const [bootstrap, transcripts] = await Promise.all([
    fetchCachedJson("/api/bootstrap", {
      cacheKey: "bootstrap",
      ttlMs: 45_000,
    }),
    fetchCachedJson("/api/transcripts", {
      cacheKey: "transcripts",
      ttlMs: 30_000,
    }),
  ]);

  if (bootstrap) {
    appState.settings = bootstrap.settings || appState.settings;
    appState.tasks = bootstrap.tasks || [];
    appState.ttsProvider = String(bootstrap.ttsProvider || "webspeech").toLowerCase();
    appState.user = bootstrap.user;
    if (workspaceLabel) {
      workspaceLabel.textContent = `Sales & Operations AI • ${bootstrap.user.company}`;
    }
    document.body.dataset.nodeEnv = bootstrap.nodeEnv || "production";
    document.body.dataset.debugVoice = bootstrap.debugVoice ? "true" : "false";
    syncDebugVisibility();
  }
  if (transcripts) {
    appState.transcriptEntries = transcripts.entries || [];
  }

  renderTasks();
  renderTranscriptPreview();
  renderTranscriptDrawer();
  buildParticles();
  setMode("idle");
}

micButton?.addEventListener("click", async () => {
  if (voiceSessionActive || appState.isRecording || isAmandaSpeaking || isThinking) {
    stopVoiceSession({ cancelSpeech: true });
    return;
  }
  startVoiceSession();
});

muteButton?.addEventListener("click", () => {
  appState.isMuted = !appState.isMuted;
  muteButton.querySelector("span")?.classList.toggle("text-primary-fixed-dim", appState.isMuted);
});

transcriptButton?.addEventListener("click", () => {
  appState.transcriptOpen = !appState.transcriptOpen;
  renderTranscriptDrawer();
});

const keyboardBtn = document.getElementById("keyboard-btn");
const keyboardInputContainer = document.getElementById("voice-keyboard-input-container");
const keyboardInput = document.getElementById("voice-keyboard-input");
const keyboardSubmit = document.getElementById("voice-keyboard-submit");
const keyboardCancel = document.getElementById("voice-keyboard-cancel");

keyboardBtn?.addEventListener("click", () => {
  keyboardInputContainer?.classList.toggle("hidden");
  if (!keyboardInputContainer?.classList.contains("hidden")) {
    keyboardInput?.focus();
    if (voiceSessionActive) {
      stopVoiceSession({ cancelSpeech: false });
    }
  }
});

keyboardCancel?.addEventListener("click", () => {
  keyboardInputContainer?.classList.add("hidden");
});

keyboardSubmit?.addEventListener("click", async () => {
  const text = keyboardInput?.value.trim();
  if (text) {
    keyboardInputContainer?.classList.add("hidden");
    keyboardInput.value = "";
    await sendAmandaCommand(text, "keyboard");
  }
});

keyboardInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    keyboardSubmit?.click();
  }
});

document.getElementById("voice-close-transcript")?.addEventListener("click", () => {
  appState.transcriptOpen = false;
  renderTranscriptDrawer();
});

const debugToggle = document.getElementById("voice-debug-toggle");
const debugPanel = document.getElementById("voice-debug-panel");
const debugClose = document.getElementById("voice-debug-close");
const debugCopy = document.getElementById("voice-debug-copy");

syncDebugVisibility();

debugToggle?.addEventListener("click", () => {
  debugPanel?.classList.toggle("hidden");
  if (debugPanel && debugToggle) {
    debugToggle.textContent = debugPanel.classList.contains("hidden") ? "Debug" : "Close";
  }
});

debugClose?.addEventListener("click", () => {
  debugPanel?.classList.add("hidden");
  if (debugToggle) debugToggle.textContent = "Debug";
});

debugCopy?.addEventListener("click", async () => {
  const payload = JSON.stringify(debugSnapshot(), null, 2);
  try {
    await navigator.clipboard?.writeText(payload);
    debugCopy.textContent = "Copied";
    window.setTimeout(() => { debugCopy.textContent = "Copy Debug JSON"; }, 1200);
  } catch {
    console.log(payload);
    debugCopy.textContent = "Logged";
    window.setTimeout(() => { debugCopy.textContent = "Copy Debug JSON"; }, 1200);
  }
});

document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && appState.immersive) {
    exitImmersiveMode();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (voiceSessionActive || appState.isRecording) stopVoiceSession({ cancelSpeech: true });
    if (appState.transcriptOpen) {
      appState.transcriptOpen = false;
      renderTranscriptDrawer();
    }
    exitImmersiveMode();
  }
});

window.amandaSubmitTranscriptForSmokeTest = (transcript) => {
  if (typeof transcript === "string" && transcript.trim()) {
    return sendAmandaCommand(transcript.trim(), "voice");
  }
  return Promise.resolve();
};

// Quick-command chips — fill voice-keyboard-input and auto-submit
document.querySelectorAll("[data-command]").forEach((chip) => {
  chip.addEventListener("click", () => {
    const cmd = chip.dataset.command;
    if (!cmd) return;
    const el = keyboardInput;
    if (el) {
      el.value = cmd;
      el.focus();
    }
    keyboardSubmit?.click();
  });
});

bootstrapVoice().catch((error) => {
  console.error(error);
  setMode("idle", "Unable to connect to your workspace data right now.");
});

primeVoices();
if (synth && "onvoiceschanged" in synth) {
  synth.onvoiceschanged = () => { primeVoices(); };
}
