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

## Avisos e descoberta (0170)

Esta secção acrescenta e, onde diz, substitui o que está em «Tempo real e notificações». API em
`apps/api/src/mixar/mixar-avisos.service.ts` e `mixar-avisos.controller.ts`; app em `lib/mixarAvisos.ts`,
`lib/api.mixarAvisos.ts`, `lib/mixarOpen.ts` e `components/mixar/MixarSuggestions.tsx`.

### Categoria «Mixar»

- Categoria nova nas notificações: `'mixar'` (`NOTIFY_CATEGORIES`, uma só opção «Mixar» nas definições). **Todos** os
  avisos do Mixar passam a ser desta categoria (o convite e o «aceitou» deixam de ser `'messages'`). Desligada: nem na
  lista nem no telemóvel.
- O resultado do desafio já não diz «Escolheram o mesmo!» / «Vê o que Fulano escolheu»: ver «Mixa Challenge» abaixo.
- A seleção diária **passa a avisar** (substitui «A seleção diária não manda push»).

### Avisos novos (lista e telemóvel)

Tipos novos em `social.notifications` (`data` leva sempre `mixarId` e `name`, o nome do Mixar visto por quem recebe,
«Ana + Zeca»). Tocar abre `/mixar/:id`. O aviso no telemóvel vai discreto se a conversa com o outro está oculta (0160).

| kind | quando | ator | telemóvel (título · texto) | extra em `data` |
|---|---|---|---|---|
| `mixar_daily` | a tarefa diária fez a seleção de hoje (com itens) | o outro | «Ana + Zeca» · «A vossa seleção de hoje está pronta» | `day` |
| `mixar_pick` | o outro escolheu no desafio e eu ainda não | quem escolheu | «Ana + Zeca» · «Zeca já escolheu no Mixa Challenge, falta tu» | `challengeId` |
| `mixar_result` | os dois escolheram (vai para quem escolheu primeiro) | quem escolheu depois | «Ana + Zeca» · «Acertaram no mesmo» / «Escolheram diferente» | `challengeId`, `match` |

- **Seleção do dia:** no fim de cada volta de `runDaily` (de 15 em 15 minutos), uma vez por Mixar, por pessoa e por dia
  (`social.mixar_notices`). Não vai a quem já abriu o Mixar nesse dia (desde as 05:00), nem num Mixar aceite já depois das
  05:00 desse dia, nem com bloqueio, conta inativa ou a categoria desligada. Só sai **entre as 08:00 e as 21:00 de
  Maputo** (a seleção é gerada às 05:00: o aviso sai na primeira volta depois das 08:00).
- **Mixa Challenge:** `mixar_pick` uma vez por desafio (mudar de ideias não volta a avisar). Quando o segundo escolhe, o
  primeiro recebe `mixar_result` (uma vez) e o `mixar_pick` do segundo fica lido. O nome vai sem artigo («Zeca já
  escolheu…»), como no resto do Mixar.
- Abrir o Mixar (`POST /mixar/:id/open`) dá por lidos os avisos desse Mixar na lista.

### Abertura sincronizada (a bolinha azul)

```
POST /mixar/:id/open      → 200 { openedAt: string }   (idempotente; 404 se não é meu ou já acabou; 403 com bloqueio)
```

- Guarda a minha última abertura (`social.mixar_opens`, uma linha por Mixar e por pessoa), nunca antes do `updatedAt` do
  Mixar. Um convite pendente também se abre (quem foi convidado, ao abrir a conversa com o cartão).
- `MixarSummary` (e portanto `Mixar`) ganha `openedAt: string | null` (a minha última abertura, em qualquer aparelho).
- App: `mixarShowDot(s, seenAt)` usa o mais recente entre `s.openedAt` e o `seenAt` deste aparelho (lib/mixarSeen fica
  de reserva para servidores sem `openedAt`). A app chama `/open` ao abrir `/mixar/[id]` (depois do `GET`) e ao abrir a
  conversa com um convite recebido.
