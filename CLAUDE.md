# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`dsh-chrome` is a browser companion for DeepSeek Harness (dsh): a Chrome MV3 extension whose side panel embeds the dsh web UI, plus three dsh host plugins that let the agent read the current page, capture HTTP traffic (via CDP), and drive the browser.

## Commands

There is no build step, no test suite, and no linter — the package ships plain JS source directly (`package.json` has no scripts). Verification is manual against a running `dsh web` (default `http://127.0.0.1:3080`).

- Install host plugins into dsh: `dsh plugin --profile web add dsh-chrome` (dsh hot-applies plugin rows; a browser refresh suffices unless an already-loaded plugin file was edited — then restart dsh web).
- Install/refresh the unpacked extension: `npx dsh-chrome install` (also `path`, `uninstall`) — loaded via `chrome://extensions` → Developer mode → Load unpacked. **This copies rather than symlinks**, so after editing anything under `extension/` you must re-run install *and* hit reload in `chrome://extensions`, or Chrome keeps running the old copy. This is the most common way to "fix" something and see no change.
- Release: update `CHANGELOG.md`, bump the version in **both** `package.json` and `extension/manifest.json` (they desync easily — the manifest was left a version behind once already), tag `vX.Y.Z` and push the tag — `.github/workflows/publish.yml` publishes to npm via OIDC trusted publishing. The tag must match `package.json`'s version or the workflow fails.
- `tools/*.cjs` are ad-hoc diagnostic scripts that decompress dsh's zstd-framed session logs. `verify-intent.cjs <session-file>` replays the intent gate against real session events by importing `host/intent-gate.js` directly, so it always tests production logic — run it after touching the gate. `dump-session.cjs <session-file> <seq|from-to>…` dumps raw events. Neither is shipped (`tools/` is not in `package.json` `files`).

### Verifying a change

There are no tests, so "verified" means one of: `node --check` on the touched files; `node tools/verify-intent.cjs <session-file>` for intent-gate changes; a throwaway `node -e` harness importing `host/redact.js` or `host/intent-gate.js` (both are dependency-free and *can* run standalone, unlike the plugins); and for anything in `extension/`, actually reinstalling and reloading it against a running `dsh web`. Say which of these you did — don't call an untested change verified.

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

The tools are approval-free, so these gates are the safety model — see README "Security" and the `0.1.2` + `Unreleased` CHANGELOG entries for hard-won details:

- **Intent unlock**: exactly four tools are gated — `navigate`/`click`/`open_tab` on `INTENT_PATTERN`, `start_capture` on the separate `CAPTURE_PATTERN`. They run only when the current turn was started by a *real user* message (`source.kind === "user"`) matching that pattern. Everything else, `stop_capture` and `capture_requests` included, is ungated. The whole gate — both patterns and the `currentTurnUserText` extractor — lives in `host/intent-gate.js`, imported by both `browser-tools.js` and `tools/verify-intent.cjs`; never re-copy any of it, both halves drifted before. Keep that module free of `@deepseek-ai/*` imports so the CJS script can load it. English keywords are `\b`-anchored on purpose ("table" must not unlock "tab", "tab-separated" must not either), "go to" requires a following page/URL so "go to line 200" doesn't unlock, and standalone 抓取 ("scrape/fetch") deliberately does *not* unlock capture. **If you change the keywords, update the system-prompt list in `browser-tools.js` and both READMEs in the same edit** — they enumerate the words for the user, and an example that doesn't actually unlock ("go to") shipped that way once.
- **The gate must fail closed.** `currentTurnUserText` returns `""` when it cannot locate `turn/start`, because without turn boundaries it would otherwise scan the whole session and let a keyword from turn 1 keep the gate open forever. Any future change to turn detection must preserve that: if the turn cannot be identified, deny.
- **Injected page messages carry `source.kind: "plugin"`** and are labelled untrusted data — they must never unlock browser actions. Keep this property when touching `page-injector.js`.
- **Headers are never captured** (no Cookie/Authorization exposure); redaction of secret-shaped query params / body fields in `host/redact.js` is key-name based and best-effort by design. Captured bodies are page-controlled input running on the host's single event loop, so **every pattern applied to them must be linear** — a nested-quantifier shape check here once stalled the host for tens of seconds on a 90-byte body. Redaction **fails closed at two levels**: `redactCaptureResult` throws on an unrecognised reply envelope, while `redactEntry` throws only for a non-object entry and otherwise fails closed *by projection* — any field outside `KNOWN_ENTRY_FIELDS` is dropped (never forwarded unmasked) and named in that entry's `droppedFields`, so extension/host version skew degrades instead of killing the tool. Consequence: adding a field to captured entries in the extension **also** requires adding it to `KNOWN_ENTRY_FIELDS` (and masking it there if it can carry credentials), or it silently vanishes from tool output.
- Hard caps: 1,000,000 chars per page body and per request/response body, rolling 500 capture entries per tab. Separately, the on-demand `browser_get_page` returns ~40,000 chars and 400 links — a different limit from the 1,000,000-char auto-injection cap. Truncation travels as an explicit `truncated` flag on the `page` frame, because a body cut to exactly the cap is indistinguishable from a complete one. `host/bridge.js` is the single place that decides that flag host-side and the only host module that caps page bodies (its `MAX_PAGE_CONTENT` is private; the extension's `MAX_PAGE` is an unavoidable cross-runtime copy); it falls back to a length check only to cover older extensions that predate the flag. Everything downstream — the page injector included — consumes `page.truncated` and must not re-derive it. Every tool that reads or manipulates page state acts on the active tab only (`list_tabs` and `open_tab` are the exceptions, by nature).
- **Clicks are never retried.** `runInPage` in `extension/src/background.js` returns an explicit `ok` / `failed` / `indeterminate` status; `indeterminate` means the side effect *may* have happened. A scrape can treat that as failure (retrying a read is free), but `clickTab` must not — it reports `clicked: "unknown"` and stops. Never collapse those two statuses, and never add a CDP retry on `indeterminate`: it would click a second time on the destination page.
- **Whether a page can be scripted is decided from the tab URL** (`injectable()`), not by matching Chrome's error text. That decision gates a safety branch — "the click provably did not happen, so CDP may re-run it" — and Chrome's error prose is version- and locale-dependent, so it must not be load-bearing.
- Loopback trust model: anything on localhost can connect to the bridge, same as dsh web's `/api`. "Most recently active session" tracking is last-writer-wins across sessions — a known single-user assumption.

## Conventions

- Host plugins and the extension are ES modules; `tools/` scripts are CommonJS.
- Comments and docs are bilingual, per file. Chinese: `bridge.js`, `intent-gate.js`, `page-injector.js` (mostly), everything under `extension/`, `tools/*.cjs`, `docs/bridge-protocol.md`. English: `browser-tools.js`, `redact.js`, `bin/cli.js`, `cordis.patch.yml`, `CHANGELOG.md`, `README.md`. Match the file you're editing rather than the directory.
- `README.md` and `README.zh.md` are parallel translations — update both, in the same edit.
