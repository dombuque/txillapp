# Montagem das tchekas no servidor

No site, o estúdio das tchekas monta o vídeo no próprio browser (canvas + MediaRecorder em
`apps/mobile/src/components/TchekaStudio.tsx`, e o dueto em `components/remix/RemixRecorder.tsx`). No telemóvel não há como
montar (o ffmpeg-kit foi descontinuado), por isso a app nativa **manda a montagem ao servidor**: envia os clipes pelo upload de
sempre, pede a montagem e, quando fica pronta, publica o vídeo final com `POST /posts`.

Código: `apps/api/src/compose/` (módulo `ComposeModule`). Migração: `0136_montagem_tchekas.sql`.

## 1. Fluxo na app

1. Enviar cada foto e cada vídeo como sempre: `POST /media/uploads` → `PUT uploadUrl` → `POST /media/:id/complete` e, nos vídeos,
   esperar por `GET /media/:id/status` = `ready`. Os clipes vão **sem a assinatura** (`signed: false`): é o vídeo final que a leva
   (uma foto da TxillCam já assinada ficava com duas assinaturas).
2. `POST /tchekas/compose` com o corpo da secção 2 → `202 { jobId }`.
3. Perguntar `GET /tchekas/compose/:jobId` de 1 em 1 s (a barra de progresso usa `progress`).
4. Com `status: 'done'`, publicar: `POST /posts { body, mediaIds: [mediaId], music?, soundId?, remixOf? }`, com a mesma `music`
   (ou o mesmo `soundId`) que foi na montagem, para o crédito e o som da tcheka (docs/sons.md). Num dueto,
   `remixOf: { postId, kind: 'duet' }` (posts/remix.ts). A capa já vem feita (secção 4): não é preciso `posterMs`.
5. Com `status: 'failed'`, mostrar `error` (já vem em português) e deixar tentar outra vez.

## 2. `POST /tchekas/compose` (com sessão)

```ts
{
  clips: [{                       // 1 a 30, pela ordem
    mediaId: string,              // meu, 'public', já 'ready' (o upload de sempre)
    kind: 'video' | 'photo',      // tem de bater com o ficheiro
    trimStartMs?: number,         // vídeos: o bocado que entra (por omissão, tudo); mínimo 0,5 s (clampTrim do estúdio)
    trimEndMs?: number,
    speed?: 0.5 | 1 | 2 | 3,      // vídeos: a 2× fica com metade da duração (o som acompanha, com atempo)
    durationMs?: number,          // fotos sem ritmo: 300 a 10 000 (por omissão 3000)
    beats?: 1 | 2 | 4,            // fotos ao ritmo: batidas no ecrã (por omissão beats.perPhoto)
  }],
  sound?: { kind: 'music', music: Faixa }   // a faixa da interface comum (docs/musica.md): catálogo, `local` ou `clip`
        | { kind: 'sound', soundId: string }, // «Usar este som» (docs/sons.md): som original (uuid), 'cat:<faixa>' ou 'local:<uuid>'
  originalVolume?: 0..1,          // o som dos vídeos; por omissão 1, 0,4 com música e 0 com um som (como o estúdio)
  musicVolume?: 0..1,             // a música/o som (e, no dueto, o som do original); por omissão 1
  beats?: { mode: 'auto' | 'manual', perPhoto?: 1 | 2 | 4, bpm?: 40..240 },
  transition?: 'cut' | 'fade' | 'slide',   // por omissão 'cut'
  filter?: 'normal' | 'vivo' | 'quente' | 'fresco' | 'suave' | 'dourado' | 'fade' | 'txilla' | 'vintage' | 'pb',
  texts?: [{                      // até 10
    text: string,                 // até 150 letras; o filtro de texto de sempre; emojis saem (a letra não os tem)
    color?: '#rrggbb',            // por omissão branco
    bg?: '#rrggbb',               // caixa por trás (o estilo «coral» do estúdio: '#d6334f'); sem ela, sombra
    x?: 0..1, y?: 0..1,           // o centro do texto (por omissão 0,5 e 0,62, como no estúdio)
    size?: 0.02..0.2,             // letra em fração da largura (por omissão 0,068 ≈ 74 px em 1080)
    startMs?: number, endMs?: number,  // por omissão de 0 a 4 s; entra em 0,45 s a subir e sai em 0,4 s (textAlpha)
  }],
  stickers?: [{ id, x, y, s, r, startMs?, endMs? }],  // até 12; o mesmo formato dos mimos (stories/stickers.ts), com tempo opcional
  coverMs?: number,               // a capa (por omissão 500 ms, como o estúdio)
  duet?: { postId: string, layout: 'side' },
}
```

