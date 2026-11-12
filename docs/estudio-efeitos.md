# Estúdio das tchekas: efeitos, texto e stickers

Contrato estável dos efeitos de uma tcheka. A web desenha tudo num canvas de 1080×1920 e grava-o (`TchekaStudio.tsx`). A
montagem no servidor (ffmpeg, para a app nativa) tem de dar o mesmo vídeo a partir deste JSON. Este documento diz o que
cada campo significa, com as fórmulas, e qual é o filtro ffmpeg equivalente de cada efeito.

A verdade está no código, sem React nem browser: `apps/mobile/src/lib/studio/effects.ts`. Os testes estão em
`apps/mobile/tests/studioEffects.test.mjs`. Quando este documento e o código não dizem o mesmo, conta o código; os testes
verificam que todos os ids de filtros, transições, rampas, fontes e animações aparecem aqui.

| Ficheiro | O que faz |
| --- | --- |
| `lib/studio/effects.ts` | Tipos `ClipFx` e `Overlay`, matrizes de cor, filtros, ajustes, rampas, animações, zona segura, serialização, cadeias ffmpeg |
| `lib/studio/renderGL.ts` | Shader WebGL dos efeitos de cor (o caminho rápido); sem WebGL, filtro SVG no canvas 2D |
| `lib/studio/renderTransitions.ts` | As transições no canvas 2D |
| `lib/studio/renderOverlays.ts` | Os textos e stickers no canvas 2D (sem DOM: corre também num canvas do Node) |
| `lib/studio/renderReverse.ts` | Inverter na web (frames em JPEG pequenos) |
| `lib/studio/renderFonts.ts` | As fontes do texto (`public/fonts/estudio/*.woff2`, OFL) |
| `components/studio/Fx*.tsx`, `TextPanel.tsx`, `StickerTray.tsx` | Os painéis e o palco onde se mexe nas camadas (`FxStage`) |

## 1. O JSON

```json
{
  "v": 1,
  "frame": { "w": 1080, "h": 1920, "fps": 30 },
  "clips": [
    { "id": "c1", "fx": { "filter": { "id": "costa-do-sol", "amount": 0.8 }, "adjust": { "contrast": 0.2, "vignette": 0.3 } } },
    { "id": "c2", "fx": { "transition": { "type": "zoom", "dur": 0.6 }, "ramp": "heroi" } },
    { "id": "c3", "fx": { "transition": { "type": "corte", "dur": 0.5 }, "freeze": { "from": "c2", "at": 3.2 } } }
  ],
  "overlays": [
    { "id": "t1", "kind": "text", "start": 0.5, "end": 4.5, "x": 0.5, "y": 0.42, "scale": 1, "rot": 0,
      "anim": { "in": "pop", "out": "aparecer", "loop": "nenhuma", "inDur": 0.45, "outDur": 0.35 },
      "text": "Bom dia, Maputo!", "font": "futuro", "size": 84, "color": "#ff4fd8", "align": "center",
      "bg": "nenhum", "outline": false, "shadow": true, "neon": true },
    { "id": "s1", "kind": "sticker", "start": 0, "end": 12, "x": 0.5, "y": 0.7, "scale": 1, "rot": -4,
      "anim": { "in": "pop", "out": "aparecer", "loop": "nenhuma", "inDur": 0.4, "outDur": 0.3 },
      "sticker": { "type": "location", "name": "Costa do Sol" }, "variant": "coral" }
  ]
}
```

- `v`: versão do contrato (`FX_VERSION = 1`). Um leitor recusa versões mais novas do que a dele (`parseFxContract`).
- `clips`: pela ordem da sequência. `id` é a chave do clipe na linha do tempo. `fx` fica no campo `fx` do clipe e não
  aparece quando não há efeitos. O tempo do clipe (ficheiro, corte, velocidade, duração das fotos) é da linha do tempo
  (`lib/studio/project.ts`, onde `ProjectClip.fx` é um `ClipFx`). Aqui só está o que os efeitos mudam. Com rampa, a
  linha do tempo usa a duração de `fxSeconds`; dividir (a tesoura) e congelar usam `splitAt` e a junção nova fica `corte`.
