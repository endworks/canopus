# syntax=docker/dockerfile:1
# Build from the monorepo root:
#   docker build -f apps/gateway/Dockerfile -t canopus .

FROM node:24-alpine AS base
RUN npm install -g pnpm@11.7.0 turbo@2.9.18
WORKDIR /app

# Prune the workspace down to this service and its workspace deps.
FROM base AS pruner
COPY . .
RUN turbo prune @canopus/gateway --docker

# Install against the pruned manifests (well-cached), build, then assemble a
# production-only bundle (dist + prod node_modules, no devDependencies).
FROM base AS installer
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
COPY tsconfig.base.json ./tsconfig.base.json
RUN turbo build --filter=@canopus/gateway
RUN pnpm --filter @canopus/gateway deploy --prod --legacy /prod

# Minimal runtime image: just the production bundle.
FROM node:24-alpine AS runner
LABEL org.opencontainers.image.source=https://github.com/endworks/canopus
WORKDIR /app
COPY --from=installer /prod/ .
# ConfigModule loads `.env.${NODE_ENV}` when NODE_ENV is set and `.env` otherwise;
# only `.env` exists, so NODE_ENV is intentionally left unset.
COPY apps/gateway/.env ./.env
EXPOSE 3000/tcp
# Run via npm so process.env.npm_package_* (Swagger title/version) is populated.
CMD ["npm", "run", "start:prod"]
