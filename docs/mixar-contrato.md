# Mixar — contrato entre a API e a app

O Mixar é um feed a dois (como o Blend do Instagram): duas pessoas juntam os gostos e recebem todos os dias uma seleção
de publicações (sobretudo tchekas/vídeos) que tem a ver com os dois. Reagem, veem a reação do outro, mandam para o chat,
descobrem o que têm em comum e fazem pequenos desafios («Mixa Challenge»).

Este ficheiro é o contrato fixo entre a equipa da API e a da app. Quem precisar de mudar algo aqui avisa o integrador.

## Regras de negócio

- Um Mixar é sempre entre **duas pessoas** e há no máximo **um Mixar por par** (ativo ou pendente).
- Só se pode convidar quem pode receber mensagens minhas (as mesmas regras do chat: `dms_allowed`, bloqueios, conversa
  já existente). Com bloqueio entre os dois, o Mixar deixa de aparecer e não se convida.
- Convidar cria o Mixar `pending` e um **cartão no chat** (mensagem `kind 'mixar'`). Aceitar põe-no `active`; recusar
  põe-no `declined`; qualquer um pode **sair** (`ended`). Um convite novo depois de `declined`/`ended` cria outro Mixar.
- No máximo **20 Mixar ativos** por pessoa e **10 convites por dia**.
- O feed só tem conteúdo que **os dois podem ver** (conta privada só se os dois a seguem, bloqueios dos dois lados,
  publicações removidas pela moderação, escondidas, de quem silenciou ou que a pessoa marcou «não me interessa»).
  Nunca publicações dos próprios dois.
- **Atualização diária:** às 05:00 (hora de Maputo) o worker gera a seleção do dia (até 24 itens) para cada Mixar ativo.
  Se ainda não houver seleção para hoje quando alguém abre, gera na hora.
- **Dinâmico:** o que os dois fazem dentro do Mixar (ver até ao fim, reagir, mandar para o chat, desafios) pesa nos
  temas do próprio Mixar e muda a seleção seguinte. Os sinais de fora (brindes, comentários, guardados, seguidos — o
  mesmo perfil de temas do `explore` em posts.service.ts) dão a base.
- **Razão de cada item:** `from: 'a' | 'b' | 'both'` (de quem é o gosto que o trouxe) e o tema (`topic`, com `label`).
  `a`/`b` vêm sempre do ponto de vista de quem pede: na resposta vai `from: 'me' | 'them' | 'both'`.

## Reações exclusivas

Ids fixos (a app desenha-os com o ReactionArt existente ou ícones próprios):
`'kkk' | 'fogo' | 'amor' | 'uau' | 'brinde' | 'nah'`.
Uma reação por pessoa e por item; mandar `null` tira-a. A reação no Mixar **não** é um brinde na publicação (fica só no
Mixar) e só os dois a veem.

## Mixa Challenge

- Um desafio por dia por Mixar, com 3 ou 4 itens da seleção do dia e uma pergunta de uma lista fixa (`kind`):
  `'mais_engracado'` («Qual é o mais engraçado?»), `'mais_txilado'` («Qual tem mais vibe?»), `'partilhavas'` («Qual
  mandavas ao grupo?»), `'repetias'` («Qual vias outra vez?»).
- Cada um escolhe um item às escondidas. Quando os dois escolheram, o resultado abre-se aos dois: `match: true` se
  escolheram o mesmo. Conta-se a série de dias seguidos com os dois a jogar (`streak`) e quantos «match».

## Endpoints (todos em `/api/v1`, com sessão)

```
POST   /mixar/invite                 { username }              → 201 Mixar
POST   /mixar/:id/accept                                        → 200 Mixar
POST   /mixar/:id/decline                                       → 200 { ok: true }
DELETE /mixar/:id                    (sair)                     → 200 { ok: true }
GET    /mixar                        → { items: MixarSummary[] }  (ativos e convites pendentes que recebi ou mandei)
GET    /mixar/with/:username         → Mixar | 404               (o Mixar com essa pessoa, se existir)
GET    /mixar/:id                    → Mixar
GET    /mixar/:id/feed?cursor=&limit= → { items: MixarItem[], nextCursor: string | null, day: 'YYYY-MM-DD' }
POST   /mixar/:id/items/:postId/react  { reaction: ReactionId | null } → 200 { mine, theirs }
POST   /mixar/:id/items/:postId/seen   { watchedMs?: number, done?: boolean } → 204
POST   /mixar/:id/items/:postId/shared                          → 204  (a app chama depois de mandar para o chat)
GET    /mixar/:id/challenge          → Challenge | null           (o de hoje)
POST   /mixar/:id/challenge/:challengeId/pick  { postId }        → 200 Challenge
```

Erros: 404 se o Mixar não existe ou não é meu; 403 com bloqueio ou regras do chat; 409 se já existe um Mixar ativo ou
pendente com essa pessoa (a resposta traz `{ id }` desse Mixar); 429 nos limites.

### Tipos

