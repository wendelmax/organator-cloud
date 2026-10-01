FROM node:26-slim AS base

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
COPY --from=installer --chown=node:node /app .
WORKDIR /app/apps/control-plane-api
ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001
USER node
# node como PID 1 recebe SIGTERM direto (npm não repassa o sinal de forma confiável).
# Migrações: npm run migrate:deploy --workspace=@organator/core-models (a partir de /app).
CMD ["node", "dist/main.js"]
