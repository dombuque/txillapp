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
    id?: string,                  // a chave do clipe no estúdio (para o `freeze.from`)
    fx?: ClipFx,                  // os efeitos do estúdio: filtro, ajustes, transição, rampa, inverter, congelar, enquadramento, moldura (4-B)
    sound?: boolean,              // vídeos: «Som do vídeo» ligado (por omissão) ou calado
    volume?: 0..1,                // vídeos: o volume deste clipe, por cima do originalVolume (por omissão 1)
  }],
  sound?: { kind: 'music', music: Faixa }   // a faixa da interface comum (docs/musica.md): catálogo, `local` ou `clip`
        | { kind: 'sound', soundId: string }, // «Usar este som» (docs/sons.md): som original (uuid), 'cat:<faixa>' ou 'local:<uuid>'
  originalVolume?: 0..1,          // o som dos vídeos; por omissão 1, e 0 com um som de outra tcheka (como o estúdio)
  musicVolume?: 0..1,             // a música/o som (e, no dueto, o som do original); por omissão 1, e 0,7 com música e vídeos
  musicStartMs?: number,          // onde começa o trecho da música (ms na faixa, escolhido pela onda); por omissão 0
  musicFadeInMs?: 0..3000,        // fade-in da música (afade, a direito); por omissão 0
  musicFadeOutMs?: 0..3000,       // fade-out da música, até ao fim da tcheka; por omissão 0
  ducking?: boolean,              // a música baixa por baixo da voz-off (sidechaincompress); por omissão true
  voiceOver?: {                   // a narração gravada no estúdio (secção 4-A)
    mediaId: string,              // meu, `purpose: 'chat'` (privado), áudio, já 'ready'
    startMs?: number,             // quando entra na tcheka; por omissão 0
    volume?: 0..1,                // por omissão 1
    effect?: EfeitoDeVoz,         // por omissão 'normal'
  },
  originalEffect?: EfeitoDeVoz,   // efeito no som original dos vídeos; por omissão 'normal'
  soundEffects?: [{ id: 'whoosh' | 'pop' | 'palmas' | 'tambor' | 'ding' | 'riser' | 'boom' | 'vinil', atMs: number }],  // até 30
  soundEffectsVolume?: 0..1,      // por omissão 1
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
  overlays?: Overlay[],           // os textos e stickers do estúdio, até 20 (secção 4-B e docs/estudio-efeitos.md)
  pano?: { pattern, palette, seed },  // o pano de capulana da tcheka (o das transições de pano sem pano próprio); por omissão losangos/coral/1
  coverMs?: number,               // a capa (por omissão 500 ms, como o estúdio)
  duet?: { postId: string, layout: 'side' },
}
// EfeitoDeVoz = 'normal' | 'robo' | 'esquilo' | 'grave' | 'eco' | 'radio' | 'estadio'
```

- `beats`: só conta com som e com fotos. `auto` lê as batidas da música no servidor (a mesma `detectBeats` do estúdio, com as
  amostras tiradas pelo ffmpeg **a partir de `musicStartMs`**: as batidas do trecho escolhido); se a música não tiver ritmo
  claro, usa `bpm` (ou 120). `manual` com `bpm`: a grelha desse andamento a partir de 0. `manual` sem `bpm`, ou sem `beats`:
  as fotos ficam com `durationMs`. O «Ajustar ao ritmo» e os moldes do estúdio acertam o `musicStartMs` para uma batida cair
  no 0 e mexem nos `trimEndMs` dos vídeos para os cortes caírem nas batidas: o servidor só recebe o resultado.
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
| voz-off de outra pessoa, que não é áudio, pública ou por enviar | «A voz-off não é tua ou ainda não está pronta. Envia-a outra vez.» |
| voz-off curta sem outro som | «Grava mais 2 s de voz-off ou escolhe uma música» (no pedido, se já se souber a duração; senão o trabalho falha com ela) |
| efeitos | «Efeito de voz desconhecido», «Efeito sonoro desconhecido», «No máximo 30 efeitos sonoros», «O fade vai de 0 a 3 s» |

Outros: `401` sem sessão; `409` «Já tens uma tcheka a montar. Espera que acabe.» (uma de cada vez por pessoa); `429` com mais de
20 montagens na última hora; `422` texto com ameaças ou ódio (o `TextFilter`).

As regras (`apps/api/src/compose/rules.ts`) são uma **cópia fiel** de `apps/mobile/src/lib/tchekaRules.ts` (o estúdio do site):
3 fotos, ou 3 s de vídeo, ou 5 s misturados; som obrigatório (a música, um som, o som dos vídeos, o original do dueto **ou uma
voz-off com pelo menos 3 s dentro da tcheka**, `MIN_VOICE_S`); até 60 s.
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
   cortado à duração final; e, do estúdio de áudio (secção 4-A), o trecho, os fades, o ducking, a voz-off, os efeitos de voz e os
   efeitos sonoros.
4. **Filtros**: os mesmos ids e números de `LOOKS` (TxCamera). Não é uma aproximação: é a mesma conta de `applyLook` (brilho e
   contraste, saturação, sépia e cinzento) numa matriz `colorchannelmixer` (o termo constante vai no canal alfa). Como no
   estúdio, sem a tinta.
5. **Dueto**: como o `duetLayout` do site: a pessoa à esquerda e o original à direita, cada um num quadro 9:16 de 540×960 ao
   meio da sua metade (faixas pretas por cima e por baixo). O original toca desde o início; a tcheka dura o mais curto dos dois
   (até 60 s). Permissões como no remix (`posts/remix.ts`): o original vê-se (privacidade, bloqueios), é uma publicação de uma
   pessoa e uma tcheka, e o dono deixa (`remix_allowed`, nunca numa conta privada; o próprio pode sempre).

### 4-A. O som (o estúdio de áudio)

No site, o estúdio mistura o som com Web Audio (`apps/mobile/src/lib/studio/audioEngine.ts`, os painéis em
`components/studio/Audio*.tsx`) e a gravação final (MediaRecorder) leva exatamente o que se ouve. O servidor reproduz o mesmo
com o ffmpeg (`compose/plan.ts`, `voiceFxGraph` e o fim de `finalArgs`). O que tem de soar igual nos dois lados está num ficheiro
só, sem dependências: `apps/mobile/src/lib/studio/audioDsp.ts`, com a **cópia fiel** em `apps/api/src/compose/audio.ts`
(`audio-sync.spec.ts` compara-os, como as regras).

| | Estúdio (browser) | Servidor (ffmpeg) |
|---|---|---|
| Trecho (`musicStartMs`) | escolhido na onda (a sugestão: refrão ou parte mais forte, por energia); a música toca dali em ciclo | `atrim=start:start+T` depois de `-stream_loop -1`; as batidas lêem-se dali (`decodeMono` com `-ss`) |
| Volumes | um ganho por canal (original, música, voz-off, efeitos) | `volume` em cada canal, `amix` sem normalizar e `alimiter` |
| Fades (0 a 3 s) | rampas lineares num ganho (`fadePoints`) | `afade=t=in` / `afade=t=out` (curva `tri`, a direito); os dois multiplicam-se, como no browser |
| Ducking | a música desce para 0,3 (−10,5 dB) onde a voz-off tem fala (`voiceActivity`), em 0,12 s, e volta em 0,45 s | `sidechaincompress` comandado pela voz-off (`DUCK_SC`: limiar 0,03, 4:1, 20/400 ms): ~−10 dB com uma voz normal |
| Voz-off | gravada por cima da pré-visualização a tocar (contagem 3-2-1), com o atraso das colunas e do microfone descontado | o ficheiro enviado, `adelay` até `startMs`, com folga de 2,5 s para a cauda do eco e do reverb |
| Robô | anel × seno 60 Hz + pente de 6 ms com realimentação 0,45 | `aeval` (o mesmo anel) + `aecho` com as 4 primeiras repetições do pente |
| Esquilo / Grave | tom × 1,5 / × 0,72 sem mudar a duração (duas linhas de atraso moduladas, em tempo real) | `asetrate` + `aresample` + `atempo` |
| Eco | 280 ms, realimentação 0,45, envio 0,6 | `aecho` com as mesmas 4 repetições (`echoTaps`) |
| Rádio | passa-alto 500 Hz e passa-baixo 3,2 kHz (Butterworth), +6 dB aos 1,5 kHz, saturação `tanh(2,5x)/tanh(2,5)` | `highpass`, `lowpass`, `equalizer` e a mesma saturação em `aeval` |
| Estádio | ConvolverNode **sem normalizar** com a resposta gerada (`reverbImpulse`: ruído estéreo com semente, 2,4 s, energia 1), 0,6 molhado | `afir` com a **mesma resposta** (um WAV gerado no trabalho), `gtype=-1` (sem ganho automático): a mesma convolução |
| Efeitos sonoros | `synthSfx` (whoosh, pop, palmas, tambor, ding, riser, boom, vinil), gerados por código com semente | a mesma `synthSfx`/`renderSfxTrack` numa faixa WAV, no instante de cada um |

- **A voz-off** envia-se como os clipes de áudio do chat: `POST /media/uploads { mime: 'audio/webm' | 'audio/ogg' | 'audio/mp4',
  size, purpose: 'chat' }` (sem assinatura, `signed: false`), `PUT uploadUrl`. Fica no **armazenamento privado** (nunca se serve
  em público, só o dono a lê) e o trabalho lê-a de lá. O vídeo final é que leva a voz, já misturada. Até 5 MB (o limite dos áudios).
- **Regra do som**: uma voz-off com 3 s ou mais dentro da tcheka conta como o som (`MIN_VOICE_S`). No pedido, se a duração ainda
  não se souber, conta; no trabalho volta a contar com a duração lida pelo ffprobe.
- **Diferenças que ficam** (pequenas): o tom do Esquilo/Grave no browser é por linhas de atraso (um leve «coro»), no servidor
  pelo `atempo` (mais limpo); o ducking no browser segue as falas detetadas, no servidor o compressor segue o nível da voz
  (numa voz muito alta desce um pouco mais, numa muito baixa um pouco menos).

### 4-A2. O som por clipe

Como o «Som do vídeo» do estúdio integrado: cada vídeo pode ir calado (`sound: false`) ou com o volume dele (`volume`, por cima
do `originalVolume`); aplica-se no som de cada clipe (`volume` no 1.º passo; calado, silêncio). Um vídeo calado **não conta como
som** nas regras (como no `tchekaRules.ts`, `hasAudio: false`): todos calados e sem música dá «Os vídeos não têm som: escolhe
uma música ou um som». Em fotos, `sound`/`volume` dão 400. Os volumes por omissão são os do estúdio: o som dos vídeos a 100 % (0
com um som de outra tcheka) e a música a 70 % quando há vídeos (antes era 40 %/100 %).

### 4-B. Os efeitos do estúdio (filtros, transições, rampas, texto e stickers)

O estúdio do site desenha os efeitos num canvas (docs/estudio-efeitos.md). O servidor recebe **o mesmo JSON** (o `fx` de
cada clipe e as `overlays`, v1) e dá o mesmo vídeo. As contas não se copiam à mão: `compose/effects.ts`,
`compose/renderOverlays.ts`, `compose/renderTransitions.ts` e os panos de capulana (`capulana.ts`, `capulanaShapes.ts`,
`capulanaRender.ts`) são **cópias inteiras** de `apps/mobile/src/lib/studio/`, e as
fontes de `apps/api/assets/fonts/estudio` são os mesmos woff2 do site. `effects-sync.spec.ts` compara os ficheiros e as fontes,
como o `rules-sync.spec.ts`. O desenho corre num **canvas do Node** (`@napi-rs/canvas`, o Skia, com binários prontos para
linux-x64 glibc/musl e Windows), em `compose/studio-canvas.ts`.

**O pedido.** Cada clipe pode levar `id` (a chave, para o `freeze.from`) e `fx`; no topo vão as `overlays` (até 20). Com `fx`
em algum clipe, ou com `overlays`, a tcheka fica no **modo estúdio**: cada clipe leva a transição dele (sem `transition`, o
fundido de 0,5 s, como no site) e o `transition`/`filter` de sempre dão 400 («Com os efeitos do estúdio (fx), a transição e o
filtro vão em cada clipe»). Os `texts` e `stickers` de antes continuam a funcionar.

```ts
clips[i].fx?: {
  filter?: { id: 'matapa' | 'costa-do-sol' | … (os 16), amount?: 0..1 },          // amount por omissão 1
  adjust?: { brightness?, contrast?, saturation?, temperature?, hue?: -1..1, sharpen?, vignette?, grain?: 0..1 },
  transition?: { type: 'corte' | 'fundido' | 'deslizar-esquerda' | 'deslizar-direita' | 'deslizar-cima' | 'deslizar-baixo'
                     | 'zoom' | 'desfoque' | 'girar' | 'flash' | 'brilho' | 'glitch', dur?: 0.15..1.5 },  // a que entra neste clipe
  ramp?: 'montaria' | 'heroi' | 'bala' | 'flash',   // só vídeos
                     | 'capulana-deslizar' | 'capulana-desenrolar' | 'capulana-rasgar' | 'capulana-losango' | 'capulana-vento',
                 pano?: Pano },                      // nas de capulana: o pano (sem ele, o `pano` da tcheka)
  reverse?: boolean,                                 // só vídeos, corte até 15 s (REVERSE_MAX_S)
  freeze?: { from: string, at: number },             // só fotos: a foto enviada é o frame congelado (fica parada, sem zoom)
  focus?: { x, y, from, to, keep? },                 // só fotos: o enquadramento (o zoom lento de `from` a `to` apontado a x, y)
  moldura?: Pano,                                    // só fotos: a foto inteira numa moldura deste pano de capulana
}
overlays?: Overlay[]   // texto (fonte, estilo, animação, posição, rotação, escala, início e fim) ou sticker
                       // (emoji, txill, gif, mention, location, time, capulana), com os campos de docs/estudio-efeitos.md, 5;
                       // o texto pode levar `pano` (as letras cheias de pano) e `bg: 'pano'` (a faixa de capulana)
