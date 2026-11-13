/**
 * «Paga-me uma» (lógica pura, sem React nem imports, para os testes em tests/gelada.test.mjs). Os textos seguem os do
 * servidor (apps/api/src/gelada/gelada-cards.ts): o álcool nunca aparece a quem tem menos de 18 anos.
 */

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
  if (d.masked) return 'uma bebida';
  return d.alcoholic ? `uma ${d.name}` : 'um refresco';
}

/** O nome a mostrar por baixo do desenho (o refresco diz qual é; a escondida não diz nada). */
export const drinkLabel = (d: DrinkLike) => (d.masked ? 'Uma bebida' : d.name);

/** Uma pessoa no texto: @utilizador (ou «Conta eliminada»). */
export const handleOf = (p: PersonLike | null | undefined) => (!p || !p.username ? 'Conta eliminada' : `@${p.username}`);

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
  return who.length ? `${who.join(', ')}, ${ask}` : `Paga-me ${drinkPhrase(d)} ${drinkEmoji(d)}`;
}

/** O estado de um pedido, como toda a gente o vê (no cartão do chat e no post). `name`: @ de quem recebeu; `soft`: refresco. */
export function statusLine(status: StatusLike, name: string, forMe = false, soft = false): string {
  const who = forMe ? 'Tu' : name;
  // Refresco (menores): nunca o copo de cerveja.
  const cheers = soft ? '🥤' : '🍻';
  switch (status) {
    case 'accepted': return forMe ? `Disseste «Bora!» ${cheers}` : `${who} pagou ${cheers}`;
    case 'owed': return forMe ? 'Ficaste a dever' : `${who} ficou a dever`;
    case 'declined': return 'Hoje não';
    case 'untagged': return forMe ? 'Saíste deste pedido' : `${who} saiu do pedido`;
    default: return forMe ? 'À tua espera' : `À espera de ${who}`;
  }
}

/** Os três botões, pela ordem: «Bora!», «Hoje não», «Fica a dever». */
export const ANSWERS = [
  { answer: 'accept', label: 'Bora!' },
  { answer: 'decline', label: 'Hoje não' },
  { answer: 'owe', label: 'Fica a dever' },
] as const;

/** «Deves 2 · Devem-te 3» (sem nada: «Tudo em dia 🙌»). Para o livro de outra pessoa: «Deve 2 · Devem-lhe 3». */
export function bookSummary(owe: number, owed: number, mine = true): string {
  if (!owe && !owed) return 'Tudo em dia 🙌';
  return mine ? `Deves ${owe} · Devem-te ${owed}` : `Deve ${owe} · Devem-lhe ${owed}`;
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
  if (d.status === 'paid') return 'Paga 🙌';
  if (d.status === 'forgiven') return 'Perdoada';
  if (d.claimed) return d.iOwe ? 'À espera que confirme' : 'Diz que já pagou';
  return 'Por pagar';
}

/** A sugestão da rodada: «Hoje paga o @rui» (sem género conhecido, «Hoje paga @rui»). */
export const suggestLine = (p: PersonLike | null) => (p && p.username ? `Hoje paga @${p.username}?` : null);

/** O texto pronto para «Publicar o momento» (depois de confirmar uma gelada paga). */
export function momentText(d: { iOwe: boolean; debtor: PersonLike; creditor: PersonLike; drink: DrinkLike }): string {
  const what = d.drink.masked || !d.drink.alcoholic ? 'o refresco' : `a ${d.drink.name}`;
  return d.iOwe ? `Paguei ${what} que devia a ${handleOf(d.creditor)} ${drinkEmoji(d.drink)} Dívida saldada!` : `${handleOf(d.debtor)} pagou ${what} que me devia ${drinkEmoji(d.drink)} Saúde!`;
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
export function geladaNoticeText(kind: string, d: { soft?: boolean; answer?: string; step?: string }): string {
  const cheers = d.soft ? '🥤' : '🍻';
  if (kind === 'gelada_tag') return d.soft ? 'pede-te um refresco numa publicação 🥤' : 'pede-te uma gelada numa publicação 🍻';
  if (kind === 'gelada_answer') {
    if (d.answer === 'accept') return `disse «Bora!» ao teu pedido ${cheers}`;
    if (d.answer === 'owe') return d.soft ? 'ficou a dever-te um refresco' : 'ficou a dever-te uma';
    return 'disse «Hoje não» ao teu pedido';
  }
  if (kind === 'gelada_paid') return d.step === 'claimed' ? 'diz que já te pagou. Confirmas?' : 'confirmou que pagaste 🙌';
  return 'tem novidades para ti';
}

/** Para onde leva tocar na notificação: a publicação do pedido, ou o livro das geladas. */
export function geladaNoticeTarget(kind: string, d: { postId?: string }): string {
  if ((kind === 'gelada_tag' || kind === 'gelada_answer') && d.postId) return `/p/${d.postId}`;
  return '/geladas';
}
