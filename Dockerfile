# Stage 1: Build
FROM node:22.14.0-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Production
FROM node:22.14.0-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.js ./
COPY --from=builder /app/config.js ./
COPY --from=builder /app/db.js ./
COPY --from=builder /app/logger.js ./
COPY --from=builder /app/errors.js ./
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/middleware ./middleware
COPY --from=builder /app/routes ./routes
COPY --from=builder /app/services ./services
COPY --from=builder /app/repositories ./repositories
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/scripts ./scripts
RUN addgroup -S app && adduser -S app -G app
USER app
EXPOSE 3001
CMD ["node", "server.js"]
