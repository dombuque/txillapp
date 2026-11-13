import type { MessageBlock } from '../chat/chat.service';

/**
 * «Paga-me uma»: as frases das recusas e dos limites (403 e 429), que a app mostra tal e qual. Simpáticas, claras e com o
 * @ da pessoa. `soft`: o pedido é de refresco (há um menor): nunca se fala em geladas.
 */
export const geladaTexts = {
  /** 10 por dia, no total. */
  dayFull: (max: number) => `Já fizeste ${max} pedidos hoje. Amanhã há mais 🍻`,
  /** Escolheu mais amigos do que os pedidos que ainda tem hoje. */
  dayLeft: (left: number) => `Hoje só podes pedir a mais ${left} ${left === 1 ? 'amigo' : 'amigos'}. Tira alguém da lista e manda outra vez.`,
  /** 3 por dia ao mesmo amigo. */
  friendFull: (max: number, name: string, soft: boolean) =>
    `Já pediste ${max} ${soft ? 'refrescos' : 'geladas'} ao @${name} hoje. Amanhã há mais ${soft ? '🥤' : '🍻'}`,
  notFound: (name: string) => `Não encontrei o @${name}. Vê se o nome está bem escrito.`,
  self: 'Não podes pedir uma a ti próprio 😅',
  /** No chat: as regras das mensagens (bloqueio, `dms_allowed`, o limite a quem não me segue). */
  chat: (why: MessageBlock, name: string): string => {
    switch (why) {
      case 'self': return geladaTexts.self;
      case 'gone': return geladaTexts.notFound(name);
      case 'blocked': return `Não dá para mandar pedidos ao @${name}.`;
      case 'closed': return `O @${name} não aceita mensagens novas, por isso o pedido não lhe chega no chat.`;
      case 'waiting': return `O @${name} ainda não te segue nem respondeu às tuas mensagens. Quando responder ou te seguir, já lhe podes pedir 🍻`;
    }
  },
  /** Publicado: só a seguidores mútuos, que aceitam menções e me podem ver. */
  postBlocked: (name: string) => `Não dá para pedir ao @${name}.`,
  postNotMutual: (name: string) => `Em público só pedes a quem te segue e tu segues de volta. Manda ao @${name} no chat 🍻`,
  postNoMentions: (name: string) => `O @${name} não aceita pedidos públicos: manda-lhe no chat.`,
  postCantSee: (name: string) => `O @${name} não consegue ver as tuas publicações: manda-lhe no chat.`,
  /** «Fico a dever-te uma». */
  oweSelf: 'Não podes ficar a dever a ti próprio 😅',
  oweBlocked: (name: string) => `Não dá para ficares a dever ao @${name}.`,
  oweNotLinked: (name: string) => `Só ficas a dever a quem segues ou te segue. Segue o @${name} primeiro.`,
  oweDayFull: (max: number) => `Por hoje já chega: registaste ${max} dívidas. Volta amanhã 😅`,
};
