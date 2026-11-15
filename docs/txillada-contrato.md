# Txillada (lives) — contrato da fase 1

A Txillada é o live da Txillapp. O vídeo corre num servidor LiveKit à parte (WebRTC; `live.txillapp.com`); a API da
Txillapp só dá os acessos (tokens LiveKit assinados), guarda o estado, os comentários, os brindes e a moderação, e avisa
em tempo real pelo canal que a app já usa (chat/realtime — `RealtimeBus.publish(userId, evento)` e o transporte do
chat).

## Nada fica guardado

**A Txillada não se grava.** O vídeo só passa pelo LiveKit ao vivo; não há gravação, nem replay, nem «guardar como
tcheka». Quando acaba, já não se pode ver (o `GET /txilladas/:id` de uma acabada responde com o estado 'ended'/'cut' e a
app mostra «A Txillada acabou»). Os comentários e os brindes de uma Txillada acabada apagam-se **7 dias** depois do fim
(um job do Scheduler), menos os comentários ligados a uma denúncia por decidir, que ficam até à decisão. A linha da
Txillada (título, horas, números) fica só como registo para o anfitrião e a moderação, e sai com a conta.

## Configuração

`.env` da API: `LIVEKIT_URL` (ex. `wss://live.txillapp.com`), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`. Sem eles, as rotas
de criar/entrar respondem **503 «A Txillada ainda não está disponível.»** e `GET /txilladas/config` diz `{ enabled: false }`
(a app esconde a entrada). Em desenvolvimento e nos testes: `docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp
livekit/livekit-server --dev --bind 0.0.0.0` (chave `devkey`, segredo `secret`, `ws://localhost:7880`).

## Base de dados (migração 0158_txillada.sql)

- `content.txilladas`: `id uuid PK`, `host_id uuid` (identity.users), `title text` (0–80, opcional desde a 0159; limpo pelo filtro de palavras),
  `audience text` ('everyone' | 'followers' | 'close'), `status text` ('live' | 'ended' | 'cut'), `room text UNIQUE`
  (`tx-<id>`), `started_at`, `ended_at`, `viewers int` (agora), `peak_viewers int`, `cheers int`, `comments int`,
  `cut_reason text`, `cut_by uuid`. Índice parcial em `status = 'live'`. **No máximo uma `live` por anfitrião.**
- `content.txillada_comments`: `id`, `txillada_id`, `author_id`, `body` (1–300, filtro), `created_at`, `removed_at`.
- `content.txillada_cheers`: `(txillada_id, user_id)` PK, `count int`, `last_at`.
- `content.txillada_bans`: `(txillada_id, user_id)` PK, `created_at`.
- Apagar a conta apaga as Txilladas, comentários, brindes e expulsões da pessoa; exportação inclui as Txilladas que fez
  e os comentários que escreveu.
- **0162_txillada_fixar.sql:** `content.txilladas.pinned_comment_id uuid` (FK para `txillada_comments`, `ON DELETE SET NULL`;
  índice parcial) — o comentário fixado pelo anfitrião, no máximo um. O serviço põe-no a NULL quando o comentário é apagado
  (anfitrião, autor ou moderação); a limpeza dos 7 dias e apagar a conta tiram-no pela FK. `social.reports.target_type`
  ganha `'txillada_comment'`.
- **0165_txillada_convidados.sql:** `content.txillada_guests` `(txillada_id, user_id)` PK, `kind` ('request' — a pessoa
  pediu; 'invite' — o anfitrião convidou), `status` ('pending' | 'accepted' | 'declined' | 'cancelled' | 'left' |
  'removed'), `created_at`, `updated_at`, `since` (quando passou a transmitir). Uma linha por pessoa e Txillada, que muda de
  estado. Apagar a conta apaga as linhas da pessoa (e as das suas Txilladas pelo CASCADE); a exportação junta
  `txilladaGuests` (as Txilladas dos outros em que pedi, fui convidado ou transmiti: anfitrião, `kind`, `status`, horas).
- **Limpeza (`txillada.purge`, de hora a hora):** 7 dias depois do fim apaga comentários, brindes, brindes aos comentários,
  expulsões e convidados (0165), menos os comentários de uma Txillada com denúncia aberta e cada comentário com denúncia
  aberta (`txillada_comment`): ficam até à decisão (os brindes a eles apagam-se na mesma).

