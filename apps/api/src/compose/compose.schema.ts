import { z } from 'zod';
import { STICKER_ART } from '../stories/sticker-art';
import { MAX_FADE_S, MAX_SFX, SFX_IDS, VOICE_FX_IDS } from './audio';
import { GIPHY_ID, giphyMediaUrl, sizeOk } from '../gifs/gif';
import {
  ADJUSTS, ANIMS, CAPULANA_PALETTE_IDS, CAPULANA_PATTERN_IDS, CAPULANA_SHAPE_IDS, DEFAULT_ANIM, FILTERS, FONTS, LOOPS, MAX_OVERLAYS, RAMPS,
  TRANSITION_MAX_S, TRANSITION_MIN_S, TRANSITIONS,
} from './effects';
import { LOOK_IDS } from './looks';

/** No máximo 30 clipes numa tcheka (o estúdio nativo e o servidor). */
export const MAX_CLIPS = 30;
export const MAX_TEXTS = 10;
export const MAX_STICKERS = 12;
/** Uma foto sem ritmo fica 3 s no ecrã (como no estúdio). */
export const PHOTO_DEFAULT_MS = 3000;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'A cor tem de ser #rrggbb');
const ms = (max = 600_000) => z.number().int('Os tempos vão em milissegundos inteiros').min(0).max(max);
const fadeMs = z.number().int('Os tempos vão em milissegundos inteiros').min(0, 'O fade vai de 0 a 3 s').max(MAX_FADE_S * 1000, 'O fade vai de 0 a 3 s');
const voiceFx = z.enum(VOICE_FX_IDS, { message: 'Efeito de voz desconhecido' });
const literals = <T extends number>(vals: readonly T[], msg: string) => z.number().refine((v): v is T => (vals as readonly number[]).includes(v), msg);

// ------------------------------------------------------------------ os efeitos do estúdio (docs/estudio-efeitos.md, v1)

const ids = <T extends { id: string }>(l: readonly T[]) => l.map((x) => x.id) as [string, ...string[]];
const between = (a: number, b: number, msg: string) => z.number().min(a, msg).max(b, msg);
const TRANSITION_MSG = `A transição dura de ${String(TRANSITION_MIN_S).replace('.', ',')} a ${String(TRANSITION_MAX_S).replace('.', ',')} s`;

/** Um pano de capulana (`CapulanaSpec`): o padrão, a paleta e a semente. */
export const panoSchema = z
  .object({
    pattern: z.enum(CAPULANA_PATTERN_IDS as [string, ...string[]], { message: 'Pano desconhecido' }),
    palette: z.enum(CAPULANA_PALETTE_IDS as [string, ...string[]], { message: 'Pano desconhecido' }),
    seed: z.number().int().min(0).max(999_999).default(0),
  })
  .strict();
const frac = between(0, 1, 'O enquadramento vai de 0 a 1');
const zoomK = between(1, 1.5, 'O zoom do enquadramento vai de 1 a 1,5');

/** Os efeitos de um clipe (`ClipFx` do estúdio): filtro e intensidade, ajustes, transição de entrada, rampa, inverter, congelar. */
export const clipFxSchema = z
  .object({
    filter: z.object({ id: z.enum(ids(FILTERS), { message: 'Filtro desconhecido' }), amount: between(0, 1, 'A intensidade do filtro vai de 0 a 1').default(1) }).strict().optional(),
    adjust: z
      .object(Object.fromEntries(ADJUSTS.map((a) => [a.id, between(a.min, a.max, `O ajuste ${a.label} vai de ${a.min} a ${a.max}`).optional()])) as Record<string, z.ZodOptional<z.ZodNumber>>)
      .strict()
      .optional(),
    transition: z.object({ type: z.enum(ids(TRANSITIONS), { message: 'Transição desconhecida' }), dur: between(TRANSITION_MIN_S, TRANSITION_MAX_S, TRANSITION_MSG).default(0.5), pano: panoSchema.optional() }).strict().optional(),
    ramp: z.enum(ids(RAMPS), { message: 'Rampa desconhecida' }).optional(),
    reverse: z.boolean().optional(),
    /** Só fotos: a foto é um frame congelado do clipe `from` (o `id` dele), no segundo `at` do ficheiro. */
    freeze: z.object({ from: z.string().min(1).max(60), at: z.number().min(0).max(3600) }).strict().optional(),
    /** Só fotos: o enquadramento (o ponto de interesse, o zoom lento de `from` a `to` e a caixa que não se corta). */
    focus: z.object({ x: frac, y: frac, from: zoomK.default(1), to: zoomK.default(1.07), keep: z.object({ x0: frac, y0: frac, x1: frac, y1: frac }).strict().optional() }).strict().optional(),
    /** Só fotos: a foto inteira numa moldura deste pano de capulana. */
    moldura: panoSchema.optional(),
  })
  .strict();

