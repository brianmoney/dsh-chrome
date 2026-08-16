# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`dsh-chrome` is a browser companion for DeepSeek Harness (dsh): a Chrome MV3 extension whose side panel embeds the dsh web UI, plus three dsh host plugins that let the agent read the current page, capture HTTP traffic (via CDP), and drive the browser.

## Commands

There is no build step, no test suite, and no linter — the package ships plain JS source directly (`package.json` has no scripts).

- Install host plugins into dsh: `dsh plugin --profile web add dsh-chrome` (dsh hot-applies plugin rows; a browser refresh suffices unless an already-loaded plugin file was edited — then restart dsh web).
- Install/refresh the unpacked extension: `npx dsh-chrome install` (also `path`, `uninstall`) — loaded via `chrome://extensions` → Developer mode → Load unpacked. **This copies rather than symlinks**, so after editing anything under `extension/` you must re-run install *and* hit reload in `chrome://extensions`, or Chrome keeps running the old copy. This is the most common way to "fix" something and see no change.
- Release: update `CHANGELOG.md`, bump the version in **both** `package.json` and `extension/manifest.json` (they desync easily — the manifest was left a version behind once already), tag `vX.Y.Z` and push the tag — `.github/workflows/publish.yml` publishes to npm via OIDC trusted publishing. The tag must match `package.json`'s version or the workflow fails.
- `tools/*.cjs` are dev-only diagnostics over dsh's zstd-framed session logs, not shipped (`tools/` is absent from `package.json` `files`): `verify-intent.cjs <session-file>` and `dump-session.cjs <session-file> [seq|from-to]…`, both reading through `tools/session-log.cjs`.

### Verifying a change

With no test suite, "verified" means one of: `node --check` on the touched files; `node tools/verify-intent.cjs <session-file>` after any intent-gate change (it imports the production module, so it cannot drift from it); a throwaway `node -e` harness against `host/redact.js` or `host/intent-gate.js`, the two modules with no `@deepseek-ai/*` imports and therefore the only ones runnable standalone; and for anything under `extension/`, reinstalling and reloading it against a running `dsh web` (default `http://127.0.0.1:3080`). Say which you did — don't call an unexercised change verified.

## Architecture

Two halves talking over one WebSocket:

1. **Chrome extension** (`extension/`): `src/background.js` is the only place that touches Chrome APIs. It keeps a reconnecting WebSocket to `ws://<dsh>/dsh-agent/bridge`, executes `action` frames from dsh (get_page / list_tabs / navigate / click / open_tab / start_capture / stop_capture / capture_requests), captures the active tab's traffic via `chrome.debugger` (CDP), pushes debounced (~2 s) "current page" snapshots on tab switch / navigation / SPA route change, and talks to the side panel over a `chrome.runtime` port. The side panel (`sidepanel.*`) is a thin iframe around the dsh web UI plus a status top bar (currently Chinese-only UI text). For pages `chrome.scripting` cannot touch at all (`chrome-extension://`, `chrome://`, PDFs), it falls back to the remote debugging endpoint `http://127.0.0.1:9222`.

2. **dsh host plugins** (`host/`), mounted by `cordis.patch.yml` when the package is added to a dsh profile — each row is addressed by id so users can override/disable it:
   - `bridge.js` (`dsh-chrome-bridge`): registers the `/dsh-agent/bridge` WS route on the dsh web server and exposes the `dshAgentBridge` service (`call(action, params, timeoutMs)`, `onPage`, `currentPage`, plus an `isConnected` that nothing currently calls). The other two plugins consume it.
   - `browser-tools.js` (`dsh-chrome-browser-tools`): registers the `browser_*` agent tools. Runs redaction (`redact.js`) over captured traffic before it reaches the model (config `redactCredentials`, default true).
   - `page-injector.js` (`dsh-chrome-page-injector`): subscribes to page pushes and injects a "current page" message into the most recently active session (the one that last received a real user message).

`host/` also holds two **non-plugin** modules, absent from both `cordis.patch.yml` and `package.json` `exports` because they're imported by relative path: `redact.js` and `intent-gate.js` (the latter also loaded by `tools/verify-intent.cjs` via dynamic `import()`, which is why it must stay dependency-free).

The wire protocol (JSON frames: `action`/`result`/`page`/`ping`/`pong`, plus `graph-changed` broadcast by the host to make the panel refresh) is documented in `docs/bridge-protocol.md`. If you change the protocol, update `extension/src/background.js`, `host/bridge.js`, and that doc together.

