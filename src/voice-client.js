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
  recognitionCount: 0,
  safetyDecision: "",
  duplicateBlocked: false,
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
  return Boolean(value && value !== "-" && value !== "—" && value !== "â€”");
}

function isFillerOnly(transcript) {
  const clean = String(transcript || "").trim().toLowerCase().replace(/[.!?]+$/g, "");
  if (!clean) return true;
  if (/^(uh|um|hm|hmm)$/.test(clean)) return true;
  if (/^(okay|yeah|yes|no)$/.test(clean) && !hasActiveClarification()) return true;
  return false;
}

function debugSnapshot() {
  return {
    approvalAction: debugData.approvalAction || "",
    approvalId: debugData.approvalId || "",
    backendReply: debugData.backendReply || "",
    brain: debugData.brain || "",
    calendarParser: debugData.calendarParser || "",
    cleanTranscript: debugData.cleanedTranscript || "",
    confidence: debugData.confidence || "",
    duplicateBlocked: Boolean(debugData.duplicateBlocked),
    finalResult: Boolean(debugData.isFinal),
    gmailDebug: debugData.gmailDebug || "",
    intent: debugData.intent || "",
    pendingClarification: debugData.pendingClarification || "",
    rawTranscript: debugData.rawTranscript || "",
    recognitionCount: debugData.recognitionCount || 0,
    requestId: debugData.requestId || "",
    routedTo: debugData.routedTo || "",
    safetyDecision: debugData.safetyDecision || "",
    usedFollowUpContext: Boolean(debugData.usedFollowupContext),
    voiceState: debugData.voiceState || mode,
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
    if (el) el.textContent = String(value || "—");
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
  update("debug-duplicate-blocked", debugData.duplicateBlocked ? "YES" : "false");
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

function scoreVoiceForPreference(voice, preference) {
  const name = `${voice.name || ""} ${voice.voiceURI || ""}`.toLowerCase();
  const lang = (voice.lang || "").toLowerCase();

  const femaleMatches = [
    "female",
    "woman",
    "zira",
    "aria",
    "jenny",
    "sonia",
    "sara",
    "samantha",
    "victoria",
    "natasha",
    "libby",
    "michelle",
    "emma",
    "olivia",
    "ava",
    "amy",
    "luna",
  ];

  const maleMatches = [
    "male",
    "man",
    "david",
    "mark",
    "guy",
    "brian",
    "ryan",
    "christopher",
    "george",
  ];

  let score = 0;

  if (lang.startsWith("en")) score += 2;
  if (voice.default) score += 1;

  if (preference === "Lumina Female") {
    if (femaleMatches.some((token) => name.includes(token))) score += 10;
    if (maleMatches.some((token) => name.includes(token))) score -= 6;
  } else {
    if (maleMatches.some((token) => name.includes(token))) score += 10;
    if (femaleMatches.some((token) => name.includes(token))) score -= 6;
  }

  if (name.includes("natural")) score += 3;
  if (name.includes("online")) score += 2;
  return score;
}

function chooseVoice(preference) {
  const voices = availableVoices.length ? availableVoices : synth?.getVoices?.() || [];
  if (!voices.length) return null;

  return voices
    .slice()
    .sort((a, b) => scoreVoiceForPreference(b, preference) - scoreVoiceForPreference(a, preference))[0];
}

function primeVoices() {
  if (!synth) return;
  const loaded = synth.getVoices?.() || [];
  if (loaded.length) {
    availableVoices = loaded;
  }
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

async function speak(text) {
  if (appState.isMuted || !synth) {
    setMode("executing");
    renderTasks();
    return Promise.resolve();
  }

  synth.cancel();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(failsafeTimer);
      isAmandaSpeaking = false;
      resolve();
    };
    const estimatedMs = Math.min(30000, Math.max(5000, String(text || "").length * 55));
    const failsafeTimer = window.setTimeout(() => {
      try {
        synth.cancel();
      } catch {
        // Ignore browser speech engine cleanup failures.
      }
      finish();
    }, estimatedMs);
    const utterance = new SpeechSynthesisUtterance(text);
    const preferred = chooseVoice(appState.settings.voice);
    if (preferred) utterance.voice = preferred;
    utterance.rate = 1;
    utterance.pitch = appState.settings.voice === "Lumina Female" ? 1.06 : 0.95;
    utterance.onstart = () => {
      isAmandaSpeaking = true;
      setMode("speaking");
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    synth.speak(utterance);
    window.setTimeout(() => {
      try {
        if (synth.paused) synth.resume();
      } catch {
        // Some browsers throw when the speech engine is unavailable.
      }
    }, 250);
  });
}

async function submitTranscript(transcript) {
  const cleanTranscript = String(transcript || "").replace(/\s+/g, " ").trim();
  if (!cleanTranscript) return;
  if (isFillerOnly(cleanTranscript)) {
    debugData.rawTranscript = transcript;
    debugData.cleanedTranscript = cleanTranscript;
    debugData.duplicateBlocked = false;
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
    updateDebugPanel();
    setMode("listening", "Already handling that request. Listening again...");
    restartListeningSoon(700);
    return;
  }
  debugData.duplicateBlocked = false;
  lastSentTranscript = cleanTranscript;
  lastSentAt = now;
  isThinking = true;
  setMode("thinking");

  // Generate request ID and track timing
  debugData.requestId = `voice_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  debugData.rawTranscript = transcript;
  debugData.cleanedTranscript = cleanTranscript;
  debugData.lastSentTime = new Date().toLocaleTimeString();
  debugData.isFinal = true;
  updateDebugPanel();

  try {
    const result = await postJson("/api/voice/respond", {
      transcript: cleanTranscript,
      requestId: debugData.requestId,
    });
    if (!result) return;

    // Extract debug info from response
    if (result.requestId) {
      debugData.requestId = result.requestId;
    }
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

    debugData.backendReply = result.reply || "—";

    // Log to console in development
    if (isDebugEnabled()) {
      const logMsg = `[VOICE DEBUG] requestId="${debugData.requestId}" transcript="${cleanTranscript}" intent="${debugData.intent}" confidence=${debugData.confidence} routedTo="${debugData.routedTo}" followUp=${debugData.usedFollowupContext} state="${mode}"`;
      console.log(logMsg);
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
    await speak(result.reply);
    setMode(
      shouldAutoRestartListening() ? "listening" : "executing",
      shouldAutoRestartListening()
        ? "Ready for your next request."
        : "Amanda finished the reply.",
    );
  } catch (error) {
    setMode("error", error.message || "Unable to reach Amanda right now.");
  } finally {
    isThinking = false;
    if (shouldAutoRestartListening()) {
      restartListeningSoon(700);
    } else if (voiceSessionActive && !manuallyStopped && mode !== "error") {
      setMode("paused");
    } else if (!voiceSessionActive) {
      setMode("idle");
    }
  }
}

function stopVoiceSession({ cancelSpeech = false } = {}) {
  clearRestartTimer();
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
    setMode("error", "Voice capture is not available in this browser. Use Chrome or Edge.");
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
      if (isAmandaSpeaking || mode === "speaking") return;
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
        await submitTranscript(transcript);
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
        setMode("error", "Microphone permission is blocked. Allow microphone access to use voice mode.");
        return;
      }
      if (lastRecognitionError === "audio-capture") {
        voiceSessionActive = false;
        autoListenEnabled = false;
        setMode("error", "No microphone was detected.");
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
    appState.user = bootstrap.user;
    if (workspaceLabel) {
      workspaceLabel.textContent = `Sales & Operations AI • ${bootstrap.user.company}`;
    }
    // Store env flags for debug panel
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

document.getElementById("voice-close-transcript")?.addEventListener("click", () => {
  appState.transcriptOpen = false;
  renderTranscriptDrawer();
});

// Debug panel toggle
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
    window.setTimeout(() => {
      debugCopy.textContent = "Copy Debug JSON";
    }, 1200);
  } catch {
    console.log(payload);
    debugCopy.textContent = "Logged";
    window.setTimeout(() => {
      debugCopy.textContent = "Copy Debug JSON";
    }, 1200);
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
    return submitTranscript(transcript.trim());
  }
  return Promise.resolve();
};

bootstrapVoice().catch((error) => {
  console.error(error);
  setMode("idle", "Unable to connect to your workspace data right now.");
});

primeVoices();
if (synth && "onvoiceschanged" in synth) {
  synth.onvoiceschanged = () => {
    primeVoices();
  };
}
