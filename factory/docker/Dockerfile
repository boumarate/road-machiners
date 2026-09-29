# Agent image: Claude Code with the ultrapack plugin, an entry script that links the clone's project skills, plus the browser tooling the game's tests and builds need.
# The Playwright tag matches the playwright version in package-lock.json.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl ca-certificates \
 && apt-get clean

RUN npm install -g @anthropic-ai/claude-code

COPY --chmod=755 factory-agent /usr/local/bin/factory-agent

# Everything below runs as the image's non-root user.
USER pwuser

# The mounted clone belongs to the host user, so git must trust it.
RUN git config --global user.name "ROAM Factory" \
 && git config --global user.email "factory@roam.invalid" \
 && git config --global --add safe.directory /work

RUN claude plugin marketplace add https://github.com/btseytlin/ultrapack.git \
 && claude plugin install up@ultrapack

# Factory commits carry no Claude co-author trailer.
RUN node -e 'const f=require("os").homedir()+"/.claude/settings.json";const fs=require("fs");const s=fs.existsSync(f)?JSON.parse(fs.readFileSync(f,"utf8")):{};s.attribution={commit:"",pr:""};s.includeCoAuthoredBy=false;fs.writeFileSync(f,JSON.stringify(s,null,2))'

WORKDIR /work
