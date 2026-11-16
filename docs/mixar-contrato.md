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

## Controlo e resumo (0172)

Três coisas novas, só dentro do Mixar (o feed normal não muda). Código: `apps/api/src/mixar/mixar-controlo*.ts` e
`mixar-week-card.ts`; na app `lib/api.mixarControlo.ts`, `lib/mixarControlo.ts` e `components/mixar/MixarControlo*.tsx`.

### Afinar os temas de um Mixar

- **«Menos disto»** (no menu do item, nas ações do lado): o tema do item (a razão; sem ela, o primeiro tema da
  publicação) passa a `'less'` para mim neste Mixar e o autor também pesa menos (`social.mixar_author_less`). Na
  geração, uma publicação com um tema `'less'` vale ×0,35 e de um autor `'less'` ×0,3 (acumulam). Um `'off'` não desce
  para `'less'`.
- **«Não quero isto no nosso Mixar»** (`'off'`): as publicações com esse tema saem da seleção seguinte e logo da leitura do
  feed de hoje, **para os dois**; o tema sai também do `match`, `common`, `onlyMe` e `onlyThem` deste Mixar. Só quem tirou
  o volta a pôr (`mode: null`). Tabela `social.mixar_topic_prefs (mixar_id, user_id, topic, mode 'less' | 'off', created_at)`.

### Temas privados (por pessoa, para todos os meus Mixar)

- `social.mixar_private_topics (user_id, topic)`. Um tema privado sai do meu perfil antes de tudo: não conta no `match`,
  não aparece em `common`/`onlyMe`/`onlyThem` (de nenhum dos lados), não é razão de nenhum item («Porque gostas de…» /
  «Porque Dom gosta de…»), não entra nos temas do resumo da semana nem na imagem partilhada. Uma razão já guardada com um
  tema privado de um dos dois chega sem tema (`topic: null`) logo na leitura seguinte.

### Resumo da semana

- Os últimos 7 dias do Mixar (o de hoje e os 6 anteriores, dias que começam às 05:00 de Maputo). À segunda-feira
  (`recapDay`) a app mostra o cartão no fim do feed; está sempre no cabeçalho («Resumo da semana»).
- O cartão para partilhar (JPEG 1080×1920, assinado) é desenhado no servidor: «Resumo da semana», as datas, «Dom + Ana»
  (com o selo de quem é verificado), a série, os acertos no desafio, os vídeos vistos e os temas da semana (já sem os
  privados de nenhum dos dois). O vídeo mais reagido **não** entra na imagem (é de outra pessoa, pode ser de conta privada).
- Partilhar: no Zás (um Zás para os amigos, como os outros) ou nos mimos (para os amigos ou só os amigos próximos).

### Endpoints

```
GET    /mixar/:id/topics                          → MixarTopics
PUT    /mixar/:id/topics  { topic, mode: 'less' | 'off' | null } → MixarTopics   (400 tema desconhecido)
POST   /mixar/:id/items/:postId/less              → 200 { topic: Topic | null, author: Person, topics: MixarTopics }
GET    /me/mixar/private-topics                   → { topics: Topic[], all: Topic[] }
PUT    /me/mixar/private-topics  { topics: string[] } → { topics, all }   (substitui a lista; até 60)
GET    /mixar/:id/week                            → MixarWeek
GET    /mixar/:id/week/image                      → image/jpeg (o cartão que se partilha)
POST   /mixar/:id/week/share  { to: 'zas' | 'story', audience?: 'all' | 'close' } → 201 { to, id }  (email confirmado)
```

```ts
type Topic = { topic: string; label: string };
type MixarTopics = {
  mine: (Topic & { mode: 'less' | 'off' })[];  // as minhas escolhas neste Mixar
  theirsOff: Topic[];                          // o que o outro tirou (sai para os dois)
  lessAuthors: number;                         // de quantos autores pedi menos aqui
  all: Topic[];                                // o catálogo dos temas (por nome)
};
type MixarWeek = {
  from: string; to: string; label: string;     // 'YYYY-MM-DD' e «10 a 16 nov»
  recapDay: boolean;                           // hoje é segunda-feira (dia do Mixar)
  top: { post: FeedPost; mine: ReactionId | null; theirs: ReactionId | null } | null; // o mais reagido pelos dois (sem «nah»)
  challenge: { offered: number; played: number; matches: number };                     // «3 de 5» = matches de played
  streak: number;
  topics: Topic[];                             // até 5, sem privados nem tirados
  videos: number;                              // vídeos da semana vistos por pelo menos um
  together: number;                            // vistos pelos dois
};
```

A exportação (`/me/export`) traz `mixarTopicPrefs`, `mixarAuthorLess` e `mixarPrivateTopics`; eliminar a conta apaga-os.