## Regras

- **Quem pode abrir:** conta ativa, 18 anos ou mais (`birth_date <= current_date - 18 anos`; sem data = não), sem
  suspensão. Senão 403 com a razão.
- **Quem pode ver:** as regras de `canView()` (bloqueios, conta privada → só seguidores) e o público escolhido:
  'everyone' (quem pode ver o perfil), 'followers' (quem segue), 'close' (amigos próximos do anfitrião — a mesma lista
  dos mimos). Expulsos: 403. Fora disto: 404.
- **Comentar:** quem vê, com as regras de «quem comenta» do anfitrião (`comments_allowed`/`allowedBy`), 1 comentário por
  2 s por pessoa (429 com mensagem).
- **Brindar:** quem vê; conta a quantidade (`count`), sem limite por pessoa mas no máximo 5 por segundo.
- **Quem está a ver é visível:** os tokens dos espectadores deixam de ser `hidden` (quem está na sala vê o nome e o @
  dos outros) e há a lista `GET /txilladas/:id/viewers`. Nas futuras Txilladas pagas, quem vê volta a ficar escondido
  (`roomToken(..., { hidden: true })`).
- **Reagir:** quem vê (as regras do brinde: 404/403/409) manda 👋 `hello`, 🍻 `cheers`, 🔥 `fire`, 😂 `laugh`, ❤️ `heart`.
  **As reações não se guardam** (só o 🍻 conta como brinde, igual ao `POST /cheer`, com o limite de 5 por segundo). No
  máximo 8 reações por segundo por pessoa (429 «Calma! Muitas reações seguidas.»); o 👋 de quem vê, 1 a cada 4 s (429).
  Acima de ~40 reações por segundo na sala, já não se difundem (200 `{ sent: false }`; o 🍻 conta na mesma). O anfitrião
  pode mandar 👋 (a saudação «@anfitrião diz olá a todos 👋», o texto é da app), 🔥, 😂 e ❤️, não 🍻 (400); só ele usa
  `to` (o @ de alguém, só com `hello`: responder a quem entrou com um toque) — a conta tem de existir, estar ativa e não ter
  bloqueio com ele (senão 404); `to` de quem não é anfitrião, `to` com outra reação ou `to` a si próprio: 400.
- **«@fulano entrou»:** quando alguém (que não o anfitrião) faz `join`, o anfitrião e quem vê recebem `txillada.joined`
  (menos o próprio e quem tem bloqueio com quem entrou), no máximo uma vez por pessoa por Txillada a cada 60 s (as
  religações não repetem). Sai do `join` da API (o webhook pode não estar ligado).
- **Fim:** o anfitrião termina; ou o LiveKit avisa `room_finished` (webhook); ou ninguém publica vídeo há 60 s; ou a
  moderação corta (`cut`). Ao acabar, todos os espectadores recebem `txillada.ended`. Acaba para todos: os convidados
  deixam de transmitir (`left`) e os pedidos e convites à espera caem (`cancelled`).

## Convidados (0165): até 4 pessoas a transmitir

O anfitrião e **até 3 convidados** transmitem ao mesmo tempo (câmara e microfone). O identity no LiveKit continua a ser o id
da conta; os nomes vêm dos DTO da API (o token do convidado não leva nome nem @, como o de quem vê).

- **Pedir para entrar:** quem vê (conta ativa, 18 anos ou mais, não expulso, sem bloqueio com o anfitrião) pede; o anfitrião
  recebe `txillada.request` e vê o pedido em `requests` (aceitar ou recusar). Um pedido à espera não se repete; depois de
  recusado (ou de desistir), 1 pedido a cada 20 s (429). Com um convite à espera, pedir aceita-o.
- **Convidar:** o anfitrião convida quem está a ver (a lista «A ver agora»: fez `join` e não saiu; senão 409); conta ativa,
  18 anos ou mais (senão 403 «Não podes convidar @x para transmitir.», sem dizer porquê), sem bloqueio (404), não expulso
  (409); 20 convites por minuto. A pessoa recebe `txillada.invite` (com quem convidou e o selo) e aceita ou recusa. Convidar
  quem pediu aceita o pedido.
