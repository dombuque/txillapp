# Sons das tchekas

Cada tcheka (uma publicação com um só vídeo) liga-se a um **som**, como no TikTok. O som tem página própria na app
(`/som/[id]`), com a grelha das tchekas que o usam e o botão «Usar este som», que abre o estúdio com `/tcheka/nova?som=<id>`.
Migração: `apps/api/migrations/0133_sons.sql`. Código: `apps/api/src/sounds/`, `apps/mobile/src/lib/api.sounds.ts`,
`apps/mobile/src/lib/sounds.ts` e `apps/mobile/src/app/som/[id].tsx`.

## 1. Tipos de som e ids

| `kind` | O que é | `id` |
|---|---|---|
| `original` | o áudio tirado de uma tcheka publicada com o som do próprio vídeo, sem música escolhida («Som original · @autor») | uuid |
| `catalog` | uma faixa do catálogo curado (docs/musica.md) | `cat:<id da faixa>` |
| `local` | uma faixa dos artistas de Moçambique | `local:<uuid>` (o próprio id da faixa) |

Clipes próprios (`kind: 'clip'`), música licenciada e faixas antigas de antes do catálogo não têm som.

## 2. Som original

- Ao publicar uma tcheka **sem música** (com o som do vídeo), o servidor tira o áudio em segundo plano com o ffmpeg (um de cada
  vez): até 60 s, AAC 128 kbps em M4A, com uma saída suave de 0,4 s. Fica como ficheiro privado (`purpose = 'music'`) e serve-se
  só com URL assinado (`/api/v1/sounds/audio/:id?exp&sig`, vale até ao fim da próxima hora cheia).
- Vídeos sem pista de áudio ou mudos (pico abaixo de −50 dB) não dão som.
- A capa é a imagem de capa da tcheka (`/api/v1/media/<vídeo>?poster=1`). O título segue o @ atual do autor.
- Publicações feitas **como um local** não dão som original (o som diria quem é o gestor que publicou).
- As tchekas publicadas antes disto tratam-se aos poucos, um minuto depois do arranque (até 300 de cada vez, dos últimos 180
  dias; `posts.sound_checked_at` marca as já vistas).

## 3. API (todas com sessão, em `/api/v1`)

| Pedido | Resposta |
|---|---|
| `GET /sounds/:id` | `Sound` (abaixo); 404 se o som não existe para quem pede |
| `GET /sounds/:id/tchekas?sort=top\|recent&cursor=` | `{ items: Post[], nextCursor }`. `top` (por omissão): a tcheka de onde o som saiu à frente, depois as mais vistas (vezes que apareceram no ecrã de alguém) e as mais recentes; o cursor é um número. `recent`: as mais recentes; o cursor é o id da última |
| `GET /sounds/trending?limit=` | `TrendingSound[]`: os sons com mais tchekas nos últimos 7 dias (só números agregados) |
| `POST /sounds/:id/report` `{ reason: 'copyright' \| 'other', note? }` | 204. Só sons originais, nunca o próprio |
| `GET /sounds/me/settings` · `PUT /sounds/me/settings` `{ reuse }` | `{ reuse, effective, private, minor }` |
| `GET /sounds/me` | os meus sons originais (`status`: active, held, source_removed, removed) |
| `POST /posts` com `soundId` | publicar com um som (abaixo) |

```ts
Sound = {
  id, kind: 'original' | 'catalog' | 'local', title,
  author?: { username, displayName, verified, verifiedTier },   // original: o autor; local: a conta do artista
  artist?: string,                                             // catálogo e artistas: o crédito
  cover: string | null, durationMs: number | null, previewUrl: string | null,
  uses: number,                                                // tchekas que usam o som (sem as apagadas)
  createdAt: string | null,                                    // catálogo sem usos: null
  music?: PickerTrack,                                         // catálogo e artistas: a faixa da interface de docs/musica.md
  canUse: boolean,                                             // «Usar este som»
  unavailable?: 'held' | 'off' | 'private' | 'minor' | 'unavailable',
  mine: boolean,
  sourcePost?: { id, code } | null,                            // original: a tcheka de onde saiu
}
TrendingSound = Sound sem music/canUse/unavailable/mine/sourcePost, mais uses7d
```

Cada publicação traz `sound: { id, title, kind, author?, artist? } | null` (só nas tchekas e só quando o som existe para quem vê).

### Publicar com `soundId`