const at = (max = 61) => z.number().min(0, 'Os tempos das camadas vão de 0 a 61 s').max(max, 'Os tempos das camadas vão de 0 a 61 s');
const overlayAnimSchema = z
  .object({
    in: z.enum(ids(ANIMS), { message: 'Animação desconhecida' }).default(DEFAULT_ANIM.in),
    out: z.enum(ids(ANIMS), { message: 'Animação desconhecida' }).default(DEFAULT_ANIM.out),
    loop: z.enum(ids(LOOPS), { message: 'Animação desconhecida' }).default('nenhuma'),
    inDur: between(0.05, 3, 'A animação dura de 0,05 a 3 s').default(DEFAULT_ANIM.inDur),
    outDur: between(0.05, 3, 'A animação dura de 0,05 a 3 s').default(DEFAULT_ANIM.outDur),
  })
  .strict();
const overlayBase = {
  id: z.string().min(1).max(60),
  start: at(),
  end: at(),
  x: between(-0.5, 1.5, 'A camada tem de ficar perto do quadro'),
  y: between(-0.5, 1.5, 'A camada tem de ficar perto do quadro'),
  scale: between(0.1, 8, 'A escala vai de 0,1 a 8').default(1),
  rot: between(-360, 360, 'A rotação vai de -360° a 360°').default(0),
  anim: overlayAnimSchema.default({ ...DEFAULT_ANIM }),
};
/** Só emojis (com os modificadores, juntadores e bandeiras): o resto é texto e vai num texto. */
const EMOJI = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|[‍️⃣#*0-9]|[\u{e0020}-\u{e007f}])+$/u;
const stickerContentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('emoji'), emoji: z.string().min(1).max(32).regex(EMOJI, 'O sticker de emoji só leva emojis') }).strict(),
  z.object({ type: z.literal('txill'), id: z.string().min(1).max(80).refine((id) => id in STICKER_ART, 'Sticker desconhecido') }).strict(),
  z
    .object({ type: z.literal('gif'), id: z.string().regex(GIPHY_ID, 'GIF inválido'), url: z.string().max(600), w: z.number().int(), h: z.number().int() })
    .strict()
    .transform((g, ctx) => {
      // Só do GIPHY, por https (o mesmo que /api/v1/gifs, o chat e os comentários aceitam: gifs/gif.ts).
      const url = giphyMediaUrl(g.url, g.id);
      if (!url) ctx.addIssue({ code: 'custom', path: ['url'], message: 'O GIF tem de vir do GIPHY' });
      if (!sizeOk(g.w, g.h)) ctx.addIssue({ code: 'custom', path: ['w'], message: 'Tamanho do GIF inválido' });
      return url && sizeOk(g.w, g.h) ? { ...g, url } : z.NEVER;
    }),
  z.object({ type: z.literal('mention'), username: z.string().regex(/^@?[A-Za-z0-9_.]{1,30}$/, 'Menção inválida') }).strict(),
  z.object({ type: z.literal('location'), name: z.string().trim().min(1, 'O local está vazio').max(80, 'O local tem até 80 letras') }).strict(),
  z.object({ type: z.literal('time'), format: z.enum(['hora', 'data', 'hora-data']).default('hora'), at: z.number().int().min(0).max(8.64e15) }).strict(),
  z.object({ type: z.literal('capulana'), shape: z.enum(CAPULANA_SHAPE_IDS as [string, ...string[]], { message: 'Sticker desconhecido' }), pano: panoSchema }).strict(),
], { message: 'Sticker desconhecido' });

