FROM node:20-alpine AS base

FROM base AS builder
RUN apk add --no-cache libc6-compat
RUN apk update
WORKDIR /app
RUN npm install -g turbo
COPY . .
RUN turbo prune provisioner-worker --docker

FROM base AS installer
RUN apk add --no-cache libc6-compat
RUN apk update
WORKDIR /app
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/package-lock.json ./package-lock.json
RUN npm install
COPY --from=builder /app/out/full/ .
RUN cd packages/core-models && npx prisma generate
RUN npm run build --filter=provisioner-worker

FROM base AS runner
WORKDIR /app
COPY --from=installer /app .
WORKDIR /app/apps/provisioner-worker
CMD ["npm", "run", "start"]
