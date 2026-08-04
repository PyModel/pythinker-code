FROM node:26-alpine AS build

RUN apk add --no-cache zip
WORKDIR /repo
COPY pnpm-workspace.yaml ./
COPY apps/site apps/site
COPY apps/pythinker-code/package.json apps/pythinker-code/package.json
COPY apps/pythinker-web/public/install.sh apps/pythinker-web/public/install.sh
COPY apps/pythinker-web/public/install.ps1 apps/pythinker-web/public/install.ps1
COPY plugins/cdn plugins/cdn
COPY packages/agent-core/src/tools/support/rg-locator.ts packages/agent-core/src/tools/support/rg-locator.ts
RUN cd apps/site && npm install --no-audit --no-fund && npm run build && node scripts/build-cdn.mjs --out /cdn

FROM caddy:2-alpine

COPY --from=build /cdn /srv
COPY apps/site/Caddyfile /etc/caddy/Caddyfile
