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

const REDACTED = "«redacted»";

// Key names whose *values* are treated as secrets, matched case-insensitively
// as a whole word / boundary inside query params, form fields and JSON keys.
const SECRET_KEY = /(?:^|[_-])(?:token|access[_-]?token|refresh[_-]?token|id[_-]?token|secret|password|passwd|pwd|api[_-]?key|apikey|auth|authorization|session|sessionid|sid|cookie|credential|client[_-]?secret|private[_-]?key|signature|sig)$/i;

function isSecretKey(key) {
  if (typeof key !== "string") return false;
  return SECRET_KEY.test(key) || SECRET_KEY.test("_" + key);
}

/** Mask secret query-parameter values in a URL, leaving the rest readable. */
export function redactUrl(url) {
  if (typeof url !== "string" || !url.includes("?")) return url;
  const qIndex = url.indexOf("?");
  const base = url.slice(0, qIndex);
  const rest = url.slice(qIndex + 1);
  const [query, hash = ""] = rest.split("#");
  const params = query
    .split("&")
    .map((pair) => {
      const eq = pair.indexOf("=");
      if (eq === -1) return pair;
      const key = pair.slice(0, eq);
      return isSecretKey(decodeURIComponent(key)) ? `${key}=${REDACTED}` : pair;
    })
    .join("&");
  return base + "?" + params + (hash ? "#" + hash : "");
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
  const trimmed = body.trim();

  // JSON body.
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.stringify(redactJson(JSON.parse(trimmed)));
    } catch {
      // fall through to form handling / passthrough
    }
  }

  // URL-encoded form body (key=value&key=value), no spaces, at least one '='.
  if (/^[^\s]*=[^\s]*(?:&[^\s]*=[^\s]*)*$/.test(trimmed)) {
    return trimmed
      .split("&")
      .map((pair) => {
        const eq = pair.indexOf("=");
        if (eq === -1) return pair;
        const key = pair.slice(0, eq);
        let decoded;
        try {
          decoded = decodeURIComponent(key);
        } catch {
          decoded = key;
        }
        return isSecretKey(decoded) ? `${key}=${REDACTED}` : pair;
      })
      .join("&");
  }

  return body;
}

/** Redact one capture entry (url, postData, body). Returns a new object. */
export function redactEntry(entry) {
  if (!entry || typeof entry !== "object") return entry;
  const out = { ...entry };
  if (typeof out.url === "string") out.url = redactUrl(out.url);
  if (typeof out.postData === "string") out.postData = redactBody(out.postData);
  if (typeof out.body === "string") out.body = redactBody(out.body);
  return out;
}
