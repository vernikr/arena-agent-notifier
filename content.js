(() => {
  const HEADING = "Was this task successful?";
  const REQUIRED_BUTTONS = new Set(["yes", "no", "keep working"]);
  let alreadyNotified = false;
  let lastUrl = location.href;
  let scheduled = false;

  const normalize = (value) => (value || "").replace(/\\s+/g, " ").trim().toLowerCase();

  function isVisible(element) {
    return Boolean(element && (element.offsetWidth || element.offsetHeight || element.getClientRects().length));
  }

  function findCompletionPanel() {
    const headings = document.querySelectorAll("span, p, h1, h2, h3, div");
    for (const heading of headings) {
      if (normalize(heading.textContent) !== normalize(HEADING) || !isVisible(heading)) continue;

      for (let ancestor = heading; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
        const labels = new Set(
          [...ancestor.querySelectorAll("button")]
            .filter(isVisible)
            .map((button) => normalize(button.innerText || button.textContent))
        );
        if ([...REQUIRED_BUTTONS].every((label) => labels.has(label))) return ancestor;
      }
    }
    return null;
  }

  function scan() {
    scheduled = false;
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      alreadyNotified = false;
    }

    const panel = findCompletionPanel();
    if (!panel) {
      alreadyNotified = false;
      return;
    }
    if (alreadyNotified) return;

    alreadyNotified = true;
    chrome.runtime.sendMessage({
      type: "ARENA_TURN_COMPLETED",
      title: document.title || "Arena agent",
      url: location.href
    }).catch(() => {});
  }

  function scheduleScan() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(scan);
  }

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class", "style", "aria-hidden"]
  });

  scan();
})();
