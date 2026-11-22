const notificationInput = document.getElementById("notifications");
const soundInput = document.getElementById("sound");
const testButton = document.getElementById("test");
const status = document.getElementById("status");

function showStatus(lines) {
  status.textContent = lines.join("\n");
}

async function loadSettings() {
  const settings = await chrome.storage.local.get({
    notificationsEnabled: true,
    soundEnabled: true
  });
  notificationInput.checked = settings.notificationsEnabled;
  soundInput.checked = settings.soundEnabled;

  const diagnostics = await chrome.runtime.sendMessage({ type: "GET_DIAGNOSTICS" });
  if (diagnostics?.ok) {
    showStatus([
      `Notifications: ${diagnostics.notificationsEnabled ? "ON" : "OFF"}`,
      `Chrome permission: ${diagnostics.notificationPermission || "unknown"}`,
      diagnostics.lastNotificationId
        ? `Last created: ${diagnostics.lastNotificationId}`
        : "No notification created in this session"
    ]);
  }
}

notificationInput.addEventListener("change", async () => {
  await chrome.storage.local.set({ notificationsEnabled: notificationInput.checked });
  showStatus([notificationInput.checked ? "Browser notifications enabled" : "Browser notifications disabled"]);
});

soundInput.addEventListener("change", async () => {
  await chrome.storage.local.set({ soundEnabled: soundInput.checked });
});

testButton.addEventListener("click", async () => {
  testButton.disabled = true;
  showStatus(["Sending test notification…"]);
  try {
    const result = await chrome.runtime.sendMessage({ type: "TEST_ALERT" });
    if (!result?.ok) {
      showStatus(["Test failed", result?.error || "Unknown background error"]);
      return;
    }

    const lines = [
      `Chrome permission: ${result.notificationPermission || "unknown"}`,
      `Notifications setting: ${result.notificationsEnabled ? "ON" : "OFF"}`,
      `Notification created: ${result.notificationCreated ? "YES" : "NO"}`,
      `In Chrome active list: ${result.notificationActive ? "YES" : "NO"}`,
      `Sound: ${result.soundEnabled ? "ON" : "OFF"}`
    ];
    if (result.errors?.length) lines.push(...result.errors);
    if (result.notificationId) lines.push(`ID: ${result.notificationId}`);
    showStatus(lines);
  } catch (error) {
    showStatus([`Test failed: ${error.message || error}`]);
  } finally {
    testButton.disabled = false;
  }
});

loadSettings().catch((error) => {
  showStatus([`Could not load settings: ${error.message || error}`]);
});
