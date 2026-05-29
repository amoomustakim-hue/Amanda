import { postJson } from "./client-cache.js";

const form = document.querySelector("[data-auth-form]");

if (form) {
  const mode = form.dataset.authForm;
  const submitButton = form.querySelector('button[type="submit"]');
  const feedback = document.getElementById("auth-feedback");
  const defaultButtonHtml = submitButton?.innerHTML || "";

  function setFeedback(message, tone = "error") {
    if (!feedback) return;
    feedback.hidden = false;
    feedback.textContent = message;
    feedback.className =
      tone === "success"
        ? "mt-4 text-sm text-primary-container"
        : "mt-4 text-sm text-error";
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!submitButton) return;

    const payload =
      mode === "signup"
        ? {
            company: document.getElementById("company")?.value?.trim(),
            email: document.getElementById("email")?.value?.trim(),
            name: document.getElementById("full-name")?.value?.trim(),
            password: document.getElementById("password")?.value || "",
          }
        : {
            email: document.getElementById("email")?.value?.trim(),
            password: document.getElementById("password")?.value || "",
          };

    submitButton.disabled = true;
    submitButton.classList.add("opacity-70");
    submitButton.innerHTML = "Working...";
    if (feedback) feedback.hidden = true;

    try {
      const endpoint = mode === "signup" ? "/api/auth/signup" : "/api/auth/login";
      const result = await postJson(endpoint, payload, {
        redirectOnUnauthorized: false,
      });
      if (!result) return;
      setFeedback(mode === "signup" ? "Workspace created." : "Signed in.", "success");
      window.setTimeout(() => {
        window.location.href = result.redirectTo || "/workspace";
      }, 250);
    } catch (error) {
      setFeedback(error.message || "Unable to continue right now.");
      submitButton.disabled = false;
      submitButton.classList.remove("opacity-70");
      submitButton.innerHTML = defaultButtonHtml;
    }
  });
}