- Mensagens: a linha do Mixar (`MixarEntry`) por cima dos separadores só aparece quando algum Mixar tem a bolinha azul
  (convite recebido por responder, itens de hoje por ver ou o desafio, ainda não aberto desde que mudou). Sem novidades,
  nada.

### Sugestões «Faz um Mixar com…»

```
GET    /mixar/suggestions                     → { items: MixarSuggestion[] }   (até 3)
POST   /mixar/suggestions/:username/dismiss   → 204   («Agora não»: some 30 dias; 404 se a conta não existe)
```

```ts
type MixarSuggestion = { username: string; displayName: string; hasAvatar: boolean; match: number /* 0 a 100 */;
  common: { topic: string; label: string }[] /* até 3 */ } & Badged;
```

- Quem entra: com quem falei muito nos últimos 30 dias (pelo menos 10 mensagens na conversa a dois, 3 de cada lado), que
  me segue e eu sigo, conta ativa, sem bloqueio, a quem posso mandar mensagens, sem Mixar ativo ou pendente entre nós,
  com menos de 20 Mixar ativos, que eu não dispensei nos últimos 30 dias e com `match` de pelo menos 40 (o mesmo perfil de
  temas do Explorar e o mesmo cálculo do `match` do Mixar). Ordem: `match` mais as mensagens (até +30). Com 20 Mixar
  ativos, nenhuma.
- «Agora não» fica no servidor (`social.mixar_suggestion_dismissals`, até `until`), apaga-se com a conta de qualquer um
  dos dois e entra na exportação (`mixarSuggestionsDismissed`, com `mixarOpens`).
- App: cartão discreto «Sugestões» na lista `/mixar` (também quando não há nenhum Mixar), com «Convidar» (`useOpenMixar`)
  e «Agora não».

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

## Como as três partes encaixam

- Carril de cada item (`/mixar/[id]`): por baixo das ações da tcheka, a Conversa e o Guardar do Mixar (MixarSocial) e o
  «Mais» do item (MixarControloSheets). O «Mais» abre com «Mandar a Ana» (para a vossa conversa) e depois «Menos disto» e
  «Não quero «Tema» no nosso Mixar»: com as seis ações da tcheka não cabia mais um botão num ecrã de 390 x 844.
- Cabeçalho: voltar, «Ana + Zeca» (abre a Descoberta, com «Afinar os temas do Mixar» e «Temas privados») e, à direita,
  «Guardados» e o Resumo da semana (calendário). Por baixo, «está a ver contigo».
- O «Mais 5» usa o mesmo controlo da seleção do dia: sem os temas tirados, com o «Menos disto» (temas e autores) a pesar
  menos e sem os temas privados de cada um. Nos Guardados, a razão fica sem tema se for privado de um dos dois ou tirado.
- As sugestões «Faz um Mixar com…» calculam o match e os temas em comum sem os temas privados de cada pessoa.

## Mixar de grupo (0173)

Um TxillGroup com 3 a 5 membros pode ter um Mixar do grupo (um só aberto por grupo). API em
`apps/api/src/mixar/mixar-grupo.service.ts`, `mixar-grupo.controller.ts` e `mixar-grupo-pick.ts` (o algoritmo de 2 para
N); app em `lib/mixarGrupo.ts`, `components/mixar/useGroupMixar.ts` e nos ecrãs de sempre. O Mixar a dois não muda.

### Regras

- É a mesma linha de `social.mixars`, com `group_id` e sem par (`user_a` e `user_b` NULL). Tudo o que está pendurado num
  Mixar (itens, reações, vistos, desafio, escolhas, conversa, Guardados, temas tirados, aberturas, avisos) serve para o
  grupo sem tabelas novas. Quem está guarda-se em `social.mixar_members` (`state`: `in`, `declined`, `left`).