`@deepseek-ai/dsh-tools` and `@deepseek-ai/dsh-llm` are peer dependencies provided by the dsh host at runtime — they are not installed in this repo, so host plugin code cannot be smoke-run standalone.

## Security invariants (do not weaken casually)

The tools are approval-free, so these gates are the safety model. Each rule below cost a real bug; the CHANGELOG has the incidents.

- **Intent unlock.** Four tools are gated: `navigate`/`click`/`open_tab` on `INTENT_PATTERN`, `start_capture` on `CAPTURE_PATTERN`. Everything else — `stop_capture` and `capture_requests` included — is ungated. The entire gate lives in `host/intent-gate.js`: patterns, the `currentTurnUserText` extractor, the `isUnlocked` decision, and the `INTENT_KEYWORDS_DOC`/`CAPTURE_KEYWORDS_DOC` strings the system prompt and refusal message interpolate. Never re-copy any of it — every piece that was ever duplicated drifted. Keep the module free of `@deepseek-ai/*` imports so `tools/verify-intent.cjs` can load it. **Changing the keywords means editing the patterns and the `*_KEYWORDS_DOC` strings together in that file, plus both READMEs** (the only copies that can't import); an example that didn't actually unlock ("go to") once shipped in the docs.
- **The gate fails closed.** `currentTurnUserText` returns `""` when it cannot find `turn/start` — otherwise it would scan the whole session and let a keyword from turn 1 hold the gate open forever. `isUnlocked` throws on an unrecognised `kind` rather than defaulting to "ungated". Preserve both directions: if the turn or the gate can't be identified, deny.
- **Injected page messages carry `source.kind: "plugin"`** and are untrusted data — they must never unlock browser actions. Keep that property when touching `page-injector.js`.
- **Redaction fails closed, and every pattern it applies must be linear.** Captured bodies are page-controlled input on the host's single event loop; a nested-quantifier shape check here once stalled it for tens of seconds on a 90-byte body. `redactCaptureResult` throws on an unrecognisable envelope; both the envelope and each entry are then *projected* onto allowlists (`KNOWN_ENVELOPE_FIELDS`, `KNOWN_ENTRY_FIELDS`), so an unknown field is dropped rather than forwarded and is named in `droppedFields`. Consequence: adding a field in the extension requires adding it to the matching allowlist, or it silently vanishes. `MENTIONS_SECRET` is *derived* from `SECRET_KEY_NAMES` so the fast path cannot narrow what gets masked — keep it derived; the hand-maintained version leaked percent-encoded keys.
- **Clicks are never retried.** `runInPage` returns `ok` / `failed` / `indeterminate`; `indeterminate` means the side effect *may* have happened. A scrape may treat that as failure (re-reading is free); `clickTab` must not — it reports `clicked: "unknown"` and stops. Never collapse the two statuses, and never add a CDP retry on `indeterminate`.
- **Transport is chosen from the tab URL** (`injectable()`), never from Chrome's error prose, which is version- and locale-dependent. `injectionNeverRan()` does match that prose, but only to *narrow* `indeterminate` → `failed`; a Chrome rewording therefore degrades to the safe side. Prose may never widen toward re-running a side effect.
- Hard caps: 1,000,000 chars per page body and per request/response body, 500 capture entries per tab. `browser_get_page` is a *separate*, smaller budget (~40,000 chars, 400 links). Truncation travels as the `truncated` flag on the `page` frame — a body cut to exactly the cap is indistinguishable from a whole one by length. `host/bridge.js` alone decides that flag host-side and caps page bodies (`MAX_PAGE_CONTENT` is private; the extension's `MAX_PAGE` is an unavoidable cross-runtime copy); everything downstream consumes `page.truncated` and must not re-derive it.
- Tools that read or manipulate page state act on the active tab only; `list_tabs` and `open_tab` are the natural exceptions.
- Loopback trust model: anything on localhost can connect to the bridge, same as dsh web's `/api`. "Most recently active session" tracking is last-writer-wins — a known single-user assumption.

## Conventions

- Host plugins and the extension are ES modules; `tools/` scripts are CommonJS.
- Comments and docs are bilingual, per file. Chinese: `bridge.js`, `intent-gate.js`, `page-injector.js` (mostly), everything under `extension/`, `tools/*.cjs`, `docs/bridge-protocol.md`. English: `browser-tools.js`, `redact.js`, `bin/cli.js`, `cordis.patch.yml`, `CHANGELOG.md`, `README.md`. Match the file you're editing rather than the directory.
- `README.md` and `README.zh.md` are parallel translations — update both, in the same edit.
