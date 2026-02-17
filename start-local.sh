#!/bin/bash
export MINIMAX_REAL_BASE_URL="https://api.minimax.io/anthropic"
export PII_PROXY_PORT=18790
exec node "$(dirname "$0")/index.js"