- `beats`: só conta com som e com fotos. `auto` lê as batidas da música no servidor (a mesma `detectBeats` do estúdio, com as
  amostras tiradas pelo ffmpeg); se a música não tiver ritmo claro, usa `bpm` (ou 120). `manual` com `bpm`: a grelha desse
  andamento a partir de 0. `manual` sem `bpm`, ou sem `beats`: as fotos ficam com `durationMs`.
- Os vídeos ficam sempre com a duração que têm (cortados e com a velocidade); ao ritmo, só as fotos mudam.

**Respostas de erro** (`400`, `message` em português, igual às dicas do estúdio; `problem` nas regras):

| Caso | Mensagem |
|---|---|
| poucas fotos / pouco vídeo | «Junta mais 2 fotos», «Grava mais 1 s», «Junta mais 1 foto ou 2 s de vídeo» |
| sem som | «Escolhe uma música», «Sobe o som original ou escolhe uma música», «Os vídeos não têm som: escolhe uma música ou um som» |
| mais de 60 s | «Tira 10 s (máximo 60 s)» |
| mais de 30 clipes | «No máximo 30 clipes numa tcheka» |
| clipe de outra pessoa, por enviar ou não pronto | «Um dos clipes não é teu ou ainda não está pronto. Envia-o outra vez.» |
| `kind` errado | «O clipe 2 não é uma foto» |
| música de um anfitrião não permitido ou sem https | «Esta música vem de um sítio que não é permitido. Escolhe uma do catálogo.» |
| licença NC/ND/SA | «A licença desta música não deixa usá-la numa tcheka» |
| música licenciada | «A música licenciada ainda não dá para montar no servidor» |
| dueto | `404` «Publicação não encontrada», `400` «Só dá para fazer dueto com uma tcheka», `403` «Esta pessoa não deixa fazer duetos nem responder com tchekas» |
| som original | `404` «Este som já não está disponível», `403` «Este som está em análise…», `403` «Quem publicou este som não deixa usá-lo» |

Outros: `401` sem sessão; `409` «Já tens uma tcheka a montar. Espera que acabe.» (uma de cada vez por pessoa); `429` com mais de
20 montagens na última hora; `422` texto com ameaças ou ódio (o `TextFilter`).

As regras (`apps/api/src/compose/rules.ts`) são uma **cópia fiel** de `apps/mobile/src/lib/tchekaRules.ts` (o estúdio do site):
3 fotos, ou 3 s de vídeo, ou 5 s misturados; som obrigatório (a música, um som, o som dos vídeos ou o original do dueto); até 60 s.
O limite de 30 clipes é só do servidor. `rules-sync.spec.ts` compara os dois ficheiros quando estão os dois no repositório.
No pedido, as durações ao ritmo estimam-se com o `bpm` (ou 120) e os vídeos contam como tendo som; no trabalho as regras voltam
a correr com as batidas lidas e com o som real dos vídeos (falha com a mesma dica). Se o ritmo passar um pouco dos 60 s, corta.

## 3. `GET /tchekas/compose/:jobId` (com sessão, só o dono)

```ts
{ status: 'queued' | 'working' | 'done' | 'failed', progress: 0..1, mediaId?: string, durationMs?: number, error?: string }
```

`404` para um job que não existe ou de outra pessoa. `progress`: 0–0,08 a preparar (descarregar, ler as batidas), até 0,45 os
clipes, até 0,95 o vídeo final (o `-progress` do ffmpeg), 1 no fim. Os jobs acabados apagam-se ao fim de 7 dias.

## 4. O vídeo final

