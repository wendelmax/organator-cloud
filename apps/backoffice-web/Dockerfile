FROM node:26-slim AS base

FROM base AS builder
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates
WORKDIR /app
RUN npm install -g turbo
COPY . .
RUN turbo prune backoffice-web --docker

FROM base AS installer
WORKDIR /app
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/package-lock.json ./package-lock.json
RUN npm install
COPY --from=builder /app/out/full/ .
RUN npm run build --filter=backoffice-web

FROM base AS runner
WORKDIR /app
COPY --from=installer --chown=node:node /app .
WORKDIR /app/apps/backoffice-web
ENV NODE_ENV=production
EXPOSE 3000
USER node
CMD ["node", "/app/node_modules/next/dist/bin/next", "start"]
