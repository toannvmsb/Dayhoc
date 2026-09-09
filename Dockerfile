# DẠYZI — Small Family Pilot image (doc 70).
#
# ONE image, TWO entrypoints (same build, same locked routing/gates):
#   - Pilot API host:  npm run start:web           (Next.js, PORT 3100)
#   - Durable worker:  npm run worker:worksheet     (WorksheetJobWorker)
#
# The cron jobs (scripts/pilot-cron-*.mjs) also run from this image.
#
#   docker build -t dayzi-pilot .
#   docker run --env-file .env.pilot -p 3100:3100 dayzi-pilot            # API
#   docker run --env-file .env.pilot dayzi-pilot npm run worker:worksheet # worker
#
# Secrets are passed at runtime (--env-file / platform env), never baked in.

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY services ./services
COPY apps/web ./apps/web
COPY migrations ./migrations
COPY scripts ./scripts
RUN npm ci
# build every workspace package + services/api (incl. the worker bin), then the web app
RUN npm run typecheck && npm run build --workspace @copilot/web

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3100
# copy the whole built tree (workspace symlinks + dist + .next) — simplest correct
# layout for an npm-workspaces monorepo without `next output: standalone`.
COPY --from=build /app /app
EXPOSE 3100
# default entrypoint is the API host; override the command for the worker.
CMD ["npm", "run", "start:web"]
