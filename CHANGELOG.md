# Changelog

All notable changes to `dsh-chrome` are documented here. This project follows
[semantic versioning](https://semver.org/).

## Unreleased

Follow-up fixes to the 0.1.2 code-review round:

- **redaction hang (security)**: the form-body shape check
  (`^[^\s]*=[^\s]*(?:&[^\s]*=[^\s]*)*$`) nests quantifiers that also match the
  separators, so a ~90-byte form-shaped body with trailing whitespace
  backtracked for tens of seconds — measured 18.7 s at 85 bytes, growing ~2.6x
  per added field — synchronously stalling the whole dsh host. The line is old,
  but the redaction fix below is what first put captured (page-controlled)
  bodies through it. Replaced with two linear scans, and `redactBody` now
  short-circuits on bodies that mention no secret-ish key at all *and* contain
  no escape sequence that could spell one (`%74oken`, `token`) — keys are
  compared after decoding, so a raw-text scan alone would have narrowed what
  gets masked. Roughly 6x faster on the common case, skipping the
  parse/deep-clone/re-stringify entirely.

- **intent gate fails closed (security)**: when no `turn/start` event could be
  found, the turn-text extractor fell through to scanning the entire session,
  so a browser keyword typed in turn 1 kept the gate unlocked for every later
  turn — and an instruction hidden in an injected page could act on it. It now
  returns empty (denying the action) when the turn cannot be identified. This
  bug predates the extraction into `host/intent-gate.js`.
- **intent keywords narrowed**: "go to" only unlocks when followed by a page or
  URL (`go to github.com`, `go to the page`), so "go to line 200" / "go to the
  next step" no longer do; bare `goto` (a programming keyword) was dropped; and
  `tab` no longer matches inside "tab-separated".

- **redaction (security)**: actually redact captured traffic — the 0.1.2
  transform only handled a bare array, but `capture_requests` returns
  `{tabId, capturing, count, entries}`, so redaction never ran and secrets
  reached the model unmasked. Redaction now lives in `host/redact.js` and fails
  closed at two levels: `redactCaptureResult` raises an error on an
  unrecognised reply envelope, and `redactEntry` projects each entry onto an
  allowlist — a field it does not know is dropped rather than forwarded
  unmasked, and named in that entry's `droppedFields`, so extension/host
  version skew degrades instead of erroring the whole tool. The envelope is
  allowlisted the same way, so an added top-level field cannot carry a URL or
  body past redaction either.
- **intent-unlock**: allow common English inflections ("opening", "clicking",
  "tabs", "capturing", "debugging") that the 0.1.2 `\b` anchoring accidentally
  rejected, while keeping the substring protection ("table"/"reopen"/
  "database" still don't unlock); sync `tools/verify-intent.cjs` with the
  production pattern. Standalone 抓取 stays excluded from the capture gate
  (it is ordinary "scrape/fetch" — a read intent).
- **CDP fallback**: the 5 s endpoint timeout now also bounds the response-body
  read (was disarmed once headers arrived); non-JSON responses get a clear
  error. Target selection no longer guesses from URLs: it joins
  `chrome.debugger.getTargets()` (which exposes each target's `tabId` and
  DevTools id) against `/json/list` by target id, so the right tab is
  identified even when two tabs share a URL, the URL drifts mid-navigation, or
  an iframe (such as the side panel's own embedded dsh UI) shares the address.
  The URL fallback, used only when `getTargets()` is unavailable, is
  exact-match, excludes iframe targets, and still fails safe on ambiguity.
- **get_page**: CDP errors (endpoint missing, target not listed, timeout) now
  surface as tool errors instead of a silent `ok: true` with a null page. The
  CDP fallback runs only when Chrome refused the injection outright (the page
  cannot be scripted at all); every other injection failure reports the real,
  usually retryable error rather than a misleading "start the browser with
  --remote-debugging-port" message.
- **click**: never retried — a click is not idempotent. A click is reported as
  `clicked: "unknown"` (with a note to verify via `browser_get_page`) whenever
  the extension cannot tell whether it fired, including when the frame is torn
  down by the click's own navigation. An in-page exception (e.g. a malformed
  selector, which Chrome surfaces in the injection result's `error` field
  rather than by rejecting) is now correctly reported as "no click happened".
  The CDP fallback runs only when injection was rejected outright
  (cross-extension page etc., where the click cannot have happened).
- **page scrape / click scripts**: the injected and CDP copies of both scripts
  were separate implementations that had already diverged (`document.body?.
  innerText` vs a ternary, differing on a null `innerText`). Both paths now
  serialize one shared top-level function.
- **intent gate**: the keyword patterns and the `currentTurnUserText` extractor
  moved to `host/intent-gate.js`, imported by both `browser-tools.js` and
  `tools/verify-intent.cjs`, which previously kept hand-copied duplicates of
  both halves that had drifted from production.
- **page push**: check the bridge socket before scraping — with dsh not
  running, every tab switch and navigation was paying for a full page
  extraction whose result was then discarded.
- **removed dead code**: the service worker registered a `composer-history`
  content script (`src/composer-history.js`, an ↑/↓ input-history feature) that
  has never existed in this package, so the registration failed silently on
  every startup and on every settings change. Dropped the registration; the
  `dsh_url` settings listener still reloads the address.
- **page cap**: align the host-side page-body cap with the extension's
  (1,000,000 chars, was 1,048,576) and enforce it at the bridge entry point,
  flattening the sliced string so an oversized push can't stay pinned in
  memory. Truncation is now reported end-to-end via an explicit `truncated`
  flag on the `page` frame (a body cut to exactly the cap is indistinguishable
  from a complete one by length), and the injected message says
  "[page body truncated]" instead of presenting a cut body as complete. The
  bridge is the only module that caps page bodies or decides that flag;
  everything downstream just consumes `page.truncated`.
- **SPA routes**: `history.pushState` navigations fire
  `webNavigation.onHistoryStateUpdated`, not `onCommitted`, so single-page-app
  route changes never triggered a page push despite both READMEs and the
  code's own comment claiming SPA support. Added the missing listener.
- **intent keywords**: "go to" / "goto" / 前往 now unlock browser actions.
  Both the README and the agent's system prompt offered "go to" as an example,
  but the pattern never matched it, so following the documented example got
  you a refusal.
- **CDP target lookup**: a target id that `chrome.debugger.getTargets()` knows
  but `/json/list` does not now falls through to URL matching instead of
  erroring. `/json/list` omits `webSocketDebuggerUrl` for targets that already
  have a debugger attached — i.e. right after `browser_start_capture`, or with
  DevTools open on that tab — where the old code reported the misleading "port
  9222 may belong to another browser instance".
- **click (CDP path)**: a lost `Runtime.evaluate` reply (timeout or dropped
  connection after the request was sent) now reports `clicked: "unknown"` like
  the injection path, instead of reporting failure and inviting the agent to
  click a second time. Errors raised before the expression was sent still
  report failure, since the click provably did not happen.
- **page push**: skip tabs whose `url` is empty (not yet committed) rather than
  falling through the `http(s)` guard and scraping them.
- **extension**: sync `manifest.json` version with `package.json`, and raise
  `minimum_chrome_version` to 118 — `InjectionResult.error`, which the click
  and scrape paths rely on to tell "threw in-page" from "no frame result",
  only exists from Chrome 118.
- **extension internals**: `scrapeTab` and `clickTab` were the same
  inject → classify → maybe-fall-back-to-CDP state machine written twice (an
  earlier round had deduplicated only the page-side function bodies), and had
  already drifted. Both now go through one `runInPage` returning an explicit
  `ok` / `failed` / `indeterminate` status, and each applies its own policy:
  a scrape can be retried so it reports failure, a click cannot so it reports
  `clicked: "unknown"`. Whether a page can be scripted at all is now decided
  structurally from the tab URL (`injectable()`) rather than by regex-matching
  Chrome's English error prose, which was driving a safety decision.
- **click result**: the extension now emits the bare fact
  (`clicked: "unknown"` plus a machine-readable `reason`); the agent-facing
  wording is rendered host-side in `browser_click`, in the same language as the
  rest of that tool's prose.
- **SPA page pushes**: `onHistoryStateUpdated` fires for background tabs too,
  so a `pushState`-heavy app in an unfocused tab (Gmail, Slack, Jira…) was
  triggering full re-extraction of the *active* page. Navigation events now
  only schedule a push for the active tab, and a push whose URL and body length
  are unchanged is skipped — `replaceState` loops were re-injecting an
  identical up-to-1 MB message each time. The dedup memory is cleared on bridge
  reconnect, because the host drops its cached page when the last socket
  closes; without that, a restarted `dsh web` would never be told what page you
  are on until you happened to navigate elsewhere.
- **captured bodies**: cap them with a flattening copy, so a 50 MB response no
  longer stays pinned in memory behind a 1 MB `slice` view for the lifetime of
  the tab (up to 500 entries each).
- **intent gate**: `host/intent-gate.js` now exports the whole decision
  (`isUnlocked`), plus `textOf` and the user-facing keyword list, so the tools
  layer, the system prompt, and `tools/verify-intent.cjs` all consume one
  implementation instead of re-composing it. `go to tab-separated data` no
  longer unlocks (the `go to` object list was overriding the `tab-separated`
  exclusion).
- **tools**: extracted the zstd session-log reader both diagnostic scripts had
  copied into `tools/session-log.cjs`. `dump-session.cjs` read the assistant payload shape for user
  messages, so its no-argument default mode printed nothing at all; it now
  accepts both shapes (matching `intent-gate.js`) and takes seq numbers or a
  `from-to` range on the command line instead of hardcoding one past session's.
- Docs: brought the docs back in line with the code after the rounds above —
  corrected the `click` result shape and documented the `graph-changed` frame
  in `docs/bridge-protocol.md`; fixed stale claims in both READMEs (the CDP
  fallback no longer "returns null", `browser_get_page`'s 40,000-char limit is
  not the 1 MB injection cap, the unlocking keyword list); restored
  README.md/README.zh.md parity; and refreshed the file-header comments and
  `CLAUDE.md` invariants that the refactors had invalidated.

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
