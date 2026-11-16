/**
 * A Txillada moderna no ecrã (app/txillada/[id]): as reações a flutuar, os olás, «@fulano entrou» e quem está a ver. Os
 * eventos chegam pelo canal da app (lib/realtime → onTxilladaEvent: `txillada.reaction`, `txillada.joined`); a lista
 * «A ver agora» vem da API (GET /txilladas/:id/viewers, de 10 em 10 s e quando alguém entra). A lógica pura está em
 * lib/txilladaFx.ts (com testes). Nada disto se guarda.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { txilladaApi } from '@/lib/api.txillada';
import { onTxilladaEvent } from '@/lib/realtime';
import {
  fxAdd, fxAlive, fxBurst, helloAdd, helloAlive, helloOf, joinAdd, joinBusy, joinInit, joinStep, parseFxEvent, reactGate, withJoined,
  type FxParticle, type FxPerson, type Hello, type JoinState, type ReactionKind,
} from '@/lib/txilladaFx';

export const viewersKey = (id: string) => ['txillada', id, 'viewers'] as const;

type Me = FxPerson | null;

/** `noViewers`: numa Txillada privada (0167) quem vê não tem a lista «A ver agora» (só o anfitrião): não se pede. */
export function useTxilladaFx(o: { id: string; live: boolean; host: boolean; me: Me; reduce: boolean; onCheer: () => boolean; noViewers?: boolean }) {
  const { id, live, host, me, reduce } = o;
  const askViewers = live && !o.noViewers;
  const qc = useQueryClient();
  const [fx, setFx] = useState<FxParticle[]>([]);
  const [joins, setJoins] = useState<JoinState>(joinInit);
  const [hellos, setHellos] = useState<Hello[]>([]);
  const seed = useRef(1);
  const times = useRef<number[]>([]);
  const lastHello = useRef<number | null>(null);
  const reduceRef = useRef(reduce);
  const meRef = useRef(me);
  const cheerRef = useRef(o.onCheer);
  useEffect(() => { reduceRef.current = reduce; meRef.current = me; cheerRef.current = o.onCheer; });

  const viewers = useQuery({
    queryKey: viewersKey(id),
    queryFn: () => txilladaApi.viewers(id),
    enabled: askViewers && !!id,
    refetchInterval: askViewers ? 10_000 : false,
    retry: false,
  });

  // Os eventos do canal: as reações dos outros (as minhas já apareceram ao tocar) e quem entrou.
  useEffect(() => onTxilladaEvent((raw) => {
    const type = (raw as { type?: unknown } | null)?.type;
    if (type === 'txillada.viewers') { void qc.invalidateQueries({ queryKey: viewersKey(id) }); return; }
    const ev = parseFxEvent(raw, id);
    if (!ev) return;
    const now = Date.now();
    const mine = meRef.current?.username;
    if (ev.type === 'txillada.joined') {
      setJoins((s) => joinAdd(s, ev.user, now, mine));
      qc.setQueryData<{ items: FxPerson[]; total: number }>(viewersKey(id), (old) => {
        const items = withJoined(old?.items ?? [], ev.user);
        return { items, total: Math.max(items.length, old?.total ?? 0) };
      });
      return;
    }
    if (mine && ev.from.username === mine) return;
    const s = seed.current++;
    setFx((list) => fxAdd(list, fxBurst(ev.kind, s * 31 + now, now, { n: 2, reduce: reduceRef.current }), now));
    const h = helloOf(ev, `h${s}`, now);
    if (h) setHellos((list) => helloAdd(list, h, now));
  }), [id, qc]);

  // A limpeza: tira os emojis que já chegaram lá acima, os olás passados e passa a fila do «entrou». Parada sem nada.
  const busy = fx.length > 0 || hellos.length > 0 || joinBusy(joins);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => {
      const now = Date.now();
      setFx((l) => fxAlive(l, now));
      setHellos((l) => helloAlive(l, now));
      setJoins((s) => joinStep(s, now));
    }, 300);
    return () => clearInterval(t);
  }, [busy]);

  function burst(kind: ReactionKind, n = 3) {
    const now = Date.now();
    const s = seed.current++;
    setFx((list) => fxAdd(list, fxBurst(kind, s * 31 + now, now, { n, reduce: reduceRef.current }), now));
  }

  /** Um toque numa reação: aparece logo (o leque, e o 👋 em balão); o servidor manda aos outros. Devolve false se for de mais. */
  function react(kind: ReactionKind): boolean {
    const now = Date.now();
    const g = reactGate(times.current, now, kind, lastHello.current, host);
    times.current = g.times;
    if (!g.ok) return false;
    if (kind === 'cheers') {
      // O brinde: os copos (CheersPour), o número e o 🍻 a subir (lib/txilladaRoom.cheer → POST react 'cheers').
      if (!cheerRef.current()) return false;
      burst(kind);
      return true;
    }
    burst(kind);
    if (kind === 'hello') {
      lastHello.current = now;
      const m = meRef.current;
      if (m) {
        const h = helloOf({ type: 'txillada.reaction', txilladaId: id, kind, from: { ...m, host }, to: null }, `me${seed.current++}`, now);
        if (h) setHellos((list) => helloAdd(list, h, now));
      }
    }
    void txilladaApi.react(id, kind).catch(() => undefined);
    return true;
  }

  /** O anfitrião responde a quem entrou: «@ana: Olá @rui 👋». */
  function helloTo(username: string) {
    const now = Date.now();
    const m = meRef.current;
    burst('hello', 2);
    if (m) {
      const h = helloOf({ type: 'txillada.reaction', txilladaId: id, kind: 'hello', from: { ...m, host: true }, to: { username } }, `me${seed.current++}`, now);
      if (h) setHellos((list) => helloAdd(list, h, now));
    }
    void txilladaApi.react(id, 'hello', username).catch(() => undefined);
  }

  return {
    fx,
    hellos,
    joined: joins.shown,
    viewers: viewers.data?.items ?? [],
    viewersTotal: viewers.data?.total ?? 0,
    refreshViewers: () => void viewers.refetch(),
    react,
    helloTo,
    /** Os copos dos brindes dos outros também sobem em 🍻 (o evento `txillada.cheer` de quem usa uma versão antiga). */
    burst,
  };
}
