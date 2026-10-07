#!/bin/sh
# Reads the Claude login token from a Docker secret (never from the image or a plain env file).
# Create it on the host with:  claude setup-token  > ./secrets/claude_oauth_token
set -eu
if [ -f /run/secrets/claude_oauth_token ]; then
  CLAUDE_CODE_OAUTH_TOKEN="$(cat /run/secrets/claude_oauth_token)"; export CLAUDE_CODE_OAUTH_TOKEN
fi
mkdir -p "$HOME/.claude" /app/data
[ -f "$HOME/.claude.json" ] || echo '{}' > "$HOME/.claude.json"
exec node /app/serve.mjs
