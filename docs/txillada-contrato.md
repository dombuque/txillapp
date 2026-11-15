# Txillada (lives) — contrato da fase 1

A Txillada é o live da Txillapp. O vídeo corre num servidor LiveKit à parte (WebRTC; `live.txillapp.com`); a API da
Txillapp só dá os acessos (tokens LiveKit assinados), guarda o estado, os comentários, os brindes e a moderação, e avisa
em tempo real pelo canal que a app já usa (chat/realtime — `RealtimeBus.publish(userId, evento)` e o transporte do
chat).

## Configuração

`.env` da API: `LIVEKIT_URL` (ex. `wss://live.txillapp.com`), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`. Sem eles, as rotas
de criar/entrar respondem **503 «A Txillada ainda não está disponível.»** e `GET /txilladas/config` diz `{ enabled: false }`
(a app esconde a entrada). Em desenvolvimento e nos testes: `docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp
livekit/livekit-server --dev --bind 0.0.0.0` (chave `devkey`, segredo `secret`, `ws://localhost:7880`).

## Base de dados (migração 0158_txillada.sql)

- `content.txilladas`: `id uuid PK`, `host_id uuid` (identity.users), `title text` (1–80, limpo pelo filtro de palavras),
  `audience text` ('everyone' | 'followers' | 'close'), `status text` ('live' | 'ended' | 'cut'), `room text UNIQUE`
  (`tx-<id>`), `started_at`, `ended_at`, `viewers int` (agora), `peak_viewers int`, `cheers int`, `comments int`,
  `cut_reason text`, `cut_by uuid`. Índice parcial em `status = 'live'`. **No máximo uma `live` por anfitrião.**
- `content.txillada_comments`: `id`, `txillada_id`, `author_id`, `body` (1–300, filtro), `created_at`, `removed_at`.
- `content.txillada_cheers`: `(txillada_id, user_id)` PK, `count int`, `last_at`.
- `content.txillada_bans`: `(txillada_id, user_id)` PK, `created_at`.
- Apagar a conta apaga as Txilladas, comentários, brindes e expulsões da pessoa; exportação inclui as Txilladas que fez
  e os comentários que escreveu.

## Regras

- **Quem pode abrir:** conta ativa, 18 anos ou mais (`birth_date <= current_date - 18 anos`; sem data = não), sem
  suspensão. Senão 403 com a razão.
- **Quem pode ver:** as regras de `canView()` (bloqueios, conta privada → só seguidores) e o público escolhido:
  'everyone' (quem pode ver o perfil), 'followers' (quem segue), 'close' (amigos próximos do anfitrião — a mesma lista
  dos mimos). Expulsos: 403. Fora disto: 404.
- **Comentar:** quem vê, com as regras de «quem comenta» do anfitrião (`comments_allowed`/`allowedBy`), 1 comentário por
  2 s por pessoa (429 com mensagem).
- **Brindar:** quem vê; conta a quantidade (`count`), sem limite por pessoa mas no máximo 5 por segundo.
- **Fim:** o anfitrião termina; ou o LiveKit avisa `room_finished` (webhook); ou ninguém publica vídeo há 60 s; ou a
  moderação corta (`cut`). Ao acabar, todos os espectadores recebem `txillada.ended`.

## API (prefixo /api/v1, com sessão)

| Rota | Quem | Resposta |
|---|---|---|
| `GET /txilladas/config` | todos | `{ enabled }` |
| `POST /txilladas` `{ title, audience }` | anfitrião | `{ txillada: TxilladaDto, token, url }` (token com `canPublish`) — 409 se já tem uma a decorrer |
| `GET /txilladas/live` | todos | `{ items: TxilladaDto[] }` — as que estão a decorrer e posso ver, de quem sigo primeiro, depois as mais vistas do meu país (máx. 30) |
| `GET /txilladas/:id` | quem pode ver | `TxilladaDto` |
| `POST /txilladas/:id/join` | quem pode ver | `{ token, url }` (só `canSubscribe`; o anfitrião recebe `canPublish`) |
| `POST /txilladas/:id/end` | anfitrião | `TxilladaDto` (status 'ended') |
| `GET /txilladas/:id/comments?after=<id>` | quem pode ver | `{ items: TxilladaComment[] }` (os 50 mais recentes, do mais antigo para o mais recente) |
| `POST /txilladas/:id/comments` `{ body }` | quem pode comentar | `TxilladaComment` |
| `DELETE /txilladas/:id/comments/:commentId` | anfitrião ou autor | 204 |
| `POST /txilladas/:id/cheer` | quem pode ver | `{ cheers }` |
| `POST /txilladas/:id/ban/:username` | anfitrião | 204 — tira-o da sala no LiveKit e não volta a entrar |
| `POST /txilladas/:id/report` `{ reason }` | quem pode ver | 204 (entra na fila de denúncias, `target_type = 'txillada'`) |
| `POST /txilladas/livekit-webhook` | LiveKit (assinado) | 200 — `participant_joined/left` atualiza `viewers`/`peak_viewers`; `room_finished` acaba |
| `GET /admin/txilladas` | backoffice | as que estão a decorrer, com denúncias |
| `POST /admin/txilladas/:id/cut` `{ reason }` | backoffice | 204 — apaga a sala no LiveKit, status 'cut' |

`TxilladaDto`: `{ id, host: { id, username, displayName, avatarUrl, verified, verifiedTier }, title, audience, status,
startedAt, endedAt, viewers, peakViewers, cheers, comments, isHost, canComment }`.

`TxilladaComment`: `{ id, author: { id, username, displayName, avatarUrl, verified, verifiedTier }, body, createdAt }`.

## Tempo real (pelo canal da app)

Para cada espectador ligado e o anfitrião: `{ type: 'txillada.comment', txilladaId, comment }`,
`{ type: 'txillada.cheer', txilladaId, cheers, from: { username } }`, `{ type: 'txillada.viewers', txilladaId, viewers }`,
`{ type: 'txillada.ended', txilladaId, status }`, `{ type: 'txillada.comment_removed', txilladaId, commentId }`. Quem está a
ver é quem fez `join` e não saiu (o webhook diz quem está na sala; guarda-se no Redis/RealtimeBus).

## Avisos e perfil

- Ao começar: notificação `txillada_live` aos seguidores (e push), no máximo uma por anfitrião por hora; o texto é
  «@x abriu uma Txillada: <título>». Abrir a notificação entra na Txillada (ou diz que já acabou).
- O perfil e a fila dos mimos ganham `live: { id } | null` no utilizador: a roda fica vermelha com «AO VIVO» e tocar entra.

## App (fase 1)

- Entrada: em Criar, o modo **TXILLADA** (ao lado de MIMO, TCHEKA, PUBLICAÇÃO, ZÁS) quando `config.enabled`: câmara,
  título, público, «Começar Txillada».
- Anfitrião: a câmara a transmitir (virar, calar o microfone), «AO VIVO» e o tempo, quantos estão a ver, os
  comentários a flutuar (o estilo dos balões dos mimos), os brindes com os copos, terminar (com confirmação), expulsar e
  apagar comentários (toque longo).
- Espectador (`/txillada/[id]`): o vídeo 9:16, o anfitrião com selo e «AO VIVO», quantos estão a ver, os comentários a
  flutuar, o campo para comentar, brindar (CheersPour), partilhar, denunciar, sair. Quando acaba: «A Txillada acabou».
- Fila dos mimos e perfil: roda vermelha «AO VIVO».
- Telemóvel: `@livekit/react-native` + `@livekit/react-native-webrtc` (+ plugins Expo). Site/PWA: `livekit-client`.
