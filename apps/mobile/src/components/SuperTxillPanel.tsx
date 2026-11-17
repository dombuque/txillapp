import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Alert, Animated, Easing, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { Avatar } from '@/components/Avatar';
import { FollowButton } from '@/components/FollowButton';
import { NameWithBadge } from '@/components/NameWithBadge';
import { Icon } from '@/components/Icon';
import { SendButton } from '@/components/ui/SendButton';
import { api } from '@/lib/api';
import { aiApi } from '@/lib/api.ai';
import { liveState } from '@/lib/superTxillLive';
import { confirm } from '@/lib/confirm';
import { colors } from '@/lib/theme';
import { FeatureIntro } from './FeatureIntro';
import { t } from '@/lib/i18n';

/** O símbolo do SuperTxill: o balão com cara e o brilho no canto (ícone `supertxill`), diferente do raio do Zás. */
export function Bolt({ size = 20, color = colors.brand }: { size?: number; color?: string }) {
  return <Icon name="supertxill" size={size} color={color} strokeWidth={2.1} />;
}

function BotAvatar({ size }: { size: number }) {
  return (
    <LinearGradient colors={[colors.brand, '#ff9a5b']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' }}>
      <Bolt size={Math.round(size * 0.58)} color="#fff" />
    </LinearGradient>
  );
}

/**
 * O SuperTxill: um ecrã da pilha (/supertxill), aberto a partir das Mensagens e da Pesquisa, só com dados do Txillapp.
 * Por ser um ecrã (e não uma janela por cima), arrastar para trás ou o «voltar» do browser volta para onde estavas.
 */
export function SuperTxillScreen({ onClose, initialTab = 'conversa' }: { onClose: () => void; initialTab?: SuperTxillTab }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<SuperTxillTab>(initialTab);
  const chat = useSuperTxillThread();
  const q = useQuery({ queryKey: ['supertxill-for-you'], queryFn: aiApi.forYou, staleTime: 60_000 });
  const list = q.data ?? [];
  // Procurar malta pelo nome ou pelo @ (a mesma pesquisa da lupa), com um pequeno atraso enquanto se escreve.
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setTerm(text.trim().replace(/^@/, '')), 250);
    return () => clearTimeout(t);
  }, [text]);
  const finding = term.length >= 2;
  const found = useQuery({ queryKey: ['search', term], queryFn: () => api.search(term), enabled: finding, staleTime: 30_000, placeholderData: keepPreviousData });
  const people = found.data?.people ?? [];

  return (
    <>
      <FeatureIntro id="supertxill" />
      <View style={{ flex: 1, backgroundColor: colors.white, alignItems: 'center' }}>
        <View style={{ flex: 1, width: '100%', maxWidth: 576 }}>
          <View style={[s.header, { paddingTop: Math.max(12, insets.top) }]}>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('Voltar')} style={s.back}><Icon name="chevron-left" size={26} /></Pressable>
            <BotAvatar size={40} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.title}>SuperTxill</Text>
              <Text style={s.sub} numberOfLines={1}>{tab === 'conversa' && chat.live === 'writing' ? t('está a escrever…') : tab === 'conversa' && chat.pending ? t('está a pensar…') : t('Escolhido para ti, com o que se passa no Txillapp')}</Text>
            </View>
            {tab === 'conversa' && chat.messages.length > 0 && (
              <Pressable onPress={() => void confirm({ title: t('Apagar a conversa?'), message: t('As mensagens com o SuperTxill saem da tua conta e não voltam.'), confirm: t('Apagar'), danger: true }).then((ok) => { if (ok) chat.clear(); })} accessibilityRole="button" accessibilityLabel={t('Apagar a conversa')} style={s.back}><Icon name="trash" size={20} color={colors.zinc500} /></Pressable>
            )}
          </View>

          <View style={s.tabs} accessibilityRole="tablist">
            {TABS.map((t) => (
              <Pressable key={t.id} onPress={() => setTab(t.id)} accessibilityRole="tab" accessibilityState={{ selected: tab === t.id }} style={[s.tab, tab === t.id && s.tabOn]}>
                <Text style={[s.tabText, tab === t.id && s.tabTextOn]}>{t.label}</Text>
              </Pressable>
            ))}
          </View>

          {tab === 'conversa' ? (
            <Conversa chat={chat} bottom={Math.max(12, insets.bottom + 8)} />
          ) : (
          <>

          <View style={s.findWrap}>
            <View style={s.find}>
              <Icon name="search" size={18} color={colors.zinc500} />
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder={t('Procurar malta pelo nome ou @')}
                placeholderTextColor={colors.zinc500}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                style={s.findInput}
                accessibilityLabel={t('Procurar malta')}
              />
              {text ? (
                <Pressable onPress={() => setText('')} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('Limpar a pesquisa')}><Icon name="x" size={18} color={colors.zinc500} /></Pressable>
              ) : null}
            </View>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: Math.max(24, insets.bottom + 16) }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
            {finding ? (
              <>
                <Text style={s.h2}>{t('Pessoas')}</Text>
                {found.isPending && <ActivityIndicator color={colors.brand} style={{ marginTop: 24 }} />}
                {found.isError && !found.data && <Text accessibilityRole="alert" style={s.note}>{t('Não consegui procurar agora. Tenta outra vez.')}</Text>}
                {found.isSuccess && people.length === 0 && <Text style={[s.note, { color: colors.zinc600, fontSize: 15 }]}>{t('Ninguém com esse nome por aqui.')}</Text>}
                <View style={{ marginTop: 8 }}>
                  {people.map((p) => (
                    <View key={p.username} style={s.row}>
                      <Pressable onPress={() => router.push(`/u/${p.username}` as never)} style={s.who} accessibilityRole="button">
                        <Avatar name={p.displayName} username={p.username} size={48} />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <NameWithBadge name={p.displayName} who={p} style={s.name} gap={4}>
                            {p.isPrivate && <Icon name="lock" size={14} color={colors.zinc500} />}
                          </NameWithBadge>
                          <Text style={s.reason} numberOfLines={1}>@{p.username}{p.followsYou ? (' ' + t('· Segue-te')) : ''}</Text>
                        </View>
                      </Pressable>
                      <View style={{ width: 104 }}>
                        <FollowButton username={p.username} following={p.following} requested={p.requested} isPrivate={p.isPrivate} />
                      </View>
                    </View>
                  ))}
                </View>
              </>
            ) : (
            <>
            <Text style={s.h2}>{t('Malta para ti')}</Text>
            {q.isLoading && <ActivityIndicator color={colors.brand} style={{ marginTop: 24 }} />}
            {q.isError && <Text accessibilityRole="alert" style={s.note}>{t('Não consegui ver agora. Tenta daqui a pouco.')}</Text>}
            {q.isSuccess && list.length === 0 && <Text style={[s.note, { color: colors.zinc600, fontSize: 15 }]}>{t('Ainda não tenho malta para te mostrar. Segue algumas pessoas e põe gostos na tua geleira, e eu aprendo contigo.')}</Text>}
            <View style={{ marginTop: 8 }}>
              {list.map((p) => (
                <View key={p.username} style={s.row}>
                  <Pressable onPress={() => router.push(`/u/${p.username}` as never)} style={s.who} accessibilityRole="button">
                    <Avatar name={p.displayName} username={p.username} size={48} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <NameWithBadge name={p.displayName} who={p} style={s.name} gap={4}>
                        {p.isPrivate && <Icon name="lock" size={14} color={colors.zinc500} />}
                      </NameWithBadge>
                      <Text style={s.reason} numberOfLines={1}>{p.reason}</Text>
                    </View>
                  </Pressable>
                  <View style={{ width: 104 }}>
                    <FollowButton username={p.username} following={false} requested={p.requested} isPrivate={p.isPrivate} />
                  </View>
                </View>
              ))}
            </View>
            </>
            )}
            <Text style={s.box}>{t('Isto é calculado pelo Txillapp, só com dados do Txillapp: quem segues e os gostos da tua geleira. Nada sai para fora. Só aparecem pessoas que aceitam ser sugeridas.')}</Text>
          </ScrollView>
          </>
          )}
        </View>
      </View>
    </>
  );
}

