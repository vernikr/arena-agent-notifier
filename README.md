# Arena Agent Turn Notifier

A small Chrome Manifest V3 extension that alerts when an Arena agent finishes a turn.

## What it detects

On `https://arena.ai/agent/*`, the extension watches for the review panel containing:

- `Was this task successful?`
- `Yes`
- `No`
- `Keep working`

It uses visible text and the panel's button labels instead of Arena's generated CSS classes. Detection runs through microtasks rather than animation frames, so it also works while the Arena tab is in the background. Each appearance triggers one notification and, when enabled, a short three-note chime.

## Features

- Native Chrome notification; clicking it returns to the corresponding Arena tab.
- Packaged WAV sound played through an offscreen document.
- Independent notification and sound toggles in the extension popup.
- Test button to verify both alert channels.
- No third-party libraries, analytics, remote services, or network requests.

## Install locally

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose this repository directory.
5. Open an Arena agent page and use the extension popup to test the alert.

## Development

The extension uses plain JavaScript and Chrome Extension APIs. After changing files, select **Reload** on the extension card in `chrome://extensions`.

## Permissions

- `notifications`: show the completion alert.
- `offscreen`: play the packaged sound from an offscreen document.
- `storage`: persist two user preferences and notification tab targets.
- Host access to `https://arena.ai/*`: observe Arena agent pages.

## License

MIT.
