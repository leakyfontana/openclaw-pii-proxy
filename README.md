# openclaw-pii-proxy

Outbound PII-scrubbing reverse proxy that sits between [OpenClaw](https://github.com/openclaw) and the MiniMax M2.5 API. Intercepts chat completion requests, strips financial and identity-theft-sensitive data, and forwards the cleaned request to MiniMax.

Operational PII (phone numbers, emails, street addresses, URLs, IPs) is **not** scrubbed — only data that enables identity theft or financial fraud is removed. This lets the assistant function normally for tasks like coordinating contractors, scheduling appointments, and managing auction listings.

## Architecture

```
┌──────────────┐     ┌─────────────────────┐     ┌─────────────────┐
│  OpenClaw GW │────▶│  PII Scrub Proxy    │────▶│  MiniMax API    │
│  127.0.0.1:  │     │  127.0.0.1:18790    │     │  api.minimax.   │
│  18789       │     │                     │     │  chat           │
│              │◀────│  Passes responses   │◀────│                 │
│              │     │  back untouched     │     │                 │
└──────────────┘     └─────────────────────┘     └─────────────────┘
```

OpenClaw's MiniMax provider `baseURL` is pointed at the proxy instead of the real API. The proxy scrubs outbound request bodies, forwards to MiniMax, and pipes responses back untouched (including SSE streams).

## What gets scrubbed

| Type | Replacement | Context keyword required |
|---|---|---|
| SSN (`123-45-6789`, `123 45 6789`) | `[SSN_REDACTED]` | No |
| Credit card (13–19 digits, optional separators) | `[CC_REDACTED]` | No |
| Bank routing number (9-digit ABA with checksum) | `[ROUTING_REDACTED]` | Yes — `routing`, `aba`, `transit` |
| Bank account number (6–17 digits) | `[ACCOUNT_REDACTED]` | Yes — `account`, `acct`, `checking`, `savings` |
| Passport number (6–9 alphanumeric) | `[PASSPORT_REDACTED]` | Yes — `passport` |
| Date of birth | `[DOB_REDACTED]` | Yes — `dob`, `date of birth`, `born`, `birthday` |

## What passes through untouched

- Phone numbers (US and international)
- Email addresses
- Street addresses
- URLs
- IP addresses
- GPS coordinates

## Requirements

- Node.js 22+
- No npm dependencies — uses only Node built-in modules

## Usage

### Local development

```bash
bash start-local.sh
```

### Deployment target

```bash
bash start.sh
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PII_PROXY_PORT` | `18790` | Port the proxy listens on |
| `MINIMAX_REAL_BASE_URL` | `https://api.minimax.chat` | Upstream MiniMax API base URL |

### Health check

```bash
curl http://127.0.0.1:18790/health
# {"status":"ok","scrubber":"active"}
```

## OpenClaw configuration

Redirect MiniMax traffic through the proxy:

```bash
openclaw config set providers.minimax-portal.baseURL "http://127.0.0.1:18790"
```

Revert to direct MiniMax access:

```bash
openclaw config set providers.minimax-portal.baseURL "https://api.minimax.chat"
```

## Tests

```bash
node --test scrubber.test.js
```

## Logging

The proxy logs to stdout with timestamps, HTTP method, path, and scrub count. Message content, headers, and API keys are never logged.

```
[2025-02-17T12:00:00Z] POST /v1/chat/completions — scrubbed 3 PII items
```
