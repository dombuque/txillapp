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
