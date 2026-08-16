// Credential redaction for captured HTTP traffic.
//
// The extension records each request's URL and postData and each response's
// body (see extension/src/background.js). It does NOT capture request or
// response headers, so Cookie / Set-Cookie / Authorization headers never reach
// the agent. The remaining credential surface is:
//   - secret-shaped query parameters in the URL (?token=..., ?access_token=...)
//   - secret-shaped fields in request bodies (form-encoded or JSON logins)
//   - tokens embedded in response bodies (e.g. an auth endpoint's JSON)
//
// By default browser_capture_requests masks the values of secret-shaped keys
// in all three places while leaving everything else intact, so the traffic
// stays useful for debugging without piping live credentials into the model.
// Set the plugin's `redactCredentials: false` config to disable this.
//
// Redaction is an allowlist and fails closed: an unrecognised reply envelope
// throws, and per-entry fields outside KNOWN_ENTRY_FIELDS are dropped (never
// forwarded unmasked) and reported in the entry's `droppedFields`.

const REDACTED = "«redacted»";

// Key names whose *values* are treated as secrets, matched case-insensitively
// as a whole word / boundary inside query params, form fields and JSON keys.
const SECRET_KEY = /(?:^|[_-])(?:token|access[_-]?token|refresh[_-]?token|id[_-]?token|secret|password|passwd|pwd|api[_-]?key|apikey|auth|authorization|session|sessionid|sid|cookie|credential|client[_-]?secret|private[_-]?key|signature|sig)$/i;

// Cheap pre-filter: does this blob mention any secret-ish key name at all?
// Bodies without one — the overwhelming majority — can skip parsing entirely.
// Deliberately looser than SECRET_KEY (no anchors): it must never say "no"
// when SECRET_KEY would say "yes".
const MENTIONS_SECRET =
  /token|secret|passw|pwd|api[_-]?key|apikey|auth|session|sid|cookie|credential|private[_-]?key|signature|sig/i;

// …but key names reach isSecretKey DECODED (redactPairs percent-decodes, and
// JSON.parse resolves \uXXXX), so a scan of the raw text can miss a secret key
// that is spelled in escapes: `%74oken=…` and `{"token":…}` both decode to
// `token`. Any body containing an escape sequence therefore skips the fast path
// and gets processed in full — correctness beats the speedup here.
const HAS_ESCAPES = /%[0-9a-f]{2}|\\u[0-9a-f]{4}/i;

function isSecretKey(key) {
  if (typeof key !== "string") return false;
  // No `SECRET_KEY.test("_" + key)` companion check: SECRET_KEY already starts
  // with `(?:^|[_-])`, so prefixing "_" can only re-match what `^` matched.
  return SECRET_KEY.test(key);
}

/**
 * Mask secret values in an `a=1&b=2` pair string. Shared by the URL query and
 * the form-body paths so masking semantics (separators, %-decoding, which half
 * is masked) can only ever be changed in one place.
 */
function redactPairs(pairs) {
  return pairs
    .split("&")
    .map((pair) => {
      const eq = pair.indexOf("=");
      if (eq === -1) return pair;
      const key = pair.slice(0, eq);
      let decoded;
      try {
        decoded = decodeURIComponent(key);
      } catch {
        decoded = key; // malformed %-encoding: fall back to the raw key
      }
      return isSecretKey(decoded) ? `${key}=${REDACTED}` : pair;
    })
    .join("&");
}

/** Mask secret query-parameter values in a URL, leaving the rest readable. */
export function redactUrl(url) {
  if (typeof url !== "string" || !url.includes("?")) return url;
  const qIndex = url.indexOf("?");
  const base = url.slice(0, qIndex);
  const [query, hash = ""] = url.slice(qIndex + 1).split("#");
  return base + "?" + redactPairs(query) + (hash ? "#" + hash : "");
}

/** Mask secret values inside a JSON value in place (returns a new value). */
function redactJson(value) {
  if (Array.isArray(value)) return value.map(redactJson);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = isSecretKey(k) ? REDACTED : redactJson(v);
    }
    return out;
  }
  return value;
}

/**
 * Mask secret fields in a request/response body string. Handles JSON objects
 * and URL-encoded form bodies; anything else is returned unchanged (we do not
 * guess at arbitrary blobs).
 */
