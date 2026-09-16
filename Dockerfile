# WMS production image — for a Hostinger VPS (or any Docker host).
# better-sqlite3 is a native addon, so build tooling is needed at install time.
FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

FROM node:20-bookworm-slim
# The commit this image was built from. /healthz returns it, and the release
# workflow asserts the served value matches the ref it asked for - without it a
# 200 from the OLD container satisfies the health gate exactly as well as a 200
# from the new one, which is how a deploy can look green and land nothing.
ARG BUILD_SHA=unknown
ENV BUILD_SHA=$BUILD_SHA \
    NODE_ENV=production \
    SKIP_AUTO_SEED=1 \
    ALLOW_AUTO_SEED=0 \
    PRODUCTION_INITIALIZATION_ENABLED=false
WORKDIR /app
# Copy the built app (incl. compiled better-sqlite3) from the build stage.
COPY --from=build /app /app
# The SQLite file lives here; mount a volume so data survives container restarts.
RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 3000
# Schema migrations are idempotent. Never seed or initialize a production
# database from the image; an empty database is a stop-and-investigate event.
CMD ["node", "server/index.js"]
