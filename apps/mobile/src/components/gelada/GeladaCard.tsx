import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { geladaApi, geladaKeys, type GeladaAnswer, type GeladaDrink, type GeladaRequest } from '@/lib/api.gelada';
import { ANSWERS, cardTitle, drinkLabel, handleOf, statusLine, geladaErrorText } from '@/lib/gelada';
import type { LocationMessage } from '@/lib/sendLocation';
import { colors } from '@/lib/theme';
import { CheersPour } from '../CheersPour';
import { DrinkArt } from '../DrinkArt';
import { Icon } from '../Icon';
import { SendLocationSheet } from '../SendLocationSheet';

/** Âmbar escuro para texto em fundo âmbar claro (contraste ≥ 4,5:1). */
export const AMBER_INK = '#92400e';
const CARD_W = 268;

/**
 * A bebida desenhada num «balcão» âmbar (como o desenho das garrafas da geleira), com o emoji ao lado. A bebida escondida
 * (para menores) é um copo de água, sem nome.
 */
export function DrinkHero({ drink, size = 76, compact = false }: { drink: GeladaDrink; size?: number; compact?: boolean }) {
  return (
    <LinearGradient colors={drink.alcoholic && !drink.masked ? ['#fff7e6', '#fde68a'] : ['#f0f9ff', '#bae6fd']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[st.hero, compact && { height: size + 18 }]}>
      <View style={st.glow} />
      {/* Por cima do brilho (na web, o que tem posição absoluta pinta-se por cima do resto). */}
      <View style={{ zIndex: 1 }}><DrinkArt slug={drink.slug} category={drink.category} size={size} /></View>
      <View style={st.shelf} />
    </LinearGradient>
  );
}

