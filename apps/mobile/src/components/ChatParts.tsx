import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { ReportSheet } from '@/components/ReportSheet';
import { Sheet } from '@/components/Sheet';
import { REACTIONS, ReactionArt } from '@/components/StoryParts';
import { api, raw } from '@/lib/api';
import { colors } from '@/lib/theme';
import type { Msg } from './ChatBubbles';

/** Esqueleto a pulsar (como o animate-pulse do site): opacidade 1 -> 0.5 -> 1 em 2 s. */
export function Pulse({ children, style }: { children?: ReactNode; style?: object }) {
  const o = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.sequence([Animated.timing(o, { toValue: 0.5, duration: 1000, useNativeDriver: true }), Animated.timing(o, { toValue: 1, duration: 1000, useNativeDriver: true })]));
    a.start();
    return () => a.stop();
  }, [o]);
  return <Animated.View style={[style, { opacity: o }]}>{children}</Animated.View>;
}

/** Tirar a minha reação a uma mensagem (o `api.ts` só tem o pôr). */
export const unreact = (id: string): Promise<void> => raw(`/chat/messages/${id}/reaction`, { method: 'DELETE' }) as Promise<void>;
/** "Estou a escrever…" para a outra pessoa (no máximo de 3 em 3 segundos). */
export const sendTyping = (username: string): Promise<void> => raw(`/chat/with/${encodeURIComponent(username)}/typing`, { method: 'POST', body: '{}' }) as Promise<void>;
export const stopLiveShare = (id: string): Promise<void> => raw(`/chat/messages/${id}/live`, { method: 'DELETE' }) as Promise<void>;

/** Menu de uma mensagem (carregar e segurar): reações, responder, apagar para todos (as minhas) ou denunciar (as dos outros). */
export function MessageMenu({ m, onClose, onReply, onDone, onError }: { m: Msg; onClose: () => void; onReply: (m: Msg) => void; onDone: () => void; onError: (e: string) => void }) {
  const [report, setReport] = useState(false);
  async function react(id: string, already: boolean) {
    onClose();
    try {
      if (already) await unreact(m.id);
      else await api.chatReact(m.id, id);
      onDone();
    } catch (e) {
      onError((e as Error).message);
    }
  }
  async function remove() {
    onClose();
    await api.chatDelete(m.id).catch((e) => onError((e as Error).message));
    onDone();
  }
  if (report) return <ReportSheet type="message" id={m.id} onClose={() => { setReport(false); onClose(); }} />;
  const row = (icon: 'reply' | 'trash' | 'flag', title: string, sub: string | null, run: () => void, danger = false) => (
    <Pressable key={title} onPress={run} style={({ pressed }) => [st.row, pressed && { backgroundColor: danger ? '#fef2f2' : colors.zinc100 }]} accessibilityRole="button">
      <View style={[st.rowIcon, danger && { backgroundColor: '#fef2f2' }]}><Icon name={icon} size={22} color={danger ? '#b91c1c' : colors.zinc800} /></View>
      <View style={{ flex: 1 }}>
        <Text style={[st.rowTitle, danger && { color: '#b91c1c' }]}>{title}</Text>
        {sub ? <Text style={st.rowSub}>{sub}</Text> : null}
      </View>
    </Pressable>
  );
  return (
    <Sheet title="Mensagem" onClose={onClose}>
      <View style={{ paddingHorizontal: 20 }}>
        <View style={st.reacts} accessibilityRole="toolbar" accessibilityLabel="Reagir">
          {REACTIONS.map((r) => {
            const mine = !!m.reactions?.some((x) => x.mine && x.reaction === r.id);
            return (
              <Pressable key={r.id} onPress={() => void react(r.id, mine)} accessibilityRole="button" accessibilityLabel={r.label} accessibilityState={{ selected: mine }} style={({ pressed }) => [st.react, mine && { backgroundColor: 'rgba(214,51,79,0.15)', borderWidth: 2, borderColor: 'rgba(214,51,79,0.4)' }, pressed && { transform: [{ scale: 0.9 }] }]}>
                <ReactionArt body={r.id} size={34} />
              </Pressable>
            );
          })}
        </View>
        {row('reply', 'Responder', null, () => { onClose(); onReply(m); })}
        {m.fromMe
          ? row('trash', 'Apagar para todos', 'Desaparece da conversa, sem deixar rasto.', () => void remove(), true)
          : row('flag', 'Denunciar mensagem', 'Avisa a moderação. A pessoa não sabe.', () => setReport(true))}
      </View>
    </Sheet>
  );
}

