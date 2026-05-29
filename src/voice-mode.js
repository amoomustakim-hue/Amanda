import {
  getNextState,
  stateMeta,
  taskActivities,
  transcriptEntries,
} from "./voice-session-service.js";
import { mountParticles } from "./particles.js";

const root = document.querySelector("#voice-root");

const icons = {
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a4 4 0 0 0 4-4V6a4 4 0 1 0-8 0v5a4 4 0 0 0 4 4Z"/><path d="M19 11a7 7 0 0 1-14 0"/><path d="M12 18v4"/><path d="M8 22h8"/></svg>',
  mute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/></svg>',
  volume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  transcript: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16"/><path d="M4 12h12"/><path d="M4 19h9"/></svg>',
  keyboard: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01"/><path d="M11 10h.01"/><path d="M15 10h.01"/><path d="M19 10h.01"/><path d="M7 14h10"/></svg>',
  phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.91.33 1.8.63 2.65a2 2 0 0 1-.45 2.11L8 9.78a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.11-.45c.85.3 1.74.51 2.65.63A2 2 0 0 1 22 16.92Z"/></svg>',
  settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.05.05a2.1 2.1 0 0 1-2.98 2.98l-.05-.05a1.8 1.8 0 0 0-1.98-.36 1.8 1.8 0 0 0-1.1 1.65V21a2.1 2.1 0 0 1-4.2 0v-.08A1.8 1.8 0 0 0 8.4 19.3a1.8 1.8 0 0 0-1.98.36l-.05.05a2.1 2.1 0 0 1-2.98-2.98l.05-.05A1.8 1.8 0 0 0 3.8 14.7 1.8 1.8 0 0 0 2.15 13H2a2.1 2.1 0 0 1 0-4.2h.08A1.8 1.8 0 0 0 3.7 7.7a1.8 1.8 0 0 0-.36-1.98l-.05-.05A2.1 2.1 0 1 1 6.27 2.7l.05.05A1.8 1.8 0 0 0 8.3 3.1h.1A1.8 1.8 0 0 0 9.5 1.45V1a2.1 2.1 0 0 1 4.2 0v.08A1.8 1.8 0 0 0 14.8 2.7a1.8 1.8 0 0 0 1.98-.36l.05-.05a2.1 2.1 0 1 1 2.98 2.98l-.05.05a1.8 1.8 0 0 0-.36 1.98v.1a1.8 1.8 0 0 0 1.65 1.1H22a2.1 2.1 0 0 1 0 4.2h-.08A1.8 1.8 0 0 0 20.3 14.8l-.9.2Z"/></svg>',
  tools: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5 5L3 18v3h3l6.7-6.7a4 4 0 0 0 5-5l-2.4 2.4-3-3 2.4-2.4Z"/></svg>',
  minimize: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>',
};

const appState = {
  mode: "idle",
  muted: false,
  transcriptOpen: false,
  textMode: false,
  ended: false,
  immersive: false,
  activityIndex: 0,
};

let coreAnimationFrame = 0;
let flowTimer = 0;
let activityTimer = 0;

function button(label, icon, className = "", attrs = "") {
  return `<button class="icon-button ${className}" type="button" aria-label="${label}" title="${label}" ${attrs}>${icon}<span>${label}</span></button>`;
}

function render() {
  const meta = stateMeta[appState.mode];

  root.dataset.mode = appState.mode;
  root.dataset.immersive = String(appState.immersive);
  root.innerHTML = `
    <section class="background-effects" aria-hidden="true">
      <div class="grid-layer"></div>
      <div class="glow glow-a"></div>
      <div class="glow glow-b"></div>
    </section>

    <header class="top-bar">
      ${AIIdentityCard(meta)}
      ${UtilityControls()}
    </header>

    <section class="hero-stage" aria-label="Live voice session with Amanda">
      ${AICore(meta)}
      ${SideMeters()}
      ${TaskActivityStrip(meta)}
    </section>

    <section class="bottom-zone">
      ${PromptCard()}
      ${TranscriptStrip()}
      ${VoiceControlDock()}
    </section>

    ${TranscriptDrawer()}
  `;

  bindEvents();
  const canvas = root.querySelector('.ai-core-canvas');
  if (coreAnimationFrame) {
    cancelAnimationFrame(coreAnimationFrame);
  }
  const particlesInstance = mountParticles(canvas, () => ({ mode: appState.mode, immersive: appState.immersive }));
  // particlesInstance doesn't provide frame id directly; keep previous cancel behavior via returned API
  // store a stop handle for cleanup if needed
  root._particlesInstance = particlesInstance;
}

