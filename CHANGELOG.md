# Changelog

All notable changes to `dsh-chrome` are documented here. This project follows
[semantic versioning](https://semver.org/).

## 0.1.2

Code-review fixes:

- **redaction**: guard `redactUrl`'s `decodeURIComponent` so a malformed `%` in a
  captured URL no longer throws and fails the whole `browser_capture_requests`
  tool. (Redaction stays key-name based and best-effort by design — see README.)
- **intent-unlock**: anchor the English keywords to word boundaries so substrings
  ("table"/"reopen"/"database") no longer unlock state-changing browser actions;
  drop the over-broad lone `抓`.
- **page-injector**: explicitly drop the `session/event` listener on dispose, and
  enforce the documented ~1 MB page-body cap host-side.
- **bridge**: on dispose close the WebSocket server, clear sockets, and reset the
  cached page; also reset it when the last browser socket disconnects, so a stale
  page can't be injected after the browser is gone.
- **CDP fallback**: add a fetch timeout (no more indefinite hangs), surface
  protocol-level errors instead of resolving null, match the CDP target by exact
  URL and fail safe on zero/ambiguous matches (never drive the wrong tab, and no
  longer exclude chrome-extension targets by requiring type `page`), and stop
  falling through to CDP on a normal page when injection returns no result.
- **cli**: ignore a non-absolute `XDG_DATA_HOME`/`LOCALAPPDATA` (per XDG spec).
- Docs: note that the extension's own side-panel UI (top-bar labels) is currently
  Chinese only, and that redaction is best-effort (treat captured traffic as
  sensitive).

## 0.1.1

- Extension: read `chrome-extension://` pages via a remote CDP (DevTools
  protocol) fallback when ordinary `chrome.scripting`/`chrome.debugger`
  injection is blocked cross-extension.

## 0.1.0

- Initial public release. Chrome side panel embedding the full dsh web UI, plus
  three dsh host plugins (WebSocket bridge, browser tools, page injector) that
  let the agent read the current page, capture HTTP traffic, and drive the
  browser.
- Install: host side via `dsh plugin --profile web add dsh-chrome`; extension via
  `npx dsh-chrome install` (cross-platform, unpacked).
- Captured traffic redacts secret-shaped query params / body fields by default
  (`redactCredentials`).
- MIT licensed.
