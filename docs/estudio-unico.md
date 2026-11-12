# Estúdio das tchekas: «Montagem mágica» e «Capulana»

Duas coisas que só o Txillapp tem. Este documento é para o integrador (onde ligar no `TchekaStudio.tsx`) e para a montagem
no servidor (as fórmulas dos panos, para o ffmpeg + canvas do Node desenharem o mesmo).

- **Montagem mágica:** a pessoa escolhe fotos e vídeos e uma música, toca num botão e recebe a tcheka feita (melhores
  momentos, enquadramento, ordem com história, cortes ao ritmo, estilo de uma das 6 «ondas»). Depois afina na linha do tempo.
- **Capulana:** panos gerados por código (8 padrões × 6 paletas, com semente) que entram em transições, molduras, faixas de
  texto, letras e stickers. Nada vem de tecidos, marcas ou imagens reais.

Tudo corre no aparelho. Nenhum ficheiro, frame ou som sai do telemóvel e não há serviços externos.

## 1. Ficheiros

Nada disto toca no `TchekaStudio.tsx`: é tudo novo.

| Ficheiro | O que é |
| --- | --- |
| `apps/mobile/src/lib/studio/magic.ts` | O motor (puro, sem imports): frames, momentos, ponto de interesse, ordem, ritmo, ondas, `buildMontage`. |
| `apps/mobile/src/lib/studio/magicAnalyze.ts` | A análise no browser (`<img>`, `<video>`, canvas 32×56, WebAudio), com limite de tempo e cache. |
| `apps/mobile/src/lib/studio/capulana.ts` | Os panos (puro, sem imports): fórmulas, paletas, azulejo em RGBA, miniaturas em `data:` URI. |
| `apps/mobile/src/lib/studio/capulanaShapes.ts` | A geometria (pura, sem imports): transições, moldura, contornos dos stickers. |
| `apps/mobile/src/lib/studio/capulanaRender.ts` | O desenho no canvas 2D: transições, moldura, faixa, letras com pano, stickers. |
| `apps/mobile/src/components/studio/MagicButton.tsx` | O botão «Montagem mágica». |
| `apps/mobile/src/components/studio/MagicMontage.tsx` | O fluxo todo em ecrã inteiro: ondas → «a montar» → resultado. |
| `apps/mobile/src/components/studio/MagicWaves.tsx`, `MagicProgress.tsx`, `MagicResult.tsx`, `MagicPreview.tsx`, `MagicUi.tsx` | Os ecrãs e as peças do fluxo. |
| `apps/mobile/src/components/studio/CapulanaPanel.tsx`, `CapulanaPicker.tsx`, `CapulanaSwatch.tsx`, `CapulanaSticker.tsx` | O painel «Capulana», o seletor de panos, o bocado de pano e o sticker em SVG. |
| `apps/mobile/tests/studioMagic.test.mjs`, `studioCapulana.test.mjs`, `fixtures/capulana-hashes.json` | Os testes (`node --test tests/*.test.mjs`). |

Os tipos do `project.ts` e do `effects.ts` não existem no `main`, por isso o `magic.ts` repete-os com a mesma forma
(`MagicClip` = `ProjectClip`, `MagicText` = `TextOverlay`, `MagicFx` = `ClipFx` + dois campos). Depois de juntar os ramos, os
4 testes «integração:» deixam de ser saltados e conferem tudo contra os originais (já foram corridos com os ficheiros dos
três ramos: passam os 34). Se o integrador quiser, pode trocar os tipos repetidos por `import type`.

## 2. Ligar a «Montagem mágica»

### 2.1 O botão e o ecrã

Na aba «Clipes» do estúdio (e, se fizer sentido, no `new.tsx`, logo depois de escolher os ficheiros):

```tsx
import { MagicButton } from '@/components/studio/MagicButton';
import { MagicMontage } from '@/components/studio/MagicMontage';
import type { MagicResult, MagicSource } from '@/lib/studio/magic';

const [magic, setMagic] = useState(false);

<MagicButton onPress={() => { setPlaying(false); setMagic(true); }} disabled={items.length < 2 || editLocked(progress)}
  hint={items.length < 2 ? 'Junta pelo menos 2 fotos ou vídeos' : undefined} />

{magic ? (
  <View style={[StyleSheet.absoluteFill, { zIndex: 50 }]}>
    <MagicMontage
      sources={magicSources}                       // ver abaixo
      music={music ? { url: music.url, title: music.title } : null}
      capulana={CAPULANA_ON}                      // false até o passo 3 estar ligado
      onApply={(r) => { applyMagic(r); setMagic(false); }}
      onClose={() => setMagic(false)}
      topInset={insets.top} bottomInset={insets.bottom}
    />
  </View>
) : null}
```

