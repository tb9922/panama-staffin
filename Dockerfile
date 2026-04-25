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
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && npm cache clean --force \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.js ./
COPY --from=builder /app/config.js ./
COPY --from=builder /app/db.js ./
COPY --from=builder /app/logger.js ./
COPY --from=builder /app/errors.js ./
COPY --from=builder /app/metrics.js ./
COPY --from=builder /app/requestContext.js ./
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/middleware ./middleware
COPY --from=builder /app/routes ./routes
COPY --from=builder /app/services ./services
COPY --from=builder /app/repositories ./repositories
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/scripts ./scripts
RUN addgroup -S app && adduser -S app -G app
RUN mkdir -p uploads && chown app:app uploads
USER app
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"
CMD ["node", "server.js"]
