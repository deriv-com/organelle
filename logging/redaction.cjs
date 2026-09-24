const REDACTED = "[REDACTED]";

const JWT_RE = /\beyJ[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]*){2,4}\b/g;
const BEARER_RE = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const URL_CREDENTIAL_RE = /\b([a-z][a-z0-9+.-]*:\/\/)([^:@/\s]+):([^@\s]+)@/gi;
const QUERY_SECRET_RE =
  /([?&](?:access_token|refresh_token|id_token|client_secret|api_key|apikey|token|secret|password|key)=)[^&\s]+/gi;
const JSON_SECRET_RE =
  /(["'](?:access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|api[_-]?key|apikey|authorization|cookie|database_url|jwt|key_hash|password|secret|set_cookie|token|x_api_key)["']\s*:\s*["'])([^"']*)(["'])/gi;
const API_KEY_RE = /\borg_live_[A-Za-z0-9_-]{16,}\b/g;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const AUTHORIZATION_SECRET_RE =
  /\b(authorization)\b(\s*[:=]\s*)(["']?)(?:Bearer\s+)?[^"',\s;&]+(?:\s+[A-Za-z0-9._~+/=-]{8,})?/gi;
const KEY_VALUE_SECRET_RE =
  /\b(access[_-]?token|refresh[_-]?token|api[_-]?key|apikey|authorization|cookie|database_url|jwt|key_hash|password|secret|set_cookie|token|x_api_key)\b(\s*[:=]\s*)(["']?)([^"',\s;&]+)/gi;

function redactSensitiveText(value) {
  return value
    .replace(URL_CREDENTIAL_RE, `$1${REDACTED}:${REDACTED}@`)
    .replace(JWT_RE, REDACTED)
    .replace(JSON_SECRET_RE, `$1${REDACTED}$3`)
    .replace(QUERY_SECRET_RE, `$1${REDACTED}`)
    .replace(AUTHORIZATION_SECRET_RE, `$1$2$3${REDACTED}`)
    .replace(BEARER_RE, `$1 ${REDACTED}`)
    .replace(KEY_VALUE_SECRET_RE, `$1$2$3${REDACTED}`)
    .replace(API_KEY_RE, REDACTED)
    .replace(EMAIL_RE, REDACTED);
}

module.exports = {
  redactSensitiveText,
};
