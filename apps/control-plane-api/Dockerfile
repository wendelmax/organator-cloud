FROM node:24-slim AS base

FROM base AS builder
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates
WORKDIR /app
RUN npm install -g turbo
COPY . .
RUN turbo prune control-plane-api --docker

FROM base AS installer
WORKDIR /app
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/package-lock.json ./package-lock.json
RUN npm install
COPY --from=builder /app/out/full/ .
# Generate Prisma Client
RUN cd packages/core-models && npx prisma generate
RUN npm run build --filter=control-plane-api

FROM base AS runner
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=installer /app .
WORKDIR /app/apps/control-plane-api
CMD ["npm", "run", "start:prod"]
