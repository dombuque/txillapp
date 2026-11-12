// Programa de artistas moçambicanos: textos e contas pequenas, sem dependências (os testes correm em Node:
// tests/artists.test.mjs). As faixas dos artistas chegam pela interface comum das faixas (docs/musica.md), com `source: 'local'`.

export type ArtistStatus = 'pending' | 'approved' | 'rejected' | 'revoked' | 'withdrawn';
export type TrackStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'removed';

/** Contacto para direitos de autor (igual ao do servidor: RIGHTS_CONTACT). */
export const RIGHTS_CONTACT = 'suporte@txillapp.com';
export const RIGHTS_SUBJECT = 'Direitos de autor';

/** O estado do pedido de artista, numa frase. */
export function artistStatusText(s: ArtistStatus | null | undefined): { title: string; sub: string } {
  switch (s) {
    case 'pending': return { title: 'Pedido em análise', sub: 'A equipa do Txillapp está a ver o teu pedido. Recebes uma notificação com a decisão.' };
    case 'approved': return { title: 'És artista no Txillapp', sub: 'O teu perfil tem a etiqueta «Artista». Já podes carregar as tuas músicas.' };
    case 'rejected': return { title: 'Pedido não aprovado', sub: 'Vê o motivo, corrige e pede outra vez.' };
    case 'revoked': return { title: 'Estatuto de artista retirado', sub: `As tuas faixas deixaram de estar disponíveis. Para saberes mais, escreve para ${RIGHTS_CONTACT}.` };
    case 'withdrawn': return { title: 'Pedido retirado', sub: 'Podes pedir outra vez quando quiseres.' };
    default: return { title: 'Sou artista', sub: 'És artista ou editora em Moçambique? Põe as tuas músicas nos mimos e nas tchekas da malta, com destaque e uma ligação ao teu perfil.' };
  }
}

/** A etiqueta do estado de uma faixa no Gerir. `onHold`: escondida por uma denúncia de direitos de autor. */
export function trackStatusLabel(s: TrackStatus, onHold = false): { label: string; tone: 'green' | 'amber' | 'red' | 'zinc' } {
  if (onHold && s !== 'removed') return { label: 'Escondida por denúncia', tone: 'red' };
  switch (s) {
    case 'pending': return { label: 'Em análise', tone: 'amber' };
    case 'approved': return { label: 'Disponível', tone: 'green' };
    case 'rejected': return { label: 'Não aprovada', tone: 'red' };
    case 'withdrawn': return { label: 'Retirada', tone: 'zinc' };
    default: return { label: 'Tirada pela equipa', tone: 'red' };
  }
}

/** «♪ Título · Artista», como aparece nos mimos e nas tchekas. */
export const trackLine = (t: { title: string; artist?: string | null }) => `♪ ${t.title}${t.artist ? ` · ${t.artist}` : ''}`;

/** Uma faixa de um artista do programa (e não do catálogo aberto nem um clipe próprio). */
export const isLocalTrack = (t: { source?: string } | null | undefined): boolean => t?.source === 'local';

/** Para onde leva tocar no nome do artista: o perfil dele (só se o @ parecer um @). */
export const artistHref = (t: { source?: string; artistUsername?: string | null }) =>
  isLocalTrack(t) && t.artistUsername && /^[a-z0-9._]{2,40}$/i.test(t.artistUsername) ? `/u/${t.artistUsername}` : null;

