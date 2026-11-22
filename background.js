const DEFAULT_SETTINGS = {
  notificationsEnabled: true,
  soundEnabled: true
};

let creatingOffscreenDocument;

async function getSettings() {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function ensureOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) return;
  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Play a short sound when an Arena agent turn completes."
    }).finally(() => {
      creatingOffscreenDocument = undefined;
    });
  }
  await creatingOffscreenDocument;
}

async function playCompletionSound() {
  await ensureOffscreenDocument();
  await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "PLAY_COMPLETION_SOUND"
  });
}

async function showCompletionNotification(details, tab) {
  const notificationId = `arena-turn-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const key = `notification:${notificationId}`;

  // Save the destination before displaying the notification, so an immediate
  // click can never race the storage write.
  await chrome.storage.session.set({
    [key]: {
      tabId: tab?.id ?? null,
      windowId: tab?.windowId ?? null,
      url: details.url || tab?.url || "https://arena.ai/agent"
    }
  });

  try {
    await chrome.notifications.create(notificationId, {
      type: "basic",
      iconUrl: "icons/icon-128.png",
      title: "Arena: agent завершил ход",
      message: "Появилась панель оценки результата.",
      contextMessage: details.title || "Arena Agent",
      priority: 2,
      requireInteraction: false,
      silent: true
    });
  } catch (error) {
    await chrome.storage.session.remove(key);
    throw error;
  }
}

async function handleCompletion(details, tab) {
  const settings = await getSettings();
  const jobs = [];

  if (settings.notificationsEnabled) {
    jobs.push(showCompletionNotification(details, tab));
  }
  if (settings.soundEnabled) {
    jobs.push(playCompletionSound());
  }

  const results = await Promise.allSettled(jobs);
  const errors = results
    .filter((result) => result.status === "rejected")
    .map((result) => String(result.reason?.message || result.reason));

  const result = {
    notificationsEnabled: settings.notificationsEnabled,
    soundEnabled: settings.soundEnabled,
    errors
  };

  await chrome.storage.local.set({
    lastAlertAt: Date.now(),
    lastAlertUrl: details.url || tab?.url || "",
    lastAlertErrors: errors
  });

  if (errors.length) {
    console.error("[Arena notifier] One or more alert channels failed:", errors);
  }
  return result;
}

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(DEFAULT_SETTINGS);
  await chrome.storage.local.set({
    notificationsEnabled: current.notificationsEnabled ?? true,
    soundEnabled: current.soundEnabled ?? true
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === "offscreen") return;

  if (message?.type === "ARENA_TURN_COMPLETED" || message?.type === "TEST_ALERT") {
    const details = message.type === "TEST_ALERT"
      ? { title: "Проверка уведомления", url: "https://arena.ai/agent" }
      : message;

    handleCompletion(details, sender.tab).then(
      (result) => sendResponse({ ok: true, ...result }),
      (error) => {
        console.error("[Arena notifier] Alert delivery failed:", error);
        sendResponse({ ok: false, error: String(error?.message || error) });
      }
    );
    return true;
  }
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
  const key = `notification:${notificationId}`;
  const stored = await chrome.storage.session.get(key);
  const target = stored[key];

  if (target?.tabId !== null && target?.tabId !== undefined) {
    try {
      await chrome.tabs.update(target.tabId, { active: true });
      if (target.windowId !== null) {
        await chrome.windows.update(target.windowId, { focused: true });
      }
    } catch {
      await chrome.tabs.create({ url: target.url || "https://arena.ai/agent" });
    }
  } else if (target?.url) {
    await chrome.tabs.create({ url: target.url });
  }

  await chrome.storage.session.remove(key);
  await chrome.notifications.clear(notificationId);
});

chrome.notifications.onClosed.addListener(async (notificationId) => {
  await chrome.storage.session.remove(`notification:${notificationId}`);
});
