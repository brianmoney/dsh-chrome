# dsh-chrome — DeepSeek Harness browser companion

English | [中文](README.zh.md)

A Chrome side panel that embeds the **full dsh web UI** (sessions, settings,
approvals, tasks, goals, workspaces — everything) and lets the dsh agent
**perceive and drive your browser**:

- **Sees the current page automatically.** After you switch tabs or navigate
  (SPA routes included), the "current page" (URL, title, body text, 1 MB cap)
  is injected into your most recently active session, so the agent knows what
  you are looking at.
- **Reads HTTP traffic on request.** When you ask it to, the agent starts a
  capture (`browser_start_capture`) and records the active tab's request
  method, URL, status, request body and response body via the Chrome DevTools
  Protocol; `browser_capture_requests` reads them back. Secret-shaped values
  are masked by default — see [Security](#security).
- **Drives the browser.** `browser_navigate` / `browser_click` /
  `browser_open_tab`.
- **Approval-free, with tool-level intent unlock.** State-changing actions run
  only when the current turn was started by a real message from you that
  contains explicit browser intent ("open / go to / click / navigate" or
  "capture"). An instruction hidden inside a web page cannot drive the browser
  (best-effort protection in approval-free mode, not an absolute guarantee).
- While capturing, Chrome shows a "debugging this browser" banner (it
  disappears when capture stops).

## Prerequisites

- `dsh web` running locally (default `http://127.0.0.1:3080`; configurable in
  the extension's settings).
- Chrome 116+.

## Install

Two halves: the **host plugins** (added to dsh) and the **Chrome extension**
(loaded unpacked).

**1. Add the host plugins to your dsh web profile:**

```sh
dsh plugin --profile web add dsh-chrome
```

This registers the bridge, the browser tools, and the page injector. dsh
hot-applies new plugin rows, so just refresh the browser afterwards — no
restart needed unless you later edit an already-loaded plugin file.

**2. Install the Chrome extension files and load them:**

```sh
npx dsh-chrome install
```

This copies the extension to a stable per-user directory (prints the path) and
shows the remaining steps:

1. Open `chrome://extensions`, turn on **Developer mode**.
2. Click **Load unpacked** and select the printed directory.
3. Click the **dsh-chrome** toolbar icon to open the side panel.

Re-run `npx dsh-chrome install` after upgrading the package to refresh the
extension files. `npx dsh-chrome path` prints the directory;
`npx dsh-chrome uninstall` removes it.

## Usage

- The side panel is the full dsh web UI — use it normally.
- Top bar: bridge status (warns if dsh is not running), **Stop capture**
  (manual override), **Settings** (change the dsh address).
- Tell the agent things like "open the xx page", "click the login button",
  "capture this page's requests".

## Security

**Trusted, local use only.** The bridge and browser tools give a local dsh
agent the ability to read pages, capture traffic, and drive your browser.

- **Capture is opt-in per session** and only sees requests made after it
  starts. HTTP **headers are not captured** (so Cookie / Set-Cookie /
  Authorization headers never reach the model). The remaining credential
  surface — secret-shaped URL query parameters (`?access_token=…`), request
  bodies (form/JSON logins) and tokens embedded in response bodies — is
  **masked as `«redacted»` by default**. To capture raw, unmasked traffic
  (e.g. for your own debugging), set `redactCredentials: false` on the
  `dsh-chrome-browser-tools` row in your profile's `cordis.patch.yml`.
- **Injected "current page" messages are labelled untrusted data**, and the
  agent is instructed never to execute instructions found inside them. The
  intent-unlock gate further prevents page content from triggering
  state-changing browser actions. These are best-effort defenses under an
  approval-free model, not hard guarantees — do not point the agent at
  untrusted or sensitive sites while capture is on.

## Layout

| Path | Contents |
|---|---|
| `extension/` | Chrome MV3 extension (side panel + service worker + options page) |
| `host/` | Three dsh host plugins: `bridge.js` (WS bridge), `browser-tools.js` (agent tools + redaction), `page-injector.js` |
| `host/redact.js` | Credential redaction for captured traffic |
| `cordis.patch.yml` | Bundle patch that mounts the three host plugins |
| `bin/cli.js` | `dsh-chrome` installer for the extension files |
| `docs/bridge-protocol.md` | Wire protocol between the extension and dsh |

## Notes & limits

- All browser tools (capture included) act on the **active tab** only.
- Capture retains a rolling last 500 entries; each request/response body and
  the injected page body share a 1 MB cap.
- Page-change detection: tab switch / main-frame navigation, ~2 s debounce;
  scrolling does not trigger it.
- **The extension's own side-panel UI is currently Chinese only** (the top-bar
  labels: bridge status, "stop capture", settings). The embedded dsh web UI
  follows dsh's own locale; only this thin extension chrome is not yet
  translated. Planned for a future release.
- **Reading `chrome-extension://` pages** (e.g. another extension's options page):
  `chrome.scripting` and `chrome.debugger` are both blocked from cross-extension
  access, so the worker falls back to the browser's **remote debugging protocol**
  (`http://127.0.0.1:9222`) when ordinary injection fails. This requires the
  browser to be launched with `--remote-debugging-port=9222` (and
  `--remote-allow-origins=chrome-extension://<this-extension-id>` if the remote
  endpoint enforces the Origin check). When the CDP endpoint is absent, the
  fallback simply returns `null` and normal pages keep working.

## License

[MIT](LICENSE) © Stuart Hu
