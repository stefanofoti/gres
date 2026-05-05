# ── Stage 1: deps ─────────────────────────────────────────────────────────────
FROM node:24-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ── Stage 2: runtime ───────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime

# Metadati OCI standard
LABEL org.opencontainers.image.title="gres" \
      org.opencontainers.image.description="Gres - Lightweight integrated control pane for smart homes" \
      org.opencontainers.image.source="https://github.com/stefanofoti/gres"

WORKDIR /app

RUN addgroup -g 1001 -S gres && adduser -u 1001 -S gres -G gres

COPY --from=deps /app/node_modules ./node_modules

COPY package.json ./
COPY backend/ ./backend/
COPY frontend/ ./frontend/

RUN chown -R gres:gres /app
RUN mkdir -p /app/data && chown -R gres:gres /app/data
USER gres

ENV NODE_ENV=production \
    PORT=3000 \
    LOG_LEVEL=warn

EXPOSE 3000

CMD ["node", "backend/server.js"]