- `overlays`: a lista do projeto, da camada de baixo para a de cima (no máximo 20). No estúdio fazem parte do projeto:
  entram no desfazer/refazer (um gesto no palco ou na faixa da linha do tempo é um passo) e no rascunho
  (`settings.overlays`, validadas outra vez com `sanitizeOverlay` ao abrir).
- O texto sai sempre igual: chaves por ordem alfabética, números arredondados (`stringifyFxContract`). O que não for
  válido cai na leitura (`sanitizeFx`, `sanitizeOverlay`): ids desconhecidos, GIFs fora do GIPHY, texto vazio, `end <= start`.

### `ClipFx`

| Campo | Tipo | O que é |
| --- | --- | --- |
| `filter` | `{ id, amount }` | Um dos 16 filtros (secção 2), `amount` de 0 a 1 (a intensidade). `normal` não se guarda |
| `adjust` | `{ brightness, contrast, saturation, temperature, hue, sharpen, vignette, grain }` | Ajustes. Os 5 primeiros vão de -1 a 1, os 3 últimos de 0 a 1. Os que estão a 0 não se guardam |
| `transition` | `{ type, dur }` | A transição que **entra** neste clipe, vinda do anterior. `dur` de 0,15 a 1,5 s. Sem o campo vale `fundido` de 0,5 s. No primeiro clipe não conta |
| `ramp` | `montaria`, `heroi`, `bala`, `flash` | Só vídeos: rampa de velocidade por cima da velocidade do clipe |
| `reverse` | `true` | Só vídeos: o clipe toca ao contrário e o som original dele fica calado |
| `freeze` | `{ from, at }` | Só fotos: a foto é um frame congelado do clipe `from`, no segundo `at` do ficheiro. Fica parada, sem zoom |

## 2. Cor (filtro e ajustes)

### Ordem dos passos (igual no shader e no ffmpeg)

Para cada pixel do clipe já posto no quadro (cover centrado):

1. **Nitidez**, com o núcleo 3×3 `c·(1+4a) − a·(N+S+E+O)`, onde `a = nitidez × 0,6` (`SHARPEN_K`) e os vizinhos estão a 1 px
   do quadro final. O resultado fica entre 0 e 1.
2. **Matriz de cor** 4×5 (como o `feColorMatrix`), com o corte a 0..1 no fim.
3. **Vinheta**, que multiplica por `cos(ângulo·d)⁴`. `ângulo = vinheta × π/2,6` (`VIGNETTE_ANGLE`) e `d` é a distância ao
   centro em px a dividir pela distância do centro ao canto (`d = 1` nos cantos). É a fórmula do `vignette` do ffmpeg com aspect=1.
4. **Grão**, que soma o mesmo valor a R, G e B: `(ruído − 0,5) × grão × 0,16` (`GRAIN_AMP`). O ruído é aleatório por pixel e por frame.

O pixel de referência é `applyFxPixel` (effects.ts). O shader (`renderGL.ts`) segue-o à letra.

### A matriz

`resolveFx(fx)` dá `matrix = ajustes ∘ mistura(filtro, amount)`: primeiro o filtro, depois os ajustes. A mistura é
`I + amount·(M − I)`. A nitidez, a vinheta e o grão do filtro multiplicam por `amount` e somam aos dos ajustes (com
limite de 1).

As operações (as cores vão de 0 a 1; as fórmulas da saturação, da matiz, do sépia e dos cinzentos são as do CSS/SVG Filter Effects):

| Operação | Matriz |
| --- | --- |
| `brightness(b)` | diagonal b |
| `contrast(c)` | diagonal c, deslocamento (1−c)/2 |
| `saturate(s)` | `feColorMatrix type=saturate` |
| `hue(graus)` | `feColorMatrix type=hueRotate` |
| `sepia(a)`, `grayscale(a)` | as do CSS (`sepia()`, `grayscale()`) |
| `temperature(t)` | R × (1+0,18t), G × (1+0,04t), B × (1−0,22t) |
| `tint(t)` | R e B × (1+0,04t), G × (1−0,12t) (t>0 magenta, t<0 verde) |
| `fade(f)` | × (1−0,22f) + 0,1f (levanta os pretos e baixa os brancos) |
| `colorize(r,g,b,a)` | × (1−a) + cor·a |
| `lift(r,g,b)` | por canal: × (1−x) + x (cor nas sombras) |

