# Arena Agent Turn Notifier

A small Chrome Manifest V3 extension that alerts when an Arena agent finishes a turn, asks the user a question, or shows an error banner.

## What it detects

On `https://arena.ai/agent/*`, the extension watches for three kinds of panels.

### Turn completed

The review panel containing:

- `Was this task successful?`
- `Yes`
- `No`
- `Keep working`

### Question for the user

The question card Arena renders when an agent asks the user to choose between options. It is recognised by:

- a visible `role="radiogroup"` with at least two options, or a visible free-text field with the `Revise options or write your own...` placeholder;
- a visible `Skip` button (when the card has one) in the same card;
- the question text, taken from the radiogroup `aria-label` or the card heading.

### Error banner

The red error block Arena renders when something goes wrong (`Something went wrong. Please try again.` and similar texts). It is recognised by:

- a visible `role="alert"` element with meaningful text;
- as a fallback, a visible banner with Arena's red error background.

The extension checks visible text, ARIA roles and placeholders rather than Arena's generated CSS classes. Detection uses a MutationObserver, microtasks, and a one-second polling fallback, including while the tab is in the background. It avoids duplicate alerts while the same panel remains visible, and alerts again when a new question or a different error text replaces the previous one.

## Features

- Native Chrome notification; clicking it focuses the browser window and activates the exact Arena tab that completed the turn, asked the question, or shown the error. The tab destination is saved before the notification appears to avoid click races.
- Packaged WAV sound played through an offscreen document.
- Independent notification and sound toggles in the extension popup.
- Test button to verify both alert channels.
- Delivery errors are logged in the extension and page consoles.
- No third-party libraries, analytics, remote services, or network requests.

## Install locally

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose this repository directory.
5. Open an Arena agent page and use the extension popup to test the alert.

After reloading/updating the extension, refresh all open Arena tabs once so they receive the new content script.

## Development

The extension uses plain JavaScript and Chrome Extension APIs. After changing files, select **Reload** on the extension card in `chrome://extensions`, then refresh Arena tabs.

## Permissions

- `notifications`: show the completion, question, and error alerts.
- `offscreen`: play the packaged sound from an offscreen document.
- `storage`: persist preferences, delivery status, and notification tab targets.
- Host access to `https://arena.ai/*`: observe Arena agent pages.

## License

MIT.