export type SuperTxillTab = 'conversa' | 'malta';
const TABS: { id: SuperTxillTab; label: string }[] = [
  { id: 'conversa', get label() { return t('Conversa'); } },
  { id: 'malta', get label() { return t('Malta para ti'); } },
];
const IDEAS = () => [t('Estou animado hoje: onde anda a malta?'), t('Que eventos há hoje perto de mim?'), t('Há alguma Txillada a decorrer?'), t('Dá-me uma legenda para uma foto na praia')];

/**
 * A conversa com o SuperTxill: a pergunta fica guardada e a resposta chega em segundo plano (pode demorar, o modelo corre no
 * nosso servidor). Enquanto há resposta pendente, o ecrã pergunta de 1,5 em 1,5 s e mostra «SuperTxill está a pensar…».
 */
export function useSuperTxillThread() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['supertxill'], queryFn: aiApi.thread, refetchInterval: (query) => (query.state.data?.pending ? 1500 : false) });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const messages = q.data?.messages ?? [];
  const ask = async (text: string) => {
    const txt = text.trim();
    if (!txt || sending) return false;
    setSending(true);
    setError('');
    try {
      await aiApi.ask(txt);
      await qc.invalidateQueries({ queryKey: ['supertxill'] });
      return true;
    } catch (e) {
      setError((e as Error).message || t('Não consegui enviar. Tenta outra vez.'));
      return false;
    } finally {
      setSending(false);
    }
  };
  const clear = () => {
    void aiApi.clear().catch(() => undefined).then(() => qc.invalidateQueries({ queryKey: ['supertxill'] }));
  };
  const pending = sending || !!q.data?.pending;
  return { messages, pending, live: liveState(messages, pending), loaded: q.isSuccess, failed: q.isError && !q.data, error, ask, clear };
}
type Chat = ReturnType<typeof useSuperTxillThread>;