- **Aceitar:** com a linha da Txillada trancada, conta os que transmitem — **no máximo 3 (409 «Já há 3 convidados a
  transmitir…»)**; a pessoa tem de estar a ver. A API muda a permissão no LiveKit sem voltar a entrar
  (`RoomService.updateParticipant`, `canPublish: true`; o `LiveKitRooms.setCanPublish` injetável) e a sala recebe
  `txillada.guest_joined`. Um `join` de um convidado aceite já dá um token com `canPublish`; o webhook volta a dar a
  permissão quando um convidado entra outra vez na sala (uma religação reaproveita o token antigo).
- **Sair e tirar:** o convidado sai quando quer (volta a só ver); o anfitrião tira (`removed`); expulsar, um bloqueio com o
  anfitrião e apagar a conta também tiram. `canPublish: false` no LiveKit (as faixas param) e a sala recebe
  `txillada.guest_left`. Um convidado que sai da sala (webhook `participant_left`, confirmado no LiveKit) deixa de transmitir.
- **Quem vê quem:** quem tem um bloqueio com um convidado não o vê em `guests` nem recebe os avisos dele; a app deixa de
  receber as faixas de quem não está na lista (`setSubscribed(false)`).
- **Espectadores:** `viewers` conta quem está na sala sem o anfitrião e sem os convidados (contam à parte); «A ver agora»
  também não os mostra.

| Rota (prefixo /api/v1, com sessão) | Quem | Resposta |
|---|---|---|
| `POST /txilladas/:id/guests/request` | quem vê | `{ state: 'requested' }` (ou `{ state: 'guest', guests }` com um convite à espera) — 400 anfitrião, 403 menor/expulso, 404, 409 já transmite/acabada, 429 |
| `POST /txilladas/:id/guests/invite` `{ username }` | anfitrião | `{ guests, requests, invites }` — 403/404/409/429 como acima |
| `POST /txilladas/:id/guests/accept` | quem foi convidado | `{ state: 'guest', guests }` — 404 sem convite, 409 com 3 ou sem estar a ver |
| `POST /txilladas/:id/guests/decline` | quem foi convidado | `{ state: 'none' }`; o anfitrião recebe `txillada.invite_declined` |
| `POST /txilladas/:id/guests/leave` | convidado, quem pediu ou foi convidado | `{ state: 'none' }` (sair do ecrã, desistir do pedido, recusar o convite) |
| `POST /txilladas/:id/guests/:username/accept` | anfitrião | `{ guests, requests, invites }` — 404 sem pedido, 409 com 3 ou se já não está a ver |
| `POST /txilladas/:id/guests/:username/decline` | anfitrião | idem; a pessoa recebe `txillada.request_declined` |
| `POST /txilladas/:id/guests/:username/remove` | anfitrião | idem — tira de transmitir, retira um convite (`txillada.invite_cancelled`) ou recusa um pedido; 404 sem nada |

`TxilladaDto` ganha `guests: [{ user: { id, username, displayName, avatarUrl, verified, verifiedTier }, since }]` (por ordem
de entrada, como eu os vejo), `guestsMax: 3`, `guestState: 'none' | 'requested' | 'invited' | 'guest'` (o meu lugar) e, só
para o anfitrião, `requests` e `invites` (`[{ user, at }]`).

Tempo real: `txillada.request` `{ user, requests, invites }` e `txillada.requests` `{ requests, invites }` (ao anfitrião);
`txillada.invite` `{ host }`, `txillada.invite_cancelled`, `txillada.request_declined` (à pessoa); `txillada.invite_declined`
`{ user }` (ao anfitrião); `txillada.guest_joined` `{ guest: { user, since } }` e `txillada.guest_left` `{ user, reason:
'left' | 'removed' }` (à sala, menos quem tem bloqueio com o convidado; o anfitrião e o próprio recebem sempre).

