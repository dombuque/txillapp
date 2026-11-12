import { z } from 'zod';
import { STICKER_ART } from '../stories/sticker-art';
import { MAX_FADE_S, MAX_SFX, SFX_IDS, VOICE_FX_IDS } from './audio';
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

export const composeClipSchema = z.object({
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
