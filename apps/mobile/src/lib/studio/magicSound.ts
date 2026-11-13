/**
 * O som dos vídeos para a «Montagem mágica» na app: o telemóvel não descodifica áudio sem um módulo novo, por isso pergunta
 * ao servidor (POST /tchekas/compose/analyze, com o `mediaId` de um clipe já enviado: lib/studio/magicUploads.ts). A resposta
 * fica em memória por ficheiro (um envio não muda). Sem rede ou sem resposta a tempo, devolve `null` e a montagem faz-se só
 * com os frames.
 */
import { post, raw } from '@/lib/api';
import { parseSoundReply, type SoundReply } from './magicFrames';

const replies = new Map<string, SoundReply>();
const asking = new Map<string, Promise<SoundReply | null>>();

/** O que o servidor já disse deste ficheiro (sem esperar). */
export const knownSound = (mediaId: string): SoundReply | null => replies.get(mediaId) ?? null;

/** O som de um vídeo já enviado (`null` sem resposta em `timeoutMs`; o pedido continua e a resposta fica para a próxima). */
export function fetchVideoSound(mediaId: string, timeoutMs: number): Promise<SoundReply | null> {
  const have = replies.get(mediaId);
  if (have) return Promise.resolve(have);
  let p = asking.get(mediaId);
  if (!p) {
    p = (async () => {
      try {
        const r = parseSoundReply(await raw('/tchekas/compose/analyze', post({ mediaId })));
        if (r) {
          replies.set(mediaId, r);
          if (replies.size > 200) replies.delete(replies.keys().next().value as string);
        }
        return r;
      } catch { return null; } finally { asking.delete(mediaId); }
    })();
    asking.set(mediaId, p);
  }
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), Math.max(0, timeoutMs)))]);
}
