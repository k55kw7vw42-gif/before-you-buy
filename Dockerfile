# syntax=docker/dockerfile:1
#
# Production image for a single-instance deployment.
#
# The app keeps its state in a SQLite file and rate-limits in process memory, so
# it runs as exactly one container. Scaling it horizontally would give each
# replica its own database and its own rate-limit counters.
#
#   docker build -t before-you-pay .
#   docker volume create before-you-pay-data
#   docker run -d --name before-you-pay \
#     -p 3000:3000 \
#     -v before-you-pay-data:/data \
#     --env-file .env.production \
#     before-you-pay
#
# The database lives on the /data volume. Nothing durable is written inside the
# container filesystem, so the image can be replaced without losing accounts.

# Node 22.5+ is required: the app uses the built-in node:sqlite module.
FROM node:22-alpine AS base

# ---- dependencies ----------------------------------------------------------
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build -----------------------------------------------------------------
FROM base AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runtime ---------------------------------------------------------------
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# `node server.js` reads both. HOSTNAME must be 0.0.0.0 or the server binds
# loopback only and nothing outside the container can reach it.
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# The database path points at the mounted volume, not the image filesystem.
ENV DATABASE_PATH=/data/before-you-pay.db

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# The standalone bundle carries its own pruned node_modules and server.js.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# TypeScript sources and scripts, so the one-off period backfill can be run
# inside the container (`npm run backfill:periods`). Not used to serve traffic.
COPY --from=builder --chown=nextjs:nodejs /app/src ./src
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts

# Created here so the directory exists and is writable even before a volume is
# attached; a mounted volume replaces it.
RUN mkdir -p /data && chown nextjs:nodejs /data
VOLUME ["/data"]

USER nextjs
EXPOSE 3000

# Hits the unauthenticated liveness route. Uses node's own fetch so the image
# needs no curl or wget.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