`sources` são os clipes do estúdio, um por ficheiro (clipes divididos ou duplicados do mesmo `media` contam uma vez):

```ts
const magicSources: MagicSource[] = useMemo(() => {
  const seen = new Set<string>();
  return items.filter((c) => !seen.has(c.media) && seen.add(c.media) && !(c.fx as ClipFx | undefined)?.freeze)
    .map((c) => ({ key: c.key, media: c.media, uri: c.uri, video: c.video, mime: c.mime, durationMs: c.durationMs, speed: c.speed }));
}, [items]);
```

`music.url` é o URL que o estúdio já toca (o mesmo que vai para o `beatsFrom`): a análise faz `fetch` + `decodeAudioData`
dele. Sem música, a montagem faz-se a 120 BPM. O `MagicMontage` é só o conteúdo (`flex: 1`): quem o mostra decide onde.

### 2.2 Aplicar o resultado («Afinar»)

O `MagicResult` traz os clipes no formato do `project.ts`. Um só passo no histórico, para «Desfazer» voltar ao que estava:

```ts
import { normalizeClips } from '@/lib/studio/project';
import { sanitizeFx, sanitizeOverlay } from '@/lib/studio/effects';
import { clampFade, isSfx } from '@/lib/studio/audioDsp';

function applyMagic(r: MagicResult) {
  const before = new Map(items.map((c) => [c.key, c]));
  // As chaves são as das fontes: o que o estúdio guarda a mais em cada clipe (campos do makeItem) fica como estava.
  const clips = normalizeClips(r.clips.map((c) => ({ ...before.get(c.key), ...c, fx: sanitizeFx(c.fx) })));
  setItems(() => clips as Item[]);
  setRhythm(false);                               // as durações já caem nas batidas (ver 2.3)
  setOverlays((o) => [...o.filter((x) => !x.id.startsWith('magica-')), ...r.overlays.map(sanitizeOverlay).filter((x): x is Overlay => !!x)]);
  if (r.music) {
    setMix((m) => ({
      ...m, musicStartMs: r.music!.startMs, musicStartAuto: false, fadeIn: clampFade(r.music!.fadeIn), fadeOut: clampFade(r.music!.fadeOut),
      sfx: r.sfx.filter((s) => isSfx(s.id)).map((s, i) => ({ key: `magica-${i}`, id: s.id as SfxId, at: s.at })),
    }));
  }
  setSelKey(clips[0]?.key ?? null);
  setTab('clipes');
  restartFrom.current = 0;                        // a pré-visualização recomeça do início
  if (r.left.length) setNote(`${r.left.length} ficheiros não couberam nos 60 s`);
}
```

O que cada campo quer dizer:

- `r.clips[i]`: `trim` (vídeos: o melhor momento, já com a duração certa), `seconds` e `beats` (fotos), `speed`, e `fx` com
  `filter`, `transition`, `ramp` (ids do `effects.ts`).
- `r.durations` / `r.starts` / `r.total`: o que cada clipe dura na tcheka. Para os vídeos é igual a
  `fxSeconds(trim.end - trim.start, speed, fx)` (um teste confirma).
- `r.overlays`: o texto de abertura sugerido pela onda (um `TextOverlay`, id `magica-<semente>`), fora da cara do primeiro
  plano e dentro da zona segura.
- `r.music`: onde começa o trecho (`startMs`, já acertado para uma batida cair no 0 da tcheka), o andamento e os fades.
- `r.sfx`: os efeitos sonoros da onda (ids do `audioDsp.ts`) e quando entram.
- `r.story`: porque é que cada plano está onde está (só para o ecrã do resultado).
- `r.left`: as chaves dos ficheiros que não couberam (acima de 58 s).

### 2.3 O ritmo

A montagem põe a batida 0 no 0 da tcheka (mexe no `musicStartMs`) e dá a cada clipe um número inteiro de batidas: as fotos
ficam com `seconds = beats × batida`, os vídeos com um corte de `batidas × batida × speed × média da rampa` segundos. Por
isso os cortes já caem nas batidas com o modo «ao ritmo» **desligado** (`setRhythm(false)`), que é o mais seguro.
Com o modo ligado dá o mesmo desde que o estúdio detete as batidas a partir do `musicStartMs` novo (o teste «ritmo» confere
com o `rhythmDurations` das regras). Em músicas acima de 143 BPM a batida conta de duas em duas (`beatUnit`).

### 2.4 O que o `effects.ts` e o desenho ainda não sabem (para ficar completo)

A montagem escreve mais dois campos no `fx` de cada clipe. Enquanto o `sanitizeFx` não os conhecer, perdem-se sem estragar
nada (a foto fica com o zoom ao centro de sempre).

