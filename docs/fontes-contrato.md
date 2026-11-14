# Fontes ao publicar: contrato da API

«Deve ter fontes também ao postar. Os textos, etc.» As 10 letras do estúdio das tchekas passam a servir também para:

- os **textos por cima dos mimos** (stories);
- a **letra das publicações só com texto**;
- a **letra da legenda do Zás**.

Migração: `apps/api/migrations/0151_fontes.sql`.

## 1. As fontes

`@txillapp/shared` (`packages/shared/src/fonts.ts`):

```ts
export const TEXT_FONT_IDS = ['classica', 'cartaz', 'grito', 'praia', 'marcador', 'elegante', 'maquina', 'retro', 'mao', 'futuro'] as const;
export type TextFontId = (typeof TEXT_FONT_IDS)[number];
export const DEFAULT_TEXT_FONT: TextFontId = 'classica';
export function isTextFontId(v: unknown): v is TextFontId;
export function textFontOf(v: unknown): TextFontId; // desconhecida ou em falta → 'classica'
```

São as mesmas, e pela mesma ordem, de `FONTS` em `apps/mobile/src/lib/studio/effects.ts` (há um teste a confirmar:
`apps/api/src/stories/text-layer.spec.ts`). As famílias, os pesos e os ficheiros estão em `docs/estudio-efeitos.md`.

**Regras:**

- **À entrada** (POST/PATCH), um id que não esteja na lista dá **400**.
- **À saída**, um id guardado que já não exista lê-se como `'classica'`. `null` quer dizer «sem escolha», e a app mostra a
  letra de sempre.

## 2. Textos por cima dos mimos

Não há coluna nova. Os textos vão na lista `stickers` do mimo (`content.stories.stickers`), ao lado dos stickers de emoji e
pela ordem em que se desenham (o último fica por cima).

```ts
type PlacedSticker = { id: string; x: number; y: number; s: number; r: number };   // como sempre, sem `kind`
type TextLayer = {
  kind: 'text';
  text: string;                       // 1–150 carateres depois de aparar; até 6 linhas (\n)
  font: TextFontId;                   // por omissão 'classica'
  color: string;                      // '#rrggbb'; por omissão '#ffffff'
  bg: 'none' | 'solid' | 'soft';      // por omissão 'none'
  align: 'left' | 'center' | 'right'; // por omissão 'center'
  x: number; y: number; s: number; r: number;
};
stickers: (PlacedSticker | TextLayer)[]
```

### O que cada campo quer dizer

- **`x`, `y`, `s`, `r`**: o mesmo que nos stickers.
  - `x`/`y`: o centro da caixa, em fração da largura e da altura do ecrã, de −0,5 a 1,5.
  - `s`: a **largura da caixa toda** (com o fundo e as margens), em fração da largura do ecrã, de 0,05 a 1,6.
  - `r`: a rotação em graus à volta do centro, de −3600 a 3600.
- **`text`**:
  - o servidor apara-o e troca `\r\n` por `\n`;
  - **não volta a partir as linhas**: o texto deve chegar já partido como aparece na app;
  - carateres de controlo dão 400 (só se aceita `\n`);
  - os 150 carateres contam-se por pontos de código, por isso um emoji conta 1.
- **Fundo:**

  | `bg`    | Caixa                                         | Letras                                                             |
  |---------|-----------------------------------------------|--------------------------------------------------------------------|
  | `none`  | sem caixa                                     | na `color`, com uma sombra suave                                   |
  | `solid` | caixa de cantos redondos na `color`           | `#111111` ou `#ffffff`, o que se lê melhor (`contrastOn` do estúdio) |
  | `soft`  | caixa de cantos redondos em `rgba(0,0,0,0.5)` | na `color`                                                         |

### Validação

**Stickers de emoji:**

- objetos sem `kind`, tal como até agora;
- qualquer objeto com `kind` é um texto ou é inválido: nunca é lido como sticker.

**Limites por mimo:** até **10 textos** e até **12 stickers**, contados à parte.

**Erros:**

- **400**: um texto ou um sticker inválido, ou passar algum dos limites. É como já acontecia com os stickers.
- **422**: o texto não passa no filtro das legendas (`TextFilter.assertClean`).

**Onde se aplica:**

- `POST /stories`;
- `POST /stories/share`;
- os mimos guardados à espera da revisão (`held_publications`), que usam o mesmo esquema.

As respostas devolvem a lista **igual à guardada**, com os valores por omissão já preenchidos. Um mimo sem nada traz
`stickers: []`.

### A caixa: como se calcula

`apps/api/src/stories/text-layer.ts` (`layoutTextLayer`) faz a conta sem desenhar nada, e a app deve seguir a mesma.
Mede-se tudo com a letra a `BASE = 100` px:

1. `linhas = text.split('\n')`, e `largura[i]` = a largura medida de cada linha (uma linha vazia mede 0).
2. Margens:
   - sem fundo: `padX = 0.12·BASE` e `padY = 0.06·BASE`;
   - com fundo: `padX = 0.40·BASE` e `padY = 0.22·BASE`.
