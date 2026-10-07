# Agents Office in a locked-down container (tier 2 in ../README.md).
# Build context = an agents-office checkout with ../0001-security-hardening.patch applied;
# the `hardening` context = this folder. compose.yaml wires both; by hand:
#   docker build -f Dockerfile --build-context hardening=. -t agents-office:hardened /path/to/agents-office
FROM node:24-slim

# Claude Code CLI: the office runs every agent as `claude -p`. Pin the version you tested.
ARG CLAUDE_CODE_VERSION=latest
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
 && npm cache clean --force

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY . .
COPY --from=hardening docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY --from=hardening office.config.local.json /app/office.config.local.json
RUN node build.mjs && rm -rf /app/data && chown -R node:node /app

# State lives on volumes, never in the image: /app/data (tasks.json) and /brain (your notes).
USER node
ENV AO_HOST=0.0.0.0 AO_BRAIN=/brain PORT=4520 NODE_USE_ENV_PROXY=1
EXPOSE 4520
ENTRYPOINT ["/usr/bin/tini", "--", "docker-entrypoint.sh"]
