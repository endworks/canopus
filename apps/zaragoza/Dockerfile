# syntax=docker/dockerfile:1
# Build from the monorepo root:
#   docker build -f apps/zaragoza/Dockerfile -t canopus-zaragoza .

FROM node:alpine AS base
RUN npm install -g pnpm@11.7.0 turbo@2.9.18
WORKDIR /app

# Prune the workspace down to this service and its workspace deps.
FROM base AS pruner
COPY . .
RUN turbo prune @canopus/zaragoza --docker

# Install against the pruned manifests (well-cached), then build.
FROM base AS installer
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
COPY tsconfig.base.json ./tsconfig.base.json
RUN turbo build --filter=@canopus/zaragoza

# Runtime image.
FROM node:alpine AS runner
LABEL org.opencontainers.image.source=https://github.com/endworks/canopus
WORKDIR /app
COPY --from=installer /app/ .
WORKDIR /app/apps/zaragoza
EXPOSE 3000/tcp
CMD ["node", "dist/main.js"]