### Os 16 filtros

| id | Nome | Personalidade | Operações (pela ordem) | Extras |
| --- | --- | --- | --- | --- |
| `normal` | Normal | Sem filtro | — | |
| `matapa` | Matapa | Verde fundo da folha de mandioca, terra quente | temperature(0.15) → tint(-0.35) → saturate(1.12) → contrast(1.06) → lift(0.02, 0.05, 0.01) | |
| `costa-do-sol` | Costa do Sol | Fim de tarde dourado na marginal | temperature(0.45) → brightness(1.06) → saturate(1.25) → contrast(1.05) → fade(0.1) | vinheta 0.15 |
| `xima` | Xima | Claro, cremoso e suave | brightness(1.08) → contrast(0.9) → saturate(0.8) → fade(0.3) → temperature(0.12) → colorize(255, 244, 225, 0.06) | |
| `noite-de-maputo` | Noite de Maputo | Néon azul e magenta, sombras frias | temperature(-0.55) → tint(0.3) → contrast(1.22) → saturate(1.2) → brightness(0.95) → lift(0.03, 0, 0.09) | vinheta 0.45 |
| `marrabenta` | Marrabenta | Vivo, quente e com contraste, para dançar | saturate(1.5) → contrast(1.15) → temperature(0.18) → brightness(1.03) | |
| `capulana` | Capulana | Cores fortes como um pano novo | saturate(1.7) → hue(12) → contrast(1.12) | nitidez 0.15 |
| `ilha` | Ilha | Turquesa e pedra branca da Ilha de Moçambique | temperature(-0.2) → tint(-0.1) → brightness(1.06) → saturate(1.12) → contrast(0.98) → colorize(64, 200, 210, 0.06) | |
| `tofo` | Tofo | Oceano azul e verde, de mergulho | temperature(-0.32) → saturate(1.25) → contrast(1.08) → hue(-6) | |
| `gorongosa` | Gorongosa | Savana: verdes de terra e luz dura | temperature(0.28) → saturate(0.88) → contrast(1.12) → tint(-0.15) | nitidez 0.2, vinheta 0.25 |
| `limpopo` | Limpopo | Pôr do sol laranja sobre o rio | temperature(0.6) → tint(0.18) → saturate(1.15) → contrast(1.06) → colorize(255, 120, 60, 0.08) | vinheta 0.25 |
| `cacimba` | Cacimba | Neblina da manhã, tudo calmo | fade(0.45) → contrast(0.85) → saturate(0.75) → temperature(-0.1) → brightness(1.05) | |
| `vintage` | Vintage | Machimbombo dos anos 70, com grão | sepia(0.4) → fade(0.25) → temperature(0.2) → contrast(0.95) → saturate(0.85) | vinheta 0.35, grão 0.35 |
| `pb` | P&B | Mafalala a preto e branco, documental | grayscale(1) → contrast(1.3) → brightness(1.02) | nitidez 0.15, grão 0.2 |
| `polana` | Polana | Preto e branco suave e elegante | grayscale(1) → contrast(0.92) → fade(0.15) → brightness(1.05) → sepia(0.08) | |
| `txillapp` | Txillapp | O coral da casa | colorize(214, 51, 79, 0.1) → saturate(1.12) → contrast(1.06) → temperature(0.08) | |

### Os ajustes

`brightness` → brightness(1 + 0,45v) · `contrast` → contrast(1 + 0,5v) · `saturation` → saturate(1 + v) ·
`temperature` → temperature(v) · `hue` → hue(180v). `sharpen`, `vignette` e `grain` somam aos do filtro.

### Em ffmpeg

`ffmpegFxChain(fx, 'clip.cube')` dá a cadeia a pôr depois de o clipe estar em 1080×1920:

```
format=gbrp,
convolution='0 -A 0 -A B -A 0 -A 0:(igual nos 4 planos):0rdiv=0.01:1rdiv=0.01:2rdiv=0.01:3rdiv=0.01',  (A = round(nitidez·0,6·100), B = 100+4A)
lut3d=file='clip.cube':interp=tetrahedral,                     (a matriz: cubeLut(matrix, 33))
vignette=angle=V·π/2,6:dither=0,                               (em gbrp a vinheta multiplica R, G e B, como o shader)
format=yuv420p,noise=c0s=round(grão·0,08·255):c0f=t+u          (grão só na luminância)
```

