# Build context is the repo root: the API serves docs/openapi.yaml, which lives
# outside backend/. Layout in the image keeps the same relative paths as the repo.
FROM node:22-bookworm-slim AS base
WORKDIR /app/backend
# Only needed if better-sqlite3 has no prebuilt binary for the platform.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY backend/package.json backend/package-lock.json ./

FROM base AS build
RUN npm ci
COPY backend/tsconfig.json backend/tsconfig.build.json ./
COPY backend/src ./src
RUN npm run build

# Separate install so devDependencies never reach the runtime image.
FROM base AS prod-deps
RUN npm ci --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app/backend
# NODE_ENV is set by compose, not baked in (see docker-compose.yml).
COPY --from=prod-deps /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist
COPY backend/package.json ./
COPY docs/openapi.yaml /app/docs/openapi.yaml
# The volume inherits this ownership, so the non-root user can write the SQLite file.
RUN mkdir /data && chown node:node /data
ENV DB_PATH=/data/payments.sqlite
VOLUME /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