- Qualquer membro propõe («Mixar do grupo» no cabeçalho e no menu «⋯» do grupo) e entra logo. Fica **ativo quando 3
  pessoas** (contando com quem propôs) entraram. Quem disse «Agora não» ou ainda não respondeu não entra: não vê o feed, a
  conversa, os Guardados, o desafio nem os gostos dos outros (o `GET` dá só o convite, com `match` 0 e `common` vazio), e
  os gostos dele não contam. Quem entra mais tarde entra (no máximo 5 participantes).
- Sair do grupo (pelo próprio pé, tirado por um admin ou com a conta eliminada) é sair do Mixar do grupo (gatilho na
  `social.group_members`). Sair do Mixar (`DELETE /mixar/:id`) deixa a pessoa no grupo e pode voltar a entrar. Com
  **menos de 3 participantes** um Mixar ativo acaba para todos (`social.mixar_group_settle`); apagar o grupo apaga o Mixar.
- Grupos com mais de 5 membros (ou menos de 3): a opção não aparece e `POST /mixar/grupo/:groupId` responde 409 «O Mixar
  de grupo é para grupos de 3 a 5 pessoas». No máximo 3 propostas por pessoa e por grupo em 24 horas (429).
- Seleção às 05:00 (a mesma tarefa `mixar.daily`), com os gostos de todos os participantes: cada publicação tem os seus
  fãs (afinidade positiva e pelo menos 40% da mais forte); cerca de 60% partilhado (dois fãs ou mais) e o resto dividido
  pelo gosto de cada um; no máximo 2 por autor. Um tema que alguém marcou «menos» não aparece a ninguém. A razão guarda-se
  em `mixar_items.source` (`all` ou `some`) e `mixar_items.fans` (os ids).
- Reações exclusivas, vistos, conversa de cada item (só participantes), «Mais 5», temas tirados («Menos disto» e «Não
  quero isto no nosso Mixar»), temas privados: as rotas de sempre, `/mixar/:id/…`. Guardados: entra sozinho quando a
  **maioria** dos participantes reage sem «nah» (no Mixar a dois continua a ser os dois).
- Mixa Challenge: cada um escolhe às escondidas; quando **todos** escolheram, abre-se quantos escolheram cada opção (sem
  dizer quem). O resumo da semana e o «ver juntos» ainda não existem no grupo (o resumo dá 404).

### Endpoints (todos em `/api/v1`, com sessão)

```
POST   /mixar/grupo/:groupId  → 201 Mixar   (propor; 404 não sou do grupo; 409 tamanho errado, ou já há com { id }; 429)
GET    /mixar/grupo/:groupId  → Mixar | 404 (o Mixar aberto do grupo, para o cabeçalho do grupo)
POST   /mixar/:id/accept      → Mixar       (entrar, também mais tarde; 409 se já estou ou o Mixar tem 5)
POST   /mixar/:id/decline     → { ok }      («Agora não»: conta como aberto, a bolinha some)
DELETE /mixar/:id             → { ok }      (sair do Mixar do grupo; com menos de 3, acaba para todos)
GET    /mixar                 → { items: MixarSummary[], groups: MixarGroupSummary[] }   (os de grupo vão à parte)
```

Num Mixar de grupo em que não estou, o feed, as reações, o desafio, a conversa, os Guardados, o «Mais 5» e os temas dão
403 «Ainda não entraste neste Mixar do grupo»; quem não é do grupo (ou saiu dele) recebe 404.

### Tipos (o que se acrescenta)

