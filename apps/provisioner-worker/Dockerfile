FROM node:20-slim AS base

FROM base AS builder
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates
WORKDIR /app
RUN npm install -g turbo
COPY . .
RUN turbo prune provisioner-worker --docker

FROM base AS installer
WORKDIR /app
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/package-lock.json ./package-lock.json
RUN npm install
COPY --from=builder /app/out/full/ .
RUN cd packages/core-models && npx prisma generate
RUN npm run build --filter=provisioner-worker

FROM base AS runner
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=installer /app .
WORKDIR /app/apps/provisioner-worker
CMD ["npm", "run", "start"]
