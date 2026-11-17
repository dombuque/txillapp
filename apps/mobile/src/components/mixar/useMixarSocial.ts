import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import type { MixarItem, MixarReactionId } from '@/lib/api.mixar';
import { mixarSocialApi, mixarSocialKeys, type MixarItemSocial } from '@/lib/api.mixarSocial';
import { applyPresence, autoSaves, moreErrorText, moreResult, PRESENCE_EVERY_MS, SAVED_TOAST, theirChanges, type Presence } from '@/lib/mixarSocial';
import { onMixarLive } from '@/lib/realtime';
import { t } from '@/lib/i18n';

const NOBODY: Presence = { here: false, postId: null };

/**
 * O lado social do ecrã do Mixar (docs/mixar-contrato.md, «Social e guardados»), num só hook para o ecrã mexer o mínimo:
 *  - os contadores do carril (quantos comentários e se está nos Guardados) para os itens carregados;
 *  - guardar e tirar dos Guardados (com o aviso curto);
 *  - «ver juntos»: a minha presença de 20 em 20 s e quando mudo de item (sai ao fechar, ao perder o foco ou com a app em
 *    segundo plano) e a do outro (pelo tempo real, onMixarLive, e pela resposta de cada batimento);
 *  - a animação das reações do outro: compara o `theirs` de cada item depois de cada leitura do feed;
 *  - «Mais 5»: quantas vezes ainda dá hoje e o pedido.
 * `enabled` false (pré-visualização, Mixar pendente) desliga tudo.
 */
