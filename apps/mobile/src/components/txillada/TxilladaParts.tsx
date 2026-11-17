import { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { Icon } from '@/components/Icon';
import { useReduceMotion } from '@/lib/reduceMotion';
import { colors } from '@/lib/theme';
import { fmtTxills, txillsLabel, viewersLabel } from '@/lib/txillada';
import { formatVibes } from '@/lib/vibes';

/** O coral do «AO VIVO» (a cor da marca) e o tom mais claro do gradiente da roda. */
export const LIVE = colors.brand;
const LIVE_2 = '#ff5c6c';

/** Um valor que pulsa de 0 a 1 e volta (parado com «reduzir movimento»). */
function usePulse(ms = 1100) {
  const reduce = useReduceMotion();
  const p = useSharedValue(0);
  useEffect(() => {
    if (reduce) { p.value = 0; return; }
    p.value = withRepeat(withSequence(withTiming(1, { duration: ms / 2, easing: Easing.inOut(Easing.quad) }), withTiming(0, { duration: ms / 2, easing: Easing.inOut(Easing.quad) })), -1);
    return () => cancelAnimation(p);
  }, [reduce, ms, p]);
  return p;
}

/** A pílula «AO VIVO» com o ícone da Txillada a pulsar (e o tempo ao lado, se o houver). */
export function LiveBadge({ time, small = false }: { time?: string; small?: boolean }) {
  const p = usePulse();
  const pulse = useAnimatedStyle(() => ({ opacity: 0.55 + 0.45 * (1 - p.value) }));
  return (
    <View style={[st.badgeRow]} accessibilityRole="text" accessibilityLabel={time ? `Ao vivo, ${time}` : 'Ao vivo'}>
      <View style={[st.badge, small && st.badgeSmall]}>
        <Animated.View style={pulse}><Icon name="txillada" size={small ? 11 : 14} color="#fff" strokeWidth={2.4} /></Animated.View>
        <Text style={[st.badgeText, small && { fontSize: 9.5 }]}>AO VIVO</Text>
      </View>
      {time ? <View style={st.time}><Text style={st.timeText}>{time}</Text></View> : null}
    </View>
  );
}

/** Quantos estão a ver (o olho e o número). */
export function ViewersPill({ n }: { n: number }) {
  return (
    <View style={st.pill} accessibilityLabel={viewersLabel(n)}>
      <Icon name="eye" size={15} color="#fff" strokeWidth={2.1} />
      <Text style={st.pillText}>{n > 999 ? viewersLabel(n).replace(' a ver', '') : String(Math.max(0, n))}</Text>
    </View>
  );
}

/**
 * A roda da foto quando a pessoa está ao vivo (fila dos mimos e perfil): um anel coral a pulsar com a pílula «AO VIVO»
 * por baixo, por cima da foto. Mede 72 px, como a roda dos mimos (components/StoryRing).
 */
/** `price` (0167): uma Txillada privada que ainda não paguei: o cadeado e o preço na pílula, em vez de «AO VIVO». */
export function LiveRing({ children, price }: { children: React.ReactNode; price?: number | null }) {
  const p = usePulse(1400);
  const halo = useAnimatedStyle(() => ({ opacity: 0.55 * (1 - p.value), transform: [{ scale: 1 + 0.1 * p.value }] }));
  return (
    <View style={st.ring}>
      <Animated.View style={[st.halo, halo]} pointerEvents="none" />
      <Svg width={72} height={72} viewBox="0 0 72 72" style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="lr" x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0" stopColor={LIVE} />
            <Stop offset="1" stopColor={LIVE_2} />
          </LinearGradient>
        </Defs>
        <Circle cx={36} cy={36} r={33} fill="none" strokeWidth={3.5} stroke="url(#lr)" />
      </Svg>
      <View style={st.ringInner}>{children}</View>
      <View style={st.ringBadge} pointerEvents="none" accessibilityLabel={price ? `Ao vivo, privada: ${txillsLabel(price)}` : undefined}>
        <Icon name={price ? 'lock' : 'txillada'} size={9} color="#fff" strokeWidth={2.6} />
        <Text style={st.ringBadgeText}>{price ? formatVibes(price, { short: true }) : 'AO VIVO'}</Text>
      </View>
    </View>
  );
}

/** «A Txillada acabou» (a Txillada não se grava: acabada, já não se pode ver), com voltar. */
export function EndedView({ title = 'A Txillada acabou', sub = 'As Txilladas não ficam gravadas: só se veem ao vivo.', onBack }: { title?: string; sub?: string; onBack: () => void }) {
  return (
    <View style={st.center}>
      <View style={st.endIcon}><Icon name="txillada" size={32} color="#fff" /></View>
      <Text style={st.endTitle} accessibilityRole="header">{title}</Text>
      <Text style={st.endSub}>{sub}</Text>
      <Pressable onPress={onBack} style={({ pressed }) => [st.cta, pressed && { opacity: 0.85 }]} accessibilityRole="button">
        <Text style={st.ctaText}>Voltar</Text>
      </Pressable>
    </View>
  );
}

/** O resumo do anfitrião no fim: a duração, o pico de espectadores, os brindes e os comentários. Não fica gravada. */
/**
 * `reopen` (0174): terminou uma Angariação antes da meta: «Reabrir a Angariação» (até `reopen.until`, 24 h), a mesma
 * Txillada outra vez ao vivo, com a meta e o que já se juntou.
 */
export function HostSummary({ duration, peak, cheers, comments, raised = 0, tickets = null, cut, onDone, reopen }: { duration: string; peak: number; cheers: number; comments: number; raised?: number; tickets?: number | null; cut?: boolean; onDone: () => void; reopen?: { goal: number; raised: number; until: string | null; busy: boolean; onPress: () => void } | null }) {
  const items: { label: string; value: string }[] = [
    { label: 'Duração', value: duration },
    { label: 'Pico de espectadores', value: String(peak) },
    { label: 'Brindes', value: String(cheers) },
    { label: 'Comentários', value: String(comments) },
    // Txillada privada e Angariação (0167): as entradas pagas e os Txills oferecidos (já estão na carteira).
    ...(tickets != null ? [{ label: cut ? 'Entradas (devolvidas)' : 'Entradas pagas', value: String(tickets) }] : []),
    ...(raised > 0 ? [{ label: 'Vibes oferecidas', value: fmtTxills(raised) }] : []),
  ];
  return (
    <View style={st.center}>
      <Text style={st.endTitle} accessibilityRole="header">A Txillada acabou e não fica gravada</Text>
      {cut ? <Text style={st.endSub}>A equipa do Txillapp terminou esta Txillada por não cumprir as regras da comunidade.</Text> : <Text style={st.endSub}>Obrigado por teres aberto a Txillada. Aqui fica como correu.</Text>}
      <View style={st.grid}>
        {items.map((i) => (
          <View key={i.label} style={st.cell}>
            <Text style={st.cellValue}>{i.value}</Text>
            <Text style={st.cellLabel}>{i.label}</Text>
          </View>
        ))}
      </View>
      {reopen && !cut ? (
        <View style={st.reopen}>
          <Text style={st.endSub}>{reopenText(reopen.raised, reopen.goal, reopen.until)}</Text>
          <Pressable onPress={reopen.onPress} disabled={reopen.busy} style={({ pressed }) => [st.cta, pressed && { opacity: 0.85 }, reopen.busy && { opacity: 0.6 }]} accessibilityRole="button" testID="txillada-reopen">
            <Text style={st.ctaText}>{reopen.busy ? 'A reabrir…' : 'Reabrir a Angariação'}</Text>
          </Pressable>
        </View>
      ) : null}
      <Pressable onPress={onDone} style={({ pressed }) => [st.cta, reopen && !cut && st.ctaGhost, pressed && { opacity: 0.85 }]} accessibilityRole="button">
        <Text style={st.ctaText}>Concluir</Text>
      </Pressable>
    </View>
  );
}

/** «Faltam N vibes para a meta. Podes reabrir até às 21:40 de amanhã.» */
export function reopenText(raised: number, goal: number, until: string | null, now = Date.now()): string {
  const left = Math.max(0, Math.round(goal - raised));
  const t = until ? Date.parse(until) : NaN;
  let when = '';
  if (Number.isFinite(t) && t > now) {
    const d = new Date(t);
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const sameDay = new Date(now).toDateString() === d.toDateString();
    when = ` Podes reabrir até às ${hm}${sameDay ? '' : ' de amanhã'}.`;
  }
  return `${left === 1 ? 'Falta' : 'Faltam'} ${formatVibes(left)} para a meta.${when}`;
}

/** Um botão redondo de vidro escuro (os mesmos dos visores). */
export function GlassButton({ icon, label, onPress, on = false, children }: { icon?: Parameters<typeof Icon>[0]['name']; label: string; onPress: () => void; on?: boolean; children?: React.ReactNode }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={({ pressed }) => [st.glassBtn, on && st.glassOn, pressed && { transform: [{ scale: 0.92 }] }]} accessibilityRole="button" accessibilityLabel={label}>
      {children ?? (icon ? <Icon name={icon} size={20} color="#fff" strokeWidth={2.2} /> : null)}
    </Pressable>
  );
}

