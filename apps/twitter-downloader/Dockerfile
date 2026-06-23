# syntax=docker/dockerfile:1
# Build from the monorepo root:
#   docker build -f apps/twitter-downloader/Dockerfile -t canopus-twitter-downloader .

FROM node:24-alpine AS base
RUN npm install -g pnpm@11.7.0 turbo@2.9.18
WORKDIR /app

# Prune the workspace down to this service and its workspace deps.
FROM base AS pruner
COPY . .
RUN turbo prune @canopus/twitter-downloader --docker

# Install against the pruned manifests (well-cached), build, then assemble a
# production-only bundle (dist + prod node_modules, no devDependencies).
FROM base AS installer
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
COPY tsconfig.base.json ./tsconfig.base.json
RUN turbo build --filter=@canopus/twitter-downloader
RUN pnpm --filter @canopus/twitter-downloader deploy --prod --legacy /prod

# Minimal runtime image: just the production bundle.
FROM node:24-alpine AS runner
LABEL org.opencontainers.image.source=https://github.com/endworks/canopus
WORKDIR /app
COPY --from=installer /prod/ .
EXPOSE 3000/tcp
# Liveness: succeeds as soon as the service accepts TCP connections.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('net').connect(3000,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"
CMD ["node", "dist/main.js"]