```

- Validado com zod (`compose.schema.ts`): ids conhecidos, limites do contrato (transição 0,15 a 1,5 s, animações 0,05 a 3 s,
  escala 0,1 a 8, rotação ±360°, tempos 0 a 61 s, texto até 200 letras, fonte de 24 a 300 px, `end > start`); depois passa
  pelo `sanitizeOverlay`/`sanitizeFx` do estúdio (os mesmos arredondamentos do site). O sticker de emoji só leva emojis; o
  do Txillapp tem de existir (`STICKER_ART`); os **GIFs só do GIPHY** (`giphyMediaUrl`, o mesmo de `/api/v1/gifs`, do chat e
  dos comentários: https, `media*.giphy.com`, o id no caminho, medidas razoáveis), e descarregam-se só de lá (também nos
  redireccionamentos), até 8 MB. Os textos, os locais e as menções passam pelo `TextFilter` (422).
- Erros novos: «A rampa e o inverter são só para vídeos», «Um frame congelado vai como uma foto», «O frame congelado tem de
  vir de um clipe desta tcheka» (quando os clipes têm `id`), «Para inverter, o clipe pode ter até 15 s», «Transição
  desconhecida», «A transição dura de 0,15 a 1,5 s», «Filtro desconhecido», «O ajuste Contraste vai de -1 a 1», «Fonte
  desconhecida», «A camada tem de sair depois de entrar», «No máximo 20 textos e stickers», «O GIF tem de vir do GIPHY», «O
  sticker de emoji só leva emojis», «Sticker desconhecido».
- Durações e regras como no estúdio: um vídeo com rampa dura `fxSeconds` (o corte ÷ velocidade ÷ média da rampa); um vídeo
  ao contrário fica calado e não conta para o som obrigatório.

**Como se faz cada efeito** (no 1.º passo, clipe a clipe, salvo as camadas):

| Efeito | No servidor | Igual ao site? |
|---|---|---|
| Filtro e ajustes de cor | `cubeLut(matriz, 33)` (gerada de `resolveFx`, effects.ts) num `.cube` e `lut3d` (trilinear: para uma matriz afim dá o mesmo que a tetraédrica do contrato, com o mesmo ΔE, e gasta menos de metade do CPU, porque o `lut3d` de 8 bits do ffmpeg 6 não tem SIMD) | **igual**: ΔE76 médio 0,2 a 0,7 por filtro contra a fórmula do site (`fx-pixels.spec.ts`, percentil 99 até 1,9), 1,1 no vídeo final (máximo 1,4) depois de duas codificações H.264 e do 4:2:0 |
| Nitidez | `convolution` 3×3 com o núcleo do shader | **igual** (no mesmo teste de ΔE) |
| Vinheta | `vignette` em RGB (gbrp), a mesma fórmula cos⁴, com um `format=gbrp` a seguir (`serverFxChain`: sem ele, o `format=yuv420p` seguinte puxa a vinheta para YUV, onde escurece muito mais) | **igual** (idem) |
| Grão | `noise` na luminância | parecido (aleatório nos dois lados) |
| Rampa | os bocados de `rampPieces` (0,1 s), com os vizinhos à mesma velocidade juntos, num `setpts` só (cada frame da fonte vai para o instante do estúdio) e, no som, `atrim` + `atempo` por bocado e `concat` | **igual** na duração e no tempo (até 0,1 s de degrau na curva, como diz o contrato) |
| Inverter | o corte, já no quadro, ao contrário aos bocados de 2 s (1 s com velocidade acima de 1×, tirado a 60 fps), do fim para o início (`reverse`; ~190 MB por bocado em vez do clipe todo em memória), junto com o concat; depois monta-se como um vídeo normal (com rampa e velocidade). Sem som | igual (melhor: o site tira 24 frames/s a 960 px) |
| Congelar | uma foto (o frame que a app tirou), com o filtro e os ajustes, sem zoom | igual |
| Transições (as 11) | **o mesmo `drawTransition` do site no canvas do Node**: o último frame do clipe anterior (já com os efeitos) e os primeiros frames deste (o ffmpeg dá-os em RGBA, só esses), `p = t/dur` com o `easeInOutCubic` do site; os frames desenhados codificam-se num bocado H.264 que entra no concat antes do resto do clipe. Como os clipes já não dependem uns dos outros, no modo estúdio montam-se **2 de cada vez** (`STUDIO_CLIPS_AT_ONCE`: o grafo de filtros de cada ffmpeg corre num fio) e cada transição desenha-se logo que os dois lados estão prontos | **igual**: diferença média de 0,7 a 2 níveis (0–255) contra o desenho do site no teste. O `xfade` não serve para nenhuma: tem a curva linear (o deslizar a ¼ fica 200 px ao lado) e não tem desenho para girar, brilho, glitch nem desfoque. ~25 ms por frame de 1080×1920 (15 frames numa transição de 0,5 s) |
| Texto e stickers | **o mesmo `drawOverlays` do site no canvas do Node**, cada camada na caixa dela (o círculo que a contém em qualquer rotação, com a escala máxima das animações e a margem do néon e das sombras): onde está parada, **um PNG só** (`overlay` com `enable` no tempo dela); onde se mexe (entrada e saída), os frames a 30 fps num **vídeo com alfa** (qtrle em .mov) posto no frame em que começa; em ciclo (pulsar, balançar), **um período só** (25 e 100 frames: o desenho repete-se igual) que o ffmpeg repete com `-stream_loop`. As camadas desenham-se ao mesmo tempo que o ffmpeg monta os clipes | **igual** (diferença média ~2 níveis no texto néon a entrar e parado) |
| Transições de pano (as 5 `capulana-*`) | o `drawCapulanaTransition` do site (`capulanaRender.ts`) no mesmo sítio das outras, com o pano da transição ou o da tcheka | **igual**: 0,8 a 1,6 níveis nas pontas e ~5 a meio, quando o pano enche o ecrã (o detalhe fino dele sofre com o 4:2:0 e o H.264) |
| Moldura de capulana | os frames da foto desenham-se no canvas com o `drawCapulanaFrame` do site (a foto inteira até 1440 px, com o filtro e os ajustes só nela, e o zoom lento dentro da moldura) e entram no ffmpeg pelo stdin | **igual** (diferença média 2 níveis); o grão da foto fica parado |
| Enquadramento (`focus`) | o retângulo de `coverRect` (cópia da conta de `lib/studio/magic.ts`, em `fx.ts`) a encher o quadro, frame a frame no canvas; a cor depois, no ffmpeg | **igual** |
| Letras de pano, faixa de pano e sticker de pano | o `drawOverlays` do site (com o canvas de trabalho para as letras) | **igual** (2,5 a 6,6 níveis: o pano tem detalhe fino) |
| Emoji | a fonte de emojis do sistema: Noto Color Emoji na imagem Docker (`fonts-noto-color-emoji`), Segoe UI Emoji no Windows | o desenho de cada emoji é o da fonte (no iPhone/Mac o site usa a da Apple) |
| Sticker do Txillapp | a arte (`STICKER_ART`, a mesma de `lib/stickers.ts`) em PNG pelo sharp, à escala máxima da camada | igual |
| GIF | descarregado do GIPHY; o GIF lê-se com o ffmpeg em ciclo (`-ignore_loop 0`), a 30 fps e já à largura da camada, e cada frame entra no `drawOverlays` (escalado e rodado pelo desenho, como no site); o WebP animado lê-se pelo sharp (o ffmpeg 6 não o lê) | igual no desenho; o GIF começa no 1.º frame quando a camada entra (no site depende de quando a imagem carregou) |

- O que fica por cima, pela ordem: os textos e stickers de antes, as camadas do estúdio (pela ordem da lista) e a assinatura.
- **Na imagem Docker** (`docker build -f apps/api/Dockerfile .`): o `@napi-rs/canvas` entra com o binário de linux-x64-gnu, as fontes
  em `apps/api/assets/fonts/estudio` e os emojis pelo pacote `fonts-noto-color-emoji`. Lá o ffmpeg do `ffmpeg-static` é o 7.0.2
  (no Windows de desenvolvimento, o 6.1): a cadeia de cor dá o mesmo que a fórmula do site nos dois, e uma montagem com
  transições, camadas, GIF, rampa e inverter corre dentro do contentor. O aviso «Fontconfig error: Cannot load default config
  file» desse ffmpeg não tem efeito (as fontes vão sempre por ficheiro).
- Uma camada que só aparece depois do fim não se desenha; as que passam do fim cortam-se.
- O `enable` das camadas vai pelo tempo (com meio frame de folga) e não pelo `n`: no `overlay`, o `enable` também se avalia nos
  frames da camada, que contam desde 0.
- **Dueto**: os efeitos de cor e as transições fazem-se no quadro da pessoa (540×960); as camadas por cima do vídeo inteiro.
  O site desenha a transição no quadro inteiro e volta a pôr o original por cima: aqui a transição fica dentro do quadro da
  pessoa (parecido, não igual).

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
`COMPOSE_BENCH=1 [COMPOSE_THREADS=6] npx jest --runInBand src/compose/compose.bench`):

| Tcheka | Total | Ficheiros | Clipes | Final |
|---|---|---|---|---|
| 15 s (2 vídeos de 6 s + 1 foto) | **10 a 14 s** | 0,4 s | 5,0 a 8,4 s | 4,4 a 4,8 s |
| 60 s (8 vídeos de 6 s + 4 fotos) | **43 s** (56 s com outra carga na máquina) | 1,0 s | 23 a 31 s | 18 a 23 s |
| 30 s **com os efeitos do estúdio todos** (secção 4-B: 4 vídeos + 2 fotos, filtro e ajustes em todos, uma rampa, um invertido, 5 transições do canvas, 3 textos animados, emoji a pulsar, local, hora, sticker do Txillapp e um GIF), com `COMPOSE_THREADS=6` | **35 a 41 s** (51 a 60 s com outra carga na máquina); com um pano a desenrolar, uma moldura, uma faixa e um sticker de pano, **36 a 43 s** | 0,5 s | 24 a 28 s (com as camadas, 8 a 12 s, ao mesmo tempo; transições 3,5 a 5 s; inverter 1,4 a 4 s) | 11 a 13 s |

- Com os efeitos do estúdio, **1,2 a 1,35 s de trabalho por segundo de tcheka** nesta máquina (contra 0,82 s/s da tcheka de 15
  s de sempre na mesma medição, a 12,2 s). O que pesa é a cor no ffmpeg (o `lut3d` e a `vignette` correm a 8 bits sem SIMD: ~25
  ms por frame de 1080×1920) e as camadas em vídeo. Num servidor de 6 núcleos contar com 1,5 a 2 vezes mais (uma tcheka de 30 s
  com tudo em ~1 a 1,5 min, de 60 s em ~2 a 3 min, dentro do prazo de 480 s). Memória: os ffmpeg juntos até ~0,9 GB (dois clipes
  ao mesmo tempo e o codificador das camadas).
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
- Os `texts`, `stickers`, `transition` e `filter` de antes (sem `fx` nem `overlays`): o texto parte-se em linhas por uma
  largura média da letra (não mede), a caixa não tem cantos redondos, os emojis saem, os stickers ficam parados e o `slide`
  desliza a direito. Com os efeitos do estúdio (secção 4-B) tudo isto é o desenho do site.
- O sticker «personagem» do estúdio (a saltitar no canto) não existe aqui.
- A verificação de nudez não volta a correr no vídeo final: as fotos e os vídeos já foram verificados no envio, e o resto (texto,
  stickers, assinatura) é nosso.
- A exportação de dados da conta não inclui os jobs (são temporários e apagam-se aos 7 dias).
- **Uma voz-off só** por tcheka (o estúdio também grava uma; regravar substitui-a). A voz-off enviada que não chegue a ir numa
  tcheka fica como os outros áudios por usar (privada; não há limpeza dos órfãos).
- O estúdio nativo ainda não grava a voz-off nem escolhe o trecho: o servidor já aceita tudo (secção 4-A).

## 8. Testes

- Os efeitos do estúdio (secção 4-B): `effects-sync.spec.ts` (as cópias, os panos de capulana com as impressões digitais de
  `apps/mobile/tests/fixtures/capulana-hashes.json` e as fontes iguais às do site); os e2e «capulana: …» (um pano a meio da
  transição, a moldura, as letras, a faixa e o sticker de pano contra o desenho do site, e o enquadramento) e «som por clipe»; `fx.spec.ts` (a rampa
  num `setpts`, os bocados do inverter, as partes paradas e animadas de cada camada, a caixa de cada camada tem tudo o que ela
  desenha, os argumentos do ffmpeg); `fx-pixels.spec.ts` (o ΔE de cada filtro, píxel a píxel, contra a fórmula do site);
  e no `compose.e2e.spec.ts` os testes «efeitos: …», verificados com o ffprobe e com amostras de píxeis: um filtro (ΔE no
  vídeo final) e um ajuste (brilho e vinheta), a rampa (duração), inverter (as cores ao contrário e o som calado), 3
  transições (fundido, deslizar e glitch) contra o desenho do site e sem mudar a duração, um texto néon a entrar (antes, a
  entrar e parado, contra o desenho do site), um emoji e um GIF a mexer-se (servido por um `fetcher` falso como se viesse do
  GIPHY), e as validações e o filtro de texto nas camadas.

- `compose.e2e.spec.ts`: 3 fotos com música (ffprobe: duração, 1080×1920, H.264/AAC a 30 fps, faststart, capa, `signed`, publicar
  com `POST /posts`); ao ritmo (deteção das batidas); vídeo cortado a 2× com P&B; texto com tempo (píxeis antes, durante e
  depois); validações (regras, clipes de outra pessoa, anfitrião e licença da música, sons, filtro, sticker, capa, sessão);
  estado do job (só o dono, um de cada vez, reinício); dueto (esquerda/direita, faixas pretas, permissões do remix, incluindo
  `remix_allowed`); «Usar este som» (som original, em análise, `sound_reuse` desligado, e o som `cat:` de uma faixa). Tudo com
  ficheiros gerados pelo ffmpeg (`testsrc`, `color`, `sine`, `aevalsrc`) e a música servida por um `fetcher` falso.
- O som (os testes «som: …», por **amostras do áudio** do vídeo final, mono a 16 kHz, com Goertzel e RMS): o trecho
  (`musicStartMs`: só se ouve a parte certa da faixa), os fades (a meio do fade-in, metade), as batidas lidas do trecho; a
  voz-off sozinha como som, no instante dela, com volume; o ducking (a música desce mais de 6 dB a falar, volta depois; sem
  ducking não desce); a voz-off curta («Grava mais 2 s…») e as validações; o Esquilo (1 kHz → 1,5 kHz), o Estádio (cauda), o Eco
  (a repetição aos 280 ms), o Grave no som original (440 → 317 Hz); todos os efeitos montam no ffmpeg; os efeitos sonoros no
  instante deles, com o mesmo envelope que o estúdio gera.
- `plan.spec.ts`: as contas sem ffmpeg (também o grafo do som e os filtros de cada efeito). `rules-sync.spec.ts` e
  `audio-sync.spec.ts`: as cópias das regras e do som.
- `TEST_DATABASE_URL=postgres://txill:txill_dev@localhost:5433/t_comp1 npx jest --runInBand src/compose` (em `apps/api`).
