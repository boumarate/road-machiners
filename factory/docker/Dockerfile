# Agent image: Claude Code with the ultrapack plugin, plus the browser tooling the game's tests and builds need.
# The Playwright tag matches the playwright version in package-lock.json.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl ca-certificates \
 && apt-get clean

RUN npm install -g @anthropic-ai/claude-code

# Everything below runs as the image's non-root user.
USER pwuser

# The mounted clone belongs to the host user, so git must trust it.
RUN git config --global user.name "Korovan Factory" \
 && git config --global user.email "factory@korovan.invalid" \
 && git config --global --add safe.directory /work

RUN claude plugin marketplace add https://github.com/btseytlin/ultrapack.git \
 && claude plugin install up@ultrapack

WORKDIR /work