3. Altura de cada linha: `lh = 1.22·BASE`.
4. Tamanho natural da caixa:
   - `natW = max(0.6·BASE, max(largura)) + 2·padX`;
   - `natH = nLinhas·lh + 2·padY`.
5. Escala: `k = s·W / natW`. Tudo se multiplica por `k`: a letra fica com `BASE·k` px e a caixa com `natW·k × natH·k`.
6. Cada linha:
   - o meio da linha fica a `padY + lh·(i + 0.5)` do topo da caixa;
   - a esquerda do texto fica em `padX` (`left`), em `natW − padX − largura` (`right`) ou em `(natW − largura)/2` (`center`).
7. Cantos da caixa: raio `0.3·BASE·k` (só com fundo).
8. A caixa fica centrada em `(x·W, y·H)` e roda `r` graus à volta desse centro.

### Cópias guardadas

A cópia que o dono guarda (`GET /stories/:id/download`) grava os stickers e também os textos, tanto nas fotos como nos
vídeos:

- ficam no sítio, com o tamanho, a rotação, a letra e o fundo certos;
- ficam por baixo da assinatura;
- num ficheiro que já vem assinado da câmara, não se junta outra assinatura, mas os textos vão na mesma.

**Como o servidor desenha os textos:**

- Usa o canvas do Node (`@napi-rs/canvas`, Skia) com as fontes do estúdio, que já estão na imagem Docker
  (`apps/api/assets/fonts/estudio/*.woff2`, registadas por `ensureStudioFonts`, as mesmas da montagem das tchekas).
- Cada texto entra no SVG da assinatura como uma imagem PNG (`<image href="data:image/png;base64,…">`).
- O SVG (librsvg) não precisa de conhecer as fontes, por isso o Dockerfile e o fontconfig ficam como estavam.
- Os emojis dentro do texto saem pela fonte de emojis já instalada (`fonts-noto-color-emoji`).

O código está em `apps/api/src/stories/text-layer-render.ts`.

## 3. Publicações só com texto

**Coluna:** `content.posts.text_font text NULL`.

**Pedidos:**

- `POST /posts`: `textFont?: TextFontId | null`.
  - Só se guarda quando a publicação **não tem fotos nem vídeos**.
  - Com ficheiros, ignora-se e fica `null`.
- `PATCH /posts/:id`: `textFont?: TextFontId | null`.
  - Muda a letra de uma publicação sem ficheiros; `null` volta à de sempre.
  - Numa publicação com ficheiros, ou num repost simples, ignora-se.
- `POST /posts/:id/repost`: `textFont?: TextFontId | null`.
  - Numa citação (com texto), a citação fica com a letra.
  - No repost simples, ignora-se.

Um id desconhecido em qualquer um destes pedidos dá **400**.

**Respostas:** todos os objetos de publicação trazem `textFont: TextFontId | null`. Isto vale para:

- o feed, o Explorar, os Reels e as hashtags;
- o perfil (todas as abas);
- a publicação sozinha e o código curto;
- os guardados, as páginas e os sons;
- dentro de `repostOf`, nos reposts e nas citações.

A razão é que todos passam pelo mesmo `FEED_SQL` e pelo mesmo `toDtoRaw`.

## 4. Legenda do Zás

**Coluna:** `social.instants.caption_font text NULL`.

**Pedido:** `POST /instants` aceita `captionFont?: TextFontId | null`.

- Sem legenda, não se guarda e fica `null`.
- Um id desconhecido dá **400**.

**Respostas:**

- a resposta do `POST /instants` traz `{ id, expiresAt, captionFont }`;
- `GET /instants/feed` e `GET /instants/of/:username` trazem `captionFont: TextFontId | null` em cada Zás.

**Cópia guardada** (`GET /instants/:id/download`):

- Com letra, a legenda corre pela curva como antes, mas desenhada com a fonte escolhida: medida e desenhada no canvas e
  metida no SVG como imagem.
- Sem letra (`null`), sai como sempre, em DejaVu Sans Bold.

O código está em `apps/api/src/instants/zas-caption.ts`.

## 5. Exportação dos dados

`GET /me/export`:

- **`posts[]`**: traz `textFont`.
- **`stories[]`**: já trazia `stickers`, por isso os textos vão lá dentro.
- **Zás**: não entram na exportação, nem antes nem agora.

## Testes

| Ficheiro | O que testa |
|----------|-------------|
| `apps/api/src/stories/text-layer.spec.ts` | A conta da caixa, a validação, os limites e as fontes iguais às do estúdio (unitário). |
| `apps/api/src/stories/fontes.e2e.spec.ts` | Ida e volta, 400/422, limites, stickers antigos, partilha, cópia gravada (pixéis), `textFont` no feed, perfil, publicação, edição, citações e exportação, e `captionFont` no Zás e na cópia (integração). |