/** Três pontos a acender um a seguir ao outro, devagar (a pensar, e no fim do texto enquanto escreve). */
function Dots() {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(a, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: Platform.OS !== 'web' }));
    loop.start();
    return () => loop.stop();
  }, [a]);
  const dot = (i: number) => {
    const start = i * 0.2;
    const inputRange = [0, start, start + 0.25, start + 0.5, 1];
    return {
      opacity: a.interpolate({ inputRange, outputRange: [0.3, 0.3, 1, 0.3, 0.3] }),
      transform: [{ translateY: a.interpolate({ inputRange, outputRange: [0, 0, -3, 0, 0] }) }],
    };
  };
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {[0, 1, 2].map((i) => <Animated.View key={i} style={[s.dot, dot(i)]} />)}
    </View>
  );
}

/** «SuperTxill está a pensar…»: antes de chegar o primeiro bocado de texto. */
export function Thinking() {
  return (
    <View style={s.thinkRow} accessibilityLiveRegion="polite" accessibilityLabel={t('SuperTxill está a pensar…')}>
      <BotAvatar size={28} />
      <View style={s.thinkBubble}>
        <Text style={s.thinkText}>{t('SuperTxill está a pensar…')}</Text>
        <Dots />
      </View>
    </View>
  );
}

/** A resposta enquanto o SuperTxill a escreve: a bolha cresce com o texto e tem os três pontinhos no fim. */
function Writing({ body }: { body: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'flex-start' }} accessibilityLiveRegion="polite">
      <View style={[s.writeBubble, s.theirs]}>
        <Text style={s.writeText}>{body}</Text>
        <View style={s.writeDots} accessibilityLabel={t('SuperTxill está a escrever…')}><Dots /></View>
      </View>
    </View>
  );
}