- **Exato:** a nitidez, a cor (a LUT 3D tem a matriz e o corte a 0..1, por isso não perde os valores intermédios como o
  `colorchannelmixer` faria) e a vinheta.
- **Parecido:** o grão, porque é aleatório.
- Um clipe sem efeitos dá a cadeia vazia. A cadeia foi testada com o ffmpeg 9 (`testsrc2`).

## 3. Transições

A transição do clipe *i* ocupa os primeiros `dur` segundos dele. Durante esse tempo, o clipe anterior fica parado no
último frame (já com os efeitos dele) e o novo começa a tocar. A duração total **não muda**. `dur` nunca passa de 80 % do
clipe que entra. O progresso `p` vai de 0 a 1 com `easeInOutCubic`.

No ffmpeg, o anterior leva `tpad=stop_mode=clone:stop_duration=dur` e depois
`xfade=transition=X:duration=dur:offset=<fim do anterior>` (`ffmpegTransition`). Assim fica `A + dur + B − dur = A + B`,
igual à web.

| id | Nome | Na web | `xfade` |
| --- | --- | --- | --- |
| `corte` | Corte | sem transição | (concat) |
| `fundido` | Fundido | o anterior desaparece por cima do novo | `fade` |
| `deslizar-esquerda` | Esquerda | os dois andam para a esquerda (empurra) | `slideleft` |
| `deslizar-direita` | Direita | idem, para a direita | `slideright` |
| `deslizar-cima` | Cima | idem, para cima | `slideup` |
| `deslizar-baixo` | Baixo | idem, para baixo | `slidedown` |
| `zoom` | Zoom | o anterior amplia (1→2,2) e desaparece; o novo assenta de 1,4 para 1 | `zoomin` |
| `desfoque` | Desfoque | desfoca até ao meio, troca e volta a focar | `hblur` |
| `girar` | Girar | meia volta (0→90°, −90°→0), ampliada para não haver cantos vazios | `radial` |
| `flash` | Flash | branco a subir até ao meio e a descer (sin(πp)^1,6) | `fadewhite` |
| `brilho` | Brilho | fundido com bloom e uma luz coral/dourada a atravessar, em modo de luz | `fadefast` |
| `glitch` | Glitch | tiras deslocadas dos dois clipes e cores separadas (cião/magenta), estável por frame | `pixelize` |

O `corte` dá o mesmo resultado nos dois lados. Nas outras transições, o `xfade` tem a curva linear e um desenho parecido,
mas não igual. Para ficar igual, o servidor pode usar `drawTransition` de `renderTransitions.ts` num canvas do Node: só usa
o canvas 2D, sem DOM.

## 4. Velocidade e tempo

### Rampas

A rampa é uma curva de velocidade `s(u)`, linear entre pontos, com `u` de 0 a 1 ao longo do clipe **já montado**. Vai por
cima da velocidade do clipe (`speed`). Para um corte de `L` segundos:

- duração no vídeo final: `D = L / speed / média(s)` (`fxSeconds`), onde `média = ∫₀¹ s(u) du`;
- ponto do ficheiro no instante `t` do clipe: `trim.start + L · ∫₀^(t/D) s / média` (`sourceOffset`);
- velocidade de leitura nesse instante: `speed · s(t/D)` (`playbackRateAt`).

| id | Nome | Personalidade | Pontos (u, velocidade) | Média |
| --- | --- | --- | --- | --- |
| `montaria` | Montaria | Rápido, lento, rápido, lento | (0, 2) (0.18, 2) (0.28, 0.45) (0.45, 0.45) (0.55, 2) (0.75, 2) (0.85, 0.5) (1, 0.5) | 1.282 |
| `heroi` | Herói | Normal e câmara lenta no momento | (0, 1) (0.3, 1) (0.42, 0.25) (0.7, 0.25) (0.82, 1) (1, 1) | 0.700 |
| `bala` | Bala | Muito rápido e quase parado a meio | (0, 3) (0.36, 3) (0.44, 0.15) (0.62, 0.15) (0.7, 3) (1, 3) | 2.259 |
| `flash` | Flash | Calmo e um disparo a 4× | (0, 0.6) (0.3, 0.6) (0.38, 4) (0.62, 4) (0.7, 0.6) (1, 0.6) | 1.688 |