/** Uma camada por cima do vídeo (texto ou sticker), como `Overlay` do estúdio. */
export const overlaySchema = z
  .discriminatedUnion('kind', [
    z.object({
      ...overlayBase,
      kind: z.literal('text'),
      text: z.string().max(200, 'Cada texto tem até 200 letras').refine((t) => t.trim().length > 0, 'O texto está vazio'),
      font: z.enum(ids(FONTS), { message: 'Fonte desconhecida' }).default('classica'),
      size: z.number().int('O tamanho da letra vai em px inteiros').min(24, 'Letra pequena demais').max(300, 'Letra grande demais').default(84),
      color: hex.default('#ffffff'),
      align: z.enum(['left', 'center', 'right']).default('center'),
      bg: z.enum(['nenhum', 'cheio', 'suave', 'pano']).default('nenhum'),
      /** As letras cheias com este pano (com `bg: 'pano'`, o pano da faixa). */
      pano: panoSchema.optional(),
      outline: z.boolean().default(false),
      shadow: z.boolean().default(false),
      neon: z.boolean().default(false),
    }).strict(),
    z.object({ ...overlayBase, kind: z.literal('sticker'), sticker: stickerContentSchema, variant: z.enum(['branco', 'coral', 'escuro']).default('branco') }).strict(),
  ], { message: 'Cada camada é um texto ou um sticker' })
  .refine((o) => o.end > o.start, { message: 'A camada tem de sair depois de entrar', path: ['end'] })
  .refine((o) => o.kind !== 'text' || o.bg !== 'pano' || !!o.pano, { message: 'A faixa de pano precisa do pano', path: ['pano'] });

export const composeClipSchema = z.object({
  /** A chave do clipe (o `id` do contrato), para o `freeze.from` de um frame congelado. */
  id: z.string().min(1).max(60).optional(),
  fx: clipFxSchema.optional(),
  /** Vídeos: «Som do vídeo» ligado (por omissão) ou calado, e o volume deste clipe (por cima do `originalVolume`). */
  sound: z.boolean().optional(),
  volume: z.number().min(0, 'O volume vai de 0 a 1').max(1, 'O volume vai de 0 a 1').optional(),
  mediaId: z.string().uuid('Clipe inválido'),
  kind: z.enum(['video', 'photo'], { message: 'Cada clipe é um vídeo ou uma foto' }),
  /** Vídeos: o bocado que entra (ms no ficheiro). */
  trimStartMs: ms().optional(),
  trimEndMs: ms().optional(),
  speed: literals([0.5, 1, 2, 3] as const, 'A velocidade é 0,5×, 1×, 2× ou 3×').optional(),
  /** Fotos: quanto tempo fica no ecrã (sem ritmo). */
  durationMs: z.number().int().min(300, 'Uma foto fica pelo menos 0,3 s').max(10_000, 'Uma foto fica no máximo 10 s').optional(),
  /** Fotos ao ritmo: quantas batidas fica (1, 2 ou 4); sem isto vale o `beats.perPhoto`. */
  beats: literals([1, 2, 4] as const, 'Cada foto fica 1, 2 ou 4 batidas').optional(),
});

