FROM node:20-alpine AS base

FROM base AS builder
RUN apk add --no-cache libc6-compat
RUN apk update
WORKDIR /app
RUN npm install -g turbo
COPY . .
RUN turbo prune control-plane-api --docker

FROM base AS installer
RUN apk add --no-cache libc6-compat
RUN apk update
WORKDIR /app
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/package-lock.json ./package-lock.json
RUN npm install
COPY --from=builder /app/out/full/ .
# Generate Prisma Client
RUN cd packages/core-models && npx prisma generate
RUN npm run build --filter=control-plane-api

FROM base AS runner
WORKDIR /app
COPY --from=installer /app .
WORKDIR /app/apps/control-plane-api
CMD ["npm", "run", "start:prod"]