export function redactBody(body) {
  if (typeof body !== "string" || body.length === 0) return body;
  // Bail before parsing when nothing in the blob even looks like a secret key
  // and nothing could be hiding one behind an escape sequence. Captured bodies
  // routinely run to the 1 MB cap, and parse + deep-clone + re-stringify costs
  // ~30x this scan — on a payload we'd hand back unchanged.
  if (!MENTIONS_SECRET.test(body) && !HAS_ESCAPES.test(body)) return body;
  const trimmed = body.trim();

  // JSON body.
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.stringify(redactJson(JSON.parse(trimmed)));
    } catch {
      // fall through to form handling / passthrough
    }
  }

  // URL-encoded form body (key=value&key=value), no whitespace, at least one
  // '='. Checked with two linear scans, NOT a regex: the obvious shape regex
  // (`^[^\s]*=[^\s]*(?:&[^\s]*=[^\s]*)*$`) nests quantifiers that also match
  // the separators, so a ~90-byte form-ish body with trailing whitespace
  // backtracked for tens of seconds and stalled the whole dsh host.
  if (!/\s/.test(trimmed) && trimmed.includes("=")) {
    return redactPairs(trimmed);
  }

  return body;
}

// Envelope fields the extension replies with (see the capture_requests case in
// extension/src/background.js). Like the per-entry allowlist below, anything
// outside this set is dropped rather than forwarded: a future envelope-level
// field could just as easily carry a URL or a body.
const KNOWN_ENVELOPE_FIELDS = new Set(["tabId", "capturing", "count", "entries"]);

/**
 * Redact a browser_capture_requests result. The extension replies with
 * {tabId, capturing, count, entries: [...]}. Fail closed: an envelope without a
 * recognisable `entries` array throws rather than passing traffic through
 * unredacted, and any *extra* envelope field is dropped (never forwarded
 * unmasked) and named in `droppedFields` — so no reply-shape change can
 * silently bypass masking while the tool still promises «redacted».
 */
export function redactCaptureResult(result) {
  // (An array's `.entries` is Array.prototype.entries, a function, so the
  // Array.isArray check below also rejects a bare array.)
  if (!result || typeof result !== "object" || !Array.isArray(result.entries)) {
    throw new Error(
      "capture_requests returned an unexpected shape; refusing to pass it through unredacted"
    );
  }
  const out = {};
  const dropped = [];
  for (const [key, value] of Object.entries(result)) {
    if (!KNOWN_ENVELOPE_FIELDS.has(key)) dropped.push(key);
    else out[key] = value;
  }
  out.entries = result.entries.map(redactEntry);
  if (dropped.length) out.droppedFields = dropped;
  return out;
}

// Fields the extension records per capture entry (see the Network.* handlers
// in extension/src/background.js). Redaction is an allowlist: url/postData/body
// are masked, the rest are non-credential metadata copied as-is.
const KNOWN_ENTRY_FIELDS = new Set([
  "id",
  "seq",
  "method",
  "url",
  "type",
  "postData",
  "status",
  "mimeType",
  "body",
  "time",
  "redirect",
]);

/**
 * Redact one capture entry (url, postData, body). Returns a new object.
 *
 * Fails closed by projection rather than by throwing: the extension and the
 * host plugin update independently, so an extension that starts recording a
 * new per-entry field is normal version skew. Such a field is DROPPED (never
 * forwarded unmasked) and named in `droppedFields`, so capture keeps working
 * and the omission is visible — instead of the whole tool erroring out
 * because of one unrecognised piece of metadata.
 */
export function redactEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error("capture entry is not an object; refusing to pass it through unredacted");
  }
  const out = {};
  const dropped = [];
  for (const [key, value] of Object.entries(entry)) {
    if (KNOWN_ENTRY_FIELDS.has(key)) out[key] = value;
    else dropped.push(key);
  }
  if (typeof out.url === "string") out.url = redactUrl(out.url);
  if (typeof out.postData === "string") out.postData = redactBody(out.postData);
  if (typeof out.body === "string") out.body = redactBody(out.body);
  if (dropped.length) out.droppedFields = dropped;
  return out;
}
