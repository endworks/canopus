# syntax=docker/dockerfile:1
# The image every service is built from. From the monorepo root:
#   docker build --build-arg SERVICE=rae -t canopus-rae .
#
# It was six files. Substituting the service name out made five of them
# byte-identical — verified by md5 — and the sixth, the gateway, differed only
# by a `.env` copy and two reworded comments. The cost was never their length:
# `FROM node:24-alpine` appeared twelve times and the pnpm/turbo pin six, so a
# toolchain bump was a six-file edit in which five-of-six is a diff that looks
# right and ships skew. That pin has already drifted from the one in
# package.json this way.
#
# `SERVICE` is redeclared in each stage that reads it: a top-level ARG is
# visible to `FROM` lines and to nothing else.

FROM node:24-alpine AS base
RUN npm install -g pnpm@11.7.0 turbo@2.9.18
WORKDIR /app

# Prune the workspace down to this service and its workspace deps.
FROM base AS pruner
ARG SERVICE
COPY . .
RUN turbo prune @canopus/${SERVICE} --docker

# Install against the pruned manifests (well-cached), build, then assemble a
# production-only bundle (dist + prod node_modules, no devDependencies).
FROM base AS installer
ARG SERVICE
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
COPY tsconfig.base.json ./tsconfig.base.json
RUN turbo build --filter=@canopus/${SERVICE}
RUN pnpm --filter @canopus/${SERVICE} deploy --prod --legacy /prod

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
