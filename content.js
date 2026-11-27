(() => {
  const HEADING = "was this task successful?";
  const REQUIRED_BUTTONS = ["yes", "no", "keep working"];
  const QUESTION_CUSTOM_PLACEHOLDER = /revise\s+options\s+or\s+write\s+your\s+own/i;
  const QUESTION_SKIP_LABEL = "skip";
  const CONTROL_LABELS = new Set([
    "skip",
    "submit",
    "submit custom response",
    "yes",
    "no",
    "keep working"
  ]);
  const SCAN_INTERVAL_MS = 1000;
  const PANEL_RESET_DELAY_MS = 1500;

  let observer;
  let scanQueued = false;
  let stopped = false;
  let notifiedForCurrentPanel = false;
  let notifiedForCurrentQuestion = false;
  let lastQuestionKey = "";
  let panelMissingSince = 0;
  let questionMissingSince = 0;
  let notifiedForCurrentError = false;
  let lastErrorKey = "";
  let errorMissingSince = 0;
  let lastUrl = location.href;
  const inFlight = new Set();

  const normalize = (value) =>
    String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();

  function isVisible(element) {
    if (!element || !element.isConnected) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" &&
      style.visibility !== "hidden" &&
      Boolean(element.getClientRects().length);
  }

  function buttonLabel(button) {
    return normalize(
      button.innerText || button.getAttribute("aria-label") || button.textContent
    );
  }

  function findCompletionPanel() {
    const candidates = document.querySelectorAll("span, p, h1, h2, h3, div");

    for (const candidate of candidates) {
      if (!isVisible(candidate) || normalize(candidate.textContent) !== HEADING) continue;

      for (
        let ancestor = candidate.parentElement;
        ancestor && ancestor !== document.body;
        ancestor = ancestor.parentElement
      ) {
        const labels = new Set(
          [...ancestor.querySelectorAll("button")]
            .filter(isVisible)
            .map(buttonLabel)
        );

        if (REQUIRED_BUTTONS.every((label) => labels.has(label))) {
          return ancestor;
        }
      }
    }
    return null;
  }

  function isControlLabel(text) {
    return CONTROL_LABELS.has(normalize(text));
  }

  function questionMarkers(scope) {
    const skip = [...scope.querySelectorAll("button")].some(
      (button) => isVisible(button) && buttonLabel(button) === QUESTION_SKIP_LABEL
    );
    if (skip) return { skip: true, custom: false };

    const custom = [...scope.querySelectorAll("input, textarea")].some(
      (field) => isVisible(field) &&
        QUESTION_CUSTOM_PLACEHOLDER.test(field.getAttribute("placeholder") || "")
    );
    return { skip: false, custom };
  }

  // Returns the card that owns the question: the closest ancestor that carries
  // the question markers (a Skip button and/or the free-text "write your own"
  // field). Falls back to the tightest ancestor with any marker.
  function findQuestionScope(node) {
    let fallback = null;

    for (
      let current = node, depth = 0;
      current && current !== document.body && depth < 8;
      current = current.parentElement, depth += 1
    ) {
      if (!isVisible(current)) continue;

      const { skip, custom } = questionMarkers(current);
      if (!skip && !custom) continue;
      if (skip) return current;
      fallback = fallback || current;
    }
    return fallback;
  }

  function extractQuestionText(node, scope) {
    for (
      let current = node, depth = 0;
      current && current !== document.body && depth < 8;
      current = current.parentElement, depth += 1
    ) {
      if (current.matches?.("input, textarea, button")) continue;
      const label = String(current.getAttribute("aria-label") || "")
        .replace(/\s+/g, " ")
        .trim();
      if (label) return label;
    }

    const textElements = [...scope.querySelectorAll("span, p, h1, h2, h3, h4, label")]
      .filter((element) => isVisible(element) && !element.closest("button, input, textarea"));

    for (const element of textElements) {
      const text = String(element.textContent || "").replace(/\s+/g, " ").trim();
      if (text.length >= 8 && !isControlLabel(text)) return text;
    }
    return "";
  }

  function questionKey(scope, question) {
    const options = [...scope.querySelectorAll('[role="radio"], [role="checkbox"]')]
      .filter(isVisible)
      .map((option) => normalize(
        option.innerText || option.getAttribute("aria-label") || option.textContent
      ))
      .filter(Boolean);

    return `${normalize(question)}::${options.join("|")}`;
  }

  function findQuestionPanel() {
    const groups = document.querySelectorAll('[role="radiogroup"]');

    for (const group of groups) {
      if (!isVisible(group)) continue;

      const options = [...group.querySelectorAll('[role="radio"], [role="checkbox"]')]
        .filter(isVisible);
      if (options.length < 2) continue;

      const scope = findQuestionScope(group);
      if (!scope) continue;

      return { element: scope, question: extractQuestionText(group, scope) };
    }

    // Fallback for question cards that do not use radiogroup markup.
    const fields = document.querySelectorAll("input, textarea");

    for (const field of fields) {
      if (!isVisible(field)) continue;
      if (!QUESTION_CUSTOM_PLACEHOLDER.test(field.getAttribute("placeholder") || "")) continue;

      const scope = findQuestionScope(field);
      if (!scope) continue;
      return { element: scope, question: extractQuestionText(field, scope) };
    }

    return null;
  }

  // Returns the outermost visible error banner. Arena renders failures as a
  // red `role="alert"` block ("Something went wrong. Please try again." and
  // similar texts); a red-background banner is accepted as a fallback in case
  // the role attribute is missing. Banners nested inside the completion panel
  // or the question card are skipped to avoid double alerts.
  function findErrorBlock(excluded) {
    const candidates = document.querySelectorAll('[role="alert"], [class*="bg-red-500"]');

    for (const candidate of candidates) {
      if (!isVisible(candidate)) continue;
      if (candidate.parentElement?.closest('[role="alert"], [class*="bg-red-500"]')) continue;
      if (excluded.some((root) => root && root.contains(candidate))) continue;

      const text = String(candidate.textContent || "").replace(/\s+/g, " ").trim();
      if (text.length < 8 || isControlLabel(text)) continue;
      return { element: candidate, text };
    }
    return null;
  }

  function stopBecauseContextWasInvalidated(error) {
    if (stopped) return;
    stopped = true;
    observer?.disconnect();
    clearInterval(pollingTimer);
    console.error(
      "[Arena notifier] Extension context is no longer active. Reload this Arena tab after reloading the extension.",
      error
    );
  }

  function dispatchAlert(kind, payload) {
    if (stopped || inFlight.has(kind)) return;
    if (!chrome.runtime?.id) {
      stopBecauseContextWasInvalidated(new Error("chrome.runtime.id is unavailable"));
      return;
    }

    inFlight.add(kind);
    const release = () => inFlight.delete(kind);
    const markNotified = () => {
      if (kind === "question") {
        notifiedForCurrentQuestion = true;
        lastQuestionKey = payload.questionKey;
      } else if (kind === "error") {
        notifiedForCurrentError = true;
        lastErrorKey = payload.errorKey;
      } else {
        notifiedForCurrentPanel = true;
      }
    };

    try {
      chrome.runtime.sendMessage(payload).then((response) => {
        release();
        markNotified();
        if (!response?.ok) {
          console.error("[Arena notifier] Background rejected the alert:", response?.error || response);
          return;
        }
        if (response.errors?.length) {
          console.error("[Arena notifier] Alert delivery had errors:", response.errors);
        }
        const kindLabel = kind === "question" ? "Question" : kind === "error" ? "Error" : "Completion";
        console.info(`[Arena notifier] ${kindLabel} detected; alert dispatched.`);
      }).catch((error) => {
        release();
        const message = String(error?.message || error);
        if (/context invalidated|extension context/i.test(message)) {
          stopBecauseContextWasInvalidated(error);
        } else {
          console.error("[Arena notifier] Could not dispatch alert:", error);
        }
      });
    } catch (error) {
      release();
      const message = String(error?.message || error);
      if (/context invalidated|extension context/i.test(message)) {
        stopBecauseContextWasInvalidated(error);
      } else {
        console.error("[Arena notifier] Could not dispatch alert:", error);
      }
    }
  }

  function scan() {
    if (stopped) return;

    if (location.href !== lastUrl) {
      lastUrl = location.href;
      notifiedForCurrentPanel = false;
      notifiedForCurrentQuestion = false;
      lastQuestionKey = "";
      panelMissingSince = 0;
      questionMissingSince = 0;
      notifiedForCurrentError = false;
      lastErrorKey = "";
      errorMissingSince = 0;
    }

    const panel = findCompletionPanel();
    if (panel) {
      panelMissingSince = 0;
      if (!notifiedForCurrentPanel) {
        dispatchAlert("completion", {
          type: "ARENA_TURN_COMPLETED",
          title: document.title || "Arena agent",
          url: location.href
        });
      }
    } else if (!panelMissingSince) {
      panelMissingSince = Date.now();
    } else if (Date.now() - panelMissingSince >= PANEL_RESET_DELAY_MS) {
      notifiedForCurrentPanel = false;
    }

    const question = findQuestionPanel();
    if (question) {
      questionMissingSince = 0;
      const key = questionKey(question.element, question.question);
      if (!notifiedForCurrentQuestion || key !== lastQuestionKey) {
        dispatchAlert("question", {
          type: "ARENA_QUESTION_ASKED",
          question: question.question,
          questionKey: key,
          title: document.title || "Arena agent",
          url: location.href
        });
      }
    } else if (!questionMissingSince) {
      questionMissingSince = Date.now();
    } else if (Date.now() - questionMissingSince >= PANEL_RESET_DELAY_MS) {
      notifiedForCurrentQuestion = false;
      lastQuestionKey = "";
    }

    const error = findErrorBlock([panel, question?.element]);
    if (error) {
      errorMissingSince = 0;
      const key = normalize(error.text);
      if (!notifiedForCurrentError || key !== lastErrorKey) {
        dispatchAlert("error", {
          type: "ARENA_ERROR_SHOWN",
          error: error.text,
          errorKey: key,
          title: document.title || "Arena agent",
          url: location.href
        });
      }
    } else if (!errorMissingSince) {
      errorMissingSince = Date.now();
    } else if (Date.now() - errorMissingSince >= PANEL_RESET_DELAY_MS) {
      notifiedForCurrentError = false;
      lastErrorKey = "";
    }
  }

  function scheduleScan() {
    if (scanQueued || stopped) return;
    scanQueued = true;
    queueMicrotask(() => {
      scanQueued = false;
      scan();
    });
  }

  observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class", "style", "aria-label", "aria-hidden", "hidden"]
  });

  // MutationObserver reacts immediately; polling is a fallback for UI changes
  // that do not produce the expected mutation sequence in Arena's React tree.
  const pollingTimer = setInterval(scan, SCAN_INTERVAL_MS);
  scan();
})();