No ffmpeg, a rampa faz-se aos bocados com `rampPieces(L, speed, fx, 0.1)`. Cada bocado tem 0,1 s no vídeo final e uma
velocidade constante. Para cada bocado: `trim=start=S0:end=S1,setpts=(PTS-STARTPTS)/V` e, no som,
`atrim=…,asetpts=…,atempo=V` (encadear `atempo` para passar de 0,5–2). No fim junta-se tudo com `concat`.

### Inverter

`reverse: true` faz o clipe tocar do fim para o início. A rampa também conta, com `L − offset`. O som original deste clipe
fica calado: não conta para a regra do som obrigatório e no ffmpeg leva `volume=0`. A imagem leva `reverse` depois do
`trim`. Na web, os frames tiram-se uma vez, 24 por segundo (`REVERSE_FPS`), com o lado maior a 960 px. O corte pode ter
até 15 s (`REVERSE_MAX_S`).

### Congelar

Congelar cria uma **foto**: o frame do ficheiro `from` no segundo `at`, sem efeitos, a jpeg 92 %. A foto leva os mesmos
filtro e ajustes e `transition: corte`. Se o ponto calhar a meio do clipe (com pelo menos 0,3 s de cada lado,
`freezeSplit`), o clipe divide-se em dois e a foto fica no meio. O segundo bocado também leva `corte`. A foto fica 2 s (ou
as batidas, ao ritmo). No ffmpeg: `trim` no frame, `loop` e `fps=30`, sem zoom.

### Fotos

Uma foto normal tem um zoom suave de 1 a 1,07 ao longo da duração dela, centrado (é o que já existia). No ffmpeg:
`zoompan=z='1+0.07*on/(D*30)':d=D*30:s=1080x1920:fps=30`, com a foto já em cover. Um frame congelado não tem zoom.

## 5. Camadas (texto e stickers)

Coordenadas: `x` e `y` são o **centro** em frações do quadro, `scale` vale 1 no tamanho natural e `rot` está em graus
(sentido dos ponteiros). `start` e `end` são segundos do vídeo final. A ordem da lista é a ordem de desenho. A assinatura
do Txillapp fica sempre por cima de tudo.

### Animações (`animState`)

As durações de entrada e de saída nunca passam de metade do tempo da camada. `p` é o progresso da entrada (0 → 1) ou da
saída (1 → 0) e `e = easeOutCubic(p)`.

| id | Nome | Efeito |
| --- | --- | --- |
| `nenhuma` | Nenhuma | — |
| `aparecer` | Aparecer | opacidade × e |
| `maquina` | Máquina de escrever | letras visíveis = ⌊n·p⌋, com cursor a piscar a 1,5 Hz |
| `subir` | Subir | y + (1−e)·140 px (a sair, sobe: −), opacidade × e |
| `pop` | Pop | escala × easeOutBack(p) (passa de 1 e volta); a sair, 0,6+0,4e; opacidade × min(1, 3p) |
| `brilho` | Brilho | opacidade × e e um brilho branco extra de (1−p) |
| `ondulacao` | Ondulação | cada letra sobe e desce sin(9t − 0,6i)·0,35·tamanho·(1−e); opacidade × min(1, 2,5p) |

Em ciclo (`loop`): `pulsar` dá escala × (1 + 0,07·sin(2π·1,2·t)) e `balancar` dá rotação + 8°·sin(2π·0,9·t), com t
contado desde `start`.

### Texto

`size` é a altura da letra em px do quadro, antes da escala, vezes o `k` da fonte. As linhas partem a 84 % da largura
(máximo 8) e a altura de linha é 1,22×. `align` alinha as linhas dentro do bloco.

- `bg`: `cheio` põe um retângulo arredondado na cor por trás de cada linha, com a letra a preto ou branco (o que contrastar mais); `suave` põe vidro escuro (8,8,12 a 55 %).
- `outline`: contorno com 0,16× o tamanho, a preto ou branco (o que contrastar com a cor).
- `shadow`: sombra rgba(0,0,0,.55), com desfoque de 0,22× e 0,05× para baixo.
- `neon`: três passagens de brilho na cor (desfoque de 0,9×, 0,32× e 0,08×) e o miolo a 70 % de branco. Não leva contorno.