1. **`fx.focus`: o ponto de interesse e o zoom lento.** `{ x, y, from, to, keep? }` (frações da foto; `keep` é a caixa da
   cara, que nunca se corta). Acrescentar ao `ClipFx` e ao `sanitizeFx`:

   ```ts
   focus?: { x: number; y: number; from: number; to: number; keep?: { x0: number; y0: number; x1: number; y1: number } };
   // no sanitizeFx:
   const fo = o.focus as Record<string, unknown> | undefined;
   if (fo && typeof fo === 'object') out.focus = { x: r4(num(fo.x, 0.5, 0, 1)), y: r4(num(fo.y, 0.5, 0, 1)), from: r3(num(fo.from, 1, 1, 1.5)), to: r3(num(fo.to, 1.07, 1, 1.5)), ...(keepBox(fo.keep) ? { keep: keepBox(fo.keep) } : {}) };
   ```

   No `drawBase`, em vez do zoom fixo de 7 % ao centro, pedir o retângulo da fonte ao `coverRect` do `magic.ts`
   (devolve `{ sx, sy, sw, sh }` em px da foto, sempre 9:16, sempre dentro dela e com a cara lá dentro):

   ```ts
   import { coverRect } from '@/lib/studio/magic';
   const u = Math.min(1, tl / Math.max(0.1, s.dur));
   const crop = fx?.focus ? coverRect(img.naturalWidth, img.naturalHeight, fx.focus, u, to.w, to.h) : null;
   // drawClip(…) ganha um parâmetro opcional `crop` que substitui o `coverCrop(sw, sh, to.w, to.h, zoom)`.
   ```

   Nos vídeos que não são 9:16 a montagem só põe `focus` quando a análise deu um ponto de interesse (hoje só as fotos têm).

2. **`fx.moldura`: a foto vai inteira, com moldura de capulana** (ver 3.3). Só aparece com `capulana` ligado.

E, com `capulana={true}`, a montagem usa também `fx.transition = { type: 'capulana-…', dur, pano }` e `overlay.pano`
(ver 3). Com `capulana={false}` (o valor por omissão) só usa ids que o `effects.ts` já tem: pode ligar-se já.

### 2.5 No nativo

A análise precisa de `<img>`, `<video>`, canvas e WebAudio. Sem `document` (no nativo), `analyzeSources` devolve valores
neutros e `analyzeMusic` devolve `null`: a montagem faz-se na mesma (ordem dos ficheiros, vídeos do início, 120 BPM), mas sem
«olhar» para nada, e o `MagicPreview` mostra só a primeira foto. O estúdio de canvas é da web; ver «Por fazer».

### 2.6 Tempo

Num portátil, 3 fotos + 2 vídeos + música ficam prontos em 2,3 a 2,7 s, dos quais 2,1 s são as pausas mínimas das 5 fases
(420 ms cada, para se lerem). Limites: 5 s para ver os ficheiros (cada vídeo fica com `10 s / n.º de vídeos`, entre 0,7 e
2,5 s, dois de cada vez; amostra-se do geral para o pormenor, por isso quando o tempo acaba já há uma ideia do vídeo todo),
sons de vídeos acima de 24 MB não se descodificam (fica só a imagem) e a música descodifica-se para mono a 11 kHz (chega para a energia e as batidas). O que se mediu
fica em cache por ficheiro: «Outra versão» e mudar de onda são imediatos. `clearMagicCache()` ao fechar o estúdio.

## 3. Ligar a «Capulana»

Um pano é `{ pattern, palette, seed }` (`CapulanaSpec`). `sanitizeCapulana(x)` limpa um pano lido de um rascunho.

### 3.1 O painel

```tsx
import { CapulanaPanel } from '@/components/studio/CapulanaPanel';

<CapulanaPanel
  pano={pano} onPano={setPano}                                   // o pano «da tcheka» (estado do estúdio; entra no rascunho)
  transition={isCapulanaTransition(selFx?.transition?.type) ? selFx.transition.type : null}
  onTransition={(id) => setFx(selKey, { transition: id ? { type: id, dur: 0.7, pano } : undefined })}
  frame={!!selFx?.moldura} canFrame={!!sel && !sel.video}
  onFrame={(on) => setFx(selKey, { moldura: on ? pano : undefined })}
  onBand={() => addOverlay({ ...newText(nowT(), total, 'O teu texto'), bg: 'pano', pano })}
  onText={() => addOverlay({ ...newText(nowT(), total, 'TXILL'), pano })}
  onSticker={(shape) => addOverlay(newSticker({ type: 'capulana', shape, pano }, nowT(), total))}
/>
```

Fica bem como mais uma aba do estúdio («Capulana») ou dentro da aba dos efeitos. As miniaturas são imagens (`data:` URI em
BMP, geradas pelo `capulanaDataUri`), por isso o seletor funciona na web e no nativo sem canvas.

