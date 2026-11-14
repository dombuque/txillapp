import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { mixarApi, mixarKeys, type ChatMixar } from '@/lib/api.mixar';
import { CARD_ACTION_LABEL, firstName, mixarCardState, mixarErrorText } from '@/lib/mixar';
import { colors } from '@/lib/theme';
import { Icon } from '../Icon';
import { MIXAR_GRADIENT, MixarBadge } from './MixarBits';

const CARD_W = 268;

/**
 * O cartão do Mixar no chat (mensagem kind 'mixar', feito pelo servidor; docs/mixar-contrato.md). O estado é sempre o
 * atual: quem recebe vê «Aceitar» e «Agora não»; quem convidou vê «À espera de Fulano»; com o Mixar ativo, «Abrir o Mixar»;
 * recusado ou terminado, um estado discreto. `peer`: o nome do outro lado da conversa.
 */
export function MixarCard({ mixar: initial, peer, peerHandle }: { mixar: ChatMixar | null | undefined; peer?: string; peerHandle?: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [m, setM] = useState<ChatMixar | null>(initial ?? null);
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  // O estado que vem da conversa manda (muda quando o outro aceita: o tempo real põe a conversa em dia).
  useEffect(() => setM(initial ?? null), [initial]);
  const partner = firstName(peer);
  const s = mixarCardState(m, partner);

  const refresh = () => {
    if (peerHandle) void qc.invalidateQueries({ queryKey: ['chat-thread', peerHandle] });
    void qc.invalidateQueries({ queryKey: ['chat-list'] });
    void qc.invalidateQueries({ queryKey: mixarKeys.list() });
    if (peerHandle) void qc.invalidateQueries({ queryKey: mixarKeys.with(peerHandle) });
  };
  async function accept() {
    if (!m || busy) return;
    setBusy('accept');
    try {
      const r = await mixarApi.accept(m.id);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      qc.setQueryData(mixarKeys.one(r.id), r);
      setM({ ...m, status: 'active', name: r.name || m.name });
      refresh();
    } catch (e) {
      Alert.alert('Não deu', mixarErrorText(e, 'Não consegui aceitar agora. Tenta outra vez.'));
    } finally {
      setBusy(null);
    }
  }
  async function decline() {
    if (!m || busy) return;
    setBusy('decline');
    try {
      await mixarApi.decline(m.id);
      setM({ ...m, status: 'declined' });
      refresh();
    } catch (e) {
      Alert.alert('Não deu', mixarErrorText(e, 'Não consegui recusar agora. Tenta outra vez.'));
    } finally {
      setBusy(null);
    }
  }
  const open = () => m && router.push(`/mixar/${m.id}` as never);

  if (s.tone === 'off' || s.tone === 'gone') {
    return (
      <View style={[st.card, st.off]} accessibilityRole="text" accessibilityLabel={`${s.title}. ${s.line}`}>
        <Icon name="sparkles" size={18} color={colors.zinc500} />
        <Text style={st.offText}>{s.title === 'Mixar' ? s.line : `${s.title} · ${s.line}`}</Text>
      </View>
    );
  }
  const live = s.tone === 'active';
  return (
    <View style={st.card} accessibilityLabel={`Mixar. ${s.title}. ${s.line}`}>
      <LinearGradient colors={live ? MIXAR_GRADIENT : ['#fff1f2', '#ffe4d6']} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={st.hero}>
        <View style={st.heroRow}>
          <MixarBadge size={40} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[st.kicker, live && { color: 'rgba(255,255,255,0.9)' }]}>MIXAR</Text>
            <Text style={[st.title, live && { color: '#fff' }]} numberOfLines={2}>{s.title}</Text>
          </View>
        </View>
      </LinearGradient>
      <View style={st.body}>
        {s.tone === 'invite' ? <Text style={st.line}>{s.line}</Text> : null}
        {s.tone === 'waiting' ? (
          <View style={st.status} accessibilityLiveRegion="polite">
            <Icon name="clock" size={15} color={colors.zinc700} />
            <Text style={st.statusText}>{s.line}</Text>
          </View>
        ) : null}
        {s.actions.includes('accept') ? (
          <View style={{ gap: 8, marginTop: 12 }}>
            <Pressable disabled={!!busy} onPress={() => void accept()} style={({ pressed }) => [st.btn, st.primary, pressed && st.pressed, busy === 'decline' && { opacity: 0.5 }]} accessibilityRole="button" accessibilityLabel={`Aceitar o Mixar com ${partner}`}>
              <Icon name="sparkles" size={18} color="#fff" />
              <Text style={st.primaryText}>{busy === 'accept' ? 'A juntar…' : CARD_ACTION_LABEL.accept}</Text>
            </Pressable>
            <Pressable disabled={!!busy} onPress={() => void decline()} style={({ pressed }) => [st.btn, st.ghost, pressed && st.pressed, busy === 'accept' && { opacity: 0.5 }]} accessibilityRole="button" accessibilityLabel={`Agora não: recusar o Mixar com ${partner}`}>
              <Text style={st.ghostText}>{busy === 'decline' ? 'A recusar…' : CARD_ACTION_LABEL.decline}</Text>
            </Pressable>
          </View>
        ) : null}
        {s.actions.includes('open') ? (
          <>
            <Text style={st.line}>{s.line}</Text>
            <Pressable onPress={open} style={({ pressed }) => [st.btn, st.primary, { marginTop: 12 }, pressed && st.pressed]} accessibilityRole="button" accessibilityLabel={`Abrir o Mixar ${s.title}`}>
              <Text style={st.primaryText}>{CARD_ACTION_LABEL.open}</Text>
              <Icon name="chevron-right" size={16} color="#fff" strokeWidth={2.6} />
            </Pressable>
          </>
        ) : null}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  card: { width: CARD_W, maxWidth: '100%', overflow: 'hidden', borderRadius: 22, borderWidth: 1, borderColor: '#fbd5dc', backgroundColor: '#fff', boxShadow: '0 2px 10px rgba(214,51,79,0.10)' },
  off: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, borderColor: colors.zinc200, backgroundColor: colors.zinc100, boxShadow: 'none' },
  offText: { flex: 1, fontSize: 14, color: colors.zinc600, fontStyle: 'italic' },
  hero: { paddingHorizontal: 14, paddingVertical: 14 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  kicker: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, color: colors.brand },
  title: { marginTop: 1, fontSize: 17, lineHeight: 22, fontWeight: '800', color: colors.zinc900 },
  body: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 14 },
  line: { fontSize: 14, lineHeight: 19, color: colors.zinc600 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 12, paddingVertical: 6 },
  statusText: { fontSize: 14, fontWeight: '700', color: colors.zinc700 },
  btn: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 14 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
  primary: { backgroundColor: colors.brand },
  primaryText: { fontSize: 16, fontWeight: '800', color: '#fff' },
  ghost: { borderWidth: 1, borderColor: colors.zinc300, backgroundColor: '#fff' },
  ghostText: { fontSize: 15, fontWeight: '600', color: colors.zinc800 },
});