```ts
type Person = { username: string; displayName: string; hasAvatar: boolean } & Badged; // como no resto da API
type ReactionId = 'kkk' | 'fogo' | 'amor' | 'uau' | 'brinde' | 'nah';

type MixarSummary = {
  id: string;
  status: 'pending' | 'active';
  invitedByMe: boolean;          // pending: fui eu que convidei?
  partner: Person;
  name: string;                  // «Dom + Ana» (1.ºs nomes)
  newToday: number;              // itens de hoje que eu ainda não vi
  challengePending: boolean;     // há desafio de hoje à espera da minha escolha
  updatedAt: string;
};

type Mixar = MixarSummary & {
  createdAt: string;
  acceptedAt: string | null;
  match: number;                 // 0–100: quanto os gostos batem
  common: { topic: string; label: string; score: number }[];   // temas em comum, do mais forte para o mais fraco (até 8)
  onlyMe: { topic: string; label: string }[];                   // o que é mais meu (até 4)
  onlyThem: { topic: string; label: string }[];                 // o que é mais do outro (até 4)
  streak: number;                // dias seguidos com os dois a jogar o desafio
  matches: number;               // desafios em que escolheram o mesmo
};

type MixarItem = {
  post: FeedPost;                // exatamente a mesma forma que GET /posts/reels devolve em cada item
  from: 'me' | 'them' | 'both';
  topic: { topic: string; label: string } | null;
  mine: ReactionId | null;
  theirs: ReactionId | null;
  seenByThem: boolean;
};

type Challenge = {
  id: string;
  kind: 'mais_engracado' | 'mais_txilado' | 'partilhavas' | 'repetias';
  question: string;
  day: string;                   // 'YYYY-MM-DD'
  options: FeedPost[];           // 3 ou 4
  myPick: string | null;         // postId
  theirPicked: boolean;          // o outro já escolheu? (sem dizer qual)
  theirPick: string | null;      // só quando os dois escolheram
  match: boolean | null;         // só quando os dois escolheram
};
```

## Chat

- Mensagem nova `kind 'mixar'` (cartão feito pelo servidor, como o `'gelada'` da 0145). No item da conversa vem
  `mixar: { id, status: 'pending' | 'active' | 'declined' | 'ended', invitedByMe: boolean, name: string } | null`
  (o estado é sempre o atual, não o do momento do envio). O `body` leva um texto de recurso para versões antigas:
  «Convidou-te para um Mixar» / «Convidaste para um Mixar». Na lista das conversas aparece esse texto.
- Aceitar no cartão chama `POST /mixar/:id/accept`; depois o cartão mostra «Abrir o Mixar».
- **Enviar para o chat** um item do Mixar usa o envio que já existe (`kind 'post'`, body = id da publicação) e depois
  `POST /mixar/:id/items/:postId/shared`.
- O convite também se pode fazer a partir do menu da conversa e do menu «+» do chat (a app chama `POST /mixar/invite`).

## Tempo real e notificações

- Evento SSE `{ type: 'mixar', id, what: 'invite' | 'accepted' | 'reaction' | 'pick' | 'result' | 'daily' }` para o
  outro (e `echo` para os meus outros aparelhos), pelo RealtimeBus.
- Push (categoria `'messages'`, url `/mixar/:id`): convite («Fulano convidou-te para um Mixar»), aceite («Fulano aceitou
  o vosso Mixar»), resultado do desafio («Escolheram o mesmo!» / «Vê o que Fulano escolheu»). Nada de push por cada
  reação. A seleção diária não manda push.

## App

- Ecrã do Mixar: `/mixar/[id]` (feed vertical como as tchekas/reels, a barra das reações com a minha e a do outro, o
  botão «Mandar para o chat», o cartão do desafio do dia e um cabeçalho com «Dom + Ana», o `match` e os temas em
  comum). Ecrã dos meus Mixar: `/mixar`.
- Entradas: cartão no chat; menu da conversa («Mixar com Fulano»); menu «+» do chat; e um acesso nas Mensagens (por
  exemplo uma linha ou um botão «Mixar» por cima da lista).
- Web/PWA e computador também (com rato e teclado), como o resto da app.

## Social e guardados

Migração `0171_mixar_social.sql`; API em `src/mixar/mixar-social.service.ts` e `mixar-social.controller.ts`; app em
`lib/api.mixarSocial.ts`, `lib/mixarSocial.ts`, `components/mixar/MixarSocial.tsx` e `components/mixar/useMixarSocial.ts`.
As regras de acesso são as do resto do Mixar: só os dois, com o Mixar ativo (404 se não é meu ou já acabou, 409 pendente,
403 com bloqueio) e só com o que os dois podem ver agora (`bothSee`: nada removido, ocultado pelo autor, de conta privada
que um não segue, bloqueado ou escondido).

### A conversa de cada item

- Comentários que só os dois veem (`social.mixar_comments`, até 500 caracteres). O filtro de texto é o de sempre
  (`TextFilter.assertClean`: 422 para ameaças, incentivo ao suicídio e ódio). Só com o email confirmado, como os outros
  comentários. Só quem escreveu apaga (`deleted_at`); a limpeza apaga de vez os apagados há mais de 30 dias que não têm
  denúncias por decidir.