### 3.2 Transições de capulana

Cinco: `capulana-deslizar` («Pano»), `capulana-desenrolar`, `capulana-rasgar`, `capulana-losango`, `capulana-vento`.

No `effects.ts`: juntar os ids ao `TransitionId` e ao `TRANSITIONS` (os nomes e o `xfade` mais parecido estão em
`CAPULANA_TRANSITIONS`, com `exact: false`), e o pano à transição:

```ts
export interface ClipTransition { type: TransitionId; dur: number; pano?: CapulanaSpec }
// no sanitizeFx, depois de validar o tipo:  const pano = sanitizeCapulana(t.pano); if (pano) out.transition.pano = pano;
// no transitionFor: devolver também o `pano` ( { type: t.type, dur, ...(t.pano ? { pano: t.pano } : {}) } ).
```

No `drawFrame` do estúdio, a mesma chamada de hoje com um ramo a mais (o formato é o do `drawTransition`: o último frame do
clipe anterior parado, o frame de agora do que entra e `p` de 0 a 1):

```ts
import { drawCapulanaTransition } from '@/lib/studio/capulanaRender';
import { isCapulanaTransition } from '@/lib/studio/capulanaShapes';

if (isCapulanaTransition(tr.type)) drawCapulanaTransition(g, e.last, cur.c, tr.type, tl / tr.dur, W, H, tr.pano ?? pano);
else drawTransition(g, e.last, cur.c, tr.type, tl / tr.dur, W, H, scratch);
```

### 3.3 Molduras e fundos

Para fotos mais largas do que 9:16 (`needsFrame(iw, ih)`), em vez do corte ou do fundo desfocado. No `drawBase`, nas fotos:

```ts
import { drawCapulanaFrame } from '@/lib/studio/capulanaRender';

if (fx?.moldura) {
  // Para o filtro e os ajustes também apanharem a foto: desenhá-la primeiro com o drawClip num canvas de trabalho do
  // tamanho dela e passar esse canvas; sem filtro, pode ir a imagem direta.
  const zoom = fx.focus ? fx.focus.from + (fx.focus.to - fx.focus.from) * u : 1 + 0.04 * u;
  drawCapulanaFrame(g, img, img.naturalWidth, img.naturalHeight, W, H, fx.moldura, zoom, fx.focus);
} else drawClip(…);
```

`drawCapulanaBackdrop(g, pano, W, H)` é só o fundo (para vídeos deitados, por exemplo, com o vídeo por cima em «contain»).

### 3.4 Letras com pano, faixas e stickers

No `effects.ts`: `TextOverlay` ganha `pano?: CapulanaSpec` e o valor `bg: 'pano'` (a faixa); `StickerContent` ganha
`{ type: 'capulana'; shape: CapulanaShapeId; pano: CapulanaSpec }`. No `sanitizeOverlay`/`sanitizeSticker`:
`sanitizeCapulana` e `isCapulanaShape`.

No `renderOverlays.ts`, dentro do `drawOverlays` (o contexto já está transladado para o centro da camada e à escala dela):

```ts
// Texto: as letras cheias com o pano (em vez do fillText de cada linha do drawText).
if (o.kind === 'text' && o.pano && o.bg !== 'pano') drawCapulanaText(g, L.lines.join('\n'), o.pano, { x: 0, y: 0, size: o.size, font: fontCss(o.font, o.size), scratch: env.scratch, alpha: 1 });

// Faixa: de lado a lado do quadro, à altura do texto; desenha-se antes de rodar/escalar (em coordenadas do quadro).
if (o.kind === 'text' && o.bg === 'pano' && o.pano) drawCapulanaBand(g0, o.pano, env.W, { y: o.y * env.H + f.dy, h: o.size * 2.6 * o.scale, text: o.text, font: fontCss(o.font, 0).replace(/\d+px/, '{size}px'), open: f.alpha });

// Sticker: raio de 180 px no quadro de 1080 (antes da escala).
case 'capulana': return { size: { w: 396, h: 396 }, draw: (g) => drawCapulanaSticker(g, o.sticker.shape, o.sticker.pano, 0, 0, 180) };
```

O `OverlayEnv` precisa de um `scratch` (o mesmo `Scratch` do `renderTransitions.ts`) para as letras com pano. No palco de
edição (`FxStage`, em DOM), o sticker é `<CapulanaSticker shape pano size />` (SVG, as mesmas medidas) e o pano do texto pode
ser um `<CapulanaSwatch>` com `background-clip: text` na web.

### 3.5 Desempenho

O azulejo (256×256, 3×3 amostras por pixel) gera-se uma vez por pano (uns 20 ms) e fica num `OffscreenCanvas` (ou num
`<canvas>`), até 24 em cache; cada frame de transição é um `createPattern` + um `clip` + meia dúzia de `fill`. Não usa
`shadowBlur` nem `filter`. `clearCapulanaCache()` ao fechar o estúdio.