export function useMixarSocial({ id, enabled, items, activePostId, presenceOn, say }: {
  id: string;
  enabled: boolean;
  items: readonly MixarItem[];
  activePostId: string | null;
  /** A presença só no feed do dia, com o ecrã em foco. */
  presenceOn: boolean;
  say: (t: string) => void;
}) {
  const qc = useQueryClient();
  const sayRef = useRef(say);
  sayRef.current = say;

  /* ---------- Contadores do carril ---------- */
  const ids = useMemo(() => items.map((i) => i.post.id).slice(0, 50), [items]);
  const idsKey = ids.join(',');
  const social = useQuery({
    queryKey: mixarSocialKeys.social(id, idsKey),
    queryFn: () => mixarSocialApi.social(id, ids),
    enabled: enabled && ids.length > 0,
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });
  const byPost = useMemo(() => new Map((social.data?.items ?? []).map((s) => [s.postId, s])), [social.data]);
  const socialOf = useCallback((postId: string): MixarItemSocial => byPost.get(postId) ?? { postId, comments: 0, saved: false }, [byPost]);
  const patchSocial = useCallback((postId: string, f: (s: MixarItemSocial) => MixarItemSocial) => {
    qc.setQueryData<{ items: MixarItemSocial[] }>(mixarSocialKeys.social(id, idsKey), (d) => {
      const list = d?.items ?? [];
      const has = list.some((s) => s.postId === postId);
      return { items: has ? list.map((s) => (s.postId === postId ? f(s) : s)) : [...list, f({ postId, comments: 0, saved: false })] };
    });
  }, [qc, id, idsKey]);

  /* ---------- Guardados ---------- */
  const toggleSave = useCallback(async (postId: string) => {
    const was = socialOf(postId).saved;
    patchSocial(postId, (s) => ({ ...s, saved: !was }));
    try {
      await (was ? mixarSocialApi.unsave(id, postId) : mixarSocialApi.save(id, postId));
      sayRef.current(was ? SAVED_TOAST.removed : SAVED_TOAST.saved);
      void qc.invalidateQueries({ queryKey: mixarSocialKeys.saved(id) });
    } catch {
      patchSocial(postId, (s) => ({ ...s, saved: was }));
      sayRef.current(t('Não consegui guardar. Tenta outra vez.'));
    }
  }, [socialOf, patchSocial, id, qc]);
  /** Depois de eu reagir: se os dois reagiram sem «nah», o item entrou sozinho nos Guardados. */
  const afterReact = useCallback((postId: string, mine: MixarReactionId | null, theirs: MixarReactionId | null) => {
    if (!autoSaves(mine, theirs) || socialOf(postId).saved) return;
    patchSocial(postId, (s) => ({ ...s, saved: true }));
    sayRef.current(SAVED_TOAST.both);
    void qc.invalidateQueries({ queryKey: mixarSocialKeys.saved(id) });
  }, [socialOf, patchSocial, qc, id]);

  /* ---------- As reações do outro, na hora ---------- */
  const prevTheirs = useRef<Map<string, MixarReactionId | null> | null>(null);
  const [burst, setBurst] = useState<{ postId: string; reaction: MixarReactionId; seq: number } | null>(null);
  useEffect(() => {
    if (!enabled || !items.length) return;
    const { changes, next } = theirChanges(prevTheirs.current, items);
    prevTheirs.current = next;
    if (!changes.length) return;
    const c = changes.find((x) => x.postId === activePostId) ?? changes[changes.length - 1];
    setBurst((b) => ({ postId: c.postId, reaction: c.reaction, seq: (b?.seq ?? 0) + 1 }));
    // A reação do outro pode ter posto o item nos Guardados (os dois reagiram).
    void qc.invalidateQueries({ queryKey: mixarSocialKeys.social(id) });
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- Ver juntos ---------- */
  const [partner, setPartner] = useState<Presence>(NOBODY);
  const [appActive, setAppActive] = useState(true);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    const onVis = () => setAppActive(typeof document === 'undefined' || document.visibilityState !== 'hidden');
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
    return () => {
      sub.remove();
      if (Platform.OS === 'web' && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  const live = enabled && presenceOn && appActive;
  useEffect(() => {
    if (!enabled) return;
    return onMixarLive((e) => {
      const ev = e as { id?: string; what?: string; here?: boolean; postId?: string | null; self?: boolean };
      if (ev.id !== id) return;
      setPartner((p) => applyPresence(p, ev));
    });
  }, [enabled, id]);
  const postRef = useRef(activePostId);
  postRef.current = activePostId;
  useEffect(() => {
    if (!live) return;
    let stop = false;
    const beat = () => {
      void mixarSocialApi.presence(id, { postId: postRef.current }).then((r) => { if (!stop) setPartner(r.partner); }).catch(() => undefined);
    };
    beat();
    const t = setInterval(beat, PRESENCE_EVERY_MS);
    return () => {
      stop = true;
      clearInterval(t);
      void mixarSocialApi.presence(id, { leave: true }).catch(() => undefined);
    };
  }, [live, id]);
  // Mudei de item: avisa já (o batimento seguinte só daqui a 20 s).
  const firstPost = useRef(true);
  useEffect(() => {
    if (!live || !activePostId) return;
    if (firstPost.current) { firstPost.current = false; return; }
    void mixarSocialApi.presence(id, { postId: activePostId }).then((r) => setPartner(r.partner)).catch(() => undefined);
  }, [activePostId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- «Mais 5» ---------- */
  const moreQ = useQuery({ queryKey: mixarSocialKeys.more(id), queryFn: () => mixarSocialApi.moreLeft(id), enabled, staleTime: 30_000 });
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreNote, setMoreNote] = useState<string | null>(null);
  const more = useCallback(async (onAdded: () => Promise<unknown>) => {
    if (moreBusy) return;
    setMoreBusy(true);
    setMoreNote(null);
    try {
      const r = await mixarSocialApi.more(id);
      qc.setQueryData(mixarSocialKeys.more(id), { left: r.left });
      if (r.added > 0) {
        await onAdded();
        sayRef.current(moreResult(r.added));
      } else setMoreNote(moreResult(0));
    } catch (e) {
      if ((e as { status?: number }).status === 429) qc.setQueryData(mixarSocialKeys.more(id), { left: 0 });
      setMoreNote(moreErrorText(e));
    } finally {
      setMoreBusy(false);
    }
  }, [moreBusy, id, qc]);

  return { socialVersion: social.dataUpdatedAt, socialOf, toggleSave, afterReact, burst, partner: enabled ? partner : NOBODY, moreLeft: moreQ.data?.left ?? null, moreBusy, moreNote, more };
}
