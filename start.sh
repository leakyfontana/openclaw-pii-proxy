#!/bin/bash
export MINIMAX_REAL_BASE_URL="https://api.minimax.io/anthropic"
export PII_PROXY_PORT=18790
exec /Users/openclaw/.nvm/versions/node/v22.22.0/bin/node /Users/openclaw/openclaw-pii-proxy/index.js