function AIIdentityCard(meta) {
  return `
    <article class="identity-card" aria-label="AI worker identity">
      <div class="identity-mark" aria-hidden="true">A</div>
      <div>
        <div class="identity-line">
          <h1>Amanda</h1>
          <span class="status-pill">${meta.label}</span>
        </div>
        <p>Sales Operations AI <span aria-hidden="true">•</span> CodedDevs Demo</p>
      </div>
    </article>
  `;
}

function UtilityControls() {
  return `
    <div class="utility-controls-wrapper">
      <nav class="primary-nav" aria-label="Main navigation">
        <a href="/workspace">Workspace</a>
        <a href="/dashboard">Dashboard</a>
        <a href="/settings">Settings</a>
        <a href="/voice">Voice</a>
      </nav>
      <nav class="utility-controls" aria-label="Voice session utilities">
        ${button("Settings", icons.settings, "", 'data-action="thinking"')}
        ${button("Tools", icons.tools, "", 'data-action="executing"')}
        ${button("Transcript", icons.transcript, appState.transcriptOpen ? "is-active" : "", 'data-action="transcript"')}
        ${button("Minimize", icons.minimize, "", 'data-action="end"')}
      </nav>
    </div>
  `;
}

function AICore(meta) {
  return `
    <div class="ai-core-wrap">
      <div class="orb-halo" aria-hidden="true"></div>
      <canvas class="ai-core-canvas" width="1100" height="1100" aria-label="Glowing particle voice visualization"></canvas>
      <div class="core-interface">
        <p class="core-status">${meta.status}</p>
        <p class="core-line">${appState.ended ? "Session ended. Amanda is standing by." : meta.line}</p>
      </div>
    </div>
  `;
}

function SideMeters() {
  return `
    <div class="side-meter side-meter-left" aria-hidden="true"><span></span></div>
    <div class="side-meter side-meter-right" aria-hidden="true"><span></span></div>
  `;
}

function TaskActivityStrip(meta) {
  const activity =
    appState.mode === "idle" ? meta.activity : taskActivities[appState.activityIndex % taskActivities.length];
  return `
    <aside class="task-strip" aria-label="AI work activity">
      <span class="task-dot" aria-hidden="true"></span>
      <span>${appState.ended ? "Voice session ended. No active work." : activity}</span>
    </aside>
  `;
}

function PromptCard() {
  return `
    <section class="prompt-card" aria-label="Current voice prompt">
      <p>"Check today's customer messages and show me the important ones."</p>
      <span>${stateMeta[appState.mode].status}</span>
    </section>
  `;
}

function TranscriptStrip() {
  const userLine = transcriptEntries[0];
  const assistantLine = transcriptEntries[1];
  return `
    <section class="transcript-strip" aria-label="Live transcript preview">
      <p><strong>${userLine.speaker}:</strong> ${userLine.text}</p>
      <p><strong>${assistantLine.speaker}:</strong> ${assistantLine.text}</p>
    </section>
  `;
}

function VoiceControlDock() {
  const micLabel = appState.immersive ? "Exit immersive voice mode" : "Enter immersive voice mode";
  return `
    <section class="voice-dock" aria-label="Voice controls">
      ${dockButton("End session", icons.phone, "danger", 'data-action="end"')}
      ${dockButton(appState.muted ? "Unmute" : "Mute", appState.muted ? icons.mute : icons.volume, appState.muted ? "is-active" : "", 'data-action="mute"')}
      <button class="mic-button ${appState.mode === "listening" ? "is-listening" : ""}" type="button" aria-label="${micLabel}" title="${micLabel}" data-action="mic">
        <span class="mic-rings" aria-hidden="true"></span>
        ${icons.mic}
      </button>
      ${dockButton("Transcript", icons.transcript, appState.transcriptOpen ? "is-active" : "", 'data-action="transcript"')}
      ${dockButton("Keyboard", icons.keyboard, appState.textMode ? "is-active" : "", 'data-action="text"')}
    </section>
  `;
}

function dockButton(label, icon, className = "", attrs = "") {
  return `<button class="icon-button dock-control ${className}" type="button" aria-label="${label}" title="${label}" ${attrs}>${icon}<span>${label}</span></button>`;
}

