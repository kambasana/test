#!/usr/bin/env bash
# Run Elenta Office inside a Docker Sandbox (sbx) with its own network rules.
#
#   docker/sbx-office.sh [--sandbox NAME] [--library DIR] [--port PORT] [--dry-run] {create|install|start|stop|rules|remove}
#
# What it sets up:
#   - one sandbox per office ("wing"), named with --sandbox;
#   - only two folders mounted: the app folder and the library folder;
#   - network: Locked Down (chosen at `sbx login`) plus per-sandbox rules for the Claude hosts only; the npm registry is allowed only
#     for the duration of `install` and removed again afterwards;
#   - the office listens inside the sandbox and is published to 127.0.0.1 on the host only.
#
# The sbx commands below follow the Docker Sandboxes docs (create claude PATH…, policy allow|rm network --sandbox, ports --publish, exec). Every call goes through `sbx_run`,
# so if your sbx version spells a sub-command differently, fix it in one place. Use --dry-run to
# print the commands without running them.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SANDBOX="elenta-office"
LIBRARY_DIR="$APP_DIR/library"
PORT="4180"
DRY_RUN=0
ACTION=""

# Hosts the agents need to reach Claude. Nothing else is allowed.
CLAUDE_HOSTS=(
  "api.anthropic.com"
  "claude.ai"
  "platform.claude.com"
  "console.anthropic.com"
  "statsig.anthropic.com"
)
NPM_HOSTS=("registry.npmjs.org")

usage() { sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --sandbox) SANDBOX="${2:?--sandbox needs a name}"; shift 2 ;;
    --library) LIBRARY_DIR="$(cd "${2:?--library needs a folder}" && pwd)"; shift 2 ;;
    --port) PORT="${2:?--port needs a number}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage 0 ;;
    create|install|start|stop|rules|remove) ACTION="$1"; shift ;;
    *) echo "Unknown argument: $1" >&2; usage 1 ;;
  esac
done
[ -n "$ACTION" ] || usage 1

if ! [[ "$SANDBOX" =~ ^[a-z0-9][a-z0-9-]{0,40}$ ]]; then
  echo "Sandbox names use lower-case letters, digits and dashes." >&2; exit 1
fi
if ! [[ "$PORT" =~ ^[0-9]{2,5}$ ]]; then echo "The port must be a number." >&2; exit 1; fi
case "$LIBRARY_DIR" in
  "$APP_DIR"/*) LIB_MOUNT="" ;;              # already inside the app folder
  *) LIB_MOUNT="$LIBRARY_DIR" ;;
esac

sbx_run() {
  if [ "$DRY_RUN" = 1 ]; then printf 'sbx'; printf ' %q' "$@"; printf '\n'; return 0; fi
  command -v sbx >/dev/null 2>&1 || { echo "The sbx CLI (Docker Sandboxes) is not installed." >&2; exit 1; }
  sbx "$@"
}

# Per-sandbox rules (--sandbox). The default is the policy chosen at `sbx login`: pick Locked Down.
# Global rules (no --sandbox) would reach every sandbox on the machine, so keep that list empty.
allow_hosts()  { local IFS=,; sbx_run policy allow network --sandbox "$SANDBOX" "$*"; }
revoke_hosts() { for h in "$@"; do sbx_run policy rm network --sandbox "$SANDBOX" --resource "$h"; done; }
rules()        { allow_hosts "${CLAUDE_HOSTS[@]}"; }

case "$ACTION" in
  create)
    # Workspaces appear inside the microVM at the same absolute paths as on the host;
    # extra workspaces may end in :ro for read-only. Nothing else from the host is visible.
    args=(create "--name=$SANDBOX" claude "$APP_DIR")
    if [ -n "$LIB_MOUNT" ]; then args+=("$LIB_MOUNT"); fi
    sbx_run "${args[@]}"
    rules
    sbx_run ports "$SANDBOX" --publish "$PORT:$PORT"
    ;;
  install)
    # The registry is reachable only while dependencies install.
    allow_hosts "${NPM_HOSTS[@]}"
    trap 'revoke_hosts "${NPM_HOSTS[@]}"' EXIT
    sbx_run exec "$SANDBOX" bash -lc "cd '$APP_DIR' && npm ci --omit=dev"
    ;;
  start)
    lib="$APP_DIR/library"; [ -n "$LIB_MOUNT" ] && lib="$LIB_MOUNT"
    sbx_run exec -d "$SANDBOX" bash -lc "cd '$APP_DIR' && EO_HOST=0.0.0.0 EO_PORT=$PORT EO_LIBRARY='$lib' nohup node server/main.mjs > office.log 2>&1 &"
    ;;
  stop)   sbx_run stop "$SANDBOX" ;;
  rules)  rules ;;
  remove) sbx_run rm "$SANDBOX" ;;
esac