## 4. As fórmulas (para o servidor)

O `capulana.ts` e o `capulanaShapes.ts` não importam nada e correm no Node tal e qual: o caminho mais seguro é o servidor ter
uma **cópia fiel** dos dois (como `audioDsp.ts` ↔ `apps/api/src/compose/audio.ts`, com um spec a comparar). O
`capulanaRender.ts` só usa o canvas 2D: com `setCapulanaCanvasFactory((w, h) => createCanvas(w, h))` desenha num canvas do
Node. Para quem quiser reescrever, fica aqui tudo.

### 4.1 Números com semente

`mulberry32(seed)` (32 bits, igual no `magic.ts`):

```
a = (a + 0x6D2B79F5) mod 2^32;  t = a
t = imul(t XOR (t >>> 15), t OR 1)
t = t XOR (t + imul(t XOR (t >>> 7), t OR 61))
devolve ((t XOR (t >>> 14)) >>> 0) / 2^32
```

`mulberry32(1)()` = `0.6270739405881613` (está num teste).

### 4.2 Os parâmetros de um pano

`r = mulberry32((semente mod 1 000 000) × 8 + índice do padrão)`, com os padrões pela ordem `losangos, ziguezague, circulos,
flores, faixas, escamas, sol, degraus` (índices 0 a 7). Três tiragens, por esta ordem:

1. a ordem das cores: `ORDERS[floor(r() × 6)]` com `ORDERS = [1,2,3], [1,3,2], [2,1,3], [2,3,1], [3,1,2], [3,2,1]` → `(a, b, c)`;
2. `n` (quantos motivos cabem no azulejo, para cada lado): `ns[floor(r() × ns.length)]`;
3. `k` (o pormenor): `ks[floor(r() × ks.length)]`.

| Padrão | `ns` | `ks` | `k` é |
| --- | --- | --- | --- |
| losangos | 2, 3, 4 | 0, 1 | se o miolo é linha (1) ou cor (0) |
| ziguezague | 2, 3, 4 | 2, 3, 4 | quantas ondas em altura |
| circulos | 2, 3 | 4, 5, 6 | quantos anéis |
| flores | 2, 3 | 5, 6, 8 | quantas pétalas |
| faixas | 1, 2 | 4, 6, 8 | quantos triângulos em altura |
| escamas | 2, 3 | 0, 1 | se há terceira cor (1) |
| sol | 1, 2 | 8, 12, 16 | quantos raios (metade acesos) |
| degraus | 2, 3 | 4, 5, 6 | quantos degraus |

### 4.3 As paletas

`[fundo, forte, claro, acento, linha]` (índices 0 a 4; `F` = 0 e `L` = 4 nas fórmulas):

| Paleta | 0 fundo | 1 forte | 2 claro | 3 acento | 4 linha |
| --- | --- | --- | --- | --- | --- |
| coral | `#3a0b17` | `#d6334f` | `#ffd9c7` | `#ff8a5c` | `#fff6ef` |
| marginal | `#2b0f2e` | `#f26a3d` | `#ffc247` | `#d6334f` | `#fff3e0` |
| indico | `#07243b` | `#0fa3b1` | `#f7f3e3` | `#ff8a5c` | `#ffd60a` |
| machamba | `#17301c` | `#3f8f4a` | `#f0b400` | `#c8452b` | `#f6ecd2` |
| mafalala | `#141414` | `#f4f1ea` | `#d6334f` | `#e9b23a` | `#8a8a8a` |
| neon | `#0d0b2a` | `#7a5cff` | `#ff4fd8` | `#2ec5ff` | `#f5f3ff` |

### 4.4 A cor de cada ponto

`(u, v)` de 0 a 1 no azulejo (repete-se de 1 em 1). `frac(x) = x − floor(x)`. Em todos:

```
cu = frac(u)·n   cv = frac(v)·n   ix = floor(cu)   iy = floor(cv)
x = cu − ix − ½   y = cv − iy − ½        (a posição dentro da célula, de −½ a ½)
par = (ix + iy) é par
```

As condições leem-se de cima para baixo; ganha a primeira que for verdade.

**losangos** — `d = 2·(|x| + |y|)`
- `d < 0,20` → `k ? L : c` · `d < 0,48` → `k ? c : L` · `d < 0,78` → `par ? a : b` · `d < 0,90` → `L` · `d < 1` → `F`
- senão (os cantos): `2 − d < 0,20` → `c`, senão `F`

