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
ENV NODE_ENV=production
WORKDIR /app
# Copy the built app (incl. compiled better-sqlite3) from the build stage.
COPY --from=build /app /app
# The SQLite file lives here; mount a volume so data survives container restarts.
RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 3000
# The schema is created on boot (idempotent). Seed once with:
#   docker compose run --rm wms npm run seed
CMD ["node", "server/index.js"]
