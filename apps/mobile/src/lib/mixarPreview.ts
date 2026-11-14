/**
 * Pré-visualização do Mixar em desenvolvimento (só com __DEV__): /mixar/exemplo abre um Mixar de exemplo, com dados em
 * memória e a mesma forma do contrato (docs/mixar-contrato.md), para ver os ecrãs antes de a API estar pronta. As
 * reações, a escolha do desafio e os sinais ficam só neste aparelho; «Ana» escolhe sozinha passado um bocado.
 * Nada disto entra na app publicada: quem o usa pergunta sempre `isMixarPreview(id)`.
 */
import type { Post } from './api';
import type { Mixar, MixarChallenge, MixarFeedPage, MixarItem, MixarReactionId, MixarSummary, mixarApi } from './api.mixar';

export const MIXAR_PREVIEW_ID = 'exemplo';
declare const __DEV__: boolean | undefined;
export const isMixarPreview = (id: string | null | undefined) => id === MIXAR_PREVIEW_ID && typeof __DEV__ !== 'undefined' && !!__DEV__;

const SAMPLE = 'https://storage.googleapis.com/gtv-videos-bucket/sample';
const now = () => new Date().toISOString();
const ana = { username: 'ana_exemplo', displayName: 'Ana Exemplo', hasAvatar: false };

function post(i: number, author: string, body: string, video: string): Post {
  return {
    id: `exemplo-${i}`,
    code: `exemplo${i}`,
    body,
    locationLabel: i % 2 ? 'Maputo' : null,
    media: [{ url: `${SAMPLE}/${video}`, kind: 'video', width: 1280, height: 720 }],
    createdAt: now(),
    author: { id: `autor-${i}`, username: author, displayName: author },
    cheers: 12 * i,
    comments: 3 * i,
    cheered: false,
    reposts: i,
    reposted: false,
    gifts: 0,
    canGift: false,
    kind: 'post',
    gift: null,
  };
}

const POSTS = [
  post(1, 'dj_maputo', 'Marrabenta com batida nova 🔥 #musica', 'ForBiggerBlazes.mp4'),
  post(2, 'golo_certo', 'Que golo! #futebol', 'ForBiggerEscapes.mp4'),
  post(3, 'riso_mz', 'Quando a chapa não pára na tua paragem 😂 #comedia', 'ForBiggerFun.mp4'),
  post(4, 'cozinha_da_avo', 'Matapa como deve ser #comida', 'ForBiggerJoyrides.mp4'),
];

const state = {
  mixar: {
    id: MIXAR_PREVIEW_ID,
    status: 'active',
    invitedByMe: true,
    partner: ana,
    name: 'Tu + Ana',
    newToday: 4,
    challengePending: true,
    updatedAt: now(),
    createdAt: now(),
    acceptedAt: now(),
    match: 72,
    common: [{ topic: 'musica', label: 'Música', score: 0.9 }, { topic: 'comedia', label: 'Comédia', score: 0.7 }, { topic: 'comida', label: 'Comida', score: 0.4 }],
    onlyMe: [{ topic: 'futebol', label: 'Futebol' }],
    onlyThem: [{ topic: 'moda', label: 'Moda' }, { topic: 'danca', label: 'Dança' }],
    streak: 3,
    matches: 2,
  } as Mixar,
  items: [
    { post: POSTS[0], from: 'both', topic: { topic: 'musica', label: 'Música' }, mine: null, theirs: 'fogo', seenByThem: true },
    { post: POSTS[1], from: 'me', topic: { topic: 'futebol', label: 'Futebol' }, mine: null, theirs: null, seenByThem: false },
    { post: POSTS[2], from: 'them', topic: { topic: 'comedia', label: 'Comédia' }, mine: 'kkk', theirs: 'kkk', seenByThem: true },
    { post: POSTS[3], from: 'both', topic: null, mine: null, theirs: null, seenByThem: false },
  ] as MixarItem[],
  challenge: {
    id: 'desafio-exemplo',
    kind: 'mais_engracado',
    question: 'Qual é o mais engraçado?',
    day: now().slice(0, 10),
    options: POSTS.slice(0, 4),
    myPick: null,
    theirPicked: false,
    theirPick: null,
    match: null,
  } as MixarChallenge,
};

const wait = <T>(v: T, ms = 250) => new Promise<T>((r) => setTimeout(() => r(JSON.parse(JSON.stringify(v)) as T), ms));

/** A mesma forma do `mixarApi`, em memória (só o que o ecrã do Mixar usa). */
export const previewMixarApi: Pick<typeof mixarApi, 'get' | 'feed' | 'react' | 'seen' | 'shared' | 'challenge' | 'pick' | 'accept' | 'decline' | 'leave'> = {
  get: () => wait(state.mixar),
  feed: (): Promise<MixarFeedPage> => wait({ items: state.items, nextCursor: null, day: state.challenge.day }),
  react: async (_id: string, postId: string, reaction: MixarReactionId | null) => {
    const it = state.items.find((x) => x.post.id === postId);
    if (it) it.mine = reaction;
    return wait({ mine: it?.mine ?? null, theirs: it?.theirs ?? null }, 120);
  },
  seen: async () => undefined,
  shared: async () => undefined,
  challenge: () => wait(state.challenge),
  pick: async (_id: string, _c: string, postId: string) => {
    state.challenge.myPick = postId;
    state.mixar.challengePending = false;
    // «Ana» escolhe passados 4 s (a de baixo, para dar «Ana escolheu esta»; a mesma se só houver uma).
    setTimeout(() => {
      const other = state.challenge.options.find((p) => p.id !== postId)?.id ?? postId;
      state.challenge.theirPicked = true;
      state.challenge.theirPick = other;
      state.challenge.match = other === postId;
    }, 4000);
    return wait(state.challenge);
  },
  accept: () => wait(state.mixar),
  decline: () => wait({ ok: true as const }),
  leave: () => wait({ ok: true as const }),
};

/** Para a lista /mixar em desenvolvimento: o resumo do exemplo. */
export const previewSummary = (): MixarSummary => ({ ...state.mixar });
