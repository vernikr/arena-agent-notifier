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
  return true;
}

async function showCompletionNotification(details, tab) {
  const notificationId = `arena-turn-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const key = `notification:${notificationId}`;

  await chrome.storage.session.set({
    [key]: {
      tabId: tab?.id ?? null,
      windowId: tab?.windowId ?? null,
      url: details.url || tab?.url || "https://arena.ai/agent"
    }
  });

  try {
    const createdId = await chrome.notifications.create(notificationId, {
      type: "basic",
      iconUrl: "icons/icon-128.png",
      title: "Arena: agent завершил ход",
      message: "Появилась панель оценки результата.",
      contextMessage: details.title || "Arena Agent",
      priority: 2,
      requireInteraction: true,
      silent: true
    });

    if (!createdId) {
      throw new Error("Chrome returned an empty notification ID");
    }
    return createdId;
  } catch (error) {
    await chrome.storage.session.remove(key);
    throw error;
  }
}

async function readNotificationDiagnostics(notificationId = null) {
  const [permission, active] = await Promise.all([
    chrome.notifications.getPermissionLevel(),
    chrome.notifications.getAll()
  ]);
  return {
    notificationPermission: permission,
    activeNotificationIds: Object.keys(active),
    notificationActive: notificationId ? Boolean(active[notificationId]) : null
  };
}

async function handleCompletion(details, tab) {
  const settings = await getSettings();
  const notificationJob = settings.notificationsEnabled
    ? showCompletionNotification(details, tab)
    : Promise.resolve(null);
  const soundJob = settings.soundEnabled
    ? playCompletionSound()
    : Promise.resolve(false);

  const [notificationResult, soundResult] = await Promise.allSettled([
    notificationJob,
    soundJob
  ]);

  const errors = [];
  if (notificationResult.status === "rejected") {
    errors.push(`notification: ${String(notificationResult.reason?.message || notificationResult.reason)}`);
  }
  if (soundResult.status === "rejected") {
    errors.push(`sound: ${String(soundResult.reason?.message || soundResult.reason)}`);
  }

  const notificationId = notificationResult.status === "fulfilled"
    ? notificationResult.value
    : null;

  let diagnostics = {};
  try {
    diagnostics = await readNotificationDiagnostics(notificationId);
  } catch (error) {
    errors.push(`diagnostics: ${String(error?.message || error)}`);
  }

  const result = {
    notificationsEnabled: settings.notificationsEnabled,
    soundEnabled: settings.soundEnabled,
    notificationId,
    notificationCreated: Boolean(notificationId),
    ...diagnostics,
    errors
  };

  await chrome.storage.local.set({
    lastAlertAt: Date.now(),
    lastAlertUrl: details.url || tab?.url || "",
    lastAlertErrors: errors,
    lastNotificationId: notificationId,
    lastNotificationPermission: diagnostics.notificationPermission ?? "unknown",
    lastNotificationActive: diagnostics.notificationActive ?? false
  });

  if (errors.length) {
    console.error("[Arena notifier] Alert delivery errors:", errors);
  }
  console.info("[Arena notifier] Alert diagnostics:", result);
  return result;
}

async function getDiagnostics() {
  const [settings, stored, notificationDiagnostics] = await Promise.all([
    getSettings(),
    chrome.storage.local.get([
      "lastAlertAt",
      "lastAlertUrl",
      "lastAlertErrors",
      "lastNotificationId",
      "lastNotificationPermission",
      "lastNotificationActive"
    ]),
    readNotificationDiagnostics()
  ]);
  return {
    ...settings,
    ...stored,
    ...notificationDiagnostics
  };
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

  if (message?.type === "GET_DIAGNOSTICS") {
    getDiagnostics().then(
      (result) => sendResponse({ ok: true, ...result }),
      (error) => sendResponse({ ok: false, error: String(error?.message || error) })
    );
    return true;
  }

  if (message?.type === "ARENA_TURN_COMPLETED" || message?.type === "TEST_ALERT") {
    const details = message.type === "TEST_ALERT"
      ? { title: "Проверка уведомления", url: "https://arena.ai/agent", isTest: true }
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

chrome.notifications.onClosed.addListener(async (notificationId, byUser) => {
  if (byUser) {
    await chrome.storage.session.remove(`notification:${notificationId}`);
  }
});
