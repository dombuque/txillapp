import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '@/components/BackButton';
import { Icon } from '@/components/Icon';
import { NameWithBadge } from '@/components/NameWithBadge';
import { ActivityIndicator } from '@/components/PontoLoader';
import { RichText } from '@/components/RichText';
import { RailButton, railStyles } from '@/components/reel/ReelExtraActions';
import { GroupAvatars, MixarBadge, PairAvatars, ReactionBar, ReasonChip, SeenBy, TopicChips } from '@/components/mixar/MixarBits';
import { ChallengePage, DiscoverySheet, EndPage } from '@/components/mixar/MixarPages';
import { HereChip, MixarCommentsSheet, MixarRailButtons, MoreButton, ReactionBurst, SavedByChip, SavedEndPage, SavedHeaderButton, TogetherBanner } from '@/components/mixar/MixarSocial';
import { useMixarSocial } from '@/components/mixar/useMixarSocial';
import { mixarSocialApi, mixarSocialKeys, type MixarSavedItem } from '@/lib/api.mixarSocial';
import { MixarItemMenu, MixarTopicsSheet } from '@/components/mixar/MixarControloSheets';
import { WeekPage, WeekSheet } from '@/components/mixar/MixarWeekCard';
import { mixarControloApi, mixarControloKeys, previewControloApi } from '@/lib/api.mixarControlo';
import { isMonday, lessToast, withWeekPage } from '@/lib/mixarControlo';
import { api, isTcheka, type Post } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { showToast } from '@/lib/toast';
import { mixarApi, mixarKeys, type Mixar, type MixarChallenge, type MixarFeedPage, type MixarItem, type MixarReactionId } from '@/lib/api.mixar';
import { useAuth } from '@/lib/auth';
import { abs } from '@/lib/config';
import { useDesktop } from '@/lib/desktop';
import { useDeskReels } from '@/lib/desktopHooks';
import { enterImmersive, leaveImmersive } from '@/lib/immersive';
import { buildPages, createSeenTracker, firstName, matchLabel, mixarErrorText, nextReaction, type MixarPage } from '@/lib/mixar';
import { isMixarPreview, previewMixarApi } from '@/lib/mixarPreview';
import { markMixarSeen } from '@/lib/mixarSeen';
import { markMixarOpened } from '@/lib/mixarOpen';
import { groupInviteView, groupLeaveText, groupReasonIcon, groupReasonText, groupSavedByText, groupSeenText, othersOf } from '@/lib/mixarGrupo';
import { gruposApi } from '@/lib/api.grupos';
import { colors } from '@/lib/theme';
import { reelMounted } from '@/lib/videoMemory';
import { Reel } from '../(tabs)/reels';
import { t } from '@/lib/i18n';

const isWeb = Platform.OS === 'web';
const SHADOW = { textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 } as const;
type Who = { name: string; username?: string; verified?: boolean; verifiedTier?: 'verified' | 'official' | 'paid' | null };
type Api = typeof previewMixarApi;
/** Uma página do feed vinda da API: a seleção do dia ou os Guardados (MixarSavedItem estende MixarItem). */
type FeedPage = Pick<MixarFeedPage, 'items' | 'nextCursor'> & { day?: string };
/** As páginas da lista, com o cartão da semana à segunda-feira (lib/mixarControlo; nunca nos Guardados). */
type Page = MixarPage | { kind: 'week'; key: 'week' };

/**
 * O Mixar aberto: um feed vertical a dois, um item por ecrã, como as tchekas (o mesmo leitor e o mesmo cartão: Reel).
 * Em cima, «Dom + Ana» com os dois avatares, o match e os temas em comum (tocar abre a Descoberta de interesses). Primeiro
 * o Mixa Challenge do dia (se houver), depois a seleção e, no fim, «Volta amanhã para mais».
 * Em cada item: a razão, a barra das reações exclusivas (a minha e a do outro) e «Visto por Ana»; no carril, a Conversa e o
 * Guardar do Mixar e o «Mais» (com «Mandar» para o chat da outra pessoa, «Menos disto» e tirar o tema).
 * Ao sair de cada item (ou quando o vídeo acaba) manda um /seen, no máximo um por visita (lib/mixar).
 * Computador: ↑/↓ e ←/→ (e a roda do rato) mudam de item; espaço pausa; ao passar o rato aparecem os botões.
 * Social e guardados (components/mixar/MixarSocial, useMixarSocial): a conversa e o marcador no carril, «está a ver contigo»,
 * a reação do outro a subir e o «Mais 5» no fim. Com `saved` (rota /mixar/guardados/[id]) o mesmo feed mostra os Guardados.
 */