function TranscriptDrawer() {
  return `
    <aside class="transcript-drawer ${appState.transcriptOpen ? "is-open" : ""}" aria-label="Full transcript" aria-hidden="${!appState.transcriptOpen}">
      <div class="drawer-header">
        <div>
          <p class="eyebrow">Session transcript</p>
          <h2>Conversation history</h2>
        </div>
        <button class="icon-button" type="button" aria-label="Close transcript" title="Close transcript" data-action="transcript">${icons.minimize}<span>Close</span></button>
      </div>
      <div class="drawer-list">
        ${transcriptEntries
      .map(
        (entry) => `
              <article class="transcript-entry ${entry.kind}">
                <time>${entry.time}</time>
                <div>
                  <strong>${entry.speaker}</strong>
                  <p>${entry.text}</p>
                </div>
              </article>
            `,
      )
      .join("")}
      </div>
    </aside>
  `;
}

function bindEvents() {
  root.querySelector(".ai-core-canvas")?.addEventListener("click", () => {
    if (appState.immersive) exitImmersiveMode();
  });

  root.querySelectorAll("[data-action]").forEach((control) => {
    control.addEventListener("click", () => {
      const action = control.dataset.action;
      if (action === "mic") {
        if (appState.immersive) {
          exitImmersiveMode();
        } else {
          stopTimers();
          enterImmersiveMode();
        }
      }
      if (action === "thinking") {
        stopTimers();
        setMode("thinking");
      }
      if (action === "executing") runExecutingMode();
      if (action === "mute") appState.muted = !appState.muted;
      if (action === "transcript") appState.transcriptOpen = !appState.transcriptOpen;
      if (action === "text") {
        stopTimers();
        appState.textMode = !appState.textMode;
        setMode(appState.textMode ? "speaking" : "idle");
      }
      if (action === "end") {
        stopTimers();
        exitImmersiveMode(false);
        appState.ended = true;
        setMode("idle", false);
      }
      render();
    });
  });
}

function enterImmersiveMode() {
  appState.immersive = true;
  setMode("listening");

  if (root.requestFullscreen) {
    root.requestFullscreen().catch(() => { });
  }
}

function exitImmersiveMode(shouldRender = true) {
  appState.immersive = false;
  setMode("idle");

  if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => { });
  }

  if (shouldRender) render();
}

function setMode(mode, clearEnded = true) {
  appState.mode = mode;
  if (clearEnded) appState.ended = false;
  appState.activityIndex += 1;
}

function stopTimers() {
  window.clearTimeout(flowTimer);
  window.clearInterval(activityTimer);
}

function runMockWorkerFlow() {
  stopTimers();
  const sequence = [
    ["thinking", 1800],
    ["speaking", 2300],
    ["executing", 4200],
    ["idle", 0],
  ];

  function step(index) {
    const [mode, delay] = sequence[index];
    setMode(mode);
    render();

    if (mode === "executing") startActivityLoop();
    if (index < sequence.length - 1) {
      flowTimer = window.setTimeout(() => step(index + 1), delay);
    }
  }

  step(0);
}

function runExecutingMode() {
  stopTimers();
  setMode("executing");
  startActivityLoop();
}

function startActivityLoop() {
  window.clearInterval(activityTimer);
  activityTimer = window.setInterval(() => {
    appState.activityIndex += 1;
    render();
  }, 1800);
}

// particle rendering is handled by src/particles.js via `mountParticles`

window.addEventListener("beforeunload", () => cancelAnimationFrame(coreAnimationFrame), { once: true });

document.addEventListener("fullscreenchange", () => {
  // toggle particles-only class on body so fullscreen canvas UI shows alone
  document.body.classList.toggle('particles-only', !!document.fullscreenElement);
  if (!document.fullscreenElement && appState.immersive) {
    appState.immersive = false;
    setMode("idle");
    render();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() === "m") {
    if (appState.immersive) exitImmersiveMode();
    else enterImmersiveMode();
  }
  if (event.key === "Escape" && appState.transcriptOpen) {
    appState.transcriptOpen = false;
    render();
  } else if (event.key === "Escape" && appState.immersive) {
    exitImmersiveMode();
  }
  if (event.key.toLowerCase() === " ") {
    event.preventDefault();
    if (appState.immersive) return;
    setMode(getNextState(appState.mode));
    render();
  }
});

render();
