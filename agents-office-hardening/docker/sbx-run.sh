#!/usr/bin/env bash
# Tier 1: Agents Office inside a Docker Sandboxes microVM (sbx). Own kernel, own filesystem,
# no direct network: every request goes through sbx's host-side proxy and its policy.
# Requires sbx (macOS Apple silicon, Windows 11, or Linux with KVM — Ubuntu 24.04+).
# Run from the agents-office checkout, with 0001-security-hardening.patch applied.
set -euo pipefail
NAME=${NAME:-agents-office}

# 1. Credentials stay on the host; sbx injects them through its proxy.
# Either store an API key (sbx injects it at its proxy; the office never sees it) or sign in to Claude inside the sandbox.
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then echo "$ANTHROPIC_API_KEY" | sbx secret set -g anthropic; fi

# 2. Create the sandbox with this folder as its workspace.
sbx create --name="$NAME" claude .

# 3. Network: start from "Locked Down" (chosen at `sbx login`) and open only what THIS office needs.
# --sandbox scopes the rule to this one sandbox. A global rule (no --sandbox) would reach every
# sandbox on the machine, including a stricter wing, so keep the global list empty.
sbx policy allow network --sandbox "$NAME" "api.anthropic.com,claude.ai,platform.claude.com,registry.npmjs.org"
# add connector hosts deliberately, e.g.: sbx policy allow network --sandbox "$NAME" "gmail.googleapis.com"
# The workspace appears inside the microVM at the same path as on the host.
sbx exec -d "$NAME" bash -lc "cd '$PWD' && npm ci && node build.mjs && AO_HOST=0.0.0.0 PORT=4520 nohup node serve.mjs > office.log 2>&1 &"

sbx ports "$NAME" --publish 4520:4520

echo "Office: http://localhost:4520    Denied requests: sbx policy log    Stop: sbx stop $NAME && sbx rm $NAME"
