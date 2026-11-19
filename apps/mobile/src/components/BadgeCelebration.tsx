import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/ui/Button';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useReduceMotion } from '@/lib/reduceMotion';
import { colors } from '@/lib/theme';
import { t } from '@/lib/i18n';
import { VerifiedBadge } from './VerifiedBadge';

/** Cores dos papelinhos: as da marca e as do selo. */
const CONFETTI = ['#d6334f', '#ff9a5b', '#fcd34d', '#ffffff', '#f472b6', '#60a5fa'];
/** Quantos papelinhos caem. */
export const CONFETTI_COUNT = 28;

/** Um papelinho: cai a rodar desde cima, com um atraso e um desvio próprios (calculados uma vez). */
function Piece({ i, width, height }: { i: number; width: number; height: number }) {
  const seed = useMemo(() => ({ x: ((i * 37) % 100) / 100, delay: (i * 97) % 900, drift: (((i * 53) % 60) - 30), spin: 180 + ((i * 41) % 360), w: 6 + (i % 3) * 2 }), [i]);
  const y = useSharedValue(-40);
  const r = useSharedValue(0);
  const o = useSharedValue(1);
  useEffect(() => {
    y.value = withDelay(seed.delay, withTiming(height + 40, { duration: 2600 + (i % 5) * 300, easing: Easing.in(Easing.quad) }));
    r.value = withDelay(seed.delay, withTiming(seed.spin, { duration: 2600 }));
    o.value = withDelay(seed.delay + 2000, withTiming(0, { duration: 900 }));
  }, [height, i, seed, y, r, o]);
  const style = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ translateY: y.value }, { translateX: (seed.drift * y.value) / Math.max(1, height) }, { rotate: `${r.value}deg` }] }));
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, left: seed.x * width, width: seed.w, height: seed.w * 1.6, borderRadius: 2, backgroundColor: CONFETTI[i % CONFETTI.length] }, style]} />;
}

/**
 * «Ganhaste o selo!»: quando a equipa dá um selo (pedido aceite ou à mão no backoffice), a pessoa vê, na próxima vez que
 * abre a app, o selo a entrar em grande com um brilho a pulsar e papelinhos a cair. Só uma vez por selo (o servidor guarda
 * que já foi visto). Com «Reduzir movimento» ligado, aparece sem animação.
 */
export function BadgeCelebration() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const reduce = useReduceMotion();
  const { width, height } = useWindowDimensions();
  const q = useQuery({ queryKey: ['badge-news', user?.id], queryFn: api.badgeNews, enabled: !!user, staleTime: 60_000, refetchOnWindowFocus: true, retry: false });
  const news = q.data?.news ?? null;

  const scale = useSharedValue(reduce ? 1 : 0.2);
  const turn = useSharedValue(reduce ? 0 : -25);
  const glow = useSharedValue(0);
  const textIn = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (!news) return;
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    if (reduce) return;
    scale.value = withSequence(withSpring(1.18, { damping: 7, stiffness: 140 }), withSpring(1, { damping: 10, stiffness: 160 }));
    turn.value = withSpring(0, { damping: 9, stiffness: 120 });
    glow.value = withDelay(400, withRepeat(withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) }), -1, false));
    textIn.value = withDelay(350, withTiming(1, { duration: 420 }));
  }, [news, reduce, scale, turn, glow, textIn]);
  const badgeStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }, { rotate: `${turn.value}deg` }] }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: 0.55 * (1 - glow.value), transform: [{ scale: 1 + glow.value * 0.9 }] }));
  const textStyle = useAnimatedStyle(() => ({ opacity: textIn.value, transform: [{ translateY: (1 - textIn.value) * 14 }] }));

  if (!news) return null;
  const official = news.tier === 'official';
  const done = (go: boolean) => {
    qc.setQueryData(['badge-news', user?.id], { news: null });
    void api.badgeNewsSeen(news.id).catch(() => undefined);
    for (const k of ['profile', 'me']) void qc.invalidateQueries({ queryKey: [k] });
    if (go) router.push('/profile' as never);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => done(false)} statusBarTranslucent>
      <View style={st.back} accessibilityViewIsModal>
        {!reduce ? Array.from({ length: CONFETTI_COUNT }, (_, i) => <Piece key={i} i={i} width={width} height={height} />) : null}
        <View style={st.card}>
          <View style={st.badgeWrap}>
            <Animated.View style={[st.glow, { backgroundColor: news.tier === 'paid' ? '#3b82f6' : colors.brand }, glowStyle]} />
            <Animated.View style={badgeStyle}><VerifiedBadge size={104} tier={news.tier === 'official' || news.tier === 'paid' ? news.tier : 'verified'} /></Animated.View>
          </View>
          <Animated.View style={[{ alignItems: 'center' }, textStyle]}>
            <Text style={st.title} accessibilityRole="header">{official ? t('És a conta oficial!') : t('Ganhaste o selo!')}</Text>
            <Text style={st.text}>{t('O selo aparece ao lado do teu nome em todo o Txillapp: no perfil, nas publicações, nos comentários, nas mensagens e na Txillada.')}</Text>
          </Animated.View>
          <View style={{ alignSelf: 'stretch', gap: 8, marginTop: 20 }}>
            <Button label={t('Ver o meu perfil')} kind="gradient" onPress={() => done(true)} block />
            <Button label={t('Fechar')} kind="ghost" onPress={() => done(false)} block />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  back: { flex: 1, backgroundColor: 'rgba(10,10,14,0.78)', alignItems: 'center', justifyContent: 'center', padding: 20, overflow: 'hidden' },
  card: { width: '100%', maxWidth: 380, borderRadius: 28, backgroundColor: colors.white, paddingHorizontal: 24, paddingTop: 32, paddingBottom: 16, alignItems: 'center' },
  badgeWrap: { width: 150, height: 150, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  glow: { position: 'absolute', width: 120, height: 120, borderRadius: 60 },
  title: { fontSize: 26, fontWeight: '800', color: colors.zinc900, textAlign: 'center' },
  text: { marginTop: 8, fontSize: 16, lineHeight: 22, color: colors.zinc700, textAlign: 'center' },
});