**App:** `lib/txilladaGuests.ts` (o estado, o ecrã e os avisos, com testes), `components/txillada/TxilladaGuests.tsx`
(`TxilladaStage`, `InviteCard`, `GuestsPanel`). O ecrã: 1 pessoa = inteiro; 2 = uma em cima da outra ao alto (lado a lado
num ecrã deitado); 3 = o anfitrião grande em cima e dois em baixo; 4 = grelha 2×2. Cada quadrado com o @ e o selo, o
microfone calado e um contorno coral em quem fala (`ActiveSpeakersChanged`); nos quadrados pequenos pede-se a camada de
360p (`setVideoQuality`, por cima do adaptiveStream do site). Quem vê: «Pedir para entrar» em cima (e em «Mais»); o
cartão do convite (aceitar abre a câmara antes de dizer que sim); a transmitir: microfone, virar e «Sair do ecrã». O
anfitrião: o botão das pessoas com o número de pedidos (a lista: tirar, aceitar, recusar, retirar) e «Convidar para
transmitir» em «A ver agora». Todos recebem as faixas de quem transmite (o anfitrião também: as dos convidados).

## API (prefixo /api/v1, com sessão)

| Rota | Quem | Resposta |
|---|---|---|
| `GET /txilladas/config` | todos | `{ enabled }` |
| `POST /txilladas` `{ title, audience }` | anfitrião | `{ txillada: TxilladaDto, token, url }` (token com `canPublish`) — 409 se já tem uma a decorrer |
| `GET /txilladas/live` | todos | `{ items: TxilladaDto[] }` — as que estão a decorrer e posso ver, de quem sigo primeiro, depois as mais vistas do meu país (máx. 30) |
| `GET /txilladas/:id` | quem pode ver | `TxilladaDto` |
| `POST /txilladas/:id/join` | quem pode ver | `{ token, url }` (só `canSubscribe`, visível na sala — sem `hidden`; o anfitrião recebe `canPublish`); manda `txillada.joined` |
| `POST /txilladas/:id/end` | anfitrião | `TxilladaDto` (status 'ended') |
| `GET /txilladas/:id/comments?after=<id>` | quem pode ver | `{ items: TxilladaComment[] }` (os 50 mais recentes, do mais antigo para o mais recente) |
| `POST /txilladas/:id/comments` `{ body }` | quem pode comentar | `TxilladaComment` |
| `DELETE /txilladas/:id/comments/:commentId` | anfitrião ou autor | 204 |
| `POST /txilladas/:id/comments/:commentId/cheer` | quem pode ver (sem bloqueio com o autor) | 200 `{ cheered, cheers }` — brindar outra vez tira; 404 (apagado, bloqueio), 403 (expulso), 409 (acabada), 429 (mais de 5/s). Sem aviso ao autor; manda `txillada.comment_cheer` (0161) |
| `POST /txilladas/:id/cheer` | quem pode ver | `{ cheers }` |
| `POST /txilladas/:id/react` `{ kind: 'hello'\|'cheers'\|'fire'\|'laugh'\|'heart', to?: username }` | quem pode ver (`to` só o anfitrião, só com `hello`) | 200 `{ sent }` (com `cheers` quando `kind` é 'cheers') — 404/403/409 como o brinde; 400 (anfitrião com 'cheers', `to` fora das regras); 404 (`to` que não existe ou com bloqueio); 429 (mais de 8/s, ou o 👋 de quem vê antes de 4 s). Não se guarda nada (o 🍻 conta como brinde) |
| `GET /txilladas/:id/viewers` | quem pode ver | `{ items: [{ username, displayName, avatarUrl, verified, verifiedTier }], total }` — quem está a ver agora (fez `join` e não saiu), sem o anfitrião, só contas ativas, sem expulsos e sem quem tem bloqueio com quem pede; quem eu sigo primeiro, depois pelo @ (máx. 200; `total` = `items.length`) |
| `POST /txilladas/:id/ban/:username` | anfitrião | 204 — tira-o da sala no LiveKit e não volta a entrar |
| `POST /txilladas/:id/comments/:commentId/report` `{ reason, note? }` | quem pode ver | 204 (fila de denúncias, `target_type = 'txillada_comment'`; 30 por hora) — deixa de aparecer a quem denunciou (lista, balões e fixado); fica guardado até à decisão; 404 se já foi apagado |
| `POST /txilladas/:id/pin` `{ commentId: uuid \| null }` | anfitrião | 200 `{ pinned: TxilladaComment \| null }` — fixa (troca o que estava) ou tira com null; só a decorrer (409), só um comentário desta Txillada que ainda se vê (404), 403 a quem não é anfitrião; 60 por minuto. Manda `txillada.pinned` se mudou |
| `POST /txilladas/:id/report` `{ reason }` | quem pode ver | 204 (entra na fila de denúncias, `target_type = 'txillada'`) |
| `POST /txilladas/livekit-webhook` | LiveKit (assinado) | 200 — `participant_joined/left` atualiza `viewers`/`peak_viewers`; `room_finished` acaba |
| `GET /admin/txilladas` | backoffice | as que estão a decorrer, com denúncias |
| `POST /admin/txilladas/:id/cut` `{ reason }` | backoffice | 204 — apaga a sala no LiveKit, status 'cut' |

