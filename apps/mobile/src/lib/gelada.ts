/**
 * «Paga-me uma» (lógica pura, sem React nem imports, para os testes em tests/gelada.test.mjs). Os textos seguem os do
 * servidor (apps/api/src/gelada/gelada-cards.ts): o álcool nunca aparece a quem tem menos de 18 anos.
 */

import { t } from '@/lib/i18n';
import { GENERIC_ERROR_CODES } from '@/lib/apiErrors';
export interface DrinkLike { slug: string; name: string; category: string; alcoholic: boolean; masked?: boolean }
export interface PersonLike { username: string; displayName: string }
export type StatusLike = 'pending' | 'accepted' | 'declined' | 'owed' | 'untagged';

/** O emoji da bebida (refrescos e bebidas escondidas 🥤). */
export function drinkEmoji(d: DrinkLike): string {
  if (!d.alcoholic || d.masked) return '🥤';
  if (d.category === 'vinho') return /espumante|champanhe|prosecco/.test(d.slug) ? '🥂' : '🍷';
  if (d.category === 'destilado') return '🥃';
  if (d.category === 'cocktail') return '🍹';
  return '🍺';
}

/** «uma 2M» / «um refresco» / «uma bebida». */
export function drinkPhrase(d: DrinkLike): string {
  if (d.masked) return t('uma bebida');
  return d.alcoholic ? `uma ${d.name}` : t('um refresco');
}

/** O nome a mostrar por baixo do desenho (o refresco diz qual é; a escondida não diz nada). */
export const drinkLabel = (d: DrinkLike) => (d.masked ? t('Uma bebida') : d.name);

/** Uma pessoa no texto: @utilizador (ou «Conta eliminada»). */
export const handleOf = (p: PersonLike | null | undefined) => (!p || !p.username ? t('Conta eliminada') : `@${p.username}`);

/**
 * O título do cartão no chat, para quem o vê: quem recebe lê «@ana pede-te uma 2M 🍺»; quem pediu lê «Pediste a @rui uma
 * 2M 🍺».
 */
export function cardTitle(r: { mine: boolean; requester: PersonLike | null; recipient: PersonLike | null; drink: DrinkLike }): string {
  const what = `${drinkPhrase(r.drink)} ${drinkEmoji(r.drink)}`;
  if (r.mine) return `Pediste a ${handleOf(r.recipient)} ${what}`;
  return `${handleOf(r.requester)} pede-te ${what}`;
}

/** O texto do post: «@ana, @rui, paga-me uma 2M 🍺» (a vírgula separa quem foi identificado do pedido). */
export function postTitle(names: (PersonLike | null)[], d: DrinkLike): string {
  const who = names.filter((p): p is PersonLike => !!p && !!p.username).map((p) => `@${p.username}`);
  const ask = `paga-me ${drinkPhrase(d)} ${drinkEmoji(d)}`;
  return who.length ? `${who.join(', ')}, ${ask}` : t('Paga-me {drinkPhrase} {drinkEmoji}', { drinkPhrase: drinkPhrase(d), drinkEmoji: drinkEmoji(d) });
}

/** O estado de um pedido, como toda a gente o vê (no cartão do chat e no post). `name`: @ de quem recebeu. Sem emojis: o desenho da bebida já está no cartão. */
export function statusLine(status: StatusLike, name: string, forMe = false): string {
  const who = forMe ? t('Tu') : name;
  switch (status) {
    case 'accepted': return forMe ? t('Disseste «Bora!»') : `${who} pagou`;
    case 'owed': return forMe ? t('Ficaste a dever') : t('{who} ficou a dever', { who });
    case 'declined': return t('Hoje não');
    case 'untagged': return forMe ? t('Saíste deste pedido') : t('{who} saiu do pedido', { who });
    default: return forMe ? t('À tua espera') : t('À espera de {who}', { who });
  }
}

/** Os três botões, pela ordem: «Bora!», «Hoje não», «Fica a dever». */
export const ANSWERS = [
  { answer: 'accept', get label() { return t('Bora!'); } },
  { answer: 'decline', get label() { return t('Hoje não'); } },
  { answer: 'owe', get label() { return t('Fica a dever'); } },
] as const;

