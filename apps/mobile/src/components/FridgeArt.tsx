import { useEffect, useId, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

const tr = <T extends string>(s: T, vars?: Record<string, string | number>): string => (vars ? s.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? '')) : s);

/**
 * Pontuação da geleira: quantidade, variedade (grupos diferentes) e gostos avaliados. Não premeia álcool: serve para toda a malta.
 * É a mesma conta do servidor (que manda quando carrega); aqui só serve enquanto o nível não chega.
 */
export function geleiraPoints(items: { kind: string; category: string; alcoholic?: boolean; favorite?: boolean; rating?: number | null; pending?: boolean }[]): number {
  const list = items.filter((i) => !i.pending && (i.kind === 'bebida' || i.kind === 'comida'));
  const fav = list.filter((i) => i.favorite).length;
  const rated = list.filter((i) => i.rating != null).length;
  const cats = new Set(list.map((i) => `${i.kind}:${i.category}`)).size;
  return list.length + fav + Math.floor(rated / 2) + cats;
}

/** Nível da geleira pelos pontos, em calão da malta (txilar, maningue, paulada, madala). */
const STEPS = [1, 12, 30, 60] as const;
export const geleiraLevel = (points: number) => (points <= 0 ? 0 : points >= STEPS[3] ? 4 : points >= STEPS[2] ? 3 : points >= STEPS[1] ? 2 : 1);
export const LEVEL_LABEL = [tr('Geleira seca'), tr('A txilar'), tr('Maningue abastecida'), tr('Paulada garantida'), tr('Madala da paulada')];
/** Quanto falta para o nível seguinte, numa frase. */
export function nextLevelHint(points: number): string {
  const l = geleiraLevel(points);
  if (l === 4) return tr('Nível máximo: madala da paulada!');
  if (l === 0) return tr('Põe o primeiro gosto para começar a txilar.');
  const falta = STEPS[l] - points;
  return tr(falta === 1 ? 'Falta {n} ponto para {next}. Variedade e gostos avaliados valem mais.' : 'Faltam {n} pontos para {next}. Variedade e gostos avaliados valem mais.', { n: falta, next: LEVEL_LABEL[l + 1] });
}

const ITEM_COLORS = ['#fb7185', '#fbbf24', '#34d399', '#60a5fa', '#c084fc', '#fb923c', '#f472b6', '#2dd4bf'];

/** Posições e cores dos ímanes na porta (aparecem à medida que a geleira sobe de nível). */
const MAGNETS: { x: number; y: number; c: string; r: number; shape: 'dot' | 'sq' | 'heart' | 'star' }[] = [
  { x: 30, y: 68, c: '#fb7185', r: 0, shape: 'dot' },
  { x: 33, y: 84, c: '#fbbf24', r: -8, shape: 'sq' },
  { x: 50, y: 98, c: '#34d399', r: 0, shape: 'dot' },
  { x: 52, y: 70, c: '#60a5fa', r: 10, shape: 'sq' },
  { x: 28, y: 100, c: '#c084fc', r: 0, shape: 'heart' },
  { x: 54, y: 84, c: '#f59e0b', r: 0, shape: 'star' },
];
const MAGNET_COUNT = [0, 1, 3, 5, 6];

function Magnet({ m }: { m: (typeof MAGNETS)[number] }) {
  if (m.shape === 'sq') return <Rect x={m.x - 4.5} y={m.y - 3.5} width="9" height="7" rx="2" fill={m.c} transform={`rotate(${m.r} ${m.x} ${m.y})`} />;
  if (m.shape === 'heart') return <Path d={`M${m.x} ${m.y + 5} C${m.x - 9} ${m.y - 1} ${m.x - 4} ${m.y - 7} ${m.x} ${m.y - 3} C${m.x + 4} ${m.y - 7} ${m.x + 9} ${m.y - 1} ${m.x} ${m.y + 5}Z`} fill={m.c} />;
  if (m.shape === 'star') return <Path d={`M${m.x} ${m.y - 5} l1.6 3.4 3.7.5 -2.7 2.6 .7 3.7 -3.3-1.8 -3.3 1.8 .7-3.7 -2.7-2.6 3.7-.5z`} fill={m.c} />;
  return <Circle cx={m.x} cy={m.y} r="4.5" fill={m.c} />;
}

/**
 * A geleira desenhada: um frigorífico com porta de cima e de baixo, puxadores, pés e ímanes. Quanto mais recheada e variada,
 * mais ímanes, mais cor e mais brilho: no topo (madala da paulada) ganha uma coroa e faíscas. Aberta, mostra o interior com
 * prateleiras e tantos "produtos" quantos gostos (até 8).
 */
/** Como o `animate-pulse` do Tailwind: opacidade 1 → 0,5 → 1 em 2 s, sempre. */
const AG = Animated.createAnimatedComponent(G);