```ts
interface MixarGroupInfo {
  groupId: string; groupName: string;
  people: MixarPerson[];          // os participantes (comigo se eu estiver), pela ordem de entrada, com o selo
  members: number;                // quantas pessoas tem o grupo
  myState: 'in' | 'declined' | 'left' | null;
  canJoin: boolean;               // não estou e há lugar
  need: number;                   // pendente: quantos faltam para começar
  proposedBy: MixarPerson | null;
}
type MixarGroupSummary = MixarSummary & { group: MixarGroupInfo };   // Mixar também leva `group` no grupo
// Em cada MixarItem do grupo (feed e Guardados):
group: { fans: MixarPerson[] /* os outros de quem é o gosto */; mine: boolean; everyone: boolean;
         reactions: { person: MixarPerson; reaction: ReactionId }[]; seenBy: MixarPerson[] }
// MixarSavedItem no grupo: savedByPerson: MixarPerson | null (quem guardou à mão; 'both' = entrou pela maioria)
// MixarChallenge no grupo:
group: { picked: number; total: number; pickedBy: MixarPerson[]; counts: { postId: string; n: number }[] | null }
// A resposta de react no grupo traz também reactions (as dos outros).
```

### Textos (app, lib/mixarGrupo.ts)

- A razão diz de quem é o gosto, sem artigo antes dos nomes: «Música, do gosto de todos», «Do gosto de Ana e Zeca»,
  «Música, do teu gosto e de Ana», «Do teu gosto». Visto: «Visto por Ana e Zeca», «Visto por todos».
- Convite: «Zeca propôs um Mixar do grupo» com quem já está, «Entrar» e «Agora não»; à espera: «Falta 1 pessoa para
  começar»; no desafio: «Já escolheram 2 de 3» e, no fim, «2 escolheram» em cada opção.
- «Mandar» de um item no grupo vai para a conversa do grupo.

### Avisos

| kind | quando | ator | telemóvel (título · texto) | `data` |
|---|---|---|---|---|
| `mixar_group` | alguém propôs (vai aos outros membros do grupo) | quem propôs | «Malta da Costa» · «Zeca propôs um Mixar do grupo» | `mixarId`, `name` (o grupo), `groupId` |
| `mixar_daily` | a seleção de hoje (participantes que ainda não abriram, 08:00 a 21:00) | outro participante | «Malta da Costa» · «A vossa seleção de hoje está pronta» | `day`, `group: true` |
| `mixar_pick` | alguém escolheu no desafio e eu ainda não (uma vez) | quem escolheu | «Ana já escolheu no Mixa Challenge, falta tu» | `challengeId`, `group: true` |
| `mixar_result` | todos escolheram (a quem escolheu antes) | o último | «Escolheram todos o mesmo» / «Já todos escolheram. Vê o resultado» | `challengeId`, `match`, `group: true` |

Mesma opção «Mixar» nas definições; no telemóvel vai discreto se a pessoa escondeu o grupo (0160). Abrir o Mixar dá por
lidos os avisos dele (também o `mixar_group`). Os registos dos avisos já enviados (`social.mixar_notices`, a dois e de
grupo) apagam-se ao fim de 30 dias (`MixarService.purge`, de 6 em 6 horas).

### A bolinha azul e a lista

- `groupShowDot`: um convite por responder (ainda não disse nada) ou, se estou, as novidades de hoje (itens por ver ou o
  desafio), até abrir (`openedAt` do servidor, a mesma regra do Mixar a dois). Aparece no ícone do Mixar no cabeçalho do
  grupo e na linha do grupo nas Mensagens.
- `/mixar`: secção «Os vossos Mixar de grupo», com «Entrar» e «Agora não» enquanto não respondi.

### Exportação e apagar a conta

- `/me/export` traz `mixarGroups` (os Mixar dos meus grupos em que entrei, recusei ou de que saí: o grupo, o meu estado,
  se fui eu que propus e as datas) e `mixarNotices` (os avisos do Mixar já enviados, a dois e de grupo). As reações, os
  vistos, as escolhas, os comentários e o que guardei no grupo vão nas listas de sempre (`mixarReactions`, …).
- Eliminar a conta: a pessoa sai dos grupos (e, pelo gatilho, dos Mixar deles; com menos de 3, acaba) e apaga-se o que
  fez lá dentro (estado, reações, vistos, escolhas, comentários, o que guardou à mão, aberturas, avisos e temas). Os Mixar
  de grupo que ela propôs continuam para os outros.