/** «Deves 2 · Devem-te 3» (sem nada: «Tudo em dia»). Para o livro de outra pessoa: «Deve 2 · Devem-lhe 3». */
export function bookSummary(owe: number, owed: number, mine = true): string {
  if (!owe && !owed) return t('Tudo em dia');
  return mine ? t('Deves {owe} · Devem-te {owed}', { owe, owed }) : t('Deve {owe} · Devem-lhe {owed}', { owe, owed });
}

/** Uma linha do livro: «Deves uma 2M a @ana» / «@rui deve-te um refresco». */
export function debtLine(d: { iOwe: boolean; owedToMe: boolean; debtor: PersonLike; creditor: PersonLike; drink: DrinkLike }): string {
  const what = drinkPhrase(d.drink);
  if (d.iOwe) return `Deves ${what} a ${handleOf(d.creditor)}`;
  if (d.owedToMe) return `${handleOf(d.debtor)} deve-te ${what}`;
  return `${handleOf(d.debtor)} deve ${what} a ${handleOf(d.creditor)}`;
}

/** O estado de uma dívida: por pagar, à espera de confirmação, paga ou perdoada. */
export function debtState(d: { status: 'open' | 'paid' | 'forgiven'; claimed: boolean; iOwe: boolean }): string {
  if (d.status === 'paid') return t('Paga');
  if (d.status === 'forgiven') return t('Perdoada');
  if (d.claimed) return d.iOwe ? t('À espera que confirme') : t('Diz que já pagou');
  return t('Por pagar');
}

/** A sugestão da rodada: «Hoje paga o @rui» (sem género conhecido, «Hoje paga @rui»). */
export const suggestLine = (p: PersonLike | null) => (p && p.username ? t('Hoje paga @{username}?', { username: p.username }) : null);

/** O texto pronto para «Publicar o momento» (depois de confirmar uma gelada paga). */
export function momentText(d: { iOwe: boolean; debtor: PersonLike; creditor: PersonLike; drink: DrinkLike }): string {
  const what = d.drink.masked || !d.drink.alcoholic ? 'o refresco' : `a ${d.drink.name}`;
  return d.iOwe ? t('Paguei {what} que devia a {handleOf} {drinkEmoji} Dívida saldada!', { what, handleOf: handleOf(d.creditor), drinkEmoji: drinkEmoji(d.drink) }) : t('{handleOf} pagou {what} que me devia {drinkEmoji} Saúde!', { handleOf: handleOf(d.debtor), what, drinkEmoji: drinkEmoji(d.drink) });
}

/** Os amigos para o pedido: mútuos primeiro, depois quem sigo; no post só os mútuos. */
export function pickable<T extends { mutual: boolean }>(list: T[], channel: 'chat' | 'post'): T[] {
  const l = channel === 'post' ? list.filter((p) => p.mutual) : list;
  return [...l].sort((a, b) => Number(b.mutual) - Number(a.mutual));
}

/**
 * As linhas da lista de notificações (0145). Com `soft` (refresco, quem tem menos de 18 anos) nunca se fala de álcool.
 * gelada_tag: pediram-me numa publicação; gelada_answer: responderam ao meu pedido publicado; gelada_paid: «Já paguei».
 */
export function geladaNoticeText(kind: string, d: { soft?: boolean; answer?: string; step?: string; venue?: string; venueKind?: string }): string {
  if (kind === 'gelada_tag') return d.soft ? t('pede-te um refresco numa publicação') : t('pede-te uma gelada numa publicação');
  if (kind === 'gelada_answer') {
    if (d.answer === 'accept') return t('disse «Bora!» ao teu pedido');
    if (d.answer === 'owe') return d.soft ? t('ficou a dever-te um refresco') : t('ficou a dever-te uma');
    return t('disse «Hoje não» ao teu pedido');
  }
  if (kind === 'gelada_paid') {
    if (d.step !== 'claimed') return t('confirmou que pagaste');
    return d.venue ? t('diz que já te pagou {venueTag}. Confirmas?', { venueTag: venueTag({ name: d.venue, kind: d.venueKind }) }) : t('diz que já te pagou. Confirmas?');
  }
  return t('tem novidades para ti');
}

