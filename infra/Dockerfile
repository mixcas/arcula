# Arcula — API + SPA container (Phase 6 S3).
#
# The beta's primary target is Lambda (scripts/build-lambda.sh); this
# image is the scale-up path for when the workload goes always-on: one
# container runs the SAME `bun run start` as local dev and serves the
# built SPA through WEB_DIST (apps/api/src/spa.ts, plan §10.2 — one
# artifact behind one origin, no second hosting stack).
#
# Build on the target architecture: the Sharp prebuilt is picked for the
# build platform (colima/this machine: linux/arm64; an x86_64 host needs
# `docker build --platform linux/amd64`).

FROM oven/bun:1.4 AS web
WORKDIR /repo
# Workspace manifests first, so the install layer caches across source
# changes.
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
RUN bun install
# The web build type-checks against the workspace sources (the package
# points at src), so the full package, not just the manifest.
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN cd apps/web && bun run build

FROM oven/bun:1.4
WORKDIR /repo
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
RUN bun install --production
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY apps/api apps/api
# The built SPA: the API serves it (spa.ts), so the image carries dist.
COPY --from=web /repo/apps/web/dist apps/web/dist
ENV WEB_DIST=/repo/apps/web/dist
# `start` is apps/api's script (bun src/main.ts); workspace deps resolve
# from the root node_modules.
WORKDIR /repo/apps/api
EXPOSE 8000
CMD ["bun", "run", "start"]
