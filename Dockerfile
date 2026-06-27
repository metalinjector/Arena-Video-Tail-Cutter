# syntax=docker/dockerfile:1

# ============================================================================
# Stage 1 — builder: install deps and build backend + frontend
# ============================================================================
FROM node:24-bookworm AS builder

# Enable pnpm via corepack (lockfile is v9 → pnpm 9.x)
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /repo

# Copy the whole workspace (see .dockerignore for what is excluded).
COPY . .

# Install all workspace dependencies (frozen to the committed lockfile).
RUN pnpm install --frozen-lockfile

# Build the backend → self-contained ESM bundle at artifacts/api-server/dist
RUN pnpm --filter @workspace/api-server run build

# Build the frontend → static files at artifacts/video-trimmer/dist/public
# PORT is only read by vite.config at load time; BASE_PATH=/ serves at root.
RUN PORT=5000 BASE_PATH=/ pnpm --filter @workspace/video-trimmer run build

# ============================================================================
# Stage 2 — runtime: minimal image with ffmpeg + the built artifacts
# ============================================================================
FROM node:24-bookworm-slim AS runtime

# ffmpeg/ffprobe are required by the trimming logic.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production \
    PORT=5000 \
    PUBLIC_DIR=/app/public

# Backend bundle (esbuild output is fully self-contained — no node_modules needed).
COPY --from=builder /repo/artifacts/api-server/dist ./dist

# Reference clip used for tail detection. trim.ts resolves it relative to the
# process working directory as ./src/reference-frames/ref_tail.mp4
COPY --from=builder /repo/artifacts/api-server/src/reference-frames ./src/reference-frames

# Built frontend served by the same Express process (see PUBLIC_DIR).
COPY --from=builder /repo/artifacts/video-trimmer/dist/public ./public

EXPOSE 5000

# Container-level health check (Node 24 has a global fetch).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||5000)+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "dist/index.mjs"]