/** «1:05» a partir de milissegundos. */
export function mmss(ms: number | null | undefined): string {
  if (!ms || ms < 0) return '0:00';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Lê «1:05», «65» ou «1.05» e devolve milissegundos (null se não der). */
export function parseMmss(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const m = /^(\d{1,2})[:.](\d{1,2})$/.exec(t);
  if (m) {
    const sec = Number(m[2]);
    return sec < 60 ? (Number(m[1]) * 60 + sec) * 1000 : null;
  }
  return /^\d{1,4}$/.test(t) ? Number(t) * 1000 : null;
}

/** Os limites do trecho (iguais aos do servidor: TRACK_LIMITS). */
export const PREVIEW = { minMs: 10_000, maxMs: 60_000, choices: [15_000, 30_000, 45_000, 60_000] } as const;

/** O trecho escolhido cabe na música? Devolve a frase do erro, ou null se está bem. `durationMs` pode não se saber ainda. */
export function previewProblem(startMs: number | null, lenMs: number, durationMs?: number | null): string | null {
  if (startMs === null || startMs < 0) return 'Escreve onde começa o trecho (por exemplo, 1:05)';
  if (lenMs < PREVIEW.minMs || lenMs > PREVIEW.maxMs) return 'O trecho tem de ter entre 10 e 60 segundos';
  if (durationMs && startMs + lenMs > durationMs + 500) return `O trecho passa do fim da música (${mmss(durationMs)}). Escolhe um início mais cedo`;
  return null;
}

/** Ligações aceites no pedido (redes e streaming): só https. */
export const LINK_LABELS: Record<string, string> = {
  instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube', spotify: 'Spotify', apple_music: 'Apple Music',
  audiomack: 'Audiomack', boomplay: 'Boomplay', deezer: 'Deezer', site: 'Site',
};
export function linkProblem(url: string): string | null {
  const u = url.trim();
  if (!u) return null;
  try {
    return new URL(u).protocol === 'https:' ? null : 'A ligação tem de começar por https://';
  } catch {
    return 'Ligação inválida';
  }
}
/** Adivinha o tipo da ligação pelo endereço (instagram.com → instagram…); o resto é «site». */
export function guessLinkKind(url: string): string {
  let host = '';
  try { host = new URL(url.trim()).hostname.replace(/^www\./, ''); } catch { return 'site'; }
  const map: [RegExp, string][] = [
    [/(^|\.)instagram\.com$/, 'instagram'], [/(^|\.)facebook\.com$|(^|\.)fb\.com$/, 'facebook'], [/(^|\.)tiktok\.com$/, 'tiktok'],
    [/(^|\.)youtube\.com$|^youtu\.be$/, 'youtube'], [/(^|\.)spotify\.com$/, 'spotify'], [/^music\.apple\.com$/, 'apple_music'],
    [/(^|\.)audiomack\.com$/, 'audiomack'], [/(^|\.)boomplay\.com$/, 'boomplay'], [/(^|\.)deezer\.com$/, 'deezer'],
  ];
  return map.find(([re]) => re.test(host))?.[1] ?? 'site';
}

/** Os números de uma faixa para o artista: «Usada 12 vezes por 9 pessoas». */
export function usesLine(uses: number, people: number): string {
  if (!uses) return 'Ainda ninguém a usou';
  return `Usada ${uses} ${uses === 1 ? 'vez' : 'vezes'} por ${people} ${people === 1 ? 'pessoa' : 'pessoas'}`;
}

/** O aviso da equipa nas notificações (kind 'music_review'), em nome do Txillapp. */
export interface MusicReviewData { what?: 'artist' | 'track'; decision?: string; title?: string; reason?: string }
export function musicReviewVerb(d: MusicReviewData): { text: string; sub?: string } {
  const why = d.reason?.trim() ? `Motivo: ${d.reason.trim()}` : undefined;
  const t = d.title ? `«${d.title}»` : 'a tua música';
  if (d.what === 'artist') {
    if (d.decision === 'approved') return { text: 'aprovou o teu pedido de artista: já podes carregar as tuas músicas' };
    if (d.decision === 'revoked') return { text: 'retirou o estatuto de artista à tua conta', sub: why };
    return { text: 'não aprovou o teu pedido de artista', sub: why ?? 'Vê o motivo em «Sou artista» e pede outra vez.' };
  }
  switch (d.decision) {
    case 'approved': return { text: `aprovou ${t}: já está nos «Artistas de Moçambique»` };
    case 'rejected': return { text: `não aprovou ${t}`, sub: why };
    case 'removed': return { text: `tirou ${t} do Txillapp`, sub: why };
    case 'restored': return { text: `repôs ${t}: voltou a estar disponível` };
    default: return { text: `tem novidades sobre ${t}` };
  }
}
/** Para onde leva o aviso: o pedido (artista) ou o Gerir (faixas). */
export const musicReviewTarget = (d: MusicReviewData) => (d.what === 'artist' && d.decision !== 'approved' ? '/artista' : '/artista/gerir');