export const composeSchema = z
  .object({
    clips: z.array(composeClipSchema).min(1, 'Junta 3 fotos ou grava 3 s').max(MAX_CLIPS, `No máximo ${MAX_CLIPS} clipes numa tcheka`),
    sound: z
      .discriminatedUnion('kind', [
        // A faixa como no resto da API (docs/musica.md): catálogo, artistas de Moçambique ou um clipe de áudio próprio.
        z.object({ kind: z.literal('music'), music: z.record(z.string(), z.unknown()) }),
        z.object({ kind: z.literal('sound'), soundId: z.string().min(3).max(90) }),
      ], { message: 'O som é uma música ({ kind: "music", music }) ou um som ({ kind: "sound", soundId })' })
      .optional(),
    originalVolume: z.number().min(0, 'O volume vai de 0 a 1').max(1, 'O volume vai de 0 a 1').optional(),
    musicVolume: z.number().min(0, 'O volume vai de 0 a 1').max(1, 'O volume vai de 0 a 1').optional(),
    /** Onde começa o trecho da música (ms dentro da faixa), escolhido pela onda no estúdio. */
    musicStartMs: ms().optional(),
    musicFadeInMs: fadeMs.optional(),
    musicFadeOutMs: fadeMs.optional(),
    /** A música baixa quando há voz-off (por omissão, sim). */
    ducking: z.boolean().optional(),
    /** A narração gravada no estúdio: um áudio meu, enviado como os clipes de áudio (`purpose: 'chat'`, privado). */
    voiceOver: z
      .object({
        mediaId: z.string().uuid('Voz-off inválida'),
        startMs: ms(61_000).default(0),
        volume: z.number().min(0, 'O volume vai de 0 a 1').max(1, 'O volume vai de 0 a 1').default(1),
        effect: voiceFx.default('normal'),
      })
      .optional(),
    /** O efeito de voz no som original dos vídeos. */
    originalEffect: voiceFx.optional(),
    soundEffects: z
      .array(z.object({ id: z.enum(SFX_IDS, { message: 'Efeito sonoro desconhecido' }), atMs: ms(61_000) }))
      .max(MAX_SFX, `No máximo ${MAX_SFX} efeitos sonoros`)
      .optional(),
    soundEffectsVolume: z.number().min(0, 'O volume vai de 0 a 1').max(1, 'O volume vai de 0 a 1').optional(),
    beats: z
      .object({
        mode: z.enum(['auto', 'manual']),
        perPhoto: literals([1, 2, 4] as const, 'Cada foto fica 1, 2 ou 4 batidas').optional(),
        bpm: z.number().min(40, 'O ritmo vai de 40 a 240 BPM').max(240, 'O ritmo vai de 40 a 240 BPM').optional(),
      })
      .optional(),
    transition: z.enum(['cut', 'fade', 'slide'], { message: 'A transição é cut, fade ou slide' }).optional(),
    filter: z.enum(LOOK_IDS, { message: 'Filtro desconhecido' }).optional(),
    texts: z
      .array(
        z.object({
          text: z.string().trim().min(1, 'O texto está vazio').max(150, 'Cada texto tem até 150 letras'),
          color: hex.default('#ffffff'),
          /** Cor da caixa por trás (o estilo «coral» do estúdio); sem ela, o texto leva sombra. */
          bg: hex.optional(),
          /** O centro do texto, em fração do vídeo (0 a 1). */
          x: z.number().min(0).max(1).default(0.5),
          y: z.number().min(0).max(1).default(0.62),
          /** Tamanho da letra em fração da largura do vídeo (0,068 ≈ 74 px em 1080, o do estúdio). */
          size: z.number().min(0.02, 'Letra pequena demais').max(0.2, 'Letra grande demais').default(0.068),
          startMs: ms(61_000).default(0),
          endMs: ms(61_000).optional(),
        }),
      )
      .max(MAX_TEXTS, `No máximo ${MAX_TEXTS} textos`)
      .optional(),
    stickers: z
      .array(
        z.object({
          id: z.string().min(1).max(40).refine((id) => id in STICKER_ART, 'Sticker desconhecido'),
          x: z.number().min(-0.5).max(1.5),
          y: z.number().min(-0.5).max(1.5),
          s: z.number().min(0.05).max(1.6),
          r: z.number().min(-3600).max(3600),
          startMs: ms(61_000).optional(),
          endMs: ms(61_000).optional(),
        }),
      )
      .max(MAX_STICKERS, `No máximo ${MAX_STICKERS} stickers`)
      .optional(),
    coverMs: ms(61_000).optional(),
    /** O pano de capulana da tcheka: o das transições de pano que não tragam o delas (por omissão losangos/coral/1, como o site). */
    pano: panoSchema.optional(),
    /** Os textos e stickers do estúdio (docs/estudio-efeitos.md), da camada de baixo para a de cima. */
    overlays: z.array(overlaySchema).max(MAX_OVERLAYS, `No máximo ${MAX_OVERLAYS} textos e stickers`).optional(),
    duet: z.object({ postId: z.string().uuid('Publicação inválida'), layout: z.literal('side').default('side') }).optional(),
  })
  .strict();

export type ComposeInput = z.infer<typeof composeSchema>;

/** O primeiro problema do pedido, numa frase para a pessoa (os erros do zod em inglês viram uma frase genérica). */
export function firstProblem(issues: z.core.$ZodIssue[]): string {
  const i = issues[0];
  if (!i) return 'Pedido inválido';
  const generic = /^(Invalid|Expected|Too|Unrecognized|Number must|String must|Array must|Required)/i.test(i.message) || i.code === 'invalid_type' || i.code === 'unrecognized_keys';
  if (!generic) return i.message;
  const at = i.path.join('.');
  if (i.path[0] === 'clips' && i.path.length === 1 && i.code === 'too_big') return `No máximo ${MAX_CLIPS} clipes numa tcheka`;
  return at ? `Pedido inválido (${at})` : 'Pedido inválido';
}
