import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { feedApi } from '@/lib/api.feed';
import { kvGet, kvSet } from '@/lib/kv';
import { cardShadow, colors } from '@/lib/theme';
import { Icon, type IconName } from './Icon';

const KEY = 'txill_profile_nudge';
/** Dias até voltar a lembrar, depois de cada "agora não": cada vez mais espaçado (e deixa de aparecer quando o perfil chega aos 100%). */
const GAPS = [1, 3, 7, 14, 30];

async function read(): Promise<{ next: number; n: number }> {
  try {
    const v = JSON.parse((await kvGet(KEY)) ?? '{}') as { next?: number; n?: number };
    return { next: Number(v.next) || 0, n: Number(v.n) || 0 };
  } catch {
    return { next: 0, n: 0 };
  }
}

const STEPS: Record<string, { icon: IconName; label: string; to: string }> = {
  photo: { icon: 'camera', label: 'Pôr uma foto de perfil', to: '/profile' },
  bio: { icon: 'pencil', label: 'Escrever uma bio', to: '/profile' },
  post: { icon: 'plus', label: 'Fazer o primeiro post', to: '/new' },
  follow: { icon: 'user-plus', label: 'Seguir 3 pessoas', to: '/search' },
  geleira: { icon: 'cheers', label: 'Encher a geleira (3 gostos)', to: '/geleira' },
};

/**
 * Lembrete para completar o perfil (foto, bio, primeiro post, seguir malta, geleira): aparece de tempos em tempos
 * (cada vez mais espaçado) até o perfil estar a 100%. "Agora não" adia.
 */
export function ProfileNudge() {
  const router = useRouter();
  const q = useQuery({ queryKey: ['completeness'], queryFn: feedApi.completeness, staleTime: 5 * 60_000, retry: false });
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    let off = false;
    void read().then((s) => !off && setHidden(Date.now() < s.next));
    return () => {
      off = true;
    };
  }, []);
  const d = q.data;
  if (!d || d.percent >= 100 || hidden) return null;
  const missing = d.steps.filter((s) => !s.done && STEPS[s.id]).slice(0, 3);

  async function later() {
    setHidden(true);
    const st = await read();
    const gap = GAPS[Math.min(st.n, GAPS.length - 1)];
    await kvSet(KEY, JSON.stringify({ n: st.n + 1, next: Date.now() + gap * 86_400_000 }));
  }

  return (
    <View accessibilityLabel="Completa o teu perfil" style={[st.card, cardShadow]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={st.title}>Falta pouco, malta!</Text>
          <Text style={st.sub}>O teu perfil está a {d.percent}%. A malta agradece quando o completas.</Text>
        </View>
        <Pressable onPress={() => void later()} hitSlop={6} style={st.x} accessibilityRole="button" accessibilityLabel="Agora não">
          <Icon name="x" size={18} color={colors.zinc500} />
        </Pressable>
      </View>
      <View style={st.track} accessibilityRole="progressbar">
        <View style={[st.fill, { width: `${Math.max(6, d.percent)}%` }]} />
      </View>
      <View style={{ marginTop: 12, gap: 8 }}>
        {missing.map((s) => {
          const m = STEPS[s.id];
          return (
            <Pressable key={s.id} onPress={() => router.push(m.to as never)} style={({ pressed }) => [st.step, pressed && { opacity: 0.8 }]} accessibilityRole="button">
              <View style={st.stepIco}><Icon name={m.icon} size={17} color={colors.brand} /></View>
              <Text style={st.stepText}>{m.label}</Text>
              <Icon name="chevron-right" size={18} color={colors.zinc300} />
            </Pressable>
          );
        })}
      </View>
      <Pressable onPress={() => void later()} style={{ marginTop: 8, paddingVertical: 8, alignItems: 'center' }} accessibilityRole="button">
        <Text style={{ fontSize: 14, fontWeight: '600', color: colors.zinc500 }}>Agora não</Text>
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  card: { marginHorizontal: 16, marginBottom: 16, borderRadius: 24, backgroundColor: colors.white, padding: 16 },
  title: { fontSize: 17, fontWeight: '800', lineHeight: 21, color: colors.zinc900 },
  sub: { marginTop: 2, fontSize: 14, lineHeight: 20, color: colors.zinc600 },
  x: { width: 36, height: 36, marginRight: -4, marginTop: -4, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  track: { marginTop: 12, height: 8, overflow: 'hidden', borderRadius: 4, backgroundColor: colors.zinc100 },
  fill: { height: '100%', borderRadius: 4, backgroundColor: colors.brand },
  step: { height: 48, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, backgroundColor: '#fafafa', paddingHorizontal: 14 },
  stepIco: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white, boxShadow: '0 1px 2px rgba(0,0,0,0.08)' },
  stepText: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.zinc900 },
});