| id | Nome | Família (Google Fonts) | Ficheiro |
| --- | --- | --- | --- |
| `classica` | Clássica | Inter 800 | `/fonts/estudio/inter.woff2` |
| `cartaz` | Cartaz | Bebas Neue | `/fonts/estudio/bebas.woff2` |
| `grito` | Grito | Anton | `/fonts/estudio/anton.woff2` |
| `praia` | Praia | Pacifico | `/fonts/estudio/pacifico.woff2` |
| `marcador` | Marcador | Permanent Marker | `/fonts/estudio/marker.woff2` |
| `elegante` | Elegante | Playfair Display 700 itálico | `/fonts/estudio/playfair.woff2` |
| `maquina` | Máquina | Space Mono 700 | `/fonts/estudio/spacemono.woff2` |
| `retro` | Retro | Lobster | `/fonts/estudio/lobster.woff2` |
| `mao` | À mão | Caveat 700 | `/fonts/estudio/caveat.woff2` |
| `futuro` | Futuro | Orbitron 800 | `/fonts/estudio/orbitron.woff2` |

Todas têm licença SIL Open Font License e vêm no subconjunto latino, que tem os acentos do português. O site serve-as (a
CSP só aceita fontes do Txillapp). O servidor usa o TTF da mesma família.

### Stickers

| `sticker.type` | Campos | Desenho |
| --- | --- | --- |
| `emoji` | `emoji` | 230 px na fonte de emojis do sistema (no servidor: Noto Color Emoji) |
| `txill` | `id` | um sticker do Txillapp (`lib/stickers.ts`, o SVG), 400 px de largura |
| `gif` | `id`, `url`, `w`, `h` | um GIF do GIPHY (`https://media*.giphy.com/media/…`, o mesmo que o chat aceita), 440 px de largura |
| `mention` | `username` | etiqueta `@nome` |
| `location` | `name` | etiqueta com um alfinete e o nome em maiúsculas |
| `time` | `format` (`hora`, `data`, `hora-data`) e `at` (ms) | a hora (Orbitron 120 px) e/ou a data, na hora de Moçambique (UTC+2): «22:41», «Qui, 12 nov.» |

`variant` (`branco`, `coral`, `escuro`) muda as etiquetas: fundo branco com a letra coral, gradiente coral→laranja com a
letra branca, ou vidro escuro com borda. A chave do GIPHY fica só no servidor. A app procura os GIFs por `/api/v1/gifs/*`
e as imagens vêm da CDN do GIPHY com CORS.

### Zona segura

`SAFE = { top: 0.10, right: 0.17, bottom: 0.24, left: 0.05 }` (frações do quadro). É o que fica livre do topo e das
abas, dos botões da direita (cheers, comentários, repost, guardar, partilhar) e do nome, da legenda e da música em baixo.
O estúdio mostra a zona segura e as guias (o meio do quadro, o meio da zona segura e as margens). Ao arrastar, as camadas
colam a essas guias (`snapMove`, a 1,8 %) e a rotação cola a 0°, 90°, 180° e 270° (`snapAngle`). Nada disto entra no vídeo.

### No ffmpeg

Os casos simples (texto parado ou a aparecer, sem estilos) dão-se com `drawtext` (com `fontfile`, `enable='between(t,S,E)'`
e o `alpha` da entrada e da saída) e `overlay` de PNGs (emojis e stickers). Para ficar igual em todos os casos (máquina
de escrever, ondulação, néon, pop), o caminho recomendado é desenhar a camada com `drawOverlays`
(`renderOverlays.ts`) num canvas do Node (por exemplo `@napi-rs/canvas`), com as mesmas fontes, frame a frame em RGBA
transparente, e juntá-la com `overlay=format=auto` por cima do vídeo com os efeitos e as transições. O código não usa o
DOM: as imagens dos stickers chegam pela função `image` do ambiente.

## 6. Dueto

Com um vídeo de referência, ele fica na metade esquerda (540×1920), sem efeitos, e a tcheka fica na direita. Os efeitos de
cor e a vinheta são calculados no retângulo da direita (`d` normalizado a 540×1920). As transições mexem no quadro todo e
a metade do dueto volta a ser desenhada por cima.