export function FridgeArt({ count, level, open = false, invite = false, size = 96 }: { count: number; level: number; open?: boolean; invite?: boolean; size?: number }) {
  const id = useId().replace(/:/g, '');
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!invite) return;
    const ease = Easing.bezier(0.4, 0, 0.6, 1);
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.5, duration: 1000, easing: ease, useNativeDriver: false }),
      Animated.timing(pulse, { toValue: 1, duration: 1000, easing: ease, useNativeDriver: false }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [invite, pulse]);
  const edge = ['#a9c9d9', '#8fd0ee', '#6fc4ea', '#f08aa0', '#e8a317'][level];
  const dots = Math.min(count, 8);
  const h = Math.round(size * 1.3);
  return (
    <Svg width={size} height={h} viewBox="0 0 100 130" accessibilityLabel={`Geleira: ${LEVEL_LABEL[level] ?? ''}`} style={{ overflow: 'visible' }}>
      <Defs>
        <LinearGradient id={`b${id}`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#ffffff" />
          <Stop offset="1" stopColor={level >= 3 ? '#fdeef1' : '#e4f1f8'} />
        </LinearGradient>
        <LinearGradient id={`i${id}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#fffdf2" />
          <Stop offset="1" stopColor="#e2f3fb" />
        </LinearGradient>
        <RadialGradient id={`g${id}`} cx="0.5" cy="0.5" r="0.5">
          <Stop offset="0" stopColor={level >= 4 ? '#fde68a' : '#fbcfe8'} stopOpacity="0.85" />
          <Stop offset="1" stopColor="#fff" stopOpacity="0" />
        </RadialGradient>
      </Defs>

      {/* brilho atrás, a partir do nível 3 */}
      {level >= 3 && <Ellipse cx="50" cy="66" rx="62" ry="72" fill={`url(#g${id})`} />}

      <Ellipse cx="50" cy="124" rx="34" ry="4" fill="#0e7490" opacity="0.12" />
      <Rect x="20" y="118" width="9" height="6" rx="2" fill="#7b9aab" />
      <Rect x="71" y="118" width="9" height="6" rx="2" fill="#7b9aab" />

      <Rect x="14" y="6" width="72" height="114" rx="11" fill={`url(#b${id})`} stroke={edge} strokeWidth={level >= 3 ? 3.4 : 3} />

      {open ? (
        <>
          <Rect x="20" y="12" width="60" height="102" rx="7" fill={`url(#i${id})`} stroke={edge} strokeWidth="1.5" />
          {[38, 62, 86].map((y) => <Rect key={y} x="20" y={y} width="60" height="4.5" fill="#fff" stroke="#9fd6ee" strokeWidth="1" />)}
          {Array.from({ length: dots }).map((_, i) => {
            const shelf = [34, 58, 82][Math.floor(i / 3) % 3];
            return <Circle key={i} cx={28 + (i % 3) * 18} cy={shelf - 5} r="6" fill={ITEM_COLORS[i % ITEM_COLORS.length]} stroke="#fff" strokeWidth="1.5" />;
          })}
          <Path d="M14 6 L-6 14 L-6 112 L14 120 Z" fill="#fff" stroke={edge} strokeWidth="3" strokeLinejoin="round" />
          <Path d="M-6 52 L14 54" stroke={edge} strokeWidth="2.5" />
          <Rect x="-2" y="26" width="3.5" height="16" rx="1.7" fill="#9ab8c8" />
          <Rect x="-2" y="64" width="3.5" height="22" rx="1.7" fill="#9ab8c8" />
          <Circle cx="50" cy="19" r="3" fill="#fde68a" />
        </>
      ) : (
        <>
          <Path d="M14 46 H86" stroke={edge} strokeWidth="3" />
          <Rect x="72" y="22" width="4.5" height="18" rx="2.2" fill="#8aa7b8" />
          <Rect x="72" y="58" width="4.5" height="30" rx="2.2" fill="#8aa7b8" />
          {MAGNETS.slice(0, MAGNET_COUNT[level]).map((m, i) => <Magnet key={i} m={m} />)}
          {invite && (
            <>
              {/* porta entreaberta: uma frincha de luz no lado da dobradiça */}
              <AG opacity={pulse}>
                <Rect x="10.5" y="14" width="4.5" height="98" rx="2" fill="#fde68a" />
                <Rect x="8" y="14" width="3" height="98" rx="1.5" fill="#fde68a" opacity="0.5" />
              </AG>
              {/* seta desenhada a mostrar que se puxa a porta */}
              <AG opacity={pulse} fill="none" stroke="#0ea5e9" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <Path d="M90 54 C101 66 99 84 84 92" />
                <Path d="M83.5 82 L84 92 L94 90" />
              </AG>
            </>
          )}
          <Path d="M22 14 Q24 10 34 10" stroke="#fff" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.9" />
        </>
      )}

      {/* topo da escala: coroa e faíscas */}
      {level >= 4 && (
        <>
          <G transform="translate(50 4)">
            <Path d="M-15 0 l-3 -15 9 6 9 -12 9 12 9 -6 -3 15z" fill="#fde047" stroke="#b45309" strokeWidth="2.4" strokeLinejoin="round" />
          </G>
          <G fill="#fbbf24">
            <Path d="M94 34 l1.8 4.4 4.4 1.8 -4.4 1.8 -1.8 4.4 -1.8 -4.4 -4.4 -1.8 4.4 -1.8z" />
            <Path d="M5 78 l1.4 3.4 3.4 1.4 -3.4 1.4 -1.4 3.4 -1.4 -3.4 -3.4 -1.4 3.4 -1.4z" />
          </G>
        </>
      )}
    </Svg>
  );
}
