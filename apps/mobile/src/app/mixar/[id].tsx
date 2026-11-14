import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Platform, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '@/components/BackButton';
import { Icon } from '@/components/Icon';
import { NameWithBadge } from '@/components/NameWithBadge';
import { ActivityIndicator } from '@/components/PontoLoader';
import { RichText } from '@/components/RichText';
import { RailButton, railStyles } from '@/components/reel/ReelExtraActions';
import { MixarBadge, PairAvatars, ReactionBar, ReasonChip, SeenBy, TopicChips } from '@/components/mixar/MixarBits';
import { ChallengePage, DiscoverySheet, EndPage } from '@/components/mixar/MixarPages';
import { api, isTcheka, type Post } from '@/lib/api';
import { mixarApi, mixarKeys, type Mixar, type MixarChallenge, type MixarFeedPage, type MixarItem, type MixarReactionId } from '@/lib/api.mixar';
import { useAuth } from '@/lib/auth';
import { abs } from '@/lib/config';
import { useDesktop } from '@/lib/desktop';
import { useDeskReels } from '@/lib/desktopHooks';
import { enterImmersive, leaveImmersive } from '@/lib/immersive';
import { buildPages, createSeenTracker, firstName, matchLabel, mixarErrorText, nextReaction, type MixarPage } from '@/lib/mixar';
import { isMixarPreview, previewMixarApi } from '@/lib/mixarPreview';
import { colors } from '@/lib/theme';
import { reelMounted } from '@/lib/videoMemory';
import { Reel } from '../(tabs)/reels';

const isWeb = Platform.OS === 'web';
const SHADOW = { textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 } as const;
type Who = { name: string; username?: string };
type Api = typeof previewMixarApi;

/**
 * O Mixar aberto: um feed vertical a dois, um item por ecrã, como as tchekas (o mesmo leitor e o mesmo cartão: Reel).
 * Em cima, «Dom + Ana» com os dois avatares, o match e os temas em comum (tocar abre a Descoberta de interesses). Primeiro
 * o Mixa Challenge do dia (se houver), depois a seleção e, no fim, «Volta amanhã para mais».
 * Em cada item: a razão, a barra das reações exclusivas (a minha e a do outro), «Mandar» (para o chat da outra pessoa) e
 * «Visto por Ana». Ao sair de cada item (ou quando o vídeo acaba) manda um /seen, no máximo um por visita (lib/mixar).
 * Computador: ↑/↓ e ←/→ (e a roda do rato) mudam de item; espaço pausa; ao passar o rato aparecem os botões.
 */
