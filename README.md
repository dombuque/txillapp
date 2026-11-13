# Txillapp

Plataforma social mobile-first (PWA) com feed, showoff e **Txills** — uma moeda virtual de **demonstração** (sem valor real) — criada por Erasmo Buque (dombuque).

> **Estado: MVP.** Os Txills são fictícios. Recargas e pagamentos reais só serão activados após validação regulamentar. Ver [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

**Vocabulário do Txillapp** (os nomes no código são os genéricos): **Mimo** = story (24 h), **Tcheka** = reel (vídeo curto), **Zás** = instant (foto na hora, vista uma vez), **Geleira** = os gostos do perfil. Nos textos visíveis nunca se diz story nem reel.

**As personagens** (os stickers do chat são sempre uma delas, em `apps/web/src/lib/stickers.tsx`): **Txilla** (a caneca com espuma), **Gelinho** (a geleira), **Zazá** (o raio), **Mimo** (o coração), **Txeka** (o ecrã dos tchekas) e **Super** (a estrela do SuperTxill). Regenerar o pacote: `npm run export-stickers` em apps/web.

## O que já funciona

- Registo em passos com **validação em tempo real** do @ e do email (sugestões livres quando o @ já tem dono; nomes reservados bloqueados)
- Login com utilizador ou email, **login com Google** (verificado no servidor), Argon2id, auditoria append-only
- Sessão persistente e deslizante (rotação do refresh token, dura enquanto usar a app): só o logout leva ao login
- Feed com publicações e **várias fotografias** (carrossel), paginação por cursor
- **Brindar**, **Comentar** (com respostas, brindes nos comentários e menções, ao estilo Instagram) e **Presentear**
- **Presentear alguém** com Txills, com post opcional "X presenteou Y" no feed
- **Mimos** (stories) de 24 h, com quem viu (só o autor), apagar e bandeja com "não vistos"
- **Onde estás?**: localização do dispositivo com sugestões de sítios próximos; só o nome escolhido é guardado, nunca o GPS
- **Perfil** com foto (recorte quadrado), bio, público ou privado (pedidos para seguir), seguidores, bloqueios ao estilo do X com aviso à pessoa bloqueada
- **Notificações** (bloqueio, seguidores, pedidos, presentes, comentários, respostas a mimos, reposts) em página própria
- **Pesquisa** de pessoas e publicações; **reposts** (simples e com comentário)
- **Presentear** de qualquer sítio: discreto, mensagem privada ou no feed (ou publicar depois); só se presenteia quem se segue
- **Definições e privacidade**: quem comenta, quem presenteia, quem vê as listas, sugestões, respostas e esconder mimos, alterar senha, dispositivos, eliminar conta
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
- Sem MFA, mensagens, mimos, descoberta e comerciantes — ver as fases em `docs/ARCHITECTURE.md`.

## Licença

Todos os direitos reservados © Erasmo Buque (dombuque), até ser definida uma licença.

## Fotos: verificação automática

Todas as fotos (e 3 imagens de cada vídeo) passam por dois modelos locais antes de ficarem visíveis. Nada sai do servidor.

1. Um classificador da imagem inteira (ViT `AdamCodd/vit-base-nsfw-detector`, Apache-2.0) dá uma pontuação. Sozinho nunca recusa:
   erra em selfies, roupa justa, praia, ginásio e peles escuras.
2. A partir de `NSFW_DETECT_THRESHOLD` (0.3) corre o detetor de partes do corpo expostas, o NudeNet v3.4 `640m`
   (YOLOv8, [notAI-tech/NudeNet](https://github.com/notAI-tech/NudeNet), AGPL-3.0; os pesos oficiais, sem alterações,
   descarregam-se uma vez para `MODEL_CACHE_DIR/nudenet` e são conferidos pelo SHA-256).
3. Decisão (`apps/api/src/moderation/image-moderation.service.ts`, `decide()`):
   - **recusa** só com prova: genitais, ânus ou mamilos femininos expostos com confiança ≥ `NUDE_REJECT_CONFIDENCE` (0.6)
     e o classificador ≥ `NUDE_REJECT_MIN_NSFW` (0.5) — `NSFW_AUTO_REJECT=true` por omissão;
   - **moderação** (passa e vai para a fila, com o motivo «Detetado: … (78%)»): essas partes com menos confiança, nádegas
     expostas (≥ 0.5), ou o classificador ≥ `NSFW_REVIEW_THRESHOLD` (0.98) sem o detetor confirmar;
   - **passa** no resto. O peito de um homem confundido com mamilos femininos (só rosto masculino) nunca recusa.
- `IMAGE_MODERATION=local` liga; `off` desliga (só desenvolvimento). `NUDE_DETECTOR=320n` usa o modelo pequeno (mais rápido,
  mas com muito mais falsos alarmes); `off` tira o detetor (nada é recusado).
- Se o classificador falhar, a foto é recusada (falha fechada). Se só o detetor falhar, nunca se recusa.
- **Pedir revisão**: uma foto recusada fica `rejected` (ninguém a vê; na nuvem, no bucket privado) durante 7 dias. O dono
  pode pedir revisão uma vez (`POST /media/:id/appeal`, até 10 por dia): a foto vai para a fila da moderação, marcada como
  «pedido de revisão». Dispensar aprova-a (fica `ready`, publicável, e o dono é avisado; a mesma foto do mesmo dono deixa
  de ser recusada); remover apaga-a. Sem pedido, apaga-se ao fim dos 7 dias. A limpeza das 48 h ignora as `rejected` e,
  numa foto aprovada, conta a partir da aprovação. Na app, a faixa de publicação mostra «Pedir revisão» e continua a
  publicação sozinha quando a foto é aprovada (enquanto a app estiver aberta). Os vídeos recusados não têm revisão.
- No máximo 2 análises ao mesmo tempo. Tempos em `image_moderation_seconds` (Prometheus).
- Teste de justiça com fotos reais vestidas (fora do git; nunca fotos com nudez):
  `cd apps/api && npx ts-node --transpile-only scripts/bench-nudez.ts pasta-com-subpastas 640m > resultados.tsv`.
  Para testar uma foto: `npx ts-node scripts/check-nsfw.ts foto.jpg` (só o classificador) ou, ponta a ponta com a API,
  `npx ts-node scripts/e2e-real-nsfw.ts foto.jpg`.
- Nenhum detetor é perfeito: mantém-se a moderação humana e as denúncias.

Contas de moderação: `UPDATE identity.users SET is_admin = true WHERE username = '...';`

## Produção

Guia completo para pôr o Txillapp no ar em `txillapp.com` (Cloudflare + R2 + VPS com Docker Compose + Nginx + PostgreSQL + Redis, cópias de segurança cifradas e monitorização): [`docs/DEPLOY.md`](docs/DEPLOY.md). Os ficheiros estão em `infra/prod/` e nos `Dockerfile` de `apps/api` e `apps/web`.
