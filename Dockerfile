# ── Stage 1: deps ─────────────────────────────────────────────────────────────
FROM node:26-slim AS deps

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ── Stage 2: runtime ───────────────────────────────────────────────────────────
FROM node:26-slim AS runtime

# Metadati OCI standard
LABEL org.opencontainers.image.title="gres" \
      org.opencontainers.image.description="Gres - Lightweight integrated control pane for smart homes" \
      org.opencontainers.image.source="https://github.com/stefanofoti/gres"

WORKDIR /app

RUN groupadd -g 1001 gres && useradd -u 1001 -g gres -m -s /bin/bash gres

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

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/config',function(r){process.exit(r.statusCode===200?0:1)}).on('error',function(){process.exit(1)})"

CMD ["node", "backend/server.js"]