- Denunciar: a fila de sempre (`POST /reports { type: 'mixar_comment', id, reason }`). Só um dos dois pode denunciar o
  comentário do outro; quem denuncia deixa de o ver; a moderação «remover» apaga-o para os dois (aviso «o teu comentário no
  Mixar»). Os comentários do Mixar não entram na página «Conteúdo» do backoffice (são privados, como as mensagens).
- Sem aviso no telemóvel por comentário (só o tempo real).

### Ver juntos

- A app repete `POST /mixar/:id/presence { postId }` de 20 em 20 s e quando muda de item; ao sair, ao perder o foco ou com
  a app em segundo plano manda `{ leave: true }`. A presença vale 45 s (RealtimeBus, sem base de dados).
- A resposta diz onde está o outro: `{ partner: { here, postId } }`. O outro recebe um evento quando chego, mudo de item ou
  saio (não a cada repetição). Um `postId` que não é deste Mixar conta como «no Mixar, sem item».
- Na app: «Zeca está a ver contigo» (com o avatar e o selo) por baixo do cabeçalho; «No mesmo vídeo que tu» ou «Noutro
  vídeo. Toca para ir»; e «Zeca está aqui» no item em que o outro está. O nome vai sem artigo (a app não sabe se é «o» ou «a»).
- As reações do outro aparecem na hora: o evento `'reaction'` de sempre põe o feed em dia e a app anima (a reação a subir,
  com o avatar) a que mudou, de preferência no item que estou a ver.

### «Mais 5»

- `POST /mixar/:id/more` acrescenta até 5 itens novos no fim da seleção de hoje, com o mesmo algoritmo (`pickDaily`), sem
  nada que já tenha saído neste Mixar (em dia nenhum) e com no máximo 2 do mesmo autor no dia. No máximo 3 vezes por dia
  por Mixar (`mixar_days.more_rounds`); depois 429 «Já pediram mais 3 vezes hoje. Amanhã às 05:00 há uma seleção nova».
  Sem nada novo devolve `{ added: 0 }` e não conta. O desafio do dia não muda.

### Guardados

- A coleção dos dois (`social.mixar_saves`). Entra sozinho quando os dois reagem ao item com `amor`, `fogo`, `kkk`, `uau`
  ou `brinde` (não com `nah`; gatilho na base, `saved_by` NULL = «os dois»), ou quando um guarda à mão (marcador no carril).
- Qualquer um dos dois tira (`removed_at`): não volta a entrar sozinho quando alguém muda a reação; só à mão.
- `GET /mixar/:id/saved` do mais recente para o mais antigo, paginado por cursor, sem o que foi removido ou ocultado pelo
  autor (reavaliado em cada leitura). Na app: o botão «Guardados» no cabeçalho do Mixar abre `/mixar/guardados/[id]`, o
  mesmo feed vertical do Mixar (sem o desafio), com quem guardou («Guardado por Zeca», «Os dois reagiram»).
- Exportação dos dados: os meus comentários (não apagados) e o que guardei à mão. Sair do Mixar fecha tudo; apagar o Mixar
  (limpeza dos 30 dias, eliminação da conta) leva tudo pelo CASCADE.

### Endpoints (todos em `/api/v1`, com sessão)

```
GET    /mixar/:id/items/:postId/comments?cursor=&limit=  → { items: MixarComment[], nextCursor }  (página mais recente primeiro; cada página da mais antiga para a mais recente; cursor = as mais antigas)
POST   /mixar/:id/items/:postId/comments  { body }        → 201 MixarComment   (400 vazio ou > 500; 422 filtro de texto)
DELETE /mixar/:id/comments/:commentId                     → { ok: true }       (só o meu; 404 se não)
GET    /mixar/:id/social?posts=a,b,c                       → { items: { postId, comments, saved }[] }   (até 50)
POST   /mixar/:id/saved/:postId                            → { saved: true }
DELETE /mixar/:id/saved/:postId                            → { saved: false }
GET    /mixar/:id/saved?cursor=&limit=                     → { items: MixarSavedItem[], nextCursor }
GET    /mixar/:id/more                                     → { left }
POST   /mixar/:id/more                                     → { added, left }    (429 depois de 3 vezes no dia)
POST   /mixar/:id/presence  { postId?: string | null, leave?: boolean } → { partner: { here: boolean, postId: string | null } }
```

```ts
type MixarComment = { id: string; body: string; createdAt: string; mine: boolean; author: Person };
type MixarSavedItem = MixarItem & { savedAt: string; savedBy: 'me' | 'them' | 'both' };
```

### Tempo real

Evento SSE `{ type: 'mixar.live', id, what: 'comment' | 'saved' | 'more' | 'presence', postId?, here?, saved? }` pelo
RealtimeBus: para o outro e, como eco (`self`), para os meus outros aparelhos (menos a presença). Na app (lib/streamEvents →
`mixarLiveKeys`): 'comment' põe em dia a conversa desse item e os contadores; 'saved' os contadores e os Guardados; 'more' o
feed de hoje; 'presence' vai só para o ecrã aberto (lib/realtime → `onMixarLive`).