/** Pedido de mensagem: aceitar, recusar ou bloquear. */
export function RequestBar({ name, bottom, onAccept, onDecline, onBlock }: { name: string; bottom: number; onAccept: () => void; onDecline: () => void; onBlock: () => void }) {
  return (
    <View style={[st.request, { paddingBottom: Math.max(bottom, 14) }]}>
      <Text style={st.requestText}><Text style={{ fontWeight: '700' }}>Pedido de mensagem.</Text> Não segues {name}. Se aceitares, podem falar à vontade; se recusares, não és incomodado.</Text>
      <View style={{ marginTop: 12, flexDirection: 'row', gap: 8 }}>
        <Pressable onPress={onAccept} style={[st.btn, { backgroundColor: colors.brand }]} accessibilityRole="button"><Text style={[st.btnText, { color: '#fff', fontWeight: '700' }]}>Aceitar</Text></Pressable>
        <Pressable onPress={onDecline} style={[st.btn, { backgroundColor: colors.zinc100 }]} accessibilityRole="button"><Text style={[st.btnText, { color: colors.zinc800 }]}>Recusar</Text></Pressable>
        <Pressable onPress={onBlock} style={[st.btn, { backgroundColor: colors.zinc100 }]} accessibilityRole="button"><Text style={[st.btnText, { color: '#b91c1c' }]}>Bloquear</Text></Pressable>
      </View>
    </View>
  );
}

/** Aviso no topo quando a outra pessoa não te segue. */
export function NotFollowingNote({ name, left }: { name: string; left: number | null }) {
  return (
    <View style={st.note} accessibilityRole="summary">
      <View style={{ alignItems: 'center', marginBottom: 4 }}><Icon name="info" size={16} color={colors.zinc500} /></View>
      <Text style={st.noteText}>
        <Text style={{ fontWeight: '700', color: colors.zinc800 }}>{name} não te segue.</Text> Pode não ver nem responder à tua mensagem.
      </Text>
      {left !== null ? <Text style={st.noteText}>{left > 0 ? `Podes enviar mais ${left} ${left === 1 ? 'mensagem' : 'mensagens'} até responder.` : 'Aguarda que responda, aceite ou te siga para escreveres outra vez.'}</Text> : null}
    </View>
  );
}

/** Data entre mensagens de dias diferentes. */
export function DayDivider({ label }: { label: string }) {
  return <Text style={st.day}>{label.toUpperCase()}</Text>;
}

const st = StyleSheet.create({
  reacts: { flexDirection: 'row', justifyContent: 'space-between', gap: 4, paddingBottom: 8 },
  react: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, borderRadius: 16, paddingHorizontal: 4, paddingVertical: 12 },
  rowIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 17, fontWeight: '600', color: colors.zinc900 },
  rowSub: { fontSize: 14, color: colors.zinc600 },
  request: { borderTopWidth: 1, borderTopColor: colors.zinc100, paddingHorizontal: 16, paddingTop: 12 },
  requestText: { textAlign: 'center', fontSize: 14, lineHeight: 19, color: colors.zinc700 },
  btn: { flex: 1, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 16, fontWeight: '600' },
  note: { alignSelf: 'center', marginTop: 12, marginBottom: 8, maxWidth: 384, borderRadius: 16, backgroundColor: '#fafafa', borderWidth: 1, borderColor: colors.zinc100, paddingHorizontal: 16, paddingVertical: 12 },
  noteText: { textAlign: 'center', fontSize: 13, lineHeight: 18, color: colors.zinc600 },
  day: { alignSelf: 'center', marginTop: 24, marginBottom: 8, fontSize: 12, fontWeight: '600', letterSpacing: 0.6, color: colors.zinc500 },
});