**ziguezague** — `tri = |2·frac(frac(u)·n) − 1|`, `t = frac(frac(v)·k + 0,5·tri)`
- `t < 0,30` → `a` · `< 0,36` → `L` · `< 0,60` → `b` · `< 0,66` → `L` · `< 0,84` → `c` · senão `F`

**circulos** — `r = 2·hypot(x, y)`
- `r < 1` → `[c, L, a, F, b, L][(floor(r·k) + (par ? 0 : 2)) mod 6]`
- senão (os cantos): `r2 = 2·hypot(|x| − ½, |y| − ½)`; `r2 < 0,26` → `c` · `r2 < 0,36` → `L` · senão `F`

**flores** — `r = 2·hypot(x, y)`, `R = 0,42 + 0,44·|cos(k·atan2(y, x) / 2)|`
- `r < 0,15` → `c` · `r < 0,22` → `L` · `r < R − 0,07` → `par ? a : b` · `r < R` → `L`
- senão: `dd = 2·(||x| − ½| + ||y| − ½|)`; `dd < 0,20` → `c`, senão `F`

**faixas** — `s = cu − ix` (0 a 1 ao longo da faixa), `yy = frac(frac(v)·k)`
- `s < 0,12` → `a` · `s < 0,16` → `L`
- `s < 0,44` → triângulos: `|yy − ½|·2 < (s − 0,16)/0,28` → `b`, senão `F`
- `s < 0,48` → `L` · `s < 0,60` → `c` · `s < 0,64` → `L`
- `s < 0,92` → contas: `d = |(s − 0,64)/0,28 − ½|·2 + |yy − ½|·2`; `d < 0,30` → `L` · `d < 0,82` → `a` · senão `F`
- `s < 0,96` → `L` · senão `b`

**escamas** — filas a cada ¼ de célula: `rows = 4·n`, `fv = frac(v)·rows`, `j = floor(fv)`, `yy = (fv − j)·0,25`.
Para `q = 0, 1, 2` (a fila de baixo fica por cima; ganha a primeira escama que contiver o ponto):
- `row = j − q`; `xx = frac(cu + (row ímpar ? ½ : 0)) − ½`; `d = 2·hypot(xx, yy + q·0,25)`; se `d ≥ 1`, passa à seguinte
- `d > 0,88` → `L` · `d > 0,58` → `[a, b, (k ? c : a), b][row mod 4]` · `d > 0,48` → `L` · senão `F`

Se nenhuma contiver o ponto: `F`. (`row mod 4` e «ímpar» são sempre positivos: `((row % 4) + 4) % 4`.)

**sol** — `r = 2·hypot(x, y)`
- `r < 0,20` → `c` · `r < 0,27` → `L`
- `r < 0,90` → `raio = floor((atan2(y, x)/(2π) + 1)·k)` é par → `a`; senão `r < 0,58` → `b`, senão `F`
- `r < 0,96` → `L` · senão: `2·hypot(|x| − ½, |y| − ½) < 0,24` → `b`, senão `F`

**degraus** — `s = floor(|x|·2k) + floor(|y|·2k)`
- `s ≥ k` → `F` · `s = k − 1` → `L` · senão `[c, (par ? a : b), L, (par ? b : a)][s mod 4]`

### 4.5 O azulejo em pixels

`capulanaTile(pano, size = 256, ss = 3)`: para cada pixel `(px, py)`, a média (em RGB, arredondada) das `ss × ss` amostras
em `u = (px + (i + ½)/ss)/size`, `v = (py + (j + ½)/ss)/size`. Opaco. O `pixelsHash` (FNV-1a de 32 bits sobre os bytes
RGBA) serve para conferir; os de referência (paleta `coral`, semente 1, `size` 64, `ss` 2) estão em
`apps/mobile/tests/fixtures/capulana-hashes.json`:

```
losangos d30b4445 · ziguezague 93323fc5 · circulos 6a2afb65 · flores 2d0f969d
faixas 2179d0ad · escamas b3bbdb65 · sol 00c5cedd · degraus ab9f1165
```

### 4.6 O pano no quadro

No quadro de `W` px de largura o azulejo tem `round(W / 3)` px de lado (três motivos de lado a lado: 360 px em 1080) e
repete-se a partir do canto de cima à esquerda, deslocado `shift` (o pano anda com a transição). Por cima vão as dobras: um
gradiente horizontal que se repete de `2,2 × azulejo` em `2,2 × azulejo` px, a começar em `−span + ((0,6·shift.x) mod span)`,
com as paragens `0: preto 20 %`, `0,30: nada`, `0,55: branco 9 %`, `0,75: nada`, `1: preto 20 %`.

### 4.7 As transições

