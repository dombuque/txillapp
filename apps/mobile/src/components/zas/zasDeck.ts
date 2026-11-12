/**
 * Visor dos Zás em pilha: as contas puras (sem React nem módulos nativos; os testes em tests/zasDeck.test.mjs importam
 * este ficheiro diretamente). Quem as usa é o InstantViewer, em components/Instants.tsx.
 *
 * - A pilha: a foto atual por cima e até DECK_BEHIND fotos seguintes a espreitar por trás (mais pequenas e um pouco
 *   acima, com sombra). A que sai (ao avançar) voa para a esquerda; ao voltar atrás regressa pelo mesmo caminho.
 *   `deckPose(d)` dá a pose de um cartão a `d` lugares do de cima (contínuo: o arrastar do dedo e a animação usam-no).
 * - «1 de N»: `deckCount`.
 * - Pré-carregar: `prefetchTargets` (as próximas PREFETCH_AHEAD fotos) e `createPrefetcher` (não repete, tenta outra
 *   vez se falhar, guarda as últimas em memória).
 * - A largura certa da foto: `zasPhotoWidth` e `zasPhotoUrl` (o servidor devolve um WebP leve com ?w=, como o `sized`).
 */

/** Quantos cartões seguintes espreitam por trás do de cima. */
export const DECK_BEHIND = 2;
/** Quantas fotos à frente se pré-carregam (além da de cima). */
export const PREFETCH_AHEAD = 3;
/** Duração da troca de cartão (ms): curta, para o toque parecer imediato. */
export const DECK_MS = 220;
/** Larguras leves que o servidor tem para as fotos do chat (as mesmas de CHAT_WIDTHS na API). */
export const ZAS_WIDTHS = [480, 720, 1080] as const;

/** Um cartão da pilha: o índice na lista e a distância ao de cima (0 = o de cima, 1 e 2 por trás, -1 o que acabou de sair). */
export type DeckSlot = { index: number; depth: number };

/**
 * Os cartões a desenhar com o de cima em `at`: o que acabou de sair (para a animação de saída e para voltar atrás),
 * o de cima e até `behind` seguintes. Do mais de trás para o de cima (a ordem de desenho).
 */
export function deckSlots(count: number, at: number, behind = DECK_BEHIND): DeckSlot[] {
  if (count <= 0) return [];
  const top = Math.min(Math.max(0, Math.floor(at)), count - 1);
  const out: DeckSlot[] = [];
  for (let k = Math.min(count - 1, top + behind); k >= Math.max(0, top - 1); k--) out.push({ index: k, depth: k - top });
  return out;
}

/** Quantos cartões se veem de facto na pilha (o de cima e os que espreitam), sem contar o que já saiu. */
export function deckVisible(count: number, at: number, behind = DECK_BEHIND): number {
  return deckSlots(count, at, behind).filter((s) => s.depth >= 0).length;
}

/** A pastilha «1 de N» (vazia com um só Zás: não há pilha para contar). */
export function deckCount(at: number, count: number): string {
  if (count <= 1) return '';
  return `${Math.min(Math.max(0, at), count - 1) + 1} de ${count}`;
}

export type DeckPose = { translateX: number; translateY: number; scale: number; rotate: number; opacity: number; shade: number };

/** Pose de cada lugar da pilha, para um cartão de altura `h` e um ecrã de largura `w`: 0 por cima, 1 e 2 por trás. */
function restPose(k: number, h: number): DeckPose {
  'worklet';
  const scale = 1 - 0.07 * k;
  // Os de trás sobem um pouco acima do de cima (espreitam pelo topo) e rodam ao de leve, alternando, como uma pilha.
  const peek = 16 * k;
  return { translateX: 0, translateY: -((h * (1 - scale)) / 2) - peek, scale, rotate: k === 0 ? 0 : k % 2 ? 3.5 : -3, opacity: 1, shade: 0.22 * k };
}

const lerp = (a: number, b: number, t: number) => {
  'worklet';
  return a + (b - a) * t;
};

/**
 * Pose de um cartão a `d` lugares do de cima (contínuo). d ∈ [0, 2]: entre os lugares da pilha; d > 2: o seguinte a
 * aparecer por trás (vai ganhando opacidade); d ∈ [-1, 0): a sair para a esquerda (roda e desvanece). `w` é a largura do
 * ecrã, `h` a altura do cartão. Corre no worklet do Reanimated (no telemóvel) e no JS (na web e nos testes).
 */
