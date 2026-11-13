# Entrada (nginx) do Txillapp: serve a app web já compilada e encaminha /api para a API.
# Contexto de build: a raiz do repositório.
#   docker build -f apps/web/Dockerfile -t txillapp-edge .
# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @txillapp/shared && npm run build -w @txillapp/web

# Versão web da app React Native: é o site principal (txillapp.com e app.txillapp.com).
FROM node:22-bookworm-slim AS mobileweb
WORKDIR /m
COPY apps/mobile/package.json apps/mobile/package-lock.json ./
RUN npm ci
COPY apps/mobile/ ./
RUN CI=1 npx expo export --platform web --output-dir dist && node scripts/post-export-web.mjs dist ""

# 1.27.5 (fixo): o `resolve` no upstream da API (as réplicas entram e saem sem reiniciar o nginx) só existe desde o 1.27.3.
FROM nginx:1.27.5-alpine
COPY infra/prod/nginx/nginx.conf /etc/nginx/nginx.conf
COPY infra/prod/nginx/conf.d /etc/nginx/conf.d
COPY infra/prod/nginx/cloudflare-ips.conf /etc/nginx/cloudflare-ips.conf
# A app React Native é o site principal. O site antigo só fica para a moderação (admin.txillapp.com).
COPY --from=mobileweb /m/dist /usr/share/nginx/html
COPY --from=build /app/apps/web/dist /usr/share/nginx/admin
EXPOSE 80 443
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:8081/healthz || exit 1
