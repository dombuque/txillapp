import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { FloatBubble } from '@/components/StoryFloatComments';
import { useReduceMotion } from '@/lib/reduceMotion';
import { FLOAT_GAP } from '@/lib/storyFrame';
import {
  FLOAT_MAX, FLOAT_STEP_MS, floatAdd, floatBusy, floatInit, floatLift, floatRemove, floatSkip, floatStep, floatView,
  type FloatState, type TxilladaComment,
} from '@/lib/txillada';

/**
 * Os comentários da Txillada a flutuar (o estilo dos balões dos mimos, components/StoryFloatComments): à esquerda, em
 * baixo no vídeo. Cada comentário novo entra de baixo, um de cada vez (numa enxurrada, de 0,65 em 0,65 s, saltando os que
 * esperam demais), sobe e desvanece ao fim de 9 s ou quando já não cabe. Quem entra vê só os 3 últimos que já lá estavam.
 * `onHold`: o toque longo num balão (o anfitrião apaga ou expulsa; o autor apaga o seu).
 */
export function LiveFloatComments({ comments, bottom, width, height, onHold }: { comments: readonly TxilladaComment[]; bottom: number; width: number; height: number; onHold?: (c: TxilladaComment) => void }) {
  const reduce = useReduceMotion();
  const [st, setSt] = useState<FloatState>(floatInit);
  const [first, setFirst] = useState(true);
  const [now, setNow] = useState(0);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const max = Math.max(1, Math.min(FLOAT_MAX, Math.floor((height + FLOAT_GAP) / (56 + FLOAT_GAP))));

  // Os comentários que chegam entram na fila; os apagados saem logo.
  useEffect(() => {
    const ids = comments.map((c) => c.id);
    setSt((s) => {
      let n = s;
      const have = new Set(ids);
      for (const e of [...s.queue, ...s.shown.map((x) => x.id)]) if (!have.has(e)) n = floatRemove(n, e);
      if (first) return floatAdd(floatSkip(n, ids.slice(0, -3)), ids.slice(-3));
      return floatAdd(n, ids);
    });
    if (first && ids.length) setFirst(false);
  }, [comments, first]);

  // O relógio: anda enquanto houver fila ou balões à vista; parado, não gasta nada.
  const busy = floatBusy(st);
  useEffect(() => {
    if (!busy) return;
    const tick = () => {
      const at = Date.now();
      setNow(at);
      setSt((s) => floatStep(s, at, max));
    };
    tick();
    const t = setInterval(tick, FLOAT_STEP_MS);
    return () => clearInterval(t);
  }, [busy, max]);

  const entries = floatView(st, now, max);
  const lift = floatLift(entries, heights, 44, FLOAT_GAP);
  const byId = new Map(comments.map((c) => [c.id, c]));
  if (!entries.length) return null;
  return (
    <View style={[s.col, { bottom, width, height }]} pointerEvents="box-none">
      {entries.map((e) => {
        const c = byId.get(e.id);
        if (!c) return null;
        return (
          <FloatBubble
            key={e.id}
            c={{ author: { username: c.author.username, displayName: c.author.displayName, hasAvatar: !!c.author.avatarUrl, verified: c.author.verified, verifiedTier: c.author.verifiedTier }, body: c.body }}
            y={lift[e.id] ?? 0}
            age={e.age}
            leaving={e.leaving}
            reduce={reduce}
            onLongPress={onHold ? () => onHold(c) : undefined}
            label={onHold ? 'Mantém para apagar ou expulsar' : ''}
            onHeight={(h) => setHeights((old) => (old[e.id] === h ? old : { ...old, [e.id]: h }))}
          />
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  col: { position: 'absolute', left: 12, zIndex: 4, elevation: 4 },
});