- Só numa tcheka (um vídeo); noutra publicação: 400.
- Som original: não se manda `music` ao mesmo tempo (400). Tem de existir para quem publica (404), não estar em análise e o autor
  deixar usá-lo (403); o próprio autor pode sempre. A tcheka guarda em `music` `{ kind: 'sound', id: 'sound:<id>', soundId,
  title, artist, durationMs, cover }` e, ao ler, `url` vem assinado e `license: 'own'` (o vídeo fica sem som e toca o do som, como
  com uma música).
- Faixa (`cat:`/`local:`): passa pelas regras do seletor (escondidas e indisponíveis recusadas; a local conta o uso para o
  artista). Se vier também `music`, tem de ser a mesma faixa.
- Sem `soundId`, uma tcheka com música do catálogo ou de um artista liga-se ao som dessa faixa.

## 4. Visibilidade e regras

- Um som original existe para quem pode ver a conta do autor (`canView`: conta ativa, sem bloqueio, pública ou seguidor) e
  enquanto a tcheka de onde saiu existir. Apagar essa tcheka tira a página e os novos usos; as tchekas que já o usavam continuam
  a tocar, mas sem a ligação ao som.
- **Conta privada (decisão):** o som original de uma conta privada não pode ser usado por mais ninguém, nem pelos seguidores (uma
  tcheka pública com esse som tirava o áudio da conta privada para fora). Os seguidores veem a página, sem «Usar este som». O
  próprio pode reutilizá-lo. Ao passar a pública, vale outra vez a definição.
- **Menores de 18 (decisão):** o som existe, mas só o próprio o pode usar (e não entra em «Sons em alta»).
- **«Deixar usar o meu som»** (Definições → Conteúdo, `identity.users.sound_reuse`, ligado por omissão): desligado, ninguém
  mais usa os meus sons originais; as tchekas que já os usavam continuam.
- A grelha das tchekas segue as regras de sempre: privacidade, bloqueios, a rede de quem vê (o seu país e quem segue, como nas
  hashtags), sem as apagadas, as que escondeu e as que denunciou.
- «Sons em alta»: sem os sons em análise ou tirados, os originais que não se podem usar, os de quem não posso ver e os de fora
  da minha rede, e as faixas que saíram do catálogo. Só números (`uses7d`, `uses`).

## 5. Direitos

- «Este som tem música protegida» (ou outro motivo) num som original: o som fica logo escondido para novos usos (`hold_at`),
  mas continua a tocar nas tchekas que já o usam.
- A equipa decide em **Backoffice › Música › Sons originais** (`music.manage`, que a Moderação também tem):
  `GET /admin/sounds?status=open|upheld|dismissed|all` e `POST /admin/sounds/:id/decision { action: 'uphold' | 'dismiss' |
  'restore', reason }`. Dar razão tira o som de todo o lado (deixa de tocar também nas tchekas que o usavam); o vídeo de onde
  saiu fica, e a Moderação tira-o à parte se for preciso. Fica na auditoria (`sound.remove`, `sound.dismiss`, `sound.restore`).
  Um som retirado pelo autor (ou com a conta eliminada) não se repõe (400: o áudio já não existe).
- As faixas dos artistas têm a denúncia de direitos delas (`POST /music/local/:id/report`) e as do catálogo saem no backoffice.

### Avisar o autor (0140)

- Aviso `sound_review` ao autor, em nome do Txillapp (como os outros avisos da equipa: **não se desliga**, porque é uma decisão
  sobre o conteúdo dele e diz-lhe como contestar). `data: { soundId, decision, reason?, note?, postId? }`, com `postId` = a tcheka
  de onde o som saiu (a miniatura):
  - `held`: a primeira denúncia por analisar suspendeu o som. `reason`: «Música protegida denunciada» (ou «Denunciado por outro
    motivo»). Nunca diz quem denunciou nem a nota da denúncia; o ator é a própria pessoa (não há pessoa da equipa; a lista mostra
    «Txillapp» e a migração deixa `actor_id = user_id` neste tipo, como no aviso de verificação).
  - `removed` (a equipa deu razão): o mesmo `reason` e a nota da equipa em `note`. `cleared` (sem razão) e `restored` (reposto).
- Contestar: ainda não há caminho na Ajuda, por isso o aviso diz «escreve para suporte@txillapp.com com o assunto «Contestar
  som»». No telemóvel o texto é genérico («O teu som está em análise. Toca para ver…»), sem o motivo (o ecrã de bloqueio é público).

## 6. «Retirar o som» (0140)

