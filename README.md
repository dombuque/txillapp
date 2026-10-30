# Txillapp

Plataforma social mobile-first (PWA) com feed, showoff e **Txills** — uma moeda virtual de **demonstração** (sem valor real) — criada por Erasmo Buque (dombuque).

> **Estado: MVP.** Os Txills são fictícios. Recargas e pagamentos reais só serão activados após validação regulamentar. Ver [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## O que já funciona

- Registo em passos com **validação em tempo real** do @ e do email (sugestões livres quando o @ já tem dono; nomes reservados bloqueados)
- Login com utilizador ou email, **login com Google** (verificado no servidor), Argon2id, auditoria append-only
- Sessão persistente e deslizante (rotação do refresh token, dura enquanto usar a app): só o logout leva ao login
- Feed com publicações e **várias fotografias** (carrossel), paginação por cursor
- **Brindar**, **Comentar** (com respostas, brindes nos comentários e menções, ao estilo Instagram) e **Presentear**
- **Presentear alguém** com Txills, com post opcional "X presenteou Y" no feed
- **Stories** de 24 h, com quem viu (só o autor), apagar e bandeja com "não vistos"
- **Onde estás?**: localização do dispositivo com sugestões de sítios próximos; só o nome escolhido é guardado, nunca o GPS
- **Perfil** com foto (recorte quadrado), bio, público ou privado (pedidos para seguir), seguidores, bloqueios ao estilo do X com aviso à pessoa bloqueada
- **Notificações** (bloqueio, seguidores, pedidos, presentes, comentários, respostas a stories, reposts) em página própria
- **Pesquisa** de pessoas e publicações; **reposts** (simples e com comentário)
- **Presentear** de qualquer sítio: discreto, mensagem privada ou no feed (ou publicar depois); só se presenteia quem se segue
- **Definições e privacidade**: quem comenta, quem presenteia, quem vê as listas, sugestões, respostas e esconder stories, alterar senha, dispositivos, eliminar conta
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

## Login com Google (opcional)

1. Google Cloud Console → Credenciais → *ID de cliente OAuth* (Aplicação Web); em *Origens JavaScript autorizadas* ponha `http://localhost:5173` (e o domínio de produção).
2. Em `apps/api/.env`: `GOOGLE_CLIENT_ID=...apps.googleusercontent.com` e reinicie a API.
3. O botão aparece sozinho. Contas novas escolhem o @ a seguir; uma conta existente com o mesmo email **não** é ligada automaticamente (entra com a senha).

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

## Fotos: verificação automática

Todas as fotos passam por um modelo local (ViT `AdamCodd/vit-base-nsfw-detector`, Apache-2.0) antes de ficarem visíveis. Nada sai do servidor.

- `IMAGE_MODERATION=local` liga; `off` desliga (só desenvolvimento).
- ≥ `NSFW_REJECT_THRESHOLD` (0.85): a foto é recusada. Entre `NSFW_REVIEW_THRESHOLD` (0.5) e 0.85: passa e vai para a fila de moderação (`/admin`).
- Se o modelo falhar, a foto é recusada (falha fechada).
- O modelo (~89 MB) descarrega-se na primeira análise para `.models/`. Para o testar com as tuas imagens:
  `cd apps/api && npx ts-node scripts/check-nsfw.ts foto1.jpg foto2.png`
  e, ponta a ponta com a API: `npx ts-node scripts/e2e-real-nsfw.ts foto.jpg`.
- Nenhum detetor é perfeito: mantém-se a moderação humana e as denúncias.

Contas de moderação: `UPDATE identity.users SET is_admin = true WHERE username = '...';`

## Produção

Guia completo para pôr o Txillapp no ar em `txillapp.com` (Cloudflare + R2 + VPS com Docker Compose + Nginx + PostgreSQL + Redis, cópias de segurança cifradas e monitorização): [`docs/DEPLOY.md`](docs/DEPLOY.md). Os ficheiros estão em `infra/prod/` e nos `Dockerfile` de `apps/api` e `apps/web`.
