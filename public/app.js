(() => {
  "use strict";

  const source = document.querySelector("#tangkhul-input");
  const result = document.querySelector("#result");
  const allowedErrorStatuses = new Set([422, 429, 500, 503]);

  function bindCorrectionDirtyState(form) {
    if (!(form instanceof HTMLFormElement) || form.dataset.dirtyBound === "true") return;

    const proposed = form.querySelector("#proposed-translation");
    const note = form.querySelector("#contributor-note");
    const tags = [...form.querySelectorAll('input[name="tags"]')];
    const controls = [proposed, note, ...tags].filter(
      (control) => control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement,
    );
    const updateDirty = () => {
      form.dataset.dirty = String(
        controls.some((control) => {
          const current =
            control instanceof HTMLInputElement && control.type === "checkbox"
              ? String(control.checked)
              : control.value;
          return current !== control.dataset.initialValue;
        }),
      );
    };
    controls.forEach((control) => {
      control.dataset.initialValue =
        control instanceof HTMLInputElement && control.type === "checkbox"
          ? String(control.checked)
          : control.value;
      control.addEventListener("input", () => {
        updateDirty();
      });
      control.addEventListener("change", () => {
        updateDirty();
      });
    });
    form.dataset.dirty = "false";
    form.dataset.dirtyBound = "true";
  }

  document.querySelectorAll("[data-character]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!(source instanceof HTMLTextAreaElement)) return;
      const character = button.getAttribute("data-character") ?? "";
      source.setRangeText(character, source.selectionStart, source.selectionEnd, "end");
      source.focus();
      source.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });

  document.body.addEventListener("htmx:beforeSwap", (event) => {
    const detail = event.detail;
    if (!detail || !allowedErrorStatuses.has(detail.xhr.status)) return;

    const translationFragment =
      detail.target === result &&
      detail.xhr.getResponseHeader("X-Translation-Fragment") === "result";
    const feedbackMessage = document.querySelector("#feedback-message");
    const feedbackFragment =
      detail.target === feedbackMessage &&
      detail.xhr.getResponseHeader("X-Feedback-Fragment") === "feedback";

    if (!translationFragment && !feedbackFragment) return;

    detail.shouldSwap = true;
    detail.isError = false;
  });

  document.body.addEventListener("htmx:confirm", (event) => {
    const detail = event.detail;
    const elt = detail?.elt;
    if (!(elt instanceof Element)) return;
    if (!elt.closest(".translation-form")) return;

    const form = document.querySelector("#correction-form");
    if (!(form instanceof HTMLFormElement) || form.hasAttribute("hidden")) return;

    bindCorrectionDirtyState(form);

    if (form.dataset.dirty !== "true") return;

    event.preventDefault();
    const proceed = window.confirm(
      "You have an unsubmitted correction. Translating again will discard it. Continue?",
    );
    if (proceed) {
      detail.issueRequest(true);
    }
  });

  document.body.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const toggle = target.closest("[data-toggle-correction]");
    if (toggle) {
      const form = document.querySelector("#correction-form");
      if (!(form instanceof HTMLFormElement)) return;

      const isHidden = form.hasAttribute("hidden");
      if (isHidden) {
        form.removeAttribute("hidden");
        bindCorrectionDirtyState(form);
        toggle.setAttribute("aria-expanded", "true");
        form.querySelector("#proposed-translation")?.focus();
      } else {
        form.setAttribute("hidden", "");
        toggle.setAttribute("aria-expanded", "false");
      }
      return;
    }

    const button = target.closest("[data-copy-result]");
    if (!(button instanceof HTMLButtonElement) || !result?.contains(button)) return;

    const output = result.querySelector("[data-translation-output]")?.textContent;
    const status = result.querySelector("[data-copy-status]");
    if (output === undefined) return;

    try {
      await navigator.clipboard.writeText(output);
      button.textContent = "Copied";
      if (status) status.textContent = "Translation copied to the clipboard.";
    } catch {
      if (status) status.textContent = "Copy failed. Select the translation and copy it manually.";
    }
  });
})();
