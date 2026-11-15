/**
 * O cartão do QR do perfil («Partilhar perfil») como imagem: lógica pura, sem React Native, para correr nos testes
 * (tests/profileQrCard.test.mjs). O desenho é o do cartão da folha: fundo branco com margem, o QR, o @username e o logótipo
 * txillapp por baixo. Sai em duas partes, que cada aparelho pinta à sua maneira (Skia no telemóvel, canvas na web; ver
 * profileQrImage.ts e .web.ts): um SVG sem letras (o fundo, o QR e o logótipo) e a linha do @username.
 */

/** A linha do @username (a mesma forma do CardText de inviteCard.ts: quem pinta encolhe a letra se passar de `maxWidth`). */
export interface QrCardText {
  text: string;
  x: number;
  y: number;
  size: number;
  weight: 800;
  color: string;
  align: 'center';
  maxWidth: number;
}

export interface QrCardLayout {
  width: number;
  height: number;
  /** O fundo, o QR e o logótipo (sem letras), com o elemento <svg> de fora. */
  svg: string;
  text: QrCardText;
  /** Onde ficou o QR (quadrado, já com a margem branca de um módulo). */
  qr: { x: number; y: number; size: number; module: number };
  /** Rótulo para o leitor de ecrã. */
  label: string;
}

const INK = '#18181b';
const BRAND = '#d6334f';

/**
 * As medidas em píxeis (1080 de largura). Saem das da folha (QR de 238, @ de 20 com 28 de linha e 12 por cima, logótipo
 * de 22 de altura e 6 por cima), em ponto grande, com uma margem branca à volta.
 */
export const QR_CARD = { width: 1080, margin: 110, qrBox: 860, userGap: 43, userSize: 72, userLine: 101, markGap: 22, markH: 80 } as const;

/** O logótipo (a mesma geometria de lib/wordmark.ts e do componente Wordmark): caixa de -4,-3 a 150,51. */
const circlePath = (cx: number, cy: number, r: number) => `M${cx + r} ${cy}a${r} ${r} 0 1 0 ${-2 * r} 0a${r} ${r} 0 1 0 ${2 * r} 0`;
const WORDMARK = ['M7 5V27Q7 34 14 34M0 14H14', 'M20 14Q27 24 34 34M34 14Q27 24 20 34', 'M42 14V34', 'M51 3V34', 'M61 3V34', circlePath(77, 24, 9.5), 'M86.5 14V34', circlePath(106, 24, 9.5), 'M96.5 14V46', circlePath(135, 24, 9.5), 'M125.5 14V46'];

function wordmarkSvg(cx: number, top: number, height: number) {
  const s = height / 54;
  const w = 154 * s;
  const x = cx - w / 2;
  return `<g transform="translate(${(x + 4 * s).toFixed(2)} ${(top + 3 * s).toFixed(2)}) scale(${s.toFixed(4)})" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">${WORDMARK.map((d) => `<path d="${d}"/>`).join('')}<circle cx="42" cy="3.5" r="4.2" fill="${BRAND}" stroke="none"/></g>`;
}

/** Os módulos escuros do QR num só caminho, em tiras por linha (como o QrCode da folha), em unidades de módulo. */
export function qrPath(m: readonly (readonly boolean[])[]): string {
  let d = '';
  m.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x++;
        continue;
      }
      let w = 1;
      while (x + w < row.length && row[x + w]) w++;
      d += `M${x + 1} ${y + 1}h${w}v1h-${w}z`;
      x += w;
    }
  });
  return d;
}

/**
 * O desenho do cartão. `matrix`: a matriz do QR (lib/qr.ts). Os módulos têm um número inteiro de píxeis (o QR fica nítido
 * e lê-se bem) e o QR centra-se na sua caixa. Puro: as mesmas entradas dão sempre o mesmo desenho.
 */
export function qrCardLayout(matrix: readonly (readonly boolean[])[], username: string): QrCardLayout {
  const g = QR_CARD;
  const W = g.width;
  const n = matrix.length + 2;
  const module = Math.max(1, Math.floor(g.qrBox / n));
  const side = module * n;
  const qr = { x: Math.round((W - side) / 2), y: g.margin + Math.round((g.qrBox - side) / 2), size: side, module };
  const userTop = g.margin + g.qrBox + g.userGap;
  const baseline = Math.round(userTop + (g.userLine - g.userSize) / 2 + g.userSize * 0.8);
  const markTop = userTop + g.userLine + g.markGap;
  const H = markTop + g.markH + g.margin;
  const name = String(username ?? '').trim();
  const text: QrCardText = { text: `@${name}`, x: W / 2, y: baseline, size: g.userSize, weight: 800, color: INK, align: 'center', maxWidth: W - 2 * g.margin };
  const parts = [
    `<rect width="${W}" height="${H}" fill="#ffffff"/>`,
    `<g transform="translate(${qr.x} ${qr.y}) scale(${module})" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#ffffff"/><path d="${qrPath(matrix)}" fill="${INK}"/></g>`,
    wordmarkSvg(W / 2, markTop, g.markH),
  ];
  return {
    width: W,
    height: H,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`,
    text,
    qr,
    label: `QR do perfil de @${name} no Txillapp`,
  };
}

/** O texto que acompanha a imagem (sem a ligação: quem partilha junta-a). Com convite, fala do convite. */
export function qrShareText(username: string, invite: boolean): string {
  return invite ? `Segue-me no Txillapp (@${username}) e entra com o meu convite: ganhamos Txills os dois.` : `Segue @${username} no Txillapp, a rede da malta:`;
}

/** O nome do ficheiro: só letras, números, ponto, traço e sublinhado. */
export function qrFileName(username: string): string {
  const safe = String(username ?? '').replace(/[^A-Za-z0-9._-]+/g, '').slice(0, 40);
  return `txillapp-qr-${safe || 'perfil'}.png`;
}

/**
 * Como correu o «Partilhar»: 'shared' (foi a imagem), 'saved-link' (Android: a imagem foi para a galeria e partilhou-se a
 * ligação), 'link' (só a ligação), 'downloaded' (web sem partilha de ficheiros: descarregou a imagem e copiou a ligação),
 * 'downloaded-only' (descarregou, mas não deu para copiar), 'copied' (sem imagem nem folha: copiou a ligação), 'cancelled' (a pessoa fechou a folha) ou 'failed'.
 */
export type QrShareOutcome = 'shared' | 'saved-link' | 'link' | 'downloaded' | 'downloaded-only' | 'copied' | 'cancelled' | 'failed';

/** A nota que aparece por baixo dos botões depois de partilhar (vazia: nada a dizer). */
export function qrShareNote(o: QrShareOutcome): string {
  switch (o) {
    case 'saved-link':
      return 'Imagem do QR guardada na galeria';
    case 'downloaded':
      return 'Imagem descarregada e ligação copiada';
    case 'downloaded-only':
      return 'Imagem descarregada';
    case 'copied':
      return 'Ligação copiada';
    case 'failed':
      return 'Não consegui partilhar';
    default:
      return '';
  }
}
