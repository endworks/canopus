# syntax=docker/dockerfile:1
# Build from the monorepo root:
#   docker build -f apps/zine/Dockerfile -t canopus-zine .

FROM node:24-alpine AS base
RUN npm install -g pnpm@11.7.0 turbo@2.9.18
WORKDIR /app

# Prune the workspace down to this service and its workspace deps.
FROM base AS pruner
COPY . .
RUN turbo prune @canopus/zine --docker

# Install against the pruned manifests (well-cached), build, then assemble a
# production-only bundle (dist + prod node_modules, no devDependencies).
FROM base AS installer
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
COPY tsconfig.base.json ./tsconfig.base.json
RUN turbo build --filter=@canopus/zine
RUN pnpm --filter @canopus/zine deploy --prod --legacy /prod

# Minimal runtime image: just the production bundle.
FROM node:24-alpine AS runner
LABEL org.opencontainers.image.source=https://github.com/endworks/canopus
WORKDIR /app
COPY --from=installer /prod/ .
EXPOSE 3000/tcp
CMD ["node", "dist/main.js"]