- **1080×1920 (9:16), H.264 (high 4.1, CRF 21, até 6 Mbit/s) + AAC 160 kbit/s, 30 fps, `faststart`**, sem metadados.
- Fica em `content.media_assets` como `purpose: 'public'`, `status: 'ready'`, `mime: 'video/mp4'`, **`signed: true`**, com
  `duration_ms`, `width`, `height` e a capa (`<id>.poster.jpg`, servida em `/media/:id?poster=1`) tirada em `coverMs`.
- **Assinatura**: o logótipo do Txillapp, o @ e o selo de verificado (se a conta o tiver), em todos os frames, com o mesmo desenho
  de `media/signature.ts` (`signatureSvg`, o que `stampTxillapp` desenha no estúdio). Por isso `signed`: ao descarregar não se
  volta a assinar.

### Como se monta (`compose/plan.ts`)

1. **Ficheiros**: os clipes saem do armazenamento (disco ou S3); as fotos passam pelo sharp (rotação, a cobrir o quadro com 1,5×
   de folga); a música descarrega-se **só de anfitriões permitidos** (`ALLOWED_HOSTS` do catálogo, `music/catalog/curation.ts`),
   **só por https** (também nos redireccionamentos, até 4), até 25 MB e 45 s; uma faixa dos artistas, um clipe de áudio próprio e
   um som original lêem-se do armazenamento privado. Todas as entradas do ffmpeg têm `-protocol_whitelist file` e a lista dos
   formatos permitidos.
2. **Um clipe de cada vez** (pouca memória): cortado (`-ss`/`-t`), à velocidade (`setpts`, `atempo`), a 30 fps, a cobrir o quadro,
   com o filtro e, nas fotos, o Ken Burns do estúdio (zoom de 1 a 1,07 ao centro, `zoompan`). As **transições** fazem-se aqui, como
   no site: o último frame do clipe anterior, parado, funde-se (`xfade=fade`) ou sai a deslizar (`xfade=slideleft`) durante 0,5 s
   sobre o início deste. As durações não mudam, por isso os cortes ao ritmo continuam nas batidas. O som de cada clipe sai com o
   número exato de amostras dos seus frames (nada escorrega).
3. **O vídeo final**: os bocados juntos (concat), o **texto** (`drawtext` com a letra DejaVu Sans Bold de `apps/api/assets/fonts`,
   com a entrada, a saída e a subida do estúdio), os **stickers** (PNG desenhados com a arte dos mimos, `stickersSvg`, com
   `enable` no tempo deles), a assinatura por cima de tudo e a **mistura do som** (`amix` sem normalizar e um limitador): o som dos
   clipes × `originalVolume`, a música ou o som em ciclo × `musicVolume`, e no dueto o som do original × `musicVolume`, tudo
   cortado à duração final.
4. **Filtros**: os mesmos ids e números de `LOOKS` (TxCamera). Não é uma aproximação: é a mesma conta de `applyLook` (brilho e
   contraste, saturação, sépia e cinzento) numa matriz `colorchannelmixer` (o termo constante vai no canal alfa). Como no
   estúdio, sem a tinta.
5. **Dueto**: como o `duetLayout` do site: a pessoa à esquerda e o original à direita, cada um num quadro 9:16 de 540×960 ao
   meio da sua metade (faixas pretas por cima e por baixo). O original toca desde o início; a tcheka dura o mais curto dos dois
   (até 60 s). Permissões como no remix (`posts/remix.ts`): o original vê-se (privacidade, bloqueios), é uma publicação de uma
   pessoa e uma tcheka, e o dono deixa (`remix_allowed`, nunca numa conta privada; o próprio pode sempre).

## 5. Fila e limites

- Fila em memória, **1 trabalho de cada vez** (`COMPOSE_CONCURRENCY`, 1 ou 2), o ffmpeg com **prioridade baixa** (nice 10).
- **Prazo** por trabalho: `COMPOSE_TIMEOUT_S` (480 s) → «A montagem demorou demais. Tenta com menos clipes ou uma tcheka mais curta.»
- `COMPOSE_THREADS` (0 = todos os núcleos): limita os fios do x264 e dos filtros num servidor partilhado (menos memória também).
- **Uma montagem por pessoa** de cada vez (índice único em `content.compose_jobs`), 20 por hora.
- Os temporários (`txcompose-*` no diretório temporário) apagam-se no fim de cada trabalho e, ao arrancar, os que um processo
  anterior deixou.