export function deckPose(d: number, w: number, h: number, behind = DECK_BEHIND): DeckPose {
  'worklet';
  if (d < 0) {
    const t = Math.min(1, -d);
    // Opaco até sair de todo (meio transparente, via-se o de trás através dele enquanto se arrasta).
    return { translateX: -t * w * 1.05, translateY: t * h * 0.04, scale: 1, rotate: -12 * t, opacity: t >= 1 ? 0 : 1, shade: 0 };
  }
  if (d > behind) {
    const last = restPose(behind, h);
    return { ...last, opacity: Math.max(0, 1 - (d - behind)) };
  }
  const k = Math.floor(d);
  const t = d - k;
  const a = restPose(k, h);
  if (t === 0) return a;
  const b = restPose(k + 1, h);
  return { translateX: 0, translateY: lerp(a.translateY, b.translateY, t), scale: lerp(a.scale, b.scale, t), rotate: lerp(a.rotate, b.rotate, t), opacity: 1, shade: lerp(a.shade, b.shade, t) };
}

/** Quanto espaço os de trás ocupam acima do de cima (para a pilha não bater nos botões de cima). */
export function deckHeadroom(h: number, behind = DECK_BEHIND): number {
  return Math.ceil(-restPose(behind, h).translateY);
}

/**
 * Para onde vai a pilha ao largar o dedo: `dx` é o deslocamento (px), `vx` a velocidade (px/ms), `w` a largura do ecrã.
 * Para a esquerda passa ao seguinte, para a direita volta ao anterior; pouco movimento volta ao sítio.
 */
export function swipeStep(dx: number, vx: number, w: number): -1 | 0 | 1 {
  const far = Math.max(48, w * 0.18);
  if (dx <= -far || (vx < -0.45 && dx < -12)) return 1;
  if (dx >= far || (vx > 0.45 && dx > 12)) return -1;
  return 0;
}

/** Largura a pedir ao servidor para um cartão de `cardW` pontos num ecrã de densidade `dpr` (no máximo 2,5×). */
export function zasPhotoWidth(cardW: number, dpr: number): number {
  const want = Math.ceil(Math.max(1, cardW) * Math.min(Math.max(1, dpr || 1), 2.5));
  return ZAS_WIDTHS.find((x) => x >= want) ?? ZAS_WIDTHS[ZAS_WIDTHS.length - 1];
}

/** O endereço da foto do Zás na largura `w` (o mesmo URL assinado com ?w=; outros endereços ficam como estão). */
export function zasPhotoUrl(url: string, w: number): string {
  if (!/\/api\/v1\/chat\/media\//.test(url)) return url;
  if (/[?&]w=\d+/.test(url)) return url.replace(/([?&])w=\d+/, `$1w=${w}`);
  return `${url}${url.includes('?') ? '&' : '?'}w=${w}`;
}

/** As fotos a pré-carregar com o de cima em `at`: a de cima e as `ahead` seguintes (sem repetir). */
export function prefetchTargets(urls: readonly string[], at: number, ahead = PREFETCH_AHEAD): string[] {
  const out: string[] = [];
  for (let k = Math.max(0, at); k < Math.min(urls.length, at + 1 + ahead); k++) if (urls[k] && !out.includes(urls[k])) out.push(urls[k]);
  return out;
}

export interface Prefetcher {
  /** Pede estas fotos (as que já estão ou estão a vir não se pedem outra vez). */
  want(urls: readonly string[]): void;
  /** Já carregou? */
  has(url: string): boolean;
  /** Quantas se pediram de facto (para os testes e as medições). */
  readonly requested: number;
}

/**
 * Pré-carregador: chama `load(url)` uma vez por foto; se falhar, a foto pode ser pedida outra vez; guarda as últimas
 * `keep` carregadas (as mais antigas saem, para não crescer sem fim).
 */
export function createPrefetcher(load: (url: string) => Promise<unknown>, keep = 40): Prefetcher {
  const done = new Set<string>();
  const busy = new Set<string>();
  let requested = 0;
  return {
    want(urls) {
      for (const u of urls) {
        if (!u || done.has(u) || busy.has(u)) continue;
        busy.add(u);
        requested++;
        Promise.resolve()
          .then(() => load(u))
          .then(
            () => {
              busy.delete(u);
              done.add(u);
              while (done.size > keep) done.delete(done.values().next().value as string);
            },
            () => void busy.delete(u),
          );
      }
    },
    has: (u) => done.has(u),
    get requested() {
      return requested;
    },
  };
}
