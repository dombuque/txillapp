/**
 * Os efeitos de voz na pré-visualização nativa: envia o ficheiro (se ainda não foi), pede ao servidor o som com o efeito
 * (`POST /tchekas/compose/voice-preview`), guarda-o na cache do telemóvel e diz que ficheiro tocar. As contas estão em
 * lib/studio/voicePreview.ts. Um de cada vez; sem rede, toca-se o original e mostra-se uma nota curta.
 */
import { File, Paths } from 'expo-file-system';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, post, raw, waitMediaReady, type MediaState } from '@/lib/api';
import { abs } from '@/lib/config';
import { emptyRecord, withSent } from '@/lib/studio/composeJob';
import { uploadAll, type Signal } from '@/lib/studio/composeRunner';
import { magicMediaId } from '@/lib/studio/magicUploads';
import { loadJobRecord, saveJobRecord } from '@/lib/studio/studioStore';
import { cacheName, failNote, targetId, type FxStatus, type FxTarget } from '@/lib/studio/voicePreview';

const statusOf = (e: unknown) => (e instanceof ApiError ? e.status : (e as { status?: number } | null)?.status);

/** Os sons já preparados nesta sessão (o ficheiro local), para não voltar a pedir ao reabrir o painel. */
const done = new Map<string, string>();

async function mediaFor(draftId: string, t: FxTarget, signal: Signal): Promise<string> {
  // Os vídeos que a Montagem mágica já está a enviar: espera-se por esse envio em vez de mandar outra vez.
  const magic = t.kind === 'video' ? await magicMediaId(draftId, t.key, 90_000) : null;
  if (magic) {
    const st = (await raw(`/media/${magic}/status`)) as MediaState;
    if (st.status !== 'deleted' && st.status !== 'failed' && st.status !== 'rejected') { await waitMediaReady(magic, st); return magic; }
  }
  const rec = (await loadJobRecord(draftId)) ?? emptyRecord(draftId);
  const up = await uploadAll([{ key: t.key, uri: t.uri, mime: t.mime, kind: t.kind }], rec, {
    signal,
    onState: () => undefined,
    onRecord: (r) => {
      const s = r.sent[t.key];
      if (!s) return;
      // Junta só este envio ao registo atual (outro envio pode tê-lo mudado entretanto).
      void loadJobRecord(draftId).then((cur) => saveJobRecord(withSent(cur ?? emptyRecord(draftId), t.key, s)));
    },
  });
  const id = up.ids[t.key];
  if (!id) throw new ApiError(0, 'sem envio');
  return id;
}

async function prepare(draftId: string, t: FxTarget, signal: Signal): Promise<string> {
  const f = new File(Paths.cache, cacheName(t));
  try { if (f.exists && (f.size ?? 0) > 0) return f.uri; } catch { /* sem cache */ }
  const mediaId = await mediaFor(draftId, t, signal);
  const r = (await raw('/tchekas/compose/voice-preview', post({ mediaId, effect: t.effect }))) as { url?: string };
  const url = abs(r?.url);
  if (!url) throw new ApiError(500, 'sem url');
  const out = await File.downloadFileAsync(url, f, { idempotent: true });
  return out.uri;
}

/**
 * O estado de cada alvo (pelo `targetId`) e o ficheiro a tocar. `enabled: false` (a montar, ou sem rascunho) não pede nada.
 * `retry()` volta a tentar os que falharam e podem tentar (chama-se quando se escolhe o efeito outra vez).
 */
export function useVoicePreview(o: { draftId: string; targets: FxTarget[]; enabled: boolean }) {
  const [status, setStatus] = useState<Record<string, FxStatus>>(() => {
    const s: Record<string, FxStatus> = {};
    for (const t of o.targets) { const f = done.get(targetId(t)); if (f) s[targetId(t)] = { state: 'ready', file: f }; }
    return s;
  });
  const [tick, setTick] = useState(0);
  const statusRef = useRef(status);
  statusRef.current = status;
  const busy = useRef(false);
  // Só se pára ao fechar o estúdio: um envio a meio continua (fica no registo e serve ao «Seguinte»).
  const alive = useRef<Signal>({ cancelled: false });
  useEffect(() => { const s = alive.current; s.cancelled = false; return () => { s.cancelled = true; }; }, []);
  const sig = useMemo(() => o.targets.map(targetId).join('\n'), [o.targets]);

  useEffect(() => {
    if (!o.enabled || busy.current) return;
    const next = o.targets.find((t) => {
      const s = statusRef.current[targetId(t)];
      return !s;
    });
    if (!next) return;
    const id = targetId(next);
    const known = done.get(id);
    if (known) { setStatus((m) => ({ ...m, [id]: { state: 'ready', file: known } })); return; }
    const signal = alive.current;
    busy.current = true;
    setStatus((m) => ({ ...m, [id]: { state: 'loading' } }));
    prepare(o.draftId, next, signal)
      .then((file) => { done.set(id, file); setStatus((m) => ({ ...m, [id]: { state: 'ready', file } })); })
      .catch((e) => {
        if (signal.cancelled) { setStatus((m) => { const c = { ...m }; delete c[id]; return c; }); return; }
        const f = failNote(statusOf(e), e instanceof ApiError ? e.message : undefined);
        if (__DEV__) console.warn('[estúdio] efeito de voz', next.effect, statusOf(e), (e as Error)?.message);
        setStatus((m) => ({ ...m, [id]: { state: 'failed', ...f } }));
      })
      .finally(() => { busy.current = false; if (!signal.cancelled) setTick((n) => n + 1); });
  }, [sig, o.enabled, o.draftId, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  /** O ficheiro com o efeito, quando está pronto (senão `null`: toca-se o original). */
  const fileFor = (t: Pick<FxTarget, 'key' | 'uri' | 'effect'>): string | null => {
    const s = status[targetId(t)];
    return s?.state === 'ready' ? s.file : null;
  };
  const retry = () => {
    setStatus((m) => {
      const c = { ...m };
      for (const [k, s] of Object.entries(c)) if (s.state === 'failed' && s.retry) delete c[k];
      return c;
    });
    setTick((n) => n + 1);
  };
  return { status, fileFor, retry };
}