`TxilladaDto`: `{ id, host: { id, username, displayName, avatarUrl, verified, verifiedTier }, title, audience, status,
startedAt, endedAt, viewers, peakViewers, cheers, comments, isHost, canComment, pinned }` (`pinned`: o comentário fixado
como eu o vejo, `TxilladaComment | null`; null se não há, se o apagaram, se a conta do autor não está ativa, se há bloqueio
entre mim e o autor ou se o denunciei).

`TxilladaComment`: `{ id, author: { id, username, displayName, avatarUrl, verified, verifiedTier }, body, createdAt, cheers, cheered }` (`cheers`: quantos brindaram; `cheered`: se eu brindei).

## Tempo real (pelo canal da app)

Para cada espectador ligado e o anfitrião: `{ type: 'txillada.comment', txilladaId, comment }`,
`{ type: 'txillada.cheer', txilladaId, cheers, from: { username } }`, `{ type: 'txillada.viewers', txilladaId, viewers }`,
`{ type: 'txillada.ended', txilladaId, status }`, `{ type: 'txillada.comment_removed', txilladaId, commentId }`, `{ type: 'txillada.comment_cheer', txilladaId, commentId, cheers }` (a contagem nova de um comentário, sem dizer quem brindou; não vai a quem tem bloqueio com o autor do comentário). Quem está a
ver é quem fez `join` e não saiu (o webhook diz quem está na sala; guarda-se no Redis/RealtimeBus).

- `{ type: 'txillada.reaction', txilladaId, kind, from: { username, displayName, avatarUrl, verified, verifiedTier, host },
  to?: { username, verified, verifiedTier } }` (o selo vai sempre com o nome, em todo o lado)
  — uma reação (`POST /react`), a quem está na sala menos quem tem bloqueio com quem reagiu (quem reagiu também a
  recebe). `host: true` quando é o anfitrião (o 👋 dele sem `to` é «@anfitrião diz olá a todos 👋»; com `to`, a resposta
  a quem entrou). Com `kind: 'cheers'` chegam os dois: `txillada.cheer` (o contador, como o `POST /cheer`) e
  `txillada.reaction` (para a animação) — a app conta pelo primeiro e anima por um só. Com a sala acima de ~40/s não
  chega nenhum dos dois (`sent: false`).
- `{ type: 'txillada.joined', txilladaId, user: { username, displayName, avatarUrl, verified, verifiedTier } }` — «@fulano
  entrou» (ver as regras). Sem o id interno.
- `{ type: 'txillada.pinned', txilladaId, comment: TxilladaComment | null }` — o fixado mudou (`POST /pin`) ou saiu
  (o comentário foi apagado pelo anfitrião ou pelo autor). A cada pessoa da sala vai o comentário, ou null a quem tem
  bloqueio com o autor ou o denunciou. Quando a moderação remove um comentário denunciado, a sala recebe
  `txillada.comment_removed` (a app tira-o dos balões e, se era o fixado, da pílula).
- **Moderação de um comentário (`txillada_comment`):** na fila do backoffice, com as outras denúncias. Remover marca
  `removed_at` (não se repõe), desconta em `comments`, tira-o do fixado e avisa o autor (`content_removed`, «o teu comentário
  na Txillada»), se a moderação escolher avisar.

