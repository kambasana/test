#!/usr/bin/env bash
# A WING: a second office on this machine, in its own Docker Sandboxes microVM.
# It shares nothing with the main office: its own copy of the code, brain folder, task file,
# config, sandbox, network rules and port. The two offices only link to each other in the top bar.
#
#   WING=military ORG=elenta-military PORT=4521 BRAIN=~/office-brains/military ./sbx-wing.sh
#
# Run it from the main agents-office checkout (hardening + departments patches applied).
# Requires sbx: macOS on Apple silicon, Windows 11, or Linux with KVM (Ubuntu 24.04+).
#
# Before you put anything in a wing, decide what may go into it. Every agent run sends its prompt
# and the notes it reads to Claude's API. Export-controlled (ITAR/EAR), classified or CUI material
# must not go into an office like this, sandbox or not; that needs an approved deployment.
set -euo pipefail
WING=${WING:?name the wing, e.g. WING=rnd}
ORG=${ORG:-}   # a file in orgs/ (without .json); empty = AJ's six departments
PORT=${PORT:-4521}
BRAIN=${BRAIN:?give the wing its own brain folder, e.g. BRAIN=~/office-brains/$WING}
case "$WING" in *[!a-z0-9-]*) echo "WING: lower-case letters, digits and dashes only" >&2; exit 1;; esac
NAME="agents-office-$WING"
APP=${APP:-"$(dirname "$PWD")/agents-office-wing-$WING"}   # the wing's own copy of the code
mkdir -p "$BRAIN"
BRAIN=$(cd "$BRAIN" && pwd)
case "$BRAIN/" in "$PWD"/*) echo "BRAIN must be outside the main office's folder" >&2; exit 1;; esac

# 1. The wing's own copy of the code: everything except the main office's brain, data, local
#    config and logs. The sandbox mounts this copy and the wing's brain, and nothing else.
mkdir -p "$APP"
rsync -a --delete --exclude brain/ --exclude data/ --exclude wings/ --exclude node_modules/ \
  --exclude 'office.config.local.json' --exclude 'office.agents.local.json' --exclude '*.log' ./ "$APP/"
cat > "$APP/office.config.local.json" <<JSON
{ "name": "$WING wing", "org": "$ORG", "wing": "$(echo "$WING" | tr a-z A-Z)",
  "wings": [{ "name": "MAIN OFFICE", "url": "http://localhost:4520" }],
  "tools": { "web": false, "browser": false } }
JSON
# (change the link above if the main office runs on another port; web search and Chrome are off)

sbx create --name="$NAME" claude "$APP" "$BRAIN"

# 2. Network: Claude, plus the npm registry only while dependencies install.
#    --sandbox keeps these rules on this one sandbox. Global rules (no --sandbox) reach every
#    sandbox, so keep the global list empty or a wing can't be stricter than the main office.
sbx policy allow network --sandbox "$NAME" "api.anthropic.com,claude.ai,platform.claude.com,registry.npmjs.org"
sbx exec "$NAME" bash -lc "cd '$APP' && npm ci && node build.mjs"
sbx policy rm network --sandbox "$NAME" --resource "registry.npmjs.org"
# Some sbx versions apply policy changes on the sandbox's next start. Check, and restart if needed:
sbx policy ls --sandbox "$NAME" || true

# 3. Start the wing's office on its own brain.
sbx exec -d "$NAME" bash -lc "cd '$APP' && AO_BRAIN='$BRAIN' AO_HOST=0.0.0.0 PORT=$PORT nohup node serve.mjs > office.log 2>&1 &"
sbx ports "$NAME" --publish "$PORT:$PORT"

cat <<MSG
Wing "$WING": http://localhost:$PORT   (org: ${ORG:-agency} · brain: $BRAIN · code: $APP)
Link to it from the main office's office.config.local.json:
  "wings": [{ "name": "$(echo "$WING" | tr a-z A-Z)", "url": "http://localhost:$PORT" }]
Denied requests: sbx policy log    Stop: sbx stop $NAME && sbx rm $NAME
MSG
