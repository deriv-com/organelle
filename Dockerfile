FROM node:24-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS migration-deps
WORKDIR /migration
COPY scripts/db/package.json scripts/db/package-lock.json ./
RUN npm ci --omit=dev

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM migration-deps AS migrator
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=migration-deps --chown=nextjs:nodejs /migration/node_modules ./node_modules
COPY --chown=nextjs:nodejs package.json package-lock.json tsconfig.json ./
COPY --chown=nextjs:nodejs db ./db
COPY --chown=nextjs:nodejs scripts/db ./scripts/db
USER nextjs
ENTRYPOINT ["node", "scripts/db/migrate.mjs"]

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/server-logging.cjs ./server-logging.cjs
COPY --from=builder --chown=nextjs:nodejs /app/logging ./logging
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=migration-deps --chown=nextjs:nodejs /migration/node_modules/postgres ./node_modules/postgres
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/db ./db
COPY --from=builder --chown=nextjs:nodejs /app/scripts/db ./scripts/db
COPY --chown=nextjs:nodejs LICENSE NOTICE THIRD_PARTY_NOTICES.md ./

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "--require", "./server-logging.cjs", "server.js"]
