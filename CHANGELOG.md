# Changelog

All notable changes to `dsh-chrome` are documented here. This project follows
[semantic versioning](https://semver.org/).

## Unreleased

- Docs: note that the extension's own side-panel UI (top-bar labels) is
  currently Chinese only; the embedded dsh web UI follows dsh's locale.

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