`panoShape(tipo, p, W, H)` dá os polígonos: `base` (o que fica por baixo: o clipe anterior ou já o seguinte), `reveal` (onde
já se vê o seguinte), `cloth` (o pano, regra `evenodd`), `hems` (as bainhas), `rolls` (os rolos) e `shift`. A ordem do desenho:
a base → o seguinte recortado por `reveal` → a sombra (as bainhas a preto, `0,06·W` de grossura a 14 % e `0,03·W` a 18 %) →
o pano recortado por `cloth` com as dobras → as bainhas (`0,014·W` na cor 4 e `0,004·W` na cor 0) → os rolos.
`e(x)` é a `easeInOutCubic` cortada a [0, 1]; `tri(x) = |2·frac(x) − 1|`.

| Transição | Geometria |
| --- | --- |
| `capulana-deslizar` | Faixa vertical de `0,62·W` que atravessa da esquerda para a direita: frente em `c = −A + (W + 0,62·W + 2A)·e(p)`, traseira em `c − 0,62·W`, com `A = 0,022·W`. Franja: 44 troços em altura, os pontos ímpares avançam `A`. À esquerda da traseira vê-se o seguinte. `shift = (c, 0)`. |
| `capulana-vento` | Faixa de `0,7·W` inclinada (`0,35·W` de cima a baixo) e a ondular: frente em `x(y) = c − 0,35·W·(y/H) + amp·sin(2π·(1,5·y/H + 1,2·p))`, traseira `0,7·W + amp` atrás; `amp = 0,035·W`, `c = −amp + (W + 0,35·W + 0,7·W + 4·amp)·e(p)`. 32 troços em altura. `shift = (c, 0)`. |
| `capulana-desenrolar` | De cima para baixo, com rolos de `0,05·H`: frente em `y1 = −rolo + (H + 2·rolo)·e(p/0,62)`, traseira em `y0 = −rolo + (H + 2·rolo)·e((p − 0,38)/0,62)`. Pano entre `y0` e `y1`; acima de `y0` vê-se o seguinte. Um rolo centrado em cada borda (o pano encolhido a 40 % na vertical e um gradiente de cilindro). `shift = (0, 0)`. |
| `capulana-losango` | Dois losangos ao centro com «raio» `2,06·e(p/0,75)` (o de fora) e `2,06·e((p − 0,25)/0,75)` (o de dentro); raio 1 = meia largura e meia altura. O pano é o anel entre os dois; dentro do de dentro vê-se o seguinte. |
| `capulana-rasgar` | Dois panos fecham dos lados e voltam a abrir: `k = e(p/0,45)` até `p = 0,5`, depois `1 − e((p − 0,55)/0,45)`. Bordas em ziguezague `z(y) = A·(2·tri(9·y/H) − 1)`, `A = 0,06·W`: a esquerda em `−A + k·(W/2 + A) + z(y)`, a direita em `W + A − k·(W/2 + A) + z(y)` (encaixam uma na outra). Por baixo: o anterior até `p = 0,5`, o seguinte depois (entre 0,45 e 0,55 está tudo tapado). |

`panoCoverage(tipo, p)` diz que parte do quadro mostra cada coisa: serve para o servidor conferir a implementação dele
(em `p = 0` só o anterior, em `p = 1` só o seguinte, o seguinte só cresce).

No ffmpeg puro (sem canvas) não há pano: o `xfade` mais parecido de cada uma está em `CAPULANA_TRANSITIONS[i].ffmpeg`
(`wipeleft`, `wipedown`, `horzopen`, `diagtl`, `wipetl`). Para ficar igual, o servidor desenha os frames da transição no
canvas do Node com o `drawCapulanaTransition` e junta-os como um troço de vídeo (como já está previsto para as transições
`exact: false` no `docs/estudio-efeitos.md`).

### 4.8 A moldura, a faixa, as letras e os stickers

- **Moldura** (`frameLayout(iw, ih, W, H)`): a foto inteira, o maior possível dentro de `0,86·W × 0,62·H`, centrada na
  largura e com o centro a `0,46·H`. À volta: margem de `round(0,016·W)` na cor 4, fio de `round(0,005·W)` na cor 0, cantos de
  `round(0,012·W)`. Fundo: o pano em todo o quadro e, por cima, um gradiente radial preto centrado em `(W/2, 0,46·H)`, de
  `0,2·W` (18,7 %) a `0,72·H` (64,6 %). Sombra: 8 retângulos arredondados pretos a 5,5 %, cada um `0,005·W` maior, descidos.
- **Faixa** (`drawCapulanaBand`): altura `h`, azulejo de `h/2`; a meio, uma placa na cor 0 com 58 % da altura; fios na cor 4
  (`0,022·h`) a fechar a placa e as bordas; texto na cor 4, centrado, com `0,34·h` de altura (encolhe até caber em 88 % da
  largura).
