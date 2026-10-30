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

FROM nginx:1.27-alpine
COPY infra/prod/nginx/nginx.conf /etc/nginx/nginx.conf
COPY infra/prod/nginx/conf.d /etc/nginx/conf.d
COPY infra/prod/nginx/cloudflare-ips.conf /etc/nginx/cloudflare-ips.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80 443
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:8081/healthz || exit 1
