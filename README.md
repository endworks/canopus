# Canopus

A pnpm + [Turborepo](https://turbo.build) monorepo for the Canopus API gateway
and its NestJS microservices. Each service builds and deploys independently — a
change to one service does not rebuild or redeploy the others.

## Structure

```
apps/
  gateway/             # @canopus/gateway            — HTTP/REST gateway, proxies to services over TCP
  zaragoza/            # @canopus/zaragoza           — Zaragoza transport (bus/tram/bizi), MongoDB
  zine/                # @canopus/zine               — cinema & movies, MongoDB
  weather/             # @canopus/weather            — weather & warnings, caller-supplied provider key
  rae/                 # @canopus/rae                — Spanish dictionary (RAE) scraper
  twitter-downloader/  # @canopus/twitter-downloader — tweet media-URL extractor
  push/                # @canopus/push               — device registry, notification preferences and arrival countdowns, MongoDB
packages/
  shared/              # @canopus/shared             — RPC contract types shared across packages
```

The gateway reaches each backend over TCP via the host env vars in
`apps/gateway/.env`.

## Develop

Requires Node 20+ and pnpm 11.

```bash
pnpm install            # install the whole workspace
pnpm turbo build        # build every package (shared first, then dependents)
pnpm lint               # lint (one flat config at the repo root)
pnpm format             # format all TypeScript with Prettier
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

- **`ci.yml`** — builds every package and lints on each push/PR.
- **`deploy.yml`**:
  1. **detect** — `dorny/paths-filter` determines which services are affected
     (own files, `packages/shared`, or root config).
  2. **deploy** — builds, signs (cosign) and SSH-deploys **only** the affected
     services to `ghcr.io/endworks/canopus[-service]`. Deploys run on `main`
     and version tags (`vX.Y.Z` → image tag `X.Y.Z`); feature branches build
     and push images but do not deploy (they'd collide on the host port).

## Migrating from the standalone repos (one-time cutover)

The `zaragoza`, `zine`, `rae` and `twitter-downloader` services were merged here
from their `endworks/canopus-*` repositories with full history (`git subtree`).
To finish the cutover:

1. Push this branch and open a PR; confirm the `deploy` workflow builds the
   affected services.
2. Merge to `main`; confirm each service deploys (container names and ports are
   unchanged: `canopus` :3000, `canopus-zaragoza` :8877, `canopus-zine` :8878,
   `canopus-rae` :8879, `canopus-twitter-downloader` :8876).
3. In the old `canopus-*` service repos: disable their Actions workflows (so they
   stop deploying), then archive the repos.
4. Add the `TWITTER_CLIENT_TOKEN` secret to `endworks/canopus` — the
   twitter-downloader service reads it at runtime.

## The push service

`apps/push` is the one service that holds something belonging to a person: a
push token, which addresses somebody's phone. It is built as a registry with
producers rather than as an arrivals feature, because arrivals is only the
first thing worth pushing:

- **devices** — one row per install: which app, which store, the token, the
  language, and which of `arrivals`, `promotions` and `events` it has agreed
  to. Arrivals alone by default; the other two are opt-in, and the moment
  somebody agreed is written down with the wording they agreed to.
- **follows** — a departure somebody is waiting for. TTL-indexed, so a crash
  mid-journey costs nothing: Mongo drops the row whether or not this service
  ever runs again.
- **the arrivals loop** — every fifteen seconds, the stops that somebody is
  actually standing at, one read per stop however many followers it has, and a
  push only where the board disagrees with what that phone is already showing.

Two credentials, and they are not interchangeable. `PUSH_CLIENT_KEYS` is
shipped inside the apps, so it is a gate and not an identity — the worst
somebody who extracts it can do is address tokens they already hold.
`PUSH_ADMIN_KEY` sends a message to everyone who opted in and is
server-to-server only.

iOS is spoken to over APNs directly rather than through Firebase, and not by
preference: a Live Activity is updated by a push whose `apns-push-type` is
`liveactivity`, and FCM will not send that header. Since that connection has to
exist anyway it carries the ordinary notifications too.

The gateway's `/push/*` routes are absent from the published API document —
`@ApiExcludeController` — because that document describes a public transit API
anybody may call, and these six are the private conversation between this
deployment and its own apps. The key checked inside the service is what
actually stands in front of them; the exclusion is tidiness.
