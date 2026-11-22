const notificationInput = document.getElementById("notifications");
const soundInput = document.getElementById("sound");
const testButton = document.getElementById("test");
const status = document.getElementById("status");

async function loadSettings() {
  const settings = await chrome.storage.local.get({
    notificationsEnabled: true,
    soundEnabled: true
  });
  notificationInput.checked = settings.notificationsEnabled;
  soundInput.checked = settings.soundEnabled;
}

notificationInput.addEventListener("change", async () => {
  await chrome.storage.local.set({ notificationsEnabled: notificationInput.checked });
});

soundInput.addEventListener("change", async () => {
  await chrome.storage.local.set({ soundEnabled: soundInput.checked });
});

testButton.addEventListener("click", async () => {
  status.textContent = "Sending test alert…";
  await chrome.runtime.sendMessage({ type: "TEST_ALERT" });
  status.textContent = "Test alert sent";
});

loadSettings().catch(() => {
  status.textContent = "Could not load settings";
});
