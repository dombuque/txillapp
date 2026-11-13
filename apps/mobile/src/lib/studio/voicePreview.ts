/**
 * Os efeitos de voz a ouvir na pré-visualização nativa (sem React; testado em tests/studioVoicePreview.test.mjs).
 *
 * O telemóvel não tem a cadeia de áudio do site (Web Audio) e não se quis um módulo nativo novo: o servidor aplica o efeito
 * com a mesma cadeia do ffmpeg da montagem (`POST /tchekas/compose/voice-preview`, docs/montagem.md) e devolve um M4A curto
 * com a mesma duração do original (os tempos batem 1:1). A app toca esse ficheiro em vez do original:
 * - a **voz-off** (enviada como na montagem, `purpose: 'chat'`), com o efeito dela;
 * - o **som original** de cada vídeo (o clipe enviado como na montagem), com o efeito do som original.
 * Os envios ficam no registo do rascunho (lib/studio/composeJob.ts): o «Seguinte» já não os volta a enviar.
 * Só o primeiro minuto de cada ficheiro (a tcheka tem no máximo 60 s): um corte que passe daí ouve-se sem efeito.
 */
import type { VoiceFxId } from './audioDsp';

export const VOICE_PREVIEW_MAX_S = 60;

/** Um ficheiro a preparar com um efeito. `key`: a chave do envio (a `media` do clipe ou `voz:<id>`, como em uploadFiles). */
export interface FxTarget { key: string; uri: string; mime: string; kind: 'voice' | 'video'; effect: VoiceFxId }

export const targetId = (t: Pick<FxTarget, 'key' | 'uri' | 'effect'>) => `${t.key}|${t.uri}|${t.effect}`;

/** O que preparar: a voz-off com efeito e os vídeos com som (um por `media`) quando o som original tem efeito. */
export function previewTargets(o: {
  voice: { id: string; uri?: string; mime?: string; fx: VoiceFxId; duration: number } | null;
  origFx: VoiceFxId;
  clips: readonly { media: string; uri: string; mime: string; video: boolean; from: number; len: number; audible: boolean }[];
}): FxTarget[] {
  const out: FxTarget[] = [];
  const v = o.voice;
  if (v?.uri && v.fx !== 'normal' && v.duration <= VOICE_PREVIEW_MAX_S + 0.05) out.push({ key: `voz:${v.id}`, uri: v.uri, mime: v.mime || 'audio/mp4', kind: 'voice', effect: v.fx });
  if (o.origFx !== 'normal') {
    const seen = new Set<string>();
    for (const c of o.clips) {
      if (!c.video || !c.audible || seen.has(c.media) || c.from + c.len > VOICE_PREVIEW_MAX_S + 0.05) continue;
      seen.add(c.media);
      out.push({ key: c.media, uri: c.uri, mime: c.mime, kind: 'video', effect: o.origFx });
    }
  }
  return out;
}

export type FxStatus = { state: 'loading' } | { state: 'ready'; file: string } | { state: 'failed'; note: string; retry: boolean };

/** A nota curta quando não deu (e se vale a pena tentar outra vez quando se volta a escolher o efeito). */
export function failNote(status: number | null | undefined, message?: string): { note: string; retry: boolean } {
  if (status === 0 || status == null) return { note: 'Sem rede: ouve-se sem o efeito.', retry: true };
  if (status === 429) return { note: message || 'Já ouviste muitos efeitos de voz na última hora. Tenta daqui a um bocado.', retry: true };
  if (status === 422) return { note: message || 'Este som não deu para o efeito: ouve-se sem ele.', retry: false };
  if (status === 401 || status === 403) return { note: 'Entra outra vez na conta para ouvir o efeito.', retry: true };
  return { note: 'Não deu para preparar o efeito: ouve-se sem ele.', retry: true };
}

/** O estado de um grupo (a voz-off, ou o som original de todos os vídeos) para o botão do efeito e a nota. */
export function groupState(list: readonly (FxStatus | undefined)[]): { loading: boolean; note: string | null } {
  if (!list.length) return { loading: false, note: null };
  const loading = list.some((s) => !s || s.state === 'loading');
  const failed = list.find((s): s is Extract<FxStatus, { state: 'failed' }> => s?.state === 'failed');
  return { loading, note: failed ? failed.note : null };
}

/** O nome do ficheiro guardado (na cache do telemóvel) de um alvo: um hash curto da chave, do caminho e do efeito. */
export function cacheName(t: Pick<FxTarget, 'key' | 'uri' | 'effect'>): string {
  const s = targetId(t);
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 + c, 2246822519) >>> 0;
  }
  return `txill-vfx-${t.effect}-${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}.m4a`;
}
