(() => {
  const HEADING = "was this task successful?";
  const REQUIRED_BUTTONS = ["yes", "no", "keep working"];
  const SCAN_INTERVAL_MS = 1000;
  const PANEL_RESET_DELAY_MS = 1500;

  let observer;
  let scanQueued = false;
  let sending = false;
  let stopped = false;
  let notifiedForCurrentPanel = false;
  let panelMissingSince = 0;
  let lastUrl = location.href;

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
      button.innerText ||
      button.getAttribute("aria-label") ||
      button.textContent
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

  function notifyBackground() {
    if (sending || stopped) return;
    if (!chrome.runtime?.id) {
      stopBecauseContextWasInvalidated(new Error("chrome.runtime.id is unavailable"));
      return;
    }

    sending = true;
    const payload = {
      type: "ARENA_TURN_COMPLETED",
      title: document.title || "Arena agent",
      url: location.href
    };

    try {
      chrome.runtime.sendMessage(payload).then((response) => {
        sending = false;
        notifiedForCurrentPanel = true;
        if (!response?.ok) {
          console.error("[Arena notifier] Background rejected the alert:", response?.error || response);
          return;
        }
        if (response.errors?.length) {
          console.error("[Arena notifier] Alert delivery had errors:", response.errors);
        }
        console.info("[Arena notifier] Completion detected; alert dispatched.");
      }).catch((error) => {
        sending = false;
        const message = String(error?.message || error);
        if (/context invalidated|extension context/i.test(message)) {
          stopBecauseContextWasInvalidated(error);
        } else {
          console.error("[Arena notifier] Could not dispatch completion alert:", error);
        }
      });
    } catch (error) {
      sending = false;
      const message = String(error?.message || error);
      if (/context invalidated|extension context/i.test(message)) {
        stopBecauseContextWasInvalidated(error);
      } else {
        console.error("[Arena notifier] Could not dispatch completion alert:", error);
      }
    }
  }

  function scan() {
    if (stopped) return;

    if (location.href !== lastUrl) {
      lastUrl = location.href;
      notifiedForCurrentPanel = false;
      panelMissingSince = 0;
    }

    const panel = findCompletionPanel();
    if (!panel) {
      if (!panelMissingSince) panelMissingSince = Date.now();
      if (Date.now() - panelMissingSince >= PANEL_RESET_DELAY_MS) {
        notifiedForCurrentPanel = false;
      }
      return;
    }

    panelMissingSince = 0;
    if (!notifiedForCurrentPanel) notifyBackground();
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
