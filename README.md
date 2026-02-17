# openclaw-pii-proxy

Outbound PII-scrubbing reverse proxy that sits between [OpenClaw](https://github.com/openclaw) and the MiniMax M2.5 API. Intercepts chat completion requests, strips financial and identity-theft-sensitive data, and forwards the cleaned request to MiniMax.

Operational PII (phone numbers, emails, street addresses, URLs, IPs) is **not** scrubbed — only data that enables identity theft or financial fraud is removed. This lets the assistant function normally for tasks like coordinating contractors, scheduling appointments, and managing auction listings.

## Architecture

```
┌──────────────┐     ┌─────────────────────┐     ┌─────────────────┐
│  OpenClaw GW │────▶│  PII Scrub Proxy    │────▶│  MiniMax API    │
│  127.0.0.1:  │     │  127.0.0.1:18790    │     │  api.minimax.   │
│  18789       │     │                     │     │  io/anthropic   │
│              │◀────│  Passes responses   │◀────│                 │
│              │     │  back untouched     │     │                 │
└──────────────┘     └─────────────────────┘     └─────────────────┘
```

OpenClaw's MiniMax provider `baseUrl` is pointed at the proxy instead of the real API. The proxy scrubs outbound request bodies (POST to `/v1/messages`), forwards to MiniMax, and pipes responses back untouched (including SSE streams).

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
| `MINIMAX_REAL_BASE_URL` | `https://api.minimax.io/anthropic` | Upstream MiniMax API base URL |

### Health check

```bash
curl http://127.0.0.1:18790/health
# {"status":"ok","scrubber":"active"}
```

## Deployment on Headless Mac

In production, the proxy runs on a headless Mid-2014 MacBook Pro (macOS Big Sur, Intel) alongside the OpenClaw gateway.

- The proxy runs as the `openclaw` user (low-privilege, no sudo).
- The OpenClaw gateway is managed by a LaunchDaemon (`system/ai.openclaw.gateway`) on port 18789. The proxy is **not** managed by the LaunchDaemon — it is started separately on port 18790.
- A future improvement would be adding a second LaunchDaemon or a wrapper script to start the proxy automatically.

### Starting the proxy

```bash
sudo -u openclaw -i bash /Users/openclaw/openclaw-pii-proxy/start.sh
```

### OpenClaw configuration

Redirect MiniMax traffic through the proxy:

```bash
openclaw config set models.providers.minimax-portal.baseUrl "http://127.0.0.1:18790"
```

After changing the config, restart the gateway:

```bash
sudo launchctl kickstart -k system/ai.openclaw.gateway
```

Revert to direct MiniMax access:

```bash
openclaw config set models.providers.minimax-portal.baseUrl "https://api.minimax.io/anthropic"
sudo launchctl kickstart -k system/ai.openclaw.gateway
```

## Tests

```bash
node --test scrubber.test.js
```

## Logging

The proxy logs to stdout with timestamps, HTTP method, path, and scrub count. Message content, headers, and API keys are never logged.

```
[2025-02-17T12:00:00Z] POST /v1/messages — scrubbed 3 PII items
```

## Troubleshooting

### PII still passing through after starting the proxy

**Cause:** OpenClaw's `baseUrl` config wasn't pointed at the proxy, so requests went directly to MiniMax.

**Fix:**

```bash
openclaw config set models.providers.minimax-portal.baseUrl "http://127.0.0.1:18790"
sudo launchctl kickstart -k system/ai.openclaw.gateway
```

**Verify:**

```bash
openclaw config get models.providers.minimax-portal.baseUrl
# Should return: http://127.0.0.1:18790
```

### Gateway won't restart after config change (port 18789 already in use)

**Symptom:** `launchctl kickstart` succeeds but `launchctl print` shows `state = pending` / `job state = exited`. Error log shows "Gateway failed to start: another gateway instance is already listening on ws://127.0.0.1:18789".

**Cause:** A stale gateway process is holding port 18789. `launchctl kickstart -k` sends SIGTERM but the old process doesn't exit cleanly.

**Fix:**

```bash
# Find the stale PID from the error log
sudo tail -5 /tmp/openclaw/gateway.err.log
# Kill it manually
sudo kill <PID>
sleep 2
# Now kickstart works
sudo launchctl kickstart -k system/ai.openclaw.gateway
# Verify
sudo launchctl print system/ai.openclaw.gateway | grep "state"
# Should show: state = running / job state = running
```

### Verifying the proxy is actually scrubbing

- Send a test message via WhatsApp containing a known fake SSN (e.g. `123-45-6789`) and credit card (e.g. `4111 1111 1111 1111`).
- Check proxy stdout for `scrubbed N PII items` log lines.
- The assistant's response should show `[SSN_REDACTED]` and `[CC_REDACTED]` instead of the raw values.
- If the assistant echoes back the raw values, the proxy is not in the request path — check the `baseUrl` config.
