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
  await chrome.runtime.sendMessage({ target: "offscreen", type: "PLAY_COMPLETION_SOUND" });
}

async function showCompletionNotification(details, tab) {
  const notificationId = `arena-turn-${Date.now()}`;
  const title = "Arena: agent завершил ход";
  const message = "Появилась панель оценки результата.";

  await chrome.notifications.create(notificationId, {
    type: "basic",
    iconUrl: "icons/icon-128.png",
    title,
    message,
    contextMessage: details.title || "Arena Agent",
    priority: 2,
    requireInteraction: false,
    silent: true
  });

  await chrome.storage.session.set({
    [`notification:${notificationId}`]: {
      tabId: tab?.id ?? null,
      windowId: tab?.windowId ?? null,
      url: details.url || tab?.url || "https://arena.ai/agent"
    }
  });
}

async function handleCompletion(details, tab) {
  const settings = await getSettings();
  const tasks = [];
  if (settings.notificationsEnabled) {
    tasks.push(showCompletionNotification(details, tab));
  }
  if (settings.soundEnabled) {
    tasks.push(playCompletionSound());
  }
  await Promise.allSettled(tasks);
}

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(DEFAULT_SETTINGS);
  await chrome.storage.local.set({
    notificationsEnabled: current.notificationsEnabled ?? true,
    soundEnabled: current.soundEnabled ?? true
  });
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.target === "offscreen") return;

  if (message?.type === "ARENA_TURN_COMPLETED") {
    void handleCompletion(message, sender.tab);
    return;
  }

  if (message?.type === "TEST_ALERT") {
    void handleCompletion({
      title: "Проверка уведомления",
      url: "https://arena.ai/agent"
    });
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
