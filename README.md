# Txillapp

Plataforma social mobile-first (PWA) com feed, showoff e **Txills** — uma moeda virtual de **demonstração** (sem valor real) — criada por Erasmo Buque (dombuque).

> **Estado: MVP.** Os Txills são fictícios. Recargas e pagamentos reais só serão activados após validação regulamentar. Ver [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## O que já funciona

- Registo, login, sessões com refresh token rotativo (deteção de reutilização), Argon2id, auditoria append-only
- Feed com publicações e **várias fotografias** (carrossel), paginação por cursor
- **Brindar**, **Comentar** (com respostas, brindes nos comentários e menções, ao estilo Instagram) e **Presentear**
- **Presentear alguém** com Txills, com post opcional "X presenteou Y" no feed
- **Stories** de 24 h, com quem viu (só o autor), apagar e bandeja com "não vistos"
- **Onde estás?**: localização do dispositivo com sugestões de sítios próximos; só o nome escolhido é guardado, nunca o GPS
- Carteira com ledger de partidas dobradas, idempotência e protecção contra gasto duplo (testado com pedidos concorrentes)
- PWA instalável

## Arrancar em desenvolvimento

Requisitos: Node 22+, Docker.

```bash
npm install
npm run infra:up                      # PostgreSQL (porta 5433) e Redis
cp .env.example apps/api/.env         # e defina JWT_ACCESS_SECRET
npm run build -w @txillapp/shared
npm run migrate
npm run dev:api                       # http://localhost:3000  (docs em /api/docs)
npm run dev:web                       # http://localhost:5173
```

## Testes

```bash
npm test          # integração contra PostgreSQL real (cria a base txillapp_test)
npm run typecheck
```

## Estrutura

```
apps/api       NestJS (API REST /api/v1)
apps/web       React + Vite + Tailwind (PWA)
packages/shared  Esquemas Zod partilhados
infra/docker   Docker Compose de desenvolvimento
docs           Arquitectura
```

## Limitações conhecidas do MVP

- Media guardada em disco local (interface preparada para S3/R2).
- Feed global (sem seguidores/privacidade ainda); rate limit em memória (Redis na fase seguinte).
- Sem MFA, mensagens, stories, descoberta e comerciantes — ver as fases em `docs/ARCHITECTURE.md`.

## Licença

Todos os direitos reservados © Erasmo Buque (dombuque), até ser definida uma licença.