- O estado vive em `content.compose_jobs` (0136): depois de um reinício, os que estavam `working` passam a `failed` com
  «O servidor reiniciou a meio da montagem. Tenta outra vez.»; os `queued` voltam à fila.

## 6. Tempos medidos (para dimensionar o servidor)

Numa máquina de desenvolvimento (Windows 11, 12 CPUs, 16 GB), com conteúdo realista: vídeos 1080×1920 a 30 fps com movimento
e som, fotos, `fade`, filtro `quente`, 2 textos, 1 sticker e música (`src/compose/compose.bench.spec.ts`,
`COMPOSE_BENCH=1 npx jest --runInBand src/compose/compose.bench`):

| Tcheka | Total | Ficheiros | Clipes | Final |
|---|---|---|---|---|
| 15 s (2 vídeos de 6 s + 1 foto) | **10 a 14 s** | 0,4 s | 5,0 a 8,4 s | 4,4 a 4,8 s |
| 60 s (8 vídeos de 6 s + 4 fotos) | **43 s** (56 s com outra carga na máquina) | 1,0 s | 23 a 31 s | 18 a 23 s |

- Ou seja, cerca de **0,7 a 0,9 s de trabalho por segundo de tcheka** com 12 núcleos; o ffmpeg chegou a ~0,7 GB de memória (com
  todos os fios). Numa máquina de 4 vCPU contar com 2 a 3 vezes mais (uma tcheka de 60 s em ~2 a 2,5 min).
- Com `COMPOSE_CONCURRENCY=1`, um servidor dá umas 60 a 80 tchekas de 60 s por hora (12 núcleos); as de 15 s, 4 vezes mais.
  Para mais, um servidor só para a montagem (a fila passa então a Redis: ver «O que não faz»).

## 7. O que não faz (ainda)

- **Música licenciada** (`kind: 'licensed'`): recusada com uma mensagem.
- **Várias instâncias da API**: a fila é em memória e o arranque falha os `working` de todas. Com mais de uma instância é preciso
  uma fila partilhada (Redis, como o TODO da fase 3 no `ThrottlerModule`).
- **Cancelar** uma montagem a meio (não há `DELETE`); o vídeo final que não chegue a ser publicado fica como os outros envios por
  publicar (não há limpeza dos órfãos).
- O texto parte-se em linhas por uma largura média da letra (não mede); a caixa do texto não tem cantos redondos; emojis saem.
- O sticker «personagem» do estúdio (a saltitar no canto) não existe aqui: os stickers são os dos mimos, parados, com tempo.
- `slide` desliza a direito (o estúdio faz com abrandamento no fim).
- A verificação de nudez não volta a correr no vídeo final: as fotos e os vídeos já foram verificados no envio, e o resto (texto,
  stickers, assinatura) é nosso.
- A exportação de dados da conta não inclui os jobs (são temporários e apagam-se aos 7 dias).

## 8. Testes

- `compose.e2e.spec.ts`: 3 fotos com música (ffprobe: duração, 1080×1920, H.264/AAC a 30 fps, faststart, capa, `signed`, publicar
  com `POST /posts`); ao ritmo (deteção das batidas); vídeo cortado a 2× com P&B; texto com tempo (píxeis antes, durante e
  depois); validações (regras, clipes de outra pessoa, anfitrião e licença da música, sons, filtro, sticker, capa, sessão);
  estado do job (só o dono, um de cada vez, reinício); dueto (esquerda/direita, faixas pretas, permissões do remix, incluindo
  `remix_allowed`); «Usar este som» (som original, em análise, `sound_reuse` desligado, e o som `cat:` de uma faixa). Tudo com
  ficheiros gerados pelo ffmpeg (`testsrc`, `color`, `sine`, `aevalsrc`) e a música servida por um `fetcher` falso.
- `plan.spec.ts`: as contas sem ffmpeg. `rules-sync.spec.ts`: a cópia das regras.
- `TEST_DATABASE_URL=postgres://txill:txill_dev@localhost:5433/t_comp1 npx jest --runInBand src/compose` (em `apps/api`).
