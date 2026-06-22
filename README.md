# Canopus

A pnpm + [Turborepo](https://turbo.build) monorepo for the Canopus API gateway
and its NestJS microservices. Each service builds and deploys independently — a
change to one service does not rebuild or redeploy the others.

## Structure

```
apps/
  gateway/     # @canopus/gateway  — HTTP/REST gateway, proxies to services over TCP
  zaragoza/    # @canopus/zaragoza — Zaragoza transport (bus/tram/bizi), MongoDB
  zine/        # @canopus/zine     — cinema & movies, MongoDB
packages/
  shared/      # @canopus/shared   — RPC contract types shared across packages
```

`rae` and `twitter-downloader` remain separate repositories; the gateway calls
them over TCP via the host env vars in `apps/gateway/.env`.

## Develop

Requires Node 20+ and pnpm 11.

```bash
pnpm install            # install the whole workspace
pnpm turbo build        # build every package (shared first, then dependents)
pnpm turbo lint         # lint
pnpm --filter @canopus/zaragoza start:dev   # run one service in watch mode
```

Turbo only rebuilds what changed. Changing `packages/shared` rebuilds the
services that depend on it (zaragoza, zine) but not the gateway.

## Docker

Each service has its own Dockerfile that builds from the **monorepo root** using
`turbo prune` to ship a minimal image:

```bash
docker build -f apps/zaragoza/Dockerfile -t canopus-zaragoza .
# or the whole stack for local dev:
MONGODB_URI=mongodb://... docker compose up --build
```

## CI/CD

`.github/workflows/deploy.yml` runs on push/PR:

1. **detect** — `dorny/paths-filter` determines which services are affected
   (own files, `packages/shared`, or root config). Version tags release all.
2. **deploy** — builds, signs (cosign) and SSH-deploys **only** the affected
   services in parallel, publishing to `ghcr.io/endworks/canopus[-service]`.

## Migrating from the standalone repos (one-time cutover)

The `zaragoza` and `zine` services were merged here from
`endworks/canopus-zaragoza` and `endworks/canopus-zine` with full history
(`git subtree`). To finish the cutover:

1. Push this branch and open a PR; confirm the `deploy` workflow builds the
   affected services.
2. Merge to `main`; confirm each service deploys (container names and ports are
   unchanged: `canopus` :3000, `canopus-zaragoza` :8877, `canopus-zine` :8878).
3. In the old `canopus-zaragoza` and `canopus-zine` repos: disable their Actions
   workflows (so they stop deploying), then archive the repos.
