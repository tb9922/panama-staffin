# Stage 1: Build
FROM node:22.22.2-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Production
FROM node:22.22.2-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && npm cache clean --force \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/server.js ./
COPY --from=builder --chown=app:app /app/config.js ./
COPY --from=builder --chown=app:app /app/db.js ./
COPY --from=builder --chown=app:app /app/logger.js ./
COPY --from=builder --chown=app:app /app/errors.js ./
COPY --from=builder --chown=app:app /app/metrics.js ./
COPY --from=builder --chown=app:app /app/requestContext.js ./
COPY --from=builder --chown=app:app /app/migrations ./migrations
COPY --from=builder --chown=app:app /app/middleware ./middleware
COPY --from=builder --chown=app:app /app/routes ./routes
COPY --from=builder --chown=app:app /app/services ./services
COPY --from=builder --chown=app:app /app/repositories ./repositories
COPY --from=builder --chown=app:app /app/lib ./lib
COPY --from=builder --chown=app:app /app/shared ./shared
COPY --from=builder --chown=app:app /app/scripts ./scripts
RUN mkdir -p uploads && chown app:app uploads
USER app
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"
CMD ["node", "server.js"]
