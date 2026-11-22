const audio = document.getElementById("completion-sound");

chrome.runtime.onMessage.addListener((message) => {
  if (message?.target !== "offscreen" || message?.type !== "PLAY_COMPLETION_SOUND") return;

  audio.currentTime = 0;
  audio.play().catch((error) => {
    console.warn("Arena notifier could not play the completion sound:", error);
  });
});
