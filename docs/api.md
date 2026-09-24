# Machine API

The integration API is versioned under `/api/integrations/v1`. An admin creates a key in
**Integrations** and assigns only the required scopes. The plaintext key is displayed
once; Organelle stores a cryptographic hash and a short lookup prefix. Keys expire 90
days after creation. Each administrator may have at most ten active, unexpired keys and
should rotate consumers before expiry.

Send the key as a bearer credential:

```bash
curl --fail --silent \
  -H "Authorization: Bearer org_live_REDACTED" \
  https://organelle.example.com/api/integrations/v1/structure/headers
```

## Header structure

`GET /api/integrations/v1/structure/headers` requires the `structure.headers.read`
scope. It returns the current published version and nested header structure without
seats, employees, or node IDs. Consumers must treat added JSON fields as
backward-compatible.

Responses use JSON and standard status codes: `401` for a missing or invalid key, `403`
for missing scope, `429` when rate-limited, and `5xx` for server failures. Keys can be
revoked immediately. Clients should use exponential backoff with jitter for `429` and
transient `5xx` responses and must not retry other `4xx` responses.

The default limiter is 60 requests per minute per API key per application process.
Deployments with multiple replicas should enforce a shared limit at the reverse proxy
until a distributed limiter is introduced. Never place keys in URLs, browser code,
source control, or logs.

No stability guarantee is made for unversioned application routes. Breaking machine API
changes will use a new path version.