function Conversa({ chat, bottom }: { chat: Chat; bottom: number }) {
  const [text, setText] = useState('');
  const list = useRef<ComponentRef<typeof ScrollView>>(null);
  const send = async (t: string) => {
    if (await chat.ask(t)) setText('');
  };
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={list} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 16, gap: 8 }} onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {chat.failed && <Text accessibilityRole="alert" style={s.note}>{t('Não consegui abrir a conversa. Tenta daqui a pouco.')}</Text>}
        {chat.loaded && chat.messages.length === 0 && !chat.pending && (
          <View style={{ alignItems: 'center', marginTop: 16 }}>
            <BotAvatar size={64} />
            <Text style={s.hello}>{t('Fala, malta!')}</Text>
            <Text style={s.helloSub}>{t('Diz-me como te sentes e eu vejo onde anda a tua malta, o que há perto ou que Txilladas estão a dar. Também te ajudo com legendas e com a app.')}</Text>
            <View style={s.ideas}>
              {IDEAS().map((i) => (
                <Pressable key={i} onPress={() => void send(i)} accessibilityRole="button" style={s.idea}><Text style={s.ideaText}>{i}</Text></Pressable>
              ))}
            </View>
          </View>
        )}
        {chat.messages.map((m) =>
          m.writing ? (
            <Writing key={m.id} body={m.body} />
          ) : (
            <View key={m.id} style={{ flexDirection: 'row', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <Text selectable style={[s.bubble, m.role === 'user' ? s.mine : s.theirs]}>{m.body}</Text>
            </View>
          ),
        )}
        {chat.live === 'thinking' && <Thinking />}
      </ScrollView>
      <View style={[s.composer, { paddingBottom: bottom }]}>
        {!!chat.error && <Text accessibilityRole="alert" style={s.err}>{chat.error}</Text>}
        <View style={s.inputRow}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t('Pergunta ao SuperTxill…')}
            placeholderTextColor={colors.zinc500}
            multiline
            numberOfLines={1}
            maxLength={1000}
            style={s.input}
            accessibilityLabel={t('Pergunta ao SuperTxill')}
            onKeyPress={(e) => {
              const k = e.nativeEvent as unknown as { key: string; shiftKey?: boolean };
              if (Platform.OS === 'web' && k.key === 'Enter' && !k.shiftKey) {
                (e as unknown as { preventDefault?: () => void }).preventDefault?.();
                void send(text);
              }
            }}
          />
          <SendButton onPress={() => void send(text)} disabled={!text.trim() || chat.pending} />
        </View>
        <Text style={s.fine}>{t('O SuperTxill corre no servidor do Txillapp e só vê o que tu já podes ver na app. Pode errar.')}</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  tab: { height: 36, paddingHorizontal: 16, borderRadius: 18, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: colors.zinc900 },
  tabText: { fontSize: 14, fontWeight: '700', color: colors.zinc600 },
  tabTextOn: { color: '#fff' },
  hello: { marginTop: 12, fontSize: 20, fontWeight: '800', color: colors.zinc900 },
  helloSub: { marginTop: 4, fontSize: 15, lineHeight: 21, color: colors.zinc600, textAlign: 'center', maxWidth: 380 },
  ideas: { marginTop: 16, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  idea: { borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 14, paddingVertical: 9 },
  ideaText: { fontSize: 14, fontWeight: '600', color: colors.zinc900 },
  bubble: { maxWidth: '84%', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16, lineHeight: 21, overflow: 'hidden' },
  mine: { backgroundColor: colors.brand, color: '#fff', borderBottomRightRadius: 6 },
  theirs: { backgroundColor: colors.zinc100, color: colors.zinc900, borderBottomLeftRadius: 6 },
  thinkRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  thinkBubble: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 20, borderBottomLeftRadius: 6, backgroundColor: colors.zinc100, paddingHorizontal: 14, paddingVertical: 11 },
  thinkText: { fontSize: 15, color: colors.zinc600 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.brand },
  writeBubble: { maxWidth: '84%', borderRadius: 20, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10 },
  writeText: { fontSize: 16, lineHeight: 21, color: colors.zinc900 },
  writeDots: { marginTop: 6, height: 8, justifyContent: 'center' },
  composer: { borderTopWidth: 1, borderTopColor: colors.zinc100, paddingHorizontal: 12, paddingTop: 8 },
  err: { textAlign: 'center', color: '#dc2626', fontSize: 14, paddingBottom: 6 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, borderRadius: 24, backgroundColor: colors.zinc100, padding: 4 },
  input: { flex: 1, minWidth: 0, minHeight: 40, maxHeight: 128, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10, fontSize: 16, lineHeight: 20, color: colors.zinc900, outlineStyle: 'none' } as object,

  fine: { marginTop: 6, textAlign: 'center', fontSize: 11, color: colors.zinc500 },

  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.zinc100 },
  back: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '800', lineHeight: 22, color: colors.zinc900 },
  sub: { fontSize: 12, color: colors.zinc500 },
  findWrap: { paddingHorizontal: 16, paddingTop: 12 },
  find: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 14 },
  findInput: { flex: 1, height: 44, fontSize: 16, color: colors.zinc900, outlineStyle: 'none' } as object,
  h2: { fontSize: 18, fontWeight: '800', color: colors.zinc900 },
  note: { marginTop: 24, textAlign: 'center', color: colors.zinc500, fontSize: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  who: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontSize: 16, fontWeight: '600', color: colors.zinc900, flexShrink: 1 },
  reason: { fontSize: 14, color: colors.zinc500 },
  box: { marginTop: 24, borderRadius: 16, backgroundColor: colors.zinc50, padding: 14, fontSize: 13, lineHeight: 18, color: colors.zinc600 },
});
