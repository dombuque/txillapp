/**
 * Os sons das tchekas (docs/sons.md), só a lógica (sem ecrãs): ligações, textos e a ordem da grelha. Os tipos e os pedidos ao
 * servidor estão em lib/api.sounds.ts. Testado em tests/sounds.test.mjs.
 */

export type SoundKind = 'original' | 'catalog' | 'local';
export type SoundUnavailable = 'held' | 'off' | 'private' | 'minor' | 'unavailable';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** O id de um som é válido? Um uuid (som original), `cat:<faixa>` ou `local:<uuid>` (o resto não abre a página). */
export function isSoundId(id: string | null | undefined): id is string {
  if (!id || id.length > 90) return false;
  if (UUID.test(id)) return true;
  if (/^local:[0-9a-f-]{36}$/.test(id)) return true;
  return /^cat:[\w.:-]{1,80}$/.test(id) && !id.startsWith('cat:local:');
}

/** O id do som de uma faixa do seletor (catálogo: `cat:<id>`; artistas: o próprio `local:<uuid>`). Clipes e licenciadas não têm. */
export function soundIdOfTrack(t: { id: string; kind?: string; source?: string; soundId?: string } | null | undefined): string | null {
  if (!t) return null;
  if (t.kind === 'sound' && t.soundId) return isSoundId(t.soundId) ? t.soundId : null;
  if (t.kind === 'clip' || t.kind === 'licensed') return null;
  const id = t.source === 'local' && !t.id.startsWith('local:') ? `local:${t.id}` : t.id;
  const out = id.startsWith('local:') ? id : `cat:${id}`;
  return isSoundId(out) ? out : null;
}

/** A página do som. */
export const soundHref = (id: string) => `/som/${encodeURIComponent(id)}`;

/** O estúdio já com o som escolhido («Usar este som»). Quem trata do parâmetro é o estúdio das tchekas. */
export const studioHref = (id: string) => `/tcheka/nova?som=${encodeURIComponent(id)}`;

/** Números curtos à portuguesa (950, 1,2 mil, 4,4 M), como no seletor de música. */
export function compactCount(n: number | null | undefined): string {
  const v = Math.max(0, Math.floor(n ?? 0));
  const fmt = (unit: number, decimals: number) => {
    const k = 10 ** decimals;
    return String(Math.floor(v / (unit / k)) / k).replace('.', ',');
  };
  if (v < 1000) return String(v);
  if (v < 1_000_000) return `${fmt(1000, v < 100_000 ? 1 : 0)} mil`;
  return `${fmt(1_000_000, v < 100_000_000 ? 1 : 0)} M`;
}

/** «1 tcheka», «12 tchekas», «1,2 mil tchekas»; sem nenhuma, «Ainda sem tchekas». */
export function usesLine(n: number | null | undefined): string {
  if (!n || n < 1) return 'Ainda sem tchekas';
  return n === 1 ? '1 tcheka' : `${compactCount(n)} tchekas`;
}

/** Porque é que não se pode usar o som (o botão «Usar este som» fica desligado e mostra isto). */
export function unavailableText(why: SoundUnavailable | null | undefined): string | null {
  switch (why) {
    case 'held': return 'Este som está em análise e não pode ser usado agora.';
    case 'off': return 'Quem publicou este som não deixa usá-lo.';
    case 'private': return 'Este som é de uma conta privada e não pode ser usado.';
    case 'minor': return 'Este som não pode ser usado por outras pessoas.';
    case 'unavailable': return 'Esta música já não está disponível.';
    default: return null;
  }
}

/** A linha por baixo do título: «Artista · 0:32» (catálogo) ou «Nome · 0:15» (som original). */
export function soundMeta(s: { kind: SoundKind; artist?: string; author?: { displayName: string } | null; durationMs?: number | null }): string {
  const who = s.kind === 'original' ? s.author?.displayName ?? '' : s.artist || s.author?.displayName || '';
  const d = s.durationMs ? `${Math.floor(s.durationMs / 60000)}:${String(Math.floor((s.durationMs % 60000) / 1000)).padStart(2, '0')}` : '';
  return [who, d].filter(Boolean).join(' · ');
}

/** A linha do som numa tcheka: «♪ Som original · @ana» ou «♪ Marrabenta · Artista». */
export function postSoundLine(s: { title: string; kind: SoundKind; artist?: string } | null | undefined): string {
  if (!s) return '';
  return s.kind === 'original' || !s.artist ? `♪ ${s.title}` : `♪ ${s.title} · ${s.artist}`;
}