/** Os três botões de resposta («Bora!», «Hoje não», «Fica a dever»): «Bora!» cheio, os outros dois lado a lado. */
export function AnswerButtons({ busy, onAnswer, name }: { busy: GeladaAnswer | null; onAnswer: (a: GeladaAnswer) => void; name: string }) {
  const [bora, nope, owe] = ANSWERS;
  return (
    <View style={{ gap: 8 }}>
      <Pressable disabled={!!busy} onPress={() => onAnswer(bora.answer)} style={({ pressed }) => [st.btn, st.bora, pressed && st.pressed, !!busy && busy !== 'accept' && { opacity: 0.5 }]} accessibilityRole="button" accessibilityLabel={`Bora! Aceitar o pedido de ${name}`}>
        <Icon name="cheers" size={20} color="#fff" />
        <Text style={st.boraText}>{busy === 'accept' ? 'A brindar…' : bora.label}</Text>
      </Pressable>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable disabled={!!busy} onPress={() => onAnswer(nope.answer)} style={({ pressed }) => [st.btn, st.ghost, { flex: 1 }, pressed && st.pressed, !!busy && busy !== 'decline' && { opacity: 0.5 }]} accessibilityRole="button" accessibilityLabel={`Hoje não: recusar o pedido de ${name}`}>
          <Text style={st.ghostText}>{nope.label}</Text>
        </Pressable>
        <Pressable disabled={!!busy} onPress={() => onAnswer(owe.answer)} style={({ pressed }) => [st.btn, st.owe, { flex: 1 }, pressed && st.pressed, !!busy && busy !== 'owe' && { opacity: 0.5 }]} accessibilityRole="button" accessibilityLabel={`Fica a dever: fico a dever uma a ${name}`}>
          <Text style={st.oweText} numberOfLines={1}>{owe.label}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** A cor do selo de estado. */
const statusTone = (s: GeladaRequest['status']) =>
  s === 'accepted' ? { bg: '#dcfce7', fg: colors.green700 } : s === 'owed' ? { bg: '#fef3c7', fg: AMBER_INK } : s === 'pending' ? { bg: colors.zinc100, fg: colors.zinc700 } : { bg: colors.zinc100, fg: colors.zinc600 };

/**
 * Responder a um pedido (no chat, no post ou na lista de notificações): chama a API, faz o brinde no «Bora!» e põe em dia
 * a conversa, o livro e as notificações. Devolve o pedido novo (ou null se falhou).
 */
export function useAnswerGelada(onDone?: (r: GeladaRequest) => void) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<GeladaAnswer | null>(null);
  async function answer(id: string, a: GeladaAnswer, other?: string | null) {
    if (busy) return null;
    setBusy(a);
    try {
      const r = await geladaApi.answer(id, a);
      if (a === 'accept' && Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      onDone?.(r.request);
      if (other) void qc.invalidateQueries({ queryKey: ['chat-thread', other] });
      void qc.invalidateQueries({ queryKey: ['chat-list'] });
      void qc.invalidateQueries({ queryKey: geladaKeys.book() });
      return r.request;
    } catch (e) {
      Alert.alert('Não deu', geladaErrorText(e, 'Não consegui responder agora. Tenta outra vez.'));
      return null;
    } finally {
      setBusy(null);
    }
  }
  return { busy, answer };
}

/**
 * O cartão «Paga-me uma» no chat (mensagem kind 'gelada'): a bebida desenhada, «@ana pede-te uma 2M 🍺» e, para quem recebe,
 * «Bora!», «Hoje não» e «Fica a dever». O estado vê-se dos dois lados e põe-se em dia em tempo real (o servidor manda
 * 'edited' aos dois). Depois do «Bora!», os dois podem sugerir um sítio perto (a folha de enviar localização, com os sítios
 * à volta). Sem pedido (a conta de uma das partes foi eliminada): um cartão cinzento.
 */
export function GeladaCard({ r: initial }: { r: GeladaRequest | null | undefined }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [r, setR] = useState<GeladaRequest | null>(initial ?? null);
  const [burst, setBurst] = useState(0);
  const [place, setPlace] = useState(false);
  // O pedido que vem da conversa manda (chega pelo SSE quando a outra pessoa responde); passar a «Bora!» faz o brinde.
  const prev = useRef(initial?.status);
  useEffect(() => {
    setR(initial ?? null);
    if (initial && prev.current === 'pending' && initial.status === 'accepted') setBurst((k) => k + 1);
    prev.current = initial?.status;
  }, [initial]);
  const other = r ? (r.mine ? r.recipient?.username : r.requester?.username) || null : null;
  const { busy, answer } = useAnswerGelada((next) => {
    if (next.status === 'accepted') setBurst((k) => k + 1);
    prev.current = next.status;
    setR(next);
  });

  if (!r) {
    return (
      <View style={[st.card, st.gone]} accessibilityRole="text">
        <Icon name="user-circle" size={18} color={colors.zinc500} />
        <Text style={st.goneText}>Conta eliminada · este pedido já não existe</Text>
      </View>
    );
  }
  const tone = statusTone(r.status);
  const name = handleOf(r.mine ? r.recipient : r.requester);
  async function sendPlace(msg: LocationMessage) {
    if (!other) return null;
    const res = await api.chatSend(other, msg);
    void qc.invalidateQueries({ queryKey: ['chat-thread', other] });
    return res;
  }
  return (
    <View style={st.card} accessibilityLabel={`Paga-me uma. ${cardTitle(r)}. ${statusLine(r.status, handleOf(r.recipient), r.forMe)}`}>
      <DrinkHero drink={r.drink} />
      <View style={st.body}>
        <Text style={st.kicker}>{r.soft ? 'PAGA-ME UM REFRESCO' : 'PAGA-ME UMA'}</Text>
        <Text style={st.title}>{cardTitle(r)}</Text>
        {/* O nome só por baixo do refresco (na bebida com álcool já vai no título). */}
        {r.soft && !r.drink.masked ? <Text style={st.drink} numberOfLines={1}>{drinkLabel(r.drink)} · sem álcool</Text> : null}
        {r.canAnswer ? (
          <View style={{ marginTop: 12 }}>
            <AnswerButtons busy={busy} name={name} onAnswer={(a) => void answer(r.id, a, other)} />
          </View>
        ) : (
          <View style={[st.status, { backgroundColor: tone.bg }]} accessibilityLiveRegion="polite">
            <Text style={[st.statusText, { color: tone.fg }]}>{statusLine(r.status, handleOf(r.recipient), r.forMe)}</Text>
          </View>
        )}
        {r.status === 'accepted' && other ? (
          <Pressable onPress={() => setPlace(true)} style={({ pressed }) => [st.btn, st.ghost, { marginTop: 8 }, pressed && st.pressed]} accessibilityRole="button" accessibilityHint="Abre a folha para enviar um sítio perto">
            <Icon name="map-pin" size={18} color={colors.zinc800} />
            <Text style={st.ghostText}>Sugerir um sítio perto</Text>
          </Pressable>
        ) : null}
        {r.status === 'owed' ? (
          <Pressable onPress={() => router.push('/geladas' as never)} style={({ pressed }) => [st.link, pressed && { opacity: 0.6 }]} accessibilityRole="link">
            <Icon name="file-text" size={16} color={AMBER_INK} />
            <Text style={st.linkText}>Ficou no livro das geladas</Text>
            <Icon name="chevron-right" size={14} color={AMBER_INK} />
          </Pressable>
        ) : null}
      </View>
      <CheersPour n={burst} size={170} />
      {place && <SendLocationSheet allowLive={false} who={name} onSend={sendPlace} onClose={() => setPlace(false)} />}
    </View>
  );
}

const st = StyleSheet.create({
  card: { width: CARD_W, maxWidth: '100%', overflow: 'hidden', borderRadius: 22, borderWidth: 1, borderColor: '#f1e3c4', backgroundColor: '#fff', boxShadow: '0 2px 10px rgba(146,64,14,0.10)' },
  gone: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, borderColor: colors.zinc200, backgroundColor: colors.zinc100, boxShadow: 'none' },
  goneText: { flex: 1, fontSize: 14, color: colors.zinc600, fontStyle: 'italic' },
  hero: { height: 104, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 6 },
  glow: { position: 'absolute', width: 120, height: 120, borderRadius: 60, top: -18, backgroundColor: 'rgba(255,255,255,0.55)' },
  shelf: { position: 'absolute', left: 24, right: 24, bottom: 6, height: 4, borderRadius: 2, backgroundColor: 'rgba(146,64,14,0.18)' },
  body: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 14 },
  kicker: { fontSize: 11, fontWeight: '800', letterSpacing: 1, color: AMBER_INK },
  title: { marginTop: 2, fontSize: 17, lineHeight: 22, fontWeight: '800', color: colors.zinc900 },
  drink: { marginTop: 2, fontSize: 13, color: colors.zinc600 },
  status: { marginTop: 12, alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  statusText: { fontSize: 14, fontWeight: '700' },
  btn: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 14 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
  bora: { backgroundColor: colors.brand },
  boraText: { fontSize: 16, fontWeight: '800', color: '#fff' },
  ghost: { borderWidth: 1, borderColor: colors.zinc300, backgroundColor: '#fff' },
  ghostText: { fontSize: 15, fontWeight: '600', color: colors.zinc800 },
  owe: { backgroundColor: '#fef3c7', borderWidth: 1, borderColor: colors.amber300 },
  oweText: { fontSize: 15, fontWeight: '700', color: AMBER_INK },
  link: { marginTop: 10, minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  linkText: { fontSize: 14, fontWeight: '700', color: AMBER_INK },
});