/** Para onde leva tocar na notificação: a publicação do pedido, ou o livro das geladas. */
export function geladaNoticeTarget(kind: string, d: { postId?: string }): string {
  if ((kind === 'gelada_tag' || kind === 'gelada_answer') && d.postId) return `/p/${d.postId}`;
  return '/geladas';
}

/* ───────────── o local no «Já paguei» ───────────── */

/** «✓ estiveram lá»: até 150 m do local (o mesmo raio do servidor, GELADA_NEAR_M em apps/api/src/gelada/gelada.service.ts). */
export const NEAR_M = 150;

export interface LatLngLike { lat: number; lng: number }

/** Distância em metros entre dois pontos (haversine). */
export function metersBetween(a: LatLngLike, b: LatLngLike): number {
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** «a 80 m» / «a 1,2 km» / «a 12 km». */
export function distanceLabel(m: number): string {
  if (m < 1000) return `a ${Math.max(10, Math.round(m / 10) * 10)} m`;
  const km = m / 1000;
  return `a ${km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km)} km`;
}

/** A etiqueta do local: «no Bar Costa» (a discoteca é «na»). */
export const venueTag = (v: { name: string; kind?: string | null }) => `${v.kind === 'discoteca' ? 'na' : 'no'} ${v.name}`;

/**
 * Os locais para escolher no «Já paguei», do mais perto para o mais longe (os sem ponto no mapa vão no fim, pela ordem que
 * vieram). `near`: estou dentro do raio (vai ter o selo «✓ estiveram lá»).
 */
export function venuesByDistance<T extends { slug: string; lat: number | null; lng: number | null }>(list: T[], at: LatLngLike | null): (T & { meters: number | null; near: boolean })[] {
  const seen = new Set<string>();
  const out = list
    .filter((v) => (seen.has(v.slug) ? false : (seen.add(v.slug), true)))
    .map((v, i) => {
      const meters = at && v.lat != null && v.lng != null ? metersBetween(at, { lat: v.lat, lng: v.lng }) : null;
      return { ...v, meters, near: meters != null && meters <= NEAR_M, i };
    });
  out.sort((a, b) => (a.meters ?? Infinity) - (b.meters ?? Infinity) || a.i - b.i);
  return out.map(({ i: _i, ...v }) => v as T & { meters: number | null; near: boolean });
}

/* ───────────── erros ───────────── */

/** Os `code` da API dos erros sem frase própria (genéricos, validação, sem mensagem): no lugar deles vai a frase do ecrã. */
const GENERIC_CODES = GENERIC_ERROR_CODES;

/**
 * O texto do erro de um pedido da gelada: a frase do servidor (já em português, com o @ da pessoa, p.ex. «Já pediste 3
 * geladas ao @ana hoje. Amanhã há mais 🍻»), menos quando é genérica ou em inglês. `fallback`: a frase do ecrã.
 */
export function geladaErrorText(e: unknown, fallback: string): string {
  const err = (e ?? {}) as { status?: number; message?: unknown; code?: unknown; extra?: Record<string, unknown> };
  const msg = typeof err.message === 'string' ? err.message.trim() : '';
  const code = typeof err.code === 'string' ? err.code : typeof err.extra?.code === 'string' ? err.extra.code : undefined;
  if (err.status === 429 && (!msg || code === 'too_many_requests')) return t('Foram muitos pedidos seguidos. Espera um bocadinho e tenta outra vez.');
  if (!err.status && /failed to fetch|network|timeout|load failed/i.test(msg)) return t('Parece que estás sem rede. Tenta outra vez quando tiveres ligação.');
  if (!msg || (code && GENERIC_CODES.has(code)) || (err.status ?? 0) >= 500) return fallback;
  return msg;
}
