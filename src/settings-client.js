import {
  clearCacheGroup,
  fetchCachedJson,
  postJson,
  writeCache,
} from "./client-cache.js";

const voiceCards = [...document.querySelectorAll("[data-voice-option]")];
const toneChips = [...document.querySelectorAll("[data-tone-option]")];
const reasoningInput = document.getElementById("reasoning-intensity");
const reasoningFill = document.getElementById("reasoning-fill");
const reasoningValue = document.getElementById("reasoning-value");
const saveButton = document.getElementById("settings-save");
const feedback = document.getElementById("settings-feedback");

const state = {
  persona: "Professional",
  reasoningIntensity: 75,
  tone: "Professional",
  voice: "Lumina Female",
};

function paintVoiceSelection() {
  voiceCards.forEach((card) => {
    const active = card.dataset.voiceOption === state.voice;
    card.classList.toggle("border-primary-container/30", active);
    card.classList.toggle("bg-primary-container/5", active);
    card.classList.toggle("border-outline-variant/20", !active);
  });
}

function paintToneSelection() {
  toneChips.forEach((chip) => {
    const active = chip.dataset.toneOption === state.tone;
    chip.classList.toggle("border-primary-container", active);
    chip.classList.toggle("text-primary-container", active);
    chip.classList.toggle("border-outline-variant/20", !active);
    chip.classList.toggle("text-on-surface-variant", !active);
  });
}

function paintReasoning() {
  if (reasoningInput) reasoningInput.value = String(state.reasoningIntensity);
  if (reasoningFill) reasoningFill.style.width = `${state.reasoningIntensity}%`;
  if (reasoningValue) {
    reasoningValue.textContent =
      state.reasoningIntensity > 70 ? "Deep Analysis" : state.reasoningIntensity > 40 ? "Balanced" : "Efficiency";
  }
}

function paintAll() {
  paintVoiceSelection();
  paintToneSelection();
  paintReasoning();
}

function setFeedback(message, tone = "success") {
  if (!feedback) return;
  feedback.hidden = false;
  feedback.textContent = message;
  feedback.className =
    tone === "success" ? "text-sm text-primary-container" : "text-sm text-error";
}

async function bootstrapSettings() {
  const data = await fetchCachedJson("/api/settings", {
    cacheKey: "settings",
    ttlMs: 30_000,
  });
  if (!data) return;
  Object.assign(state, data.settings);
  paintAll();
}

voiceCards.forEach((card) => {
  card.addEventListener("click", () => {
    state.voice = card.dataset.voiceOption;
    paintVoiceSelection();
  });
});

toneChips.forEach((chip) => {
  chip.addEventListener("click", () => {
    state.tone = chip.dataset.toneOption;
    state.persona = chip.dataset.toneOption;
    paintToneSelection();
  });
});

reasoningInput?.addEventListener("input", () => {
  state.reasoningIntensity = Number(reasoningInput.value);
  paintReasoning();
});

saveButton?.addEventListener("click", async () => {
  saveButton.disabled = true;
  try {
    const result = await postJson("/api/settings", state);
    if (!result) return;
    clearCacheGroup(["bootstrap", "settings"]);
    writeCache("settings", {
      etag: null,
      expiresAt: Date.now() + 30_000,
      payload: result,
    });
    setFeedback("Configuration saved.");
  } catch (error) {
    setFeedback(error.message || "Unable to save settings right now.", "error");
  } finally {
    saveButton.disabled = false;
  }
});

bootstrapSettings().catch((error) => {
  console.error(error);
});