const glass = Platform.OS === 'web' ? ({ backdropFilter: 'blur(14px) saturate(160%)', WebkitBackdropFilter: 'blur(14px) saturate(160%)' } as object) : null;

const st = StyleSheet.create({
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 24, paddingHorizontal: 9, borderRadius: 6, backgroundColor: LIVE },
  badgeSmall: { height: 18, paddingHorizontal: 6, gap: 4, borderRadius: 5 },
  badgeText: { color: '#fff', fontSize: 11.5, fontWeight: '900', letterSpacing: 0.6 },
  time: { height: 24, paddingHorizontal: 8, borderRadius: 6, backgroundColor: 'rgba(14,14,18,0.5)', justifyContent: 'center' },
  timeText: { color: '#fff', fontSize: 12.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 24, paddingHorizontal: 8, borderRadius: 6, backgroundColor: 'rgba(14,14,18,0.5)' },
  pillText: { color: '#fff', fontSize: 12.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
  ring: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', left: 0, top: 0, width: 72, height: 72, borderRadius: 36, borderWidth: 3, borderColor: LIVE_2 },
  ringInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  ringBadge: { position: 'absolute', bottom: -3, alignSelf: 'center', paddingHorizontal: 5, height: 16, borderRadius: 4, backgroundColor: LIVE, borderWidth: 1.5, borderColor: colors.white, flexDirection: 'row', alignItems: 'center', gap: 2, justifyContent: 'center' },
  ringBadgeText: { color: '#fff', fontSize: 8.5, fontWeight: '900', letterSpacing: 0.4 },
  center: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 12 },
  endIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  endTitle: { color: '#fff', fontSize: 22, fontWeight: '800', textAlign: 'center', letterSpacing: -0.3 },
  endSub: { color: 'rgba(255,255,255,0.72)', fontSize: 15, lineHeight: 21, textAlign: 'center', maxWidth: 340 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginTop: 10, maxWidth: 360 },
  cell: { width: 160, paddingVertical: 14, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center', gap: 2 },
  cellValue: { color: '#fff', fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] },
  cellLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '600' },
  cta: { marginTop: 14, height: 48, minWidth: 180, paddingHorizontal: 28, borderRadius: 24, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  ctaGhost: { backgroundColor: 'rgba(255,255,255,0.14)' },
  reopen: { marginTop: 16, alignItems: 'center', gap: 2 },
  glassBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(14,14,18,0.42)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center', ...(glass ?? {}) },
  glassOn: { backgroundColor: 'rgba(214,51,79,0.85)', borderColor: 'rgba(255,255,255,0.2)' },
});