export default function MixarScreen() {
  useEffect(() => { enterImmersive(); return () => leaveImmersive(); }, []);
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const preview = isMixarPreview(id);
  const mx: Api = preview ? previewMixarApi : mixarApi;
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const desktop = useDesktop();
  const [height, setHeight] = useState(0);
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  activeRef.current = active;
  const list = useRef<FlatList<MixarPage>>(null);
  const [discover, setDiscover] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [hover, setHover] = useState(false);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  const say = (t: string) => { setToast(t); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 1800); };

  const m = useQuery({ queryKey: mixarKeys.one(id), queryFn: () => mx.get(id), enabled: !!id, retry: (n, e) => (e as { status?: number }).status !== 404 && n < 2 });
  const mixar = m.data;
  const live = mixar?.status === 'active';
  const feed = useInfiniteQuery({
    queryKey: mixarKeys.feed(id),
    queryFn: ({ pageParam }) => mx.feed(id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l: MixarFeedPage) => l.nextCursor ?? undefined,
    enabled: live,
  });
  const ch = useQuery({ queryKey: mixarKeys.challenge(id), queryFn: () => mx.challenge(id), enabled: live, retry: 1 });
  // À espera da escolha do outro: o tempo real avisa ('pick'/'result'); isto é só a rede de segurança (e a pré-visualização).
  const waiting = !!ch.data?.myPick && ch.data.match == null;
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => void ch.refetch(), preview ? 2000 : 30_000);
    return () => clearInterval(t);
  }, [waiting, preview]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = useMemo(() => feed.data?.pages.flatMap((p) => p.items) ?? [], [feed.data]);
  // O desafio só entra depois de se saber se há (para a lista não saltar uma página quando ele chega).
  const pages = useMemo(() => (feed.isPending || ch.isPending ? [] : buildPages(ch.data ?? null, items, !!feed.hasNextPage)), [feed.isPending, ch.isPending, ch.data, items, feed.hasNextPage]);

  const partner: Who = mixar ? { name: firstName(mixar.partner.displayName), username: mixar.partner.hasAvatar ? mixar.partner.username : undefined } : { name: '' };
  const me: Who = { name: firstName(user?.displayName), username: user?.username };

  /* ---------- Sinais: um /seen por item e por visita ---------- */
  const tracker = useRef(createSeenTracker()).current;
  const activeKey = pages[active]?.kind === 'item' ? (pages[active] as Extract<MixarPage, { kind: 'item' }>).item.post.id : null;
  useEffect(() => { if (activeKey) tracker.enter(activeKey); }, [activeKey, tracker]);
  const onWatch = useCallback((postId: string, w: { ms: number; done: boolean }) => {
    const p = w.done ? tracker.done(postId, w.ms) : tracker.leave(postId, w.ms);
    if (p) void mx.seen(id, p.postId, { watchedMs: p.watchedMs, done: p.done }).catch(() => undefined);
  }, [tracker, mx, id]);
  // Ao sair do ecrã, os «novos hoje» da lista ficam em dia.
  useEffect(() => () => void qc.invalidateQueries({ queryKey: mixarKeys.list() }), [qc]);

  /* ---------- Mudar o feed na cache ---------- */
  const patchItem = useCallback((postId: string, f: (it: MixarItem) => MixarItem) => {
    qc.setQueryData<InfiniteData<MixarFeedPage>>(mixarKeys.feed(id), (d) => d && { ...d, pages: d.pages.map((pg) => ({ ...pg, items: pg.items.map((it) => (it.post.id === postId ? f(it) : it)) })) });
  }, [qc, id]);
  const react = useCallback(async (it: MixarItem, tapped: MixarReactionId) => {
    const before = it.mine;
    const next = nextReaction(before, tapped);
    patchItem(it.post.id, (x) => ({ ...x, mine: next }));
    try {
      const r = await mx.react(id, it.post.id, next);
      patchItem(it.post.id, (x) => ({ ...x, mine: r.mine, theirs: r.theirs }));
    } catch {
      patchItem(it.post.id, (x) => ({ ...x, mine: before }));
      say('Não consegui reagir. Tenta outra vez.');
    }
  }, [patchItem, mx, id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- Mandar para o chat ---------- */
  const [sent, setSent] = useState<Record<string, 'sending' | 'sent'>>({});
  const sendToChat = useCallback(async (p: Post) => {
    if (!mixar || sent[p.id]) return;
    setSent((s) => ({ ...s, [p.id]: 'sending' }));
    try {
      if (!preview) {
        await api.chatSend(mixar.partner.username, { kind: 'post', body: p.id });
        void qc.invalidateQueries({ queryKey: ['chat-thread', mixar.partner.username] });
        void qc.invalidateQueries({ queryKey: ['chat-list'] });
      }
      setSent((s) => ({ ...s, [p.id]: 'sent' }));
      say(`Enviado a ${firstName(mixar.partner.displayName)}`);
      void mx.shared(id, p.id).catch(() => undefined);
    } catch (e) {
      setSent((s) => { const n = { ...s }; delete n[p.id]; return n; });
      say((e as Error).message || 'Não consegui enviar. Tenta outra vez.');
    }
  }, [mixar, sent, preview, qc, mx, id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- Desafio ---------- */
  const [picking, setPicking] = useState(false);
  async function pick(c: MixarChallenge, postId: string) {
    if (picking) return;
    setPicking(true);
    try {
      const r = await mx.pick(id, c.id, postId);
      qc.setQueryData(mixarKeys.challenge(id), r);
      void qc.invalidateQueries({ queryKey: mixarKeys.list() });
    } catch (e) {
      Alert.alert('Não deu', mixarErrorText(e, 'Não consegui guardar a tua escolha. Tenta outra vez.'));
    } finally {
      setPicking(false);
    }
  }
  const openPost = (p: Post) => router.push((isTcheka(p) ? `/r/${p.id}` : `/p/${p.code || p.id}`) as never);

  /* ---------- Convite pendente / sair ---------- */
  const [answering, setAnswering] = useState<null | 'accept' | 'decline' | 'leave'>(null);
  const afterChange = () => {
    void qc.invalidateQueries({ queryKey: mixarKeys.list() });
    if (mixar) {
      void qc.invalidateQueries({ queryKey: mixarKeys.with(mixar.partner.username) });
      void qc.invalidateQueries({ queryKey: ['chat-thread', mixar.partner.username] });
    }
  };
  async function accept() {
    setAnswering('accept');
    try {
      const r = await mx.accept(id);
      qc.setQueryData(mixarKeys.one(id), r);
      afterChange();
    } catch (e) {
      Alert.alert('Não deu', mixarErrorText(e, 'Não consegui aceitar agora. Tenta outra vez.'));
    } finally {
      setAnswering(null);
    }
  }
  async function decline() {
    setAnswering('decline');
    try {
      await mx.decline(id);
      afterChange();
      close();
    } catch (e) {
      Alert.alert('Não deu', mixarErrorText(e));
    } finally {
      setAnswering(null);
    }
  }
  function leave() {
    if (!mixar) return;
    const pending = mixar.status === 'pending';
    Alert.alert(pending ? 'Cancelar o convite?' : 'Sair do Mixar?', pending ? `${partner.name} deixa de ver o convite.` : `O vosso Mixar acaba para os dois. Podes convidar ${partner.name} outra vez quando quiseres.`, [
      { text: 'Ficar', style: 'cancel' },
      { text: pending ? 'Cancelar convite' : 'Sair', style: 'destructive', onPress: () => void (async () => {
        setDiscover(false);
        setAnswering('leave');
        try {
          await mx.leave(id);
          qc.removeQueries({ queryKey: mixarKeys.one(id) });
          afterChange();
          close();
        } catch (e) {
          Alert.alert('Não deu', mixarErrorText(e));
        } finally {
          setAnswering(null);
        }
      })() },
    ]);
  }
  const close = () => (router.canGoBack() ? router.back() : router.replace('/messages' as never));

  /* ---------- A lista ---------- */
  const viewable = useRef(({ viewableItems }: { viewableItems: { index?: number | null }[] }) => {
    const i = viewableItems[0]?.index;
    if (i != null) setActive(i);
  }).current;
  const viewConfig = useRef({ itemVisiblePercentThreshold: 70 }).current;
  useEffect(() => {
    if (height > 0 && activeRef.current > 0) list.current?.scrollToOffset({ offset: activeRef.current * height, animated: false });
  }, [height]);
  useEffect(() => {
    if (pages.length > 0 && active >= pages.length - 3 && feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, pages.length, feed.hasNextPage, feed.isFetchingNextPage]);
  const goTo = useCallback((k: number) => {
    if (k < 0) return;
    if (k >= pages.length) { if (feed.hasNextPage) void feed.fetchNextPage(); return; }
    list.current?.scrollToIndex({ index: k, animated: true });
  }, [pages.length, feed]);
  const goNext = useCallback((index: number) => goTo(index + 1), [goTo]);
  // Computador: ↑/↓, ←/→ e a roda mudam de item (um de cada vez); espaço pausa a tcheka em cena.
  const desk = useDeskReels(focused && !discover, () => activeRef.current, goTo, { arrowsStep: true });

  const colW = desktop && height > 0 ? Math.min(576, Math.round((height * 9) / 16)) : undefined;
  const topPad = Math.max(insets.top, 12);

  const renderPage = ({ item: pg, index }: { item: MixarPage; index: number }) => {
    if (pg.kind === 'challenge') {
      const c = ch.data;
      return c ? <ChallengePage c={c} height={height} me={me} them={partner} busy={picking} onPick={(pid) => void pick(c, pid)} onOpen={openPost} topInset={topPad + 64} /> : <View style={{ height }} />;
    }
    if (pg.kind === 'end') return <EndPage height={height} me={me} them={partner} empty={items.length === 0} onDiscover={() => setDiscover(true)} onBack={close} />;
    const it = pg.item;
    const p = it.post;
    const extra = (
      <View style={st.extra} pointerEvents="box-none">
        <View style={st.reasonRow} pointerEvents="box-none">
          <ReasonChip from={it.from} topic={it.topic} partner={partner.name} />
          {it.seenByThem ? <SeenBy partner={partner} /> : null}
        </View>
        <ReactionBar mine={it.mine} theirs={it.theirs} partner={partner} onPick={(r) => void react(it, r)} />
      </View>
    );
    const sendState = sent[p.id];
    const send = (
      <RailButton
        icon={<View style={[railStyles.circle, sendState === 'sent' && { backgroundColor: 'rgba(16,185,129,0.9)' }]}>{sendState === 'sending' ? <ActivityIndicator color="#fff" /> : <Icon name={sendState === 'sent' ? 'check' : 'send'} size={24} color="#fff" />}</View>}
        label={sendState === 'sent' ? 'Enviado' : 'Mandar'}
        onPress={() => void sendToChat(p)}
        selected={sendState === 'sent'}
        accessibilityLabel={sendState === 'sent' ? `Enviado a ${partner.name}` : `Mandar para o chat de ${partner.name}`}
      />
    );
    const bottomInset = desktop ? Math.max(insets.bottom, 16) : insets.bottom;
    if (isTcheka(p)) {
      return reelMounted(index, active)
        ? <Reel post={p} active={index === active} onScreen={focused && !discover} height={height} me={user?.id} onMore={() => goNext(index)} bottomInset={bottomInset} pauseSignal={desk.pauseSignal} seekSignal={desk.seekSignal} onChange={(c) => patchItem(p.id, (x) => ({ ...x, post: { ...x.post, ...c } }))} infoExtra={extra} extraActions={send} onWatch={(w) => onWatch(p.id, w)} />
        : <PosterPage post={p} height={height} />;
    }
    return <PhotoPage post={p} height={height} active={index === active} extra={extra} send={send} bottomInset={bottomInset} onOpen={() => openPost(p)} onWatch={(w) => onWatch(p.id, w)} />;
  };

  /* ---------- Estados ---------- */
  let body: React.ReactNode = null;
  if (m.isPending) body = <View style={st.center}><ActivityIndicator color="#fff" /></View>;
  else if (m.isError || !mixar) {
    const gone = (m.error as { status?: number } | null)?.status === 404 || (m.error as { status?: number } | null)?.status === 403;
    body = (
      <View style={st.center} accessibilityRole="alert">
        <Icon name="mixar" size={48} color="rgba(255,255,255,0.7)" />
        <Text style={st.title}>{gone ? 'Este Mixar já não existe' : 'Ups, o Mixar não abriu'}</Text>
        <Text style={st.sub}>{gone ? 'Pode ter terminado, ou o convite foi recusado.' : 'Verifica a ligação e tenta outra vez.'}</Text>
        {gone ? null : <Pressable onPress={() => void m.refetch()} style={st.cta} accessibilityRole="button"><Text style={st.ctaText}>Tentar outra vez</Text></Pressable>}
        <Pressable onPress={() => router.replace('/mixar' as never)} style={st.link} accessibilityRole="button"><Text style={st.linkText}>Ver os meus Mixar</Text></Pressable>
      </View>
    );
  } else if (mixar.status === 'pending') {
    body = <PendingView mixar={mixar} me={me} them={partner} busy={answering} onAccept={() => void accept()} onDecline={() => void decline()} onCancel={leave} />;
  } else if (feed.isError && !items.length) {
    body = (
      <View style={st.center} accessibilityRole="alert">
        <Icon name="film" size={48} color="rgba(255,255,255,0.7)" />
        <Text style={st.title}>A seleção de hoje não carregou</Text>
        <Text style={st.sub}>Verifica a ligação e tenta outra vez.</Text>
        <Pressable onPress={() => void feed.refetch()} style={st.cta} accessibilityRole="button"><Text style={st.ctaText}>Tentar outra vez</Text></Pressable>
      </View>
    );
  } else {
    body = (
      <View
        style={{ flex: 1, flexDirection: 'row', justifyContent: 'center' }}
        {...(desktop ? ({ onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false) } as object) : null)}
      >
        {desktop ? <View style={{ width: 64 }} /> : null}
        <View ref={desk.ref as never} style={[st.column, colW ? { width: colW, maxWidth: colW } : null]} onLayout={(e: LayoutChangeEvent) => { const h = Math.round(e.nativeEvent.layout.height); if (h > 0) setHeight((o) => (Math.abs(o - h) >= 1 ? h : o)); }}>
          {height > 0 && pages.length === 0 ? <View style={st.center}><ActivityIndicator color="#fff" /></View> : null}
          {height > 0 && pages.length > 0 && (
            <FlatList
              ref={list}
              style={[{ flex: 1 }, isWeb ? ({ scrollSnapType: 'y mandatory', overscrollBehavior: 'contain' } as object) : null]}
              data={pages}
              extraData={`${height}|${active}|${focused}|${discover}|${JSON.stringify(sent)}`}
              keyExtractor={(p) => p.key}
              pagingEnabled
              snapToInterval={height}
              snapToAlignment="start"
              decelerationRate="fast"
              disableIntervalMomentum
              bounces={false}
              showsVerticalScrollIndicator={false}
              getItemLayout={(_, i) => ({ length: height, offset: height * i, index: i })}
              onViewableItemsChanged={viewable}
              viewabilityConfig={viewConfig}
              windowSize={3}
              initialNumToRender={2}
              maxToRenderPerBatch={2}
              onScrollToIndexFailed={(info) => list.current?.scrollToOffset({ offset: info.index * height, animated: true })}
              renderItem={renderPage}
              onEndReached={() => { if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage(); }}
              onEndReachedThreshold={1}
            />
          )}
        </View>
        {desktop ? (
          <View style={[st.deskNav, { opacity: hover ? 1 : 0 }]}>
            <DeskNavButton icon="up" label="Item anterior (↑ ou ←)" disabled={active <= 0} onPress={() => goTo(active - 1)} />
            <DeskNavButton icon="down" label="Item seguinte (↓ ou →)" disabled={active >= pages.length - 1} onPress={() => goTo(active + 1)} />
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {body}
      <MixarHeader mixar={mixar} me={me} them={partner} top={topPad} onBack={close} onOpen={mixar && live ? () => setDiscover(true) : undefined} />
      {toast ? <View style={st.toastWrap} pointerEvents="none" accessibilityRole="alert"><Text style={st.toast}>{toast}</Text></View> : null}
      {discover && mixar ? <DiscoverySheet mixar={mixar} me={me} them={partner} onClose={() => setDiscover(false)} onLeave={leave} /> : null}
    </View>
  );
}

/** O topo: voltar e, ao centro, «Dom + Ana» com os avatares, o match e os temas em comum (tocar abre a Descoberta). */
function MixarHeader({ mixar, me, them, top, onBack, onOpen }: { mixar?: Mixar; me: Who; them: Who; top: number; onBack: () => void; onOpen?: () => void }) {
  return (
    <View style={[st.top, { paddingTop: top }]} pointerEvents="box-none">
      <LinearGradient colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)']} style={StyleSheet.absoluteFill} pointerEvents="none" />
      <View style={st.topRow} pointerEvents="box-none">
        <BackButton onPress={onBack} color="#fff" />
        {mixar ? (
          <Pressable onPress={onOpen} disabled={!onOpen} style={({ pressed }) => [st.head, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={`${mixar.name}. ${matchLabel(mixar.match)}${mixar.common.length ? `. Em comum: ${mixar.common.slice(0, 3).map((t) => t.label).join(', ')}` : ''}. Toca para ver a Descoberta de interesses`}>
            <PairAvatars me={me} them={them} size={30} ring="rgba(255,255,255,0.9)" />
            <View style={{ flexShrink: 1, minWidth: 0 }}>
              <Text style={st.headName} numberOfLines={1}>{mixar.name}</Text>
              {mixar.status === 'active' ? <Text style={st.headMatch} numberOfLines={1}>{matchLabel(mixar.match)}</Text> : null}
            </View>
            {onOpen ? <Icon name="chevron-right" size={16} color="rgba(255,255,255,0.8)" strokeWidth={2.4} /> : null}
          </Pressable>
        ) : <View style={{ flex: 1 }} />}
        <View style={{ width: 48 }} />
      </View>
      {mixar?.status === 'active' && mixar.common.length ? (
        <Pressable onPress={onOpen} style={st.topChips} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <TopicChips topics={mixar.common} tone="dark" max={3} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Um convite por responder (Aceitar / Agora não) ou à espera do outro (com «Cancelar convite»). */
function PendingView({ mixar, me, them, busy, onAccept, onDecline, onCancel }: { mixar: Mixar; me: Who; them: Who; busy: null | 'accept' | 'decline' | 'leave'; onAccept: () => void; onDecline: () => void; onCancel: () => void }) {
  return (
    <View style={st.center}>
      <LinearGradient colors={['rgba(214,51,79,0.35)', 'rgba(0,0,0,0)']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 0.8 }} style={StyleSheet.absoluteFill} />
      <MixarBadge size={56} />
      <View style={{ marginTop: 18 }}><PairAvatars me={me} them={them} size={64} ring="#000" /></View>
      <Text style={st.title}>{mixar.invitedByMe ? `À espera de ${them.name}` : `${them.name} convidou-te para um Mixar`}</Text>
      <Text style={st.sub}>{mixar.invitedByMe ? 'Quando aceitar, o vosso feed a dois abre com a primeira seleção.' : 'Um feed só vosso, com o que os dois curtem: reagem, mandam um ao outro e jogam o Mixa Challenge. Novo todos os dias.'}</Text>
      {mixar.invitedByMe ? (
        <Pressable onPress={onCancel} disabled={!!busy} style={({ pressed }) => [st.link, pressed && { opacity: 0.6 }]} accessibilityRole="button"><Text style={st.linkText}>{busy === 'leave' ? 'A cancelar…' : 'Cancelar convite'}</Text></Pressable>
      ) : (
        <View style={{ marginTop: 24, gap: 10, width: '100%', maxWidth: 300 }}>
          <Pressable onPress={onAccept} disabled={!!busy} style={({ pressed }) => [st.cta, { marginTop: 0 }, pressed && { transform: [{ scale: 0.97 }] }, busy === 'decline' && { opacity: 0.5 }]} accessibilityRole="button"><Text style={st.ctaText}>{busy === 'accept' ? 'A juntar…' : 'Aceitar'}</Text></Pressable>
          <Pressable onPress={onDecline} disabled={!!busy} style={({ pressed }) => [st.ghost, pressed && { opacity: 0.7 }, busy === 'accept' && { opacity: 0.5 }]} accessibilityRole="button"><Text style={st.ghostText}>{busy === 'decline' ? 'A recusar…' : 'Agora não'}</Text></Pressable>
        </View>
      )}
    </View>
  );
}

/** Uma tcheka longe da que está em cena: só a capa (sem leitor, para poupar memória). */
function PosterPage({ post, height }: { post: Post; height: number }) {
  const poster = post.media[0]?.posterUrl;
  return (
    <View style={[{ height, width: '100%', backgroundColor: '#000' }, isWeb && ({ scrollSnapAlign: 'start', scrollSnapStop: 'always' } as object)]}>
      {poster ? <Image source={{ uri: abs(poster) }} style={StyleSheet.absoluteFill} contentFit="contain" /> : null}
    </View>
  );
}

/**
 * Um item que não é tcheka (foto ou carrossel): a primeira imagem em ecrã inteiro, com o mesmo texto e as mesmas peças do
 * Mixar por cima. Tocar abre a publicação. O tempo à vista conta para o /seen (sem «até ao fim»).
 */
function PhotoPage({ post, height, active, extra, send, bottomInset, onOpen, onWatch }: { post: Post; height: number; active: boolean; extra: React.ReactNode; send: React.ReactNode; bottomInset: number; onOpen: () => void; onWatch: (w: { ms: number; done: boolean }) => void }) {
  const router = useRouter();
  const m = post.media[0];
  const src = m?.kind === 'video' ? m.posterUrl : m?.url;
  const since = useRef<number | null>(null);
  const cb = useRef(onWatch);
  cb.current = onWatch;
  useEffect(() => {
    if (active) { since.current = Date.now(); return; }
    if (since.current != null) cb.current({ ms: Date.now() - since.current, done: false });
    since.current = null;
  }, [active]);
  useEffect(() => () => { if (since.current != null) cb.current({ ms: Date.now() - since.current, done: false }); }, []);
  const more = post.media.length - 1;
  return (
    <View style={[{ height, width: '100%', backgroundColor: '#000', overflow: 'hidden' }, isWeb && ({ scrollSnapAlign: 'start', scrollSnapStop: 'always' } as object)]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`Abrir a publicação de ${post.author.displayName}`}>
        {src ? <Image source={{ uri: abs(src) }} style={StyleSheet.absoluteFill} contentFit="contain" /> : null}
      </Pressable>
      {more > 0 ? <View style={st.more} pointerEvents="none"><Icon name="images" size={14} color="#fff" /><Text style={st.moreText}>+{more}</Text></View> : null}
      <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.7)']} style={st.shade} pointerEvents="none" />
      <View style={[st.info, { bottom: bottomInset + 16 }]} pointerEvents="box-none">
        {extra}
        <Pressable onPress={() => router.push(`/u/${post.author.username}` as never)} style={{ alignSelf: 'flex-start', maxWidth: '100%' }} accessibilityRole="button">
          <NameWithBadge name={`@${post.author.username}`} who={post.author} style={st.authorName} />
        </Pressable>
        {post.body ? <View style={{ marginTop: 6 }}><RichText text={post.body} style={st.caption} numberOfLines={2} /></View> : null}
      </View>
      <View style={[st.rails, { bottom: bottomInset + 14 }]} pointerEvents="box-none">
        {send}
        <RailButton icon={<View style={railStyles.circle}><Icon name="expand" size={24} color="#fff" /></View>} label="Abrir" onPress={onOpen} accessibilityLabel="Abrir a publicação" />
      </View>
    </View>
  );
}

function DeskNavButton({ icon, label, disabled, onPress }: { icon: 'up' | 'down'; label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={(s) => [st.navBtn, (s as { hovered?: boolean }).hovered && { backgroundColor: 'rgba(255,255,255,0.28)' }, disabled && { opacity: 0.3 }]} accessibilityRole="button" accessibilityLabel={label}>
      <View style={icon === 'down' ? { transform: [{ rotate: '180deg' }] } : null}><Icon name="arrow-up" size={22} color="#fff" strokeWidth={2.4} /></View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  // Dentro de uma linha (flexDirection 'row', para as setas do computador): 'stretch' dá a altura toda. Com 'center' a
  // coluna ficava com 0 de altura (o onLayout dava 0 e o feed nunca aparecia). O centro na horizontal vem do justifyContent.
  column: { flex: 1, width: '100%', maxWidth: 576, alignSelf: 'stretch', backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  title: { marginTop: 16, fontSize: 22, lineHeight: 28, fontWeight: '800', color: '#fff', textAlign: 'center' },
  sub: { marginTop: 6, fontSize: 15, lineHeight: 21, color: 'rgba(255,255,255,0.75)', textAlign: 'center', maxWidth: 340 },
  cta: { marginTop: 24, minHeight: 48, borderRadius: 999, backgroundColor: colors.brand, paddingHorizontal: 28, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  ghost: { minHeight: 48, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', alignItems: 'center', justifyContent: 'center' },
  ghostText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  link: { marginTop: 12, minHeight: 44, justifyContent: 'center' },
  linkText: { color: 'rgba(255,255,255,0.8)', fontWeight: '600', fontSize: 15 },
  top: { position: 'absolute', left: 0, right: 0, top: 0, paddingBottom: 18, zIndex: 20 },
  topRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 },
  head: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48 },
  headName: { color: '#fff', fontSize: 17, fontWeight: '800', ...SHADOW },
  headMatch: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '700', ...SHADOW },
  topChips: { alignSelf: 'center', marginTop: 2, paddingHorizontal: 16 },
  extra: { gap: 8, marginBottom: 10 },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  toastWrap: { position: 'absolute', left: 0, right: 0, top: '42%', alignItems: 'center', zIndex: 30 },
  toast: { overflow: 'hidden', borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.78)', color: '#fff', fontSize: 15, fontWeight: '600', paddingHorizontal: 16, paddingVertical: 10 },
  deskNav: { width: 64, justifyContent: 'center', alignItems: 'center', gap: 12 },
  navBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  shade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '50%' },
  info: { position: 'absolute', left: 12, right: 76 },
  rails: { position: 'absolute', right: 8, width: 60, alignItems: 'center', gap: 10 },
  authorName: { color: '#fff', fontWeight: '700', fontSize: 16, ...SHADOW },
  caption: { color: '#fff', fontSize: 15, lineHeight: 20.6, ...SHADOW },
  more: { position: 'absolute', top: 120, right: 12, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 4 },
  moreText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