/** Junta as páginas da grelha sem repetir tchekas (a ordem por vistas pode mudar entre páginas). */
export function mergePages<T extends { id: string }>(pages: { items: T[] }[] | null | undefined): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const p of pages ?? []) for (const it of p.items) if (!seen.has(it.id)) { seen.add(it.id); out.push(it); }
  return out;
}

/** A definição «Deixar usar o meu som», numa frase (numa conta privada ou de menor fica desligada e não se muda). */
export function reuseSetting(s: { reuse: boolean; effective: boolean; private: boolean; minor: boolean } | null | undefined): { on: boolean; disabled: boolean; description: string } {
  if (!s) return { on: false, disabled: true, description: 'Outras pessoas podem usar o som das tuas tchekas nas delas.' };
  if (s.private) return { on: false, disabled: true, description: 'A tua conta é privada: ninguém pode usar o som das tuas tchekas.' };
  if (s.minor) return { on: false, disabled: true, description: 'Só contas de maiores de 18 anos (com a data de nascimento indicada) podem deixar usar o seu som.' };
  return { on: s.reuse, disabled: false, description: 'Outras pessoas podem usar o som das tuas tchekas nas delas, com o teu nome no som. Desligado, as que já o usam continuam.' };
}

/** O contacto para contestar uma decisão sobre um som (ainda não há formulário na Ajuda). */
export const SOUND_SUPPORT = 'suporte@txillapp.com';

/** «Retirar o som»: o aviso antes de confirmar. */
export const RETIRE_SOUND_TITLE = 'Retirar o som?';
export const RETIRE_SOUND_TEXT = 'As tchekas que usam este som ficam sem som. Não dá para desfazer.';

/** Uma tcheka que usava um som que foi tirado (`post.soundRemoved`): a linha no lugar do som. */
export function soundRemovedText(why: string | null | undefined): string | null {
  if (why === 'author') return 'Som retirado pelo autor';
  if (why === 'rights') return 'Som retirado por direitos de autor';
  return null;
}

/** O estado de um som meu (GET /sounds/me), numa frase, e se ainda o posso retirar. */
export function mySoundStatus(s: { status: 'active' | 'held' | 'source_removed' | 'removed'; removedBy?: string | null }): { text: string; canRetire: boolean } {
  switch (s.status) {
    case 'held': return { text: 'Em análise: ninguém o pode usar em tchekas novas', canRetire: true };
    case 'source_removed': return { text: 'Apagaste a tcheka de onde saiu: continua a tocar nas que já o usam', canRetire: true };
    case 'removed': return { text: s.removedBy === 'author' ? 'Retiraste este som' : 'Retirado pela equipa por direitos de autor', canRetire: false };
    default: return { text: 'Ativo', canRetire: true };
  }
}

/** O aviso do Txillapp sobre um som meu (kind 'sound_review'): o texto, o motivo e o que posso fazer. */
export interface SoundReviewData { soundId?: string; decision?: string; reason?: string; note?: string; postId?: string }
export function soundReviewVerb(d: SoundReviewData): { text: string; sub?: string } {
  const why = [d.reason?.trim() ? `Motivo: ${d.reason.trim()}.` : '', d.note?.trim() ? `Nota da equipa: ${d.note.trim()}.` : ''].filter(Boolean).join(' ');
  const contest = `Se o som é teu ou tens autorização, escreve para ${SOUND_SUPPORT} com o assunto «Contestar som».`;
  switch (d.decision) {
    case 'held': return { text: 'suspendeu o teu som enquanto analisa uma denúncia: ninguém o pode usar em tchekas novas', sub: [why, contest].filter(Boolean).join(' ') };
    case 'removed': return { text: 'retirou o teu som: deixou de tocar em todas as tchekas', sub: [why, contest].filter(Boolean).join(' ') };
    case 'restored': return { text: 'repôs o teu som: voltou a tocar e a poder ser usado' };
    case 'cleared': return { text: 'analisou a denúncia do teu som: voltou a poder ser usado' };
    default: return { text: 'tem novidades sobre o teu som' };
  }
}
/** Para onde leva: a página do som (se ainda existe) ou «Os meus sons». */
export const soundReviewTarget = (d: SoundReviewData) =>
  d.decision === 'removed' || !d.soundId || !isSoundId(d.soundId) ? '/settings/sons' : soundHref(d.soundId);