- `POST /sounds/:id/retire` → 204. Só o autor e só sons originais (senão 404); vale com o som em análise e depois de apagar a
  tcheka de onde saiu (o som continuava a tocar nas outras). Não se desfaz. Na app: na página do som (quando é meu) e em
  **Definições → Conteúdo → «Os meus sons»** (`/settings/sons`, com `GET /sounds/me`, que traz agora `removedBy`), com a
  confirmação «As tchekas que usam este som ficam sem som. Não dá para desfazer.».
- O caminho é o da equipa (`retireTx`): `removed_at`, `removed_reason`, `removed_by` (`author` | `staff` | `account`). Quando é o
  autor, `audio_media_id` fica vazio e o ficheiro do áudio passa a `deleted` (a limpeza dos ficheiros apaga-o do armazenamento
  em menos de 10 minutos). As denúncias por analisar fecham (`upheld`, «O autor retirou o som»). Auditoria: `sound.retire`.
- **As tchekas ficam mesmo sem som.** O estúdio e a montagem gravam o som no vídeo de cada tcheka, por isso tirar a ligação não
  chegava: em segundo plano (`SoundsService.silencePending`, logo a seguir e de 10 em 10 minutos), o servidor tira a pista de
  áudio dos vídeos das tchekas com `music.kind = 'sound'` e esse som (nunca a tcheka de onde o som saiu), com o ffmpeg e sem voltar
  a comprimir a imagem. Cada vídeo fica em `content.sound_silenced`; `sounds.silenced_at` marca o fim. Quando foi a **equipa**,
  guarda-se antes uma cópia privada do vídeo (`<id>.sound`, no bucket privado), que `restore` repõe; quando foi o autor ou a conta
  eliminada, não há cópia. A cópia sai com o vídeo (sweepDeleted).
- Cada publicação traz `soundRemoved: 'author' | 'rights' | null`: a app mostra «Som retirado pelo autor» (também com a conta
  eliminada) ou «Som retirado por direitos de autor» e não toca o vídeo com som (para as cópias que o telemóvel já tinha). Quem
  usou o som não é avisado.

## 7. Duetos: «Retirar o dueto» (0140)

- O vídeo e o som de quem foi usado num dueto ficam gravados no vídeo do outro. Por isso o autor da tcheka original pode
  **retirar o dueto** sem passar pela equipa (decisão: mais simples do que uma fila no backoffice): `POST /posts/:id/duet-takedown`
  → 204, com `:id` = o dueto. O dueto fica escondido para todos, como uma publicação apagada (`posts.removed_by = 'original'`;
  na Moderação conta como apagado), e o dono recebe o aviso `remix_takedown` («@x pediu para retirar o teu dueto»; `data:
  { postId, originalId }`), que não se desliga e aparece mesmo com um bloqueio entre os dois. Não se desfaz.
- Só duetos (lado a lado); as respostas com tcheka só mostram o texto do comentário e denunciam-se como qualquer publicação (404).
  Vale com o original já apagado e com bloqueios. O próprio dono do dueto apaga-o como sempre (400 aqui).
- `remixOf.canTakeDown` diz à app quando mostrar «Retirar o dueto» no menu «⋯» (só a quem é o autor do original).
- Eliminar a conta esconde automaticamente os duetos que outras pessoas fizeram com as minhas tchekas (as respostas ficam).

## 8. Exportação e eliminar a conta

- A exportação leva `soundReuse`, `sounds` (os meus sons originais, com os usos e o estado), `soundsUsed` (o som de cada tcheka
  minha) e `soundReportsFiled`.
- Eliminar a conta tira os sons originais (deixam de existir e de tocar, também nas tchekas dos outros, que ficam sem som; o áudio
  sai do armazenamento com os outros ficheiros), desliga as minhas tchekas dos sons, apaga as denúncias de sons que fiz e esconde
  os duetos feitos com as minhas tchekas.

## 9. Menores e contas sem data de nascimento

- Uma conta sem data de nascimento conta como menor: `birth_date <= current_date - 18 anos` é falso com `NULL`, por isso o som
  não se reutiliza (`REUSABLE`), `GET /sounds/me/settings` dá `minor: true` e a página do som mostra `unavailable: 'minor'`. O
  texto da opção diz «Só contas de maiores de 18 anos (com a data de nascimento indicada)…», os Termos dizem «em contas de
  menores de 18 anos ou sem data de nascimento» e a Ajuda diz o mesmo.
