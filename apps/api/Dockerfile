# API do Txillapp (NestJS). Contexto de build: a raiz do repositório.
#   docker build -f apps/api/Dockerfile -t txillapp-api .
# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /app
# Primeiro só os package.json: a instalação fica em cache enquanto as dependências não mudam.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @txillapp/shared && npm run build -w @txillapp/api \
 && npm prune --omit=dev \
 && mkdir -p apps/api/node_modules packages/shared/node_modules

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    MEDIA_DIR=/data/uploads \
    MODEL_CACHE_DIR=/data/models
WORKDIR /app
COPY --from=build /app/node_modules node_modules
# Versões que só uma workspace usa ficam em apps/api/node_modules (o Elasticsearch 8, por exemplo).
COPY --from=build /app/apps/api/node_modules apps/api/node_modules
COPY --from=build /app/package.json package.json
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/migrations apps/api/migrations
# Pastas de dados (montadas como volumes): ficheiros enviados e modelo de verificação de fotos.
RUN mkdir -p /data/uploads /data/models && chown -R node:node /data
USER node
WORKDIR /app/apps/api
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