export default function MixarScreen({ saved: savedMode }: { saved?: boolean } = {}) {
  const saved = savedMode === true;
  useEffect(() => { enterImmersive(); return () => leaveImmersive(); }, []);
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const preview = isMixarPreview(id);
  const mx: Api = preview ? previewMixarApi : mixarApi;
  const cx = preview ? previewControloApi : mixarControloApi;
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
  const list = useRef<FlatList<Page>>(null);
  const [discover, setDiscover] = useState(false);
  // Controlo e resumo (0172): o menu do item, os temas do Mixar e o resumo da semana.
  const [itemMenu, setItemMenu] = useState<MixarItem | null>(null);
  const [topicsOpen, setTopicsOpen] = useState(false);
  const [weekOpen, setWeekOpen] = useState(false);
  const covered = discover || !!itemMenu || topicsOpen || weekOpen;
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [hover, setHover] = useState(false);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  const say = (t: string) => { setToast(t); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 1800); };

  const m = useQuery({ queryKey: mixarKeys.one(id), queryFn: () => mx.get(id), enabled: !!id, retry: (n, e) => (e as { status?: number }).status !== 404 && n < 2 });
  const mixar = m.data;
  // Abri: a bolinha azul some em todos os aparelhos (POST /open, 0170, depois do get, que já traz o updatedAt da seleção de
  // hoje) e, de reserva para servidores antigos, neste aparelho (lib/mixarSeen).
  useEffect(() => {
    if (!mixar) return;
    markMixarSeen(mixar.id, mixar.updatedAt);
    if (!preview) markMixarOpened(qc, mixar.id);
  }, [mixar?.id, mixar?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  // Mixar de grupo (0173): quem ainda não entrou (ou saiu) vê só o convite; o feed, a conversa e os Guardados são de quem está.
  const grp = mixar?.group ?? null;
  const joined = !grp || grp.myState === 'in';
  const live = mixar?.status === 'active' && joined;
  // Os Guardados usam o mesmo feed (outra lista, sem o desafio).
  const feedKey = saved ? mixarSocialKeys.saved(id) : mixarKeys.feed(id);
  const feed = useInfiniteQuery({
    queryKey: feedKey,
    queryFn: ({ pageParam }): Promise<FeedPage> => (saved ? mixarSocialApi.saved(id, pageParam) : mx.feed(id, pageParam)),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l: FeedPage) => l.nextCursor ?? undefined,
    enabled: live,
  });
  const ch = useQuery({ queryKey: mixarKeys.challenge(id), queryFn: () => mx.challenge(id), enabled: live && !saved, retry: 1 });
  // À espera da escolha do outro: o tempo real avisa ('pick'/'result'); isto é só a rede de segurança (e a pré-visualização).
  const waiting = !!ch.data?.myPick && ch.data.match == null;
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => void ch.refetch(), preview ? 2000 : 30_000);
    return () => clearInterval(t);
  }, [waiting, preview]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = useMemo(() => feed.data?.pages.flatMap((p) => p.items) ?? [], [feed.data]);
  // O desafio só entra depois de se saber se há (para a lista não saltar uma página quando ele chega).
  const day = feed.data?.pages[0]?.day;
  const pages: Page[] = useMemo(
    () => (feed.isPending || (!saved && ch.isPending) ? [] : saved ? buildPages(null, items, !!feed.hasNextPage) : withWeekPage(buildPages(ch.data ?? null, items, !!feed.hasNextPage), !grp && isMonday(day))),
    [feed.isPending, ch.isPending, ch.data, items, feed.hasNextPage, saved, day, grp],
  );

  const others = grp ? othersOf(grp, user?.username) : [];
  // No grupo, «partner» é o grupo (os textos de sempre, como «Mandar a…», ficam com o nome do grupo).
  const partner: Who = grp ? { name: grp.groupName } : mixar ? { name: firstName(mixar.partner.displayName), username: mixar.partner.hasAvatar ? mixar.partner.username : undefined, verified: mixar.partner.verified, verifiedTier: mixar.partner.verifiedTier ?? null } : { name: '' };
  const me: Who = { name: firstName(user?.displayName), username: user?.username };
  const whoOf = (p: { displayName: string; username: string; hasAvatar: boolean }): Who => ({ name: firstName(p.displayName), username: p.hasAvatar ? p.username : undefined });

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

  /* ---------- Social e guardados ---------- */
  const soc = useMixarSocial({ id, enabled: live && !preview, items, activePostId: activeKey, presenceOn: focused && !saved && !grp, say });
  const [talk, setTalk] = useState<string | null>(null);
  const partnerFull = grp ? { ...partner, displayName: grp.groupName, verified: false, verifiedTier: null } : mixar ? { ...partner, displayName: mixar.partner.displayName, verified: mixar.partner.verified, verifiedTier: mixar.partner.verifiedTier ?? null } : { ...partner, displayName: partner.name };

  /* ---------- Mudar o feed na cache ---------- */
  const patchItem = useCallback((postId: string, f: (it: MixarItem) => MixarItem) => {
    qc.setQueryData<InfiniteData<FeedPage>>(feedKey, (d) => d && { ...d, pages: d.pages.map((pg) => ({ ...pg, items: pg.items.map((it) => (it.post.id === postId ? f(it) : it)) })) });
  }, [qc, feedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const react = useCallback(async (it: MixarItem, tapped: MixarReactionId) => {
    const before = it.mine;
    const next = nextReaction(before, tapped);
    patchItem(it.post.id, (x) => ({ ...x, mine: next }));
    try {
      const r = await mx.react(id, it.post.id, next);
      patchItem(it.post.id, (x) => ({ ...x, mine: r.mine, theirs: r.theirs, ...(x.group && r.reactions ? { group: { ...x.group, reactions: r.reactions } } : null) }));
      // No grupo entra nos Guardados quando a maioria reage (o servidor decide): o marcador põe-se em dia pela API.
      if (grp) void qc.invalidateQueries({ queryKey: mixarSocialKeys.social(id) });
      else soc.afterReact(it.post.id, r.mine, r.theirs);
    } catch {
      patchItem(it.post.id, (x) => ({ ...x, mine: before }));
      say(t('Não consegui reagir. Tenta outra vez.'));
    }
  }, [patchItem, mx, id, soc]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- Mandar para o chat ---------- */
  const [sent, setSent] = useState<Record<string, 'sending' | 'sent'>>({});
  const sendToChat = useCallback(async (p: Post) => {
    if (!mixar || sent[p.id]) return;
    setSent((s) => ({ ...s, [p.id]: 'sending' }));
    try {
      if (!preview) {
        if (grp) {
          await gruposApi.send(grp.groupId, { kind: 'post', body: p.id });
          void qc.invalidateQueries({ queryKey: ['chat-group', grp.groupId] });
        } else {
          await api.chatSend(mixar.partner.username, { kind: 'post', body: p.id });
          void qc.invalidateQueries({ queryKey: ['chat-thread', mixar.partner.username] });
        }
        void qc.invalidateQueries({ queryKey: ['chat-list'] });
      }
      setSent((s) => ({ ...s, [p.id]: 'sent' }));
      say(grp ? t('Enviado para a conversa do grupo') : t('Enviado a {firstName}', { firstName: firstName(mixar.partner.displayName) }));
      void mx.shared(id, p.id).catch(() => undefined);
    } catch (e) {
      setSent((s) => { const n = { ...s }; delete n[p.id]; return n; });
      say((e as Error).message || t('Não consegui enviar. Tenta outra vez.'));
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
      showToast(mixarErrorText(e, t('Não consegui guardar a tua escolha. Tenta outra vez.')));
    } finally {
      setPicking(false);
    }
  }
  const openPost = (p: Post) => router.push((isTcheka(p) ? `/r/${p.id}` : `/p/${p.code || p.id}`) as never);

  /* ---------- Controlo: «Menos disto» e tirar um tema (só neste Mixar) ---------- */
  async function lessOf(it: MixarItem) {
    try {
      const r = await cx.less(id, it.post.id);
      qc.setQueryData(mixarControloKeys.topics(id), r.topics);
      say(lessToast(r));
      goNext(activeRef.current);
    } catch (e) {
      say(mixarErrorText(e, t('Não consegui agora. Tenta outra vez.')));
    }
  }
  async function offTopic(topic: string) {
    try {
      qc.setQueryData(mixarControloKeys.topics(id), await cx.setTopic(id, topic, 'off'));
      say(t('Tirado do vosso Mixar'));
      void qc.invalidateQueries({ queryKey: mixarKeys.one(id) });
    } catch (e) {
      say(mixarErrorText(e, t('Não consegui agora. Tenta outra vez.')));
    }
  }

  /* ---------- Convite pendente / sair ---------- */
  const [answering, setAnswering] = useState<null | 'accept' | 'decline' | 'leave'>(null);
  const afterChange = () => {
    void qc.invalidateQueries({ queryKey: mixarKeys.list() });
    if (grp) void qc.invalidateQueries({ queryKey: mixarKeys.ofGroup(grp.groupId) });
    else if (mixar) {
      void qc.invalidateQueries({ queryKey: mixarKeys.with(mixar.partner.username) });
      void qc.invalidateQueries({ queryKey: ['chat-thread', mixar.partner.username] });
    }
  };
  async function accept() {
    setAnswering('accept');
    try {
      const r = await mx.accept(id);
      qc.setQueryData(mixarKeys.one(id), r);
      if (r.group) void qc.invalidateQueries({ queryKey: ['mixar', id] });
      afterChange();
    } catch (e) {
      showToast(mixarErrorText(e, t('Não consegui aceitar agora. Tenta outra vez.')));
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
      showToast(mixarErrorText(e));
    } finally {
      setAnswering(null);
    }
  }
  function leave() {
    if (!mixar) return;
    const pending = mixar.status === 'pending';
    const gl = grp ? groupLeaveText(grp.people.length) : null;
    void (async () => {
      const ok = await confirm({
        title: gl ? gl.title : pending ? t('Cancelar o convite?') : t('Sair do Mixar?'),
        message: gl ? gl.line : pending ? t('{name} deixa de ver o convite.', { name: partner.name }) : t('O vosso Mixar acaba para os dois. Podes convidar {name} outra vez quando quiseres.', { name: partner.name }),
        confirm: gl ? t('Sair') : pending ? t('Cancelar convite') : t('Sair'),
        cancel: t('Ficar'),
        danger: true,
      });
      if (!ok) return;
      setDiscover(false);
      setAnswering('leave');
      try {
        await mx.leave(id);
        qc.removeQueries({ queryKey: mixarKeys.one(id) });
        afterChange();
        close();
      } catch (e) {
        showToast(mixarErrorText(e));
      } finally {
        setAnswering(null);
      }
    })();
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
  const desk = useDeskReels(focused && !covered, () => activeRef.current, goTo, { arrowsStep: true });

  const colW = desktop && height > 0 ? Math.min(576, Math.round((height * 9) / 16)) : undefined;
  const topPad = Math.max(insets.top, 12);
  // O «está a ver contigo» (MixarSocial) fica por baixo do cabeçalho: o desafio e o cartão da semana descem para não ficarem tapados.
  const bannerH = mixar && live && !saved && soc.partner.here ? 52 : 0;

  const renderPage = ({ item: pg, index }: { item: Page; index: number }) => {
    if (pg.kind === 'week') return mixar && !grp ? <WeekPage height={height} mixarId={id} api={cx} me={me} them={partner} partner={mixar.partner} onOpenTop={openPost} topInset={topPad + 104 + bannerH} /> : <View style={{ height }} />;
    if (pg.kind === 'challenge') {
      const c = ch.data;
      return c ? <ChallengePage c={c} height={height} me={me} them={partner} busy={picking} onPick={(pid) => void pick(c, pid)} onOpen={openPost} topInset={topPad + 64 + bannerH} /> : <View style={{ height }} />;
    }
    if (pg.kind === 'end') {
      if (saved) return <SavedEndPage height={height} partner={partner.name} group={!!grp} empty={items.length === 0} onBack={() => router.replace(`/mixar/${id}` as never)} />;
      return (
        <EndPage height={height} me={me} them={partner} empty={items.length === 0} onDiscover={() => setDiscover(true)} onBack={close}>
          {preview ? null : <MoreButton left={soc.moreLeft} busy={soc.moreBusy} note={soc.moreNote} onPress={() => void soc.more(() => feed.refetch())} />}
        </EndPage>
      );
    }
    const it = pg.item;
    const p = it.post;
    const so = soc.socialOf(p.id);
    const by = (it as Partial<MixarSavedItem>).savedBy;
    const seenLine = grp ? groupSeenText(it.group?.seenBy, others.length) : null;
    const extra = (
      <View style={st.extra} pointerEvents="box-none">
        <View style={st.reasonRow} pointerEvents="box-none">
          {saved && by ? <SavedByChip by={by} partner={partner.name} text={grp ? groupSavedByText(by, (it as Partial<MixarSavedItem>).savedByPerson) : undefined} /> : <ReasonChip from={it.from} topic={it.topic} partner={partner.name} text={grp ? groupReasonText(it.group, it.topic) : undefined} icon={grp ? groupReasonIcon(it.group) : undefined} />}
          {grp ? (seenLine ? <SeenBy partner={partner} text={seenLine} /> : null) : soc.partner.here && soc.partner.postId === p.id ? <HereChip partner={partnerFull} /> : it.seenByThem ? <SeenBy partner={partner} /> : null}
        </View>
        <View pointerEvents="box-none">
          <ReactionBar mine={it.mine} theirs={it.theirs} partner={partner} onPick={(r) => void react(it, r)} others={grp ? (it.group?.reactions ?? []).map((x) => ({ reaction: x.reaction, who: whoOf(x.person) })) : undefined} />
          {!grp && soc.burst?.postId === p.id ? <ReactionBurst reaction={soc.burst.reaction} seq={soc.burst.seq} partner={partner} /> : null}
        </View>
      </View>
    );
    // O carril: a Conversa e o Guardar do Mixar (MixarSocial) e o «Mais» do item (MixarControloSheets), que também tem o
    // «Mandar» (numa tcheka, por baixo das seis ações dela, não cabia mais um botão num ecrã de 390 x 844).
    const sendState = sent[p.id];
    const rail = (
      <>
        {preview ? null : <MixarRailButtons comments={so.comments} saved={so.saved} partner={partner.name} onComments={() => setTalk(p.id)} onToggleSave={() => void soc.toggleSave(p.id)} />}
        <RailButton
          icon={<View style={railStyles.circle}>{sendState === 'sending' ? <ActivityIndicator color="#fff" /> : <Icon name="more" size={28} color="#fff" />}</View>}
          onPress={() => setItemMenu(it)}
          accessibilityLabel={sendState === 'sent' ? t('Mais opções deste item no Mixar (enviado a {name})', { name: partner.name }) : t('Mais opções deste item no Mixar')}
        />
      </>
    );
    const bottomInset = desktop ? Math.max(insets.bottom, 16) : insets.bottom;
    if (isTcheka(p)) {
      return reelMounted(index, active)
        ? <Reel post={p} active={index === active} onScreen={focused && !covered} height={height} me={user?.id} onMore={() => goNext(index)} bottomInset={bottomInset} pauseSignal={desk.pauseSignal} seekSignal={desk.seekSignal} onChange={(c) => patchItem(p.id, (x) => ({ ...x, post: { ...x.post, ...c } }))} infoExtra={extra} extraActions={rail} onWatch={(w) => onWatch(p.id, w)} />
        : <PosterPage post={p} height={height} />;
    }
    return <PhotoPage post={p} height={height} active={index === active} extra={extra} send={rail} bottomInset={bottomInset} onOpen={() => openPost(p)} onWatch={(w) => onWatch(p.id, w)} />;
  };

  /* ---------- Estados ---------- */
  let body: React.ReactNode = null;
  if (m.isPending) body = <View style={st.center}><ActivityIndicator color="#fff" /></View>;
  else if (m.isError || !mixar) {
    const gone = (m.error as { status?: number } | null)?.status === 404 || (m.error as { status?: number } | null)?.status === 403;
    body = (
      <View style={st.center} accessibilityRole="alert">
        <Icon name="mixar" size={48} color="rgba(255,255,255,0.7)" />
        <Text style={st.title}>{gone ? t('Este Mixar já não existe') : t('Ups, o Mixar não abriu')}</Text>
        <Text style={st.sub}>{gone ? t('Pode ter terminado, ou o convite foi recusado.') : t('Verifica a ligação e tenta outra vez.')}</Text>
        {gone ? null : <Pressable onPress={() => void m.refetch()} style={st.cta} accessibilityRole="button"><Text style={st.ctaText}>{t('Tentar outra vez')}</Text></Pressable>}
        <Pressable onPress={() => router.replace('/mixar' as never)} style={st.link} accessibilityRole="button"><Text style={st.linkText}>{t('Ver os meus Mixar')}</Text></Pressable>
      </View>
    );
  } else if (grp && (mixar.status === 'pending' || grp.myState !== 'in')) {
    body = <GroupJoinView mixar={mixar} busy={answering} onAccept={() => void accept()} onDecline={() => void decline()} onLeave={leave} />;
  } else if (mixar.status === 'pending') {
    body = <PendingView mixar={mixar} me={me} them={partner} busy={answering} onAccept={() => void accept()} onDecline={() => void decline()} onCancel={leave} />;
  } else if (feed.isError && !items.length) {
    body = (
      <View style={st.center} accessibilityRole="alert">
        <Icon name="film" size={48} color="rgba(255,255,255,0.7)" />
        <Text style={st.title}>{saved ? t('Os Guardados não carregaram') : t('A seleção de hoje não carregou')}</Text>
        <Text style={st.sub}>{t('Verifica a ligação e tenta outra vez.')}</Text>
        <Pressable onPress={() => void feed.refetch()} style={st.cta} accessibilityRole="button"><Text style={st.ctaText}>{t('Tentar outra vez')}</Text></Pressable>
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
              extraData={`${height}|${active}|${focused}|${covered}|${JSON.stringify(sent)}|${soc.socialVersion}|${soc.partner.here}|${soc.partner.postId}|${soc.burst?.seq ?? 0}|${soc.moreBusy}|${soc.moreLeft}|${soc.moreNote}`}
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
            <DeskNavButton icon="up" label={t('Item anterior (↑ ou ←)')} disabled={active <= 0} onPress={() => goTo(active - 1)} />
            <DeskNavButton icon="down" label={t('Item seguinte (↓ ou →)')} disabled={active >= pages.length - 1} onPress={() => goTo(active + 1)} />
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {body}
      <MixarHeader
        mixar={mixar} me={me} them={partner} top={topPad} onBack={close} onOpen={mixar && live && !saved ? () => setDiscover(true) : undefined}
        saved={saved}
        right={mixar && live && !saved ? (
          <View style={st.headActions}>
            {preview ? null : <SavedHeaderButton onPress={() => router.push(`/mixar/guardados/${id}` as never)} />}
            {grp ? null : (
              <Pressable onPress={() => setWeekOpen(true)} style={({ pressed }) => [st.weekBtn, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={t('Resumo da semana')}>
                <Icon name="calendar" size={22} color="#fff" />
              </Pressable>
            )}
          </View>
        ) : undefined}
        below={mixar && live && !saved && !grp ? <TogetherBanner partner={partnerFull} presence={soc.partner} myPostId={activeKey} known={items.map((x) => x.post.id)} onJump={(pid) => { const k = pages.findIndex((x) => x.kind === 'item' && x.item.post.id === pid); if (k >= 0) goTo(k); }} /> : undefined}
      />
      {toast ? <View style={st.toastWrap} pointerEvents="none" accessibilityRole="alert"><Text style={st.toast}>{toast}</Text></View> : null}
      {talk && mixar ? <MixarCommentsSheet mixarId={id} postId={talk} partner={partnerFull} group={!!grp} onClose={() => setTalk(null)} /> : null}
      {discover && mixar ? <DiscoverySheet mixar={mixar} me={me} them={partner} onClose={() => setDiscover(false)} onLeave={leave} onTopics={() => { setDiscover(false); setTopicsOpen(true); }} onPrivate={() => { setDiscover(false); router.push('/settings/mixar-temas' as never); }} /> : null}
      {itemMenu ? <MixarItemMenu item={itemMenu} onClose={() => setItemMenu(null)} onLess={() => void lessOf(itemMenu)} onOff={(t) => void offTopic(t)} send={mixar ? { partner: partner.name, done: sent[itemMenu.post.id] === 'sent', onPress: () => void sendToChat(itemMenu.post) } : undefined} /> : null}
      {topicsOpen && mixar ? <MixarTopicsSheet mixar={mixar} partner={partner.name} api={cx} onClose={() => setTopicsOpen(false)} onPrivate={() => { setTopicsOpen(false); router.push('/settings/mixar-temas' as never); }} /> : null}
      {weekOpen && mixar ? <WeekSheet mixarId={id} api={cx} me={me} them={partner} partner={mixar.partner} onOpenTop={openPost} onClose={() => setWeekOpen(false)} /> : null}
    </View>
  );
}

/** O topo: voltar e, ao centro, «Dom + Ana» com os avatares, o match e os temas em comum (tocar abre a Descoberta). */
function MixarHeader({ mixar, me, them, top, onBack, onOpen, saved = false, right, below }: { mixar?: Mixar; me: Who; them: Who; top: number; onBack: () => void; onOpen?: () => void; /** Nos Guardados: «Os vossos Guardados» em vez do match. */ saved?: boolean; /** À direita (o botão «Guardados»). */ right?: React.ReactNode; /** Por baixo (o «está a ver contigo»). */ below?: React.ReactNode }) {
  return (
    <View style={[st.top, { paddingTop: top }]} pointerEvents="box-none">
      <LinearGradient colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)']} style={StyleSheet.absoluteFill} pointerEvents="none" />
      <View style={st.topRow} pointerEvents="box-none">
        <BackButton onPress={onBack} color="#fff" />
        {mixar ? (
          <Pressable onPress={onOpen} disabled={!onOpen} style={({ pressed }) => [st.head, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={t('{name}. {matchLabel}{value}. Toca para ver a Descoberta de interesses', { name: mixar.name, matchLabel: matchLabel(mixar.match), value: mixar.common.length ? t('. Em comum: {map}', { map: mixar.common.slice(0, 3).map((t) => t.label).join(', ') }) : '' })}>
            {mixar.group ? <GroupAvatars people={mixar.group.people} size={26} ring="rgba(255,255,255,0.9)" /> : <PairAvatars me={me} them={them} size={30} ring="rgba(255,255,255,0.9)" />}
            <View style={{ flexShrink: 1, minWidth: 0 }}>
              {mixar.group ? <Text style={st.headName} numberOfLines={1}>{mixar.group.groupName}</Text> : <NameWithBadge name={mixar.name} who={mixar.partner} style={st.headName} />}
              {mixar.status === 'active' && (!mixar.group || mixar.group.myState === 'in') ? <Text style={st.headMatch} numberOfLines={1}>{saved ? t('Os vossos Guardados') : mixar.group ? t('{n} pessoas, {matchLabel}', { n: mixar.group.people.length, matchLabel: matchLabel(mixar.match) }) : matchLabel(mixar.match)}</Text> : mixar.group ? <Text style={st.headMatch} numberOfLines={1}>{t('Mixar do grupo')}</Text> : null}
            </View>
            {onOpen ? <Icon name="chevron-right" size={16} color="rgba(255,255,255,0.8)" strokeWidth={2.4} /> : null}
          </Pressable>
        ) : <View style={{ flex: 1 }} />}
        {right ?? <View style={{ width: 48 }} />}
      </View>
      {mixar?.status === 'active' && mixar.common.length && !saved && (!mixar.group || mixar.group.myState === 'in') ? (
        <Pressable onPress={onOpen} style={st.topChips} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <TopicChips topics={mixar.common} tone="dark" max={3} />
        </Pressable>
      ) : null}
      {below}
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
      <Text style={st.title}>{mixar.invitedByMe ? t('À espera de {name}', { name: them.name }) : t('{name} convidou-te para um Mixar', { name: them.name })}</Text>
      <Text style={st.sub}>{mixar.invitedByMe ? t('Quando aceitar, o vosso feed a dois abre com a primeira seleção.') : t('Um feed só vosso, com o que os dois curtem: reagem, mandam um ao outro e jogam o Mixa Challenge. Novo todos os dias.')}</Text>
      {mixar.invitedByMe ? (
        <Pressable onPress={onCancel} disabled={!!busy} style={({ pressed }) => [st.link, pressed && { opacity: 0.6 }]} accessibilityRole="button"><Text style={st.linkText}>{busy === 'leave' ? t('A cancelar…') : t('Cancelar convite')}</Text></Pressable>
      ) : (
        <View style={{ marginTop: 24, gap: 10, width: '100%', maxWidth: 300 }}>
          <Pressable onPress={onAccept} disabled={!!busy} style={({ pressed }) => [st.cta, { marginTop: 0 }, pressed && { transform: [{ scale: 0.97 }] }, busy === 'decline' && { opacity: 0.5 }]} accessibilityRole="button"><Text style={st.ctaText}>{busy === 'accept' ? t('A juntar…') : t('Aceitar')}</Text></Pressable>
          <Pressable onPress={onDecline} disabled={!!busy} style={({ pressed }) => [st.ghost, pressed && { opacity: 0.7 }, busy === 'accept' && { opacity: 0.5 }]} accessibilityRole="button"><Text style={st.ghostText}>{busy === 'decline' ? t('A recusar…') : t('Agora não')}</Text></Pressable>
        </View>
      )}
    </View>
  );
}

/**
 * Mixar de grupo (0173) para quem ainda não está: o convite com quem já entrou e «Entrar» / «Agora não». Para quem está e
 * o Mixar ainda não começou: quantos faltam e «Sair do Mixar do grupo». Quem não entrou não vê os gostos de ninguém.
 */
function GroupJoinView({ mixar, busy, onAccept, onDecline, onLeave }: { mixar: Mixar; busy: null | 'accept' | 'decline' | 'leave'; onAccept: () => void; onDecline: () => void; onLeave: () => void }) {
  const g = mixar.group!;
  const v = groupInviteView({ ...mixar, group: g });
  const faces = g.people.length ? g.people : g.proposedBy ? [g.proposedBy] : [];
  return (
    <View style={st.center}>
      <LinearGradient colors={['rgba(214,51,79,0.35)', 'rgba(0,0,0,0)']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 0.8 }} style={StyleSheet.absoluteFill} />
      <MixarBadge size={56} />
      <View style={{ marginTop: 18 }}><GroupAvatars people={faces} size={56} ring="#000" max={5} /></View>
      <Text style={st.title}>{v.title}</Text>
      <Text style={st.sub}>{v.line}</Text>
      {g.people.length ? (
        <View style={st.people} accessibilityLabel={t('Quem está no Mixar do grupo')}>
          {g.people.map((p) => <NameWithBadge key={p.username} name={firstName(p.displayName)} who={p} style={st.person} gap={3} />)}
        </View>
      ) : null}
      {v.tone === 'join' ? (
        <View style={{ marginTop: 24, gap: 10, width: '100%', maxWidth: 300 }}>
          <Pressable onPress={onAccept} disabled={!!busy} style={({ pressed }) => [st.cta, { marginTop: 0 }, pressed && { transform: [{ scale: 0.97 }] }, busy === 'decline' && { opacity: 0.5 }]} accessibilityRole="button"><Text style={st.ctaText}>{busy === 'accept' ? t('A entrar…') : t('Entrar')}</Text></Pressable>
          {g.myState === null ? (
            <Pressable onPress={onDecline} disabled={!!busy} style={({ pressed }) => [st.ghost, pressed && { opacity: 0.7 }, busy === 'accept' && { opacity: 0.5 }]} accessibilityRole="button"><Text style={st.ghostText}>{busy === 'decline' ? t('A responder…') : t('Agora não')}</Text></Pressable>
          ) : null}
        </View>
      ) : v.tone === 'waiting' ? (
        <Pressable onPress={onLeave} disabled={!!busy} style={({ pressed }) => [st.link, pressed && { opacity: 0.6 }]} accessibilityRole="button"><Text style={st.linkText}>{busy === 'leave' ? t('A sair…') : t('Sair do Mixar do grupo')}</Text></Pressable>
      ) : null}
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
      <Pressable style={StyleSheet.absoluteFill} onPress={onOpen} accessibilityRole="button" accessibilityLabel={t('Abrir a publicação de {displayName}', { displayName: post.author.displayName })}>
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
        <RailButton icon={<View style={railStyles.circle}><Icon name="expand" size={28} color="#fff" /></View>} label={t('Abrir')} onPress={onOpen} accessibilityLabel={t('Abrir a publicação')} />
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
  people: { marginTop: 14, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, maxWidth: 320 },
  person: { color: '#fff', fontSize: 14, fontWeight: '700' },
  linkText: { color: 'rgba(255,255,255,0.8)', fontWeight: '600', fontSize: 15 },
  top: { position: 'absolute', left: 0, right: 0, top: 0, paddingBottom: 18, zIndex: 20 },
  topRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 },
  head: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48 },
  headName: { color: '#fff', fontSize: 17, fontWeight: '800', ...SHADOW },
  headMatch: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '700', ...SHADOW },
  weekBtn: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center' },
  headActions: { flexDirection: 'row', alignItems: 'center' },
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