## Avisos e perfil

- Ao começar: notificação `txillada_live` aos seguidores (e push), no máximo uma por anfitrião por hora; o texto é
  «@x abriu uma Txillada: <título>». Abrir a notificação entra na Txillada (ou diz que já acabou).
- O perfil e a fila dos mimos ganham `live: { id } | null` no utilizador: a roda fica vermelha com «AO VIVO» e tocar entra.

## App (ecrã inteiro e reações)

- O vídeo ocupa o ecrã todo, de ponta a ponta (anfitrião e espectador), com os controlos por cima, degradês suaves em
  cima e em baixo e as margens seguras; no site/PWA o ecrã é `position: fixed` com 100dvh. Quem vê: cover quando a
  imagem tem a forma do ecrã; senão (uma imagem deitada num telemóvel, ou ao alto num computador) a imagem inteira com o
  fundo desfocado do próprio vídeo. No computador, os controlos numa coluna ao centro.
- Captura ao alto (720×1280; no browser de um telemóvel, se a câmara der uma imagem deitada, pede-se outra vez com as
  medidas trocadas) e 720p/30 a ~2 Mbps com simulcast (camada de 360p); quem vê pede a camada certa para a densidade do
  ecrã (adaptiveStream), dynacast ligado.
- Quem vê: a barra de reações de um toque «👋 Olá», 🍻 (o brinde, com os copos), 🔥, 😂, ❤️ — sobem a flutuar pelo lado
  direito, a todos; o 👋 também aparece em balão «@fulano: Olá 👋». O anfitrião: «👋 Olá a todos» (em grande a todos) e
  responde a quem entrou com um toque no aviso «@fulano entrou» (ou na lista «A ver agora»).
- Quem está a ver: os avatares empilhados ao lado do contador; tocar abre «A ver agora» (avatar, nome com selo e @).
  «@fulano entrou» discreto, em fila e agrupado («@a, @b e mais 3 entraram»).
- Menu do comentário (`components/txillada/CommentMenu.tsx`, `commentMenu()` em `lib/txillada.ts`): um toque (ou o
  toque longo) num balão, ou no fixado, abre uma folha de vidro escuro. De outra pessoa: «Responder a @fulano» (se posso
  comentar; o campo começa por `@fulano `), «Brindar» e «Denunciar comentário»; o anfitrião também «Fixar comentário» (ou
  «Tirar o fixado»), «Apagar» e «Expulsar @fulano» (com confirmação). O meu: «Apagar» (e fixar, se sou o anfitrião).
  Acabada, sem menu.
- Fixado (`components/txillada/PinnedComment.tsx`): a pílula em baixo, por cima da barra, com a foto, o @ com o selo, a
  marca «FIXADO» e o texto (2 linhas); o comentário fixado sai dos balões para não aparecer duas vezes.
- Ligações `txillapp.com/txillada/<id>` no chat abrem a rota da app (ecrã inteiro), nunca o browser por cima.
- «Reduzir movimento»: as reações aparecem e desvanecem no sítio, sem subir nem rodar.

## App (fase 1)

- Entrada: em Criar, o modo **TXILLADA** (ao lado de MIMO, TCHEKA, PUBLICAÇÃO, ZÁS) quando `config.enabled`: câmara,
  título, público, «Começar Txillada».
- Anfitrião: a câmara a transmitir (virar, calar o microfone), «AO VIVO» e o tempo, quantos estão a ver, os
  comentários a flutuar (o estilo dos balões dos mimos), os brindes com os copos, terminar (com confirmação), expulsar e
  apagar comentários, fixar um (o menu do comentário, com um toque ou o toque longo).
- Espectador (`/txillada/[id]`): o vídeo 9:16, o anfitrião com selo e «AO VIVO», quantos estão a ver, os comentários a
  flutuar, o campo para comentar, brindar (CheersPour), partilhar, denunciar, sair. Quando acaba: «A Txillada acabou».
- Fila dos mimos e perfil: roda vermelha «AO VIVO».
- Telemóvel: `@livekit/react-native` + `@livekit/react-native-webrtc` (+ plugins Expo). Site/PWA: `livekit-client`.