- **Letras** (`drawCapulanaText`): três contornos (preto a 35 % com `0,30 × tamanho`, descido `0,05`; cor 0 com `0,20`; cor 4
  com `0,085`) e, por cima, as letras cheias com o pano (azulejo de `0,9 × tamanho`, 48 px no mínimo), a partir do canto de
  cima à esquerda da caixa do texto.
- **Stickers** (`stickerOutline(forma, r)`): `circulo` (64 pontos), `losango` (largura 0,78), `estrela` (10 pontos, raio de
  dentro 0,46), `selo` (96 pontos, `0,93 + 0,07·cos(12θ)`) e `coracao` (64 pontos da curva
  `x = 16·sin³t`, `y = −(13·cos t − 5·cos 2t − 2·cos 3t − cos 4t)`, com `x/18,5` e `(y − 2,5)/18,5`). Margem branca de
  `0,18·r`, sombra de `0,24·r` descida `0,05·r`, pano com azulejo de `0,9·r` e fio de `0,025·r` na cor 0.

## 5. Como a montagem decide (resumo)

- **Frames:** cada foto e cada amostra de vídeo é reduzida a 32×56. Mede-se a luz, a nitidez (laplaciano), a saturação e,
  entre amostras, o movimento (diferença média) e por quantos blocos de 8×8 ele se espalha.
- **Momentos:** a nota de cada amostra é `(0,12 + 0,88·vida) × luz × nitidez × (1 − 0,8·tremido)`, com
  `vida = 0,42·movimento + 0,26·nitidez + 0,32·som` (tudo em relação ao melhor que o próprio vídeo tem). Tremido = quase
  todos os blocos a mexer com muito movimento; escuro = luz abaixo de 0,07. Escolhe-se a janela com melhor média.
- **Fotos:** saliência = quanto a cor foge da média + contorno, com preferência pelo centro; com pele (YCbCr, tons claros e
  escuros) junta e em quantidade de cara (2 a 35 % da foto), o ponto e a caixa são os da pele. Se a cara não cabe no corte
  9:16, a foto vai inteira na moldura.
- **Ordem:** o mais forte abre, o mais calmo fecha; pelo meio vai-se sempre para o plano mais parecido na cor e na luz, de
  preferência do outro tipo (foto/vídeo). Depois, os vídeos mais vivos trocam para os sítios onde a música é mais forte.
- **Ritmo:** cada clipe dura um número inteiro de batidas; nas partes fortes da música (acima do percentil 65 da energia)
  as fotos ficam menos batidas e as transições são as «fortes» da onda. O instante mais vivo de cada vídeo cai na batida
  mais forte dentro do clipe ou, com rampa, no abrandamento dela.
- **Semente:** muda os empates da ordem, o momento (entre os quase tão bons), as transições, o texto e o pano. Os clipes
  trancados ficam na posição e exatamente como estavam.

## 6. Testes e laboratório

Em `apps/mobile`: `node --test tests/*.test.mjs` e `npx tsc --noEmit -p .`.

As capturas (390×844) estão em `_capturas/` na raiz do worktree (fora do git), e o laboratório que as fez em
`_capturas/lab/` (uma página com `esbuild` + `react-native-web`, sem Metro): `node build.mjs` e `node shots.mjs`.

## 7. Por fazer

- Ligar tudo no `TchekaStudio.tsx` (passos 2 e 3) e os campos novos no `effects.ts` (`focus`, `moldura`, `transition.pano`,
  `overlay.pano`, `bg: 'pano'`, sticker `capulana`), no contrato JSON e no `docs/estudio-efeitos.md`.
- A montagem no servidor: copiar `capulana.ts` e `capulanaShapes.ts` para `apps/api/src/compose/` com um spec de sincronia, e
  desenhar as transições, molduras, letras e stickers no canvas do Node.
- A análise no nativo (sem `<video>`/canvas): amostrar frames com `expo-video` ou no servidor. Hoje, no nativo, a montagem
  faz-se sem «olhar» para os ficheiros.
- A deteção é de pele, não de caras: uma cara que encha mais de 35 % da foto, ou pele ao lado de areia ou madeira da mesma
  cor, é tratada como paisagem (aponta ao contraste, sem a garantia de não cortar). Um detetor de caras a sério
  (`FaceDetector` do browser, quando houver) pode dar a caixa `keep` com mais certeza.
- O `MagicPreview` é uma pré-visualização leve: mostra os cortes, o zoom, as molduras, o pano e o texto, com os filtros
  aproximados em CSS e sem rampas nem efeitos sonoros. A imagem fiel é a do estúdio, depois de «Afinar».
- Os vídeos não têm ponto de interesse (ficam cortados ao centro, como hoje).
- Ajuda, Definições e Termos: dizer que a montagem mágica analisa as fotos, os vídeos e a música no aparelho e não envia
  nada (para o guardião das políticas, quando isto for publicado).
