import { LinearGradient } from 'expo-linear-gradient';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Alert, Platform, Pressable, Share, StyleSheet, Text, TextInput, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { CheersPour } from '@/components/CheersPour';
import { Icon } from '@/components/Icon';
import { MentionSuggest, useMentionSuggest } from '@/components/MentionSuggest';
import { NameWithBadge } from '@/components/NameWithBadge';
import { ActivityIndicator } from '@/components/PontoLoader';
import { ReportSheet } from '@/components/ReportSheet';
import { Panel, useKeyboardHeight } from '@/components/StoryParts';
import { CallIcon } from '@/components/calls/CallIcons';
import { ActionRow } from '@/components/ui/ActionRow';
import { Button } from '@/components/ui/Button';
import { SendButton } from '@/components/ui/SendButton';
import { useVisibleViewport } from '@/components/zas/useVisibleViewport';
import { FxLayer, HelloAllButton, HelloStack, JoinedToast, ReactionBar, ViewersList, ViewersStack } from '@/components/txillada/LiveFx';
import { CommentMenu } from '@/components/txillada/CommentMenu';
import { LiveComments } from '@/components/txillada/LiveCommentList';
import { PinnedComment } from '@/components/txillada/PinnedComment';
import { GuestsPanel, InviteCard, TxilladaStage } from '@/components/txillada/TxilladaGuests';
import { EndedView, GlassButton, HostSummary, LiveBadge, ViewersPill } from '@/components/txillada/TxilladaParts';
import { GiftSheet, GoalBar, LockedView, TopGivers } from '@/components/txillada/TxilladaMoney';
import { api } from '@/lib/api';
import { txilladaApi } from '@/lib/api.txillada';
import { useAuth } from '@/lib/auth';
import { SITE_URL } from '@/lib/config';
import { confirm } from '@/lib/confirm';
import { useDesktop } from '@/lib/desktop';
import { useNoIndex } from '@/lib/noIndex';
import { stableScreen, type Size } from '@/lib/prepKeyboard';
import { useReduceMotion } from '@/lib/reduceMotion';
import { sheetViewport } from '@/lib/sheetViewport';
import { colors } from '@/lib/theme';
import { COMMENT_MAX, commentMenu, dtoKind, elapsed, errorText, liveClock, liveSummary, replyText, shareLink, shareMessage, type CommentMenuItem, type TxilladaComment } from '@/lib/txillada';
import { camLabel, floatHeight, liveKeyboard } from '@/lib/txilladaChat';
import { liveLayout, type FxPerson, type ReactionKind } from '@/lib/txilladaFx';
import { useTxilladaFx } from '@/lib/txilladaFxRoom';
import { guestUi, viewerGuestAction } from '@/lib/txilladaGuests';
import { useNow } from '@/lib/txilladaRoom';
import { closeTxillada, openTxillada, useTxilladaSession, type TxilladaSession } from '@/lib/txilladaSession';

/**
 * A Txillada (o live, docs/txillada-contrato.md), em ecrã inteiro: o vídeo de quem transmite ocupa o ecrã de ponta a ponta
 * (cover; uma imagem deitada fica inteira com o fundo desfocado — components/txillada/TxilladaVideo) e os controlos vão por
 * cima, com degradês suaves em cima e em baixo e as margens seguras (entalhe, barra de casa). No site/PWA o ecrã é
 * `position: fixed` com 100dvh: não depende do tamanho da janela medido no primeiro desenho. No computador, o vídeo fica ao
 * centro em altura total, com o fundo desfocado, e os controlos numa coluna ao centro (lib/txilladaFx `liveLayout`).
 *
 * A sala vive fora do ecrã (lib/txilladaSession, como as chamadas): sair para outro sítio da app (sem tocar em Sair ou no X)
 * não desliga. Quem vê fica com o leitor pequeno e o som; o anfitrião continua ao vivo, com «Estás ao vivo · Voltar»
 * (components/txillada/TxilladaMini). Sair, o X e Terminar desligam.
 *
 * O teclado (comentar): o vídeo fica do mesmo tamanho, atrás (o palco é medido sem o teclado e fica parado enquanto se
 * escreve, como no preparar: lib/prepKeyboard); só a barra de comentar sobe por cima do teclado, e os comentários a flutuar
 * sobem com ela (lib/txilladaChat `liveKeyboard`). No iPhone a zona visível é o visualViewport.
 *
 * Em cima: o anfitrião com o selo, «AO VIVO» com o tempo e quem está a ver (os avatares empilhados; tocar abre «A ver
 * agora»). À direita sobem as reações de todos; à esquerda, os comentários a flutuar (tocar ou arrastar abre a lista para ler
 * para trás: components/txillada/LiveCommentList), os olás e «@fulano entrou». Em baixo: as reações de um toque e comentar
 * (quem vê) ou o microfone, a câmara, virar, «Olá a todos» e comentar (o anfitrião). Ao escrever @ aparecem logo pessoas
 * (primeiro o anfitrião, quem transmite e quem está a ver); quem não está a ver recebe o convite ao ser mencionado.
 *
 * A Txillada não se grava (nem as reações): quando acaba, já não se pode ver («A Txillada acabou»); o anfitrião vê o resumo
 * (e, numa Angariação terminada antes da meta, «Reabrir a Angariação»).
 *
 * Convidados (0165): até 3 pessoas transmitem com o anfitrião. Quem vê toca em «Pedir para entrar» (ou aceita o convite do
 * anfitrião, que convida da lista «A ver agora» ou por @ na lista dos convidados, 0168: também quem ainda não entrou, que
 * recebe um aviso); o anfitrião aceita, recusa e tira na lista dos convidados (o botão das pessoas, com o número de pedidos). O ecrã reparte-se: 1 = inteiro; 2 = uma em cima da outra; 3 = uma grande em cima e duas
 * em baixo; 4 = grelha 2×2 (components/txillada/TxilladaGuests `TxilladaStage`). Quem transmite pode desligar a câmara: sai
 * do ecrã e fica a ver. Os comentários, as reações, o fixado e a barra ficam por cima, como sempre.
 *
 * Tipos e Angariação (0167): uma Txillada privada mostra primeiro o cartão com o cadeado e «Entrar por N vibes» (sem ligar à
 * sala nem pedir nada dela antes de pagar); lá dentro, quem vê não aparece aos outros (só ao anfitrião). Com Angariação, a
 * barra «X de Y vibes» e quem mais ofereceu ficam por baixo dos números; quem vê oferece vibes (o botão do presente) e
 * cada oferta aparece na conversa, destacada.
 */
export default function TxilladaScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const sid = String(id);
  // As ligações das Txilladas nunca aparecem nos motores de busca (também no nginx, pelo X-Robots-Tag).
  useNoIndex();
  useEffect(() => { openTxillada(sid); }, [sid]);
  const tx = useTxilladaSession(sid);
  // Ao sair do ecrã sem a Txillada a decorrer (acabada, a pagar, com erro), a sessão fecha; a decorrer, fica (o leitor).
  const kindRef = useRef<string>('loading');
  kindRef.current = tx?.kind ?? 'loading';
  useEffect(() => () => { if (kindRef.current !== 'live') closeTxillada(); }, [sid]);
  if (!tx) return <View style={[st.screen, webFull, st.center]}><ActivityIndicator color="#fff" /></View>;
  return <TxilladaView id={sid} tx={tx} />;
}

function TxilladaView({ id, tx }: { id: string; tx: TxilladaSession }) {
  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const wide = useDesktop();
  const kb = useKeyboardHeight();
  const reduce = useReduceMotion();
  const { user } = useAuth();
  const { dto, live, kind, ui, host } = tx;
  const now = useNow(kind === 'live');
  const fxs = useTxilladaFx({
    id,
    live: kind === 'live',
    host,
    // A foto vem pelo @ (o Avatar mostra as iniciais por baixo, se não houver).
    me: user ? { username: user.username, displayName: user.displayName || user.username, avatarUrl: `/api/v1/avatars/${encodeURIComponent(user.username)}`, verified: !!user.verified, verifiedTier: user.verifiedTier ?? null } : null,
    reduce,
    onCheer: () => tx.cheer(),
    // Numa privada, «A ver agora» é só do anfitrião.
    noViewers: !!dto?.viewersHidden && !host,
  });
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(false);
  const [sending, setSending] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [panel, setPanel] = useState<null | 'more' | 'report' | 'viewers' | 'guests' | 'gift'>(null);
  /** A câmara a abrir ao aceitar um convite (o botão fica à espera). */
  const [accepting, setAccepting] = useState(false);
  const [reopening, setReopening] = useState(false);
  /** O comentário com o menu aberto (o id: as contagens vêm sempre do estado da sala) e o que se está a denunciar. */
  const [menuId, setMenuId] = useState<string | null>(null);
  const [reporting, setReporting] = useState<TxilladaComment | null>(null);
  const [pinH, setPinH] = useState(48);
  const flashT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const blurT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  // As @menções: ao escrever @ aparecem logo pessoas (o anfitrião, quem transmite e quem está a ver primeiro).
  const mention = useMentionSuggest({ text, setText: (t) => setText(t.slice(0, COMMENT_MAX)), inputRef, context: 'txillada', id });

  const say = (m: string) => {
    setFlash(m);
    clearTimeout(flashT.current);
    flashT.current = setTimeout(() => setFlash(null), 2600);
  };
  useEffect(() => () => { clearTimeout(flashT.current); if (blurT.current) clearTimeout(blurT.current); }, []);
  // Os avisos dos convidados («@ana pediu para entrar», «O anfitrião recusou o teu pedido»…), das menções e dos convites.
  const noticeN = tx.notice?.n ?? 0;
  useEffect(() => { if (tx.notice) say(tx.notice.text); }, [noticeN]); // eslint-disable-line react-hooks/exhaustive-deps
  const g = guestUi(dto, tx.guests);

  // ── O teclado: o palco fica do tamanho de antes; só a barra sobe ─────────────────────────────────────────────────────
  const web = Platform.OS === 'web';
  const vv = useVisibleViewport();
  const webKb = web && typeof window !== 'undefined' && !!sheetViewport(vv, window.innerHeight, window.innerWidth);
  const writing = typing || kb > 0 || webKb;
  const [rootH, setRootH] = useState(0);
  const still = useRef<Size>({ w: 0, h: 0 });
  still.current = stableScreen(still.current, { w: width, h: rootH || height }, writing);
  const W = still.current.w || width;
  const H = still.current.h || height;
  // Na web, com o teclado aberto, a página não rola por baixo (o Safari arrastava tudo para cima): fica no topo.
  useEffect(() => {
    if (!webKb || typeof window === 'undefined') return;
    const fix = () => { if (window.scrollY || window.scrollX) window.scrollTo(0, 0); };
    fix();
    window.addEventListener('scroll', fix);
    return () => { window.removeEventListener('scroll', fix); fix(); };
  }, [webKb, vv?.top, vv?.height]);

  /** Sair de vez (Sair, o X, Feito): a sala desliga e o ecrã fecha. */
  const leave = () => {
    closeTxillada();
    if (router.canGoBack()) router.back();
    else router.replace('/' as never);
  };
  async function confirmEnd() {
    if (!(await confirm({ title: 'Terminar a Txillada?', message: 'Quem está a ver sai, e a Txillada não fica gravada.', confirm: 'Terminar', cancel: 'Continuar', danger: true }))) return;
    const e = await tx.end();
    if (e) say(e);
  }

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    const err = await tx.sendComment(body);
    setSending(false);
    if (err) say(err);
    else setText('');
  }
  function react(k: ReactionKind) {
    if (!fxs.react(k)) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(k === 'cheers' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  }
  async function share() {
    if (!dto) return;
    const url = shareLink(dto.id, SITE_URL || 'https://txillapp.com');
    const message = shareMessage(dto);
    try {
      await Share.share(Platform.OS === 'ios' ? { message, url } : { message: `${message}: ${url}` }, { dialogTitle: `Txillada de @${dto.host.username}` });
    } catch { /* cancelado */ }
  }
  /** Tocar num @ de um comentário: o perfil (a Txillada continua ligada, no leitor pequeno). */
  const openProfile = (username: string) => router.push(`/u/${encodeURIComponent(username)}` as never);
  /** Um toque (ou o toque longo) num comentário: o menu (responder, brindar, denunciar; o anfitrião fixa, apaga e expulsa). */
  function openMenu(c: TxilladaComment) {
    if (!commentMenu(dto, c, tx.me, live.pinned?.id).length) return;
    if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => undefined);
    setMenuId(c.id);
  }
  function pick(item: CommentMenuItem, c: TxilladaComment) {
    setMenuId(null);
    switch (item) {
      case 'reply':
        setText((t) => replyText(t, c.author.username));
        // Depois de a folha fechar, para o teclado abrir por cima do vídeo.
        setTimeout(() => inputRef.current?.focus(), 60);
        return;
      case 'cheer':
        if (!tx.cheerComment(c)) say(c.cheered ? 'Já brindaste este comentário' : 'Calma! No máximo 5 brindes por segundo.');
        else if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
        return;
      case 'pin':
      case 'unpin':
        void tx.pin(item === 'pin' ? c : null).then((e) => say(e ?? (item === 'pin' ? 'Comentário fixado' : 'Deixou de estar fixado')));
        return;
      case 'remove':
        void tx.removeComment(c).then((e) => say(e ?? 'Comentário apagado'));
        return;
      case 'ban':
        void confirmBan(c.author.username);
        return;
      case 'report':
        setReporting(c);
        return;
    }
  }
  async function confirmBan(username: string) {
    if (!(await confirm({ title: `Expulsar @${username}?`, message: 'Sai já da Txillada e não pode voltar a entrar nesta.', confirm: 'Expulsar', danger: true }))) return;
    try {
      await txilladaApi.ban(id, username);
      say(`@${username} foi expulso`);
      fxs.refreshViewers();
    } catch (e) {
      const err = e as { status?: number; message?: string };
      say(errorText(err?.status, err?.message));
    }
  }
  /** Quem vê bloqueia o anfitrião (como no perfil, lib/api `block`): deixa de o ver e sai desta Txillada. */
  async function confirmBlock() {
    if (!dto) return;
    const u = dto.host.username;
    if (!(await confirm({ title: `Bloquear @${u}?`, message: 'Deixa de ver as tuas publicações e mimos e não pode interagir contigo. Sais desta Txillada.', confirm: 'Bloquear', danger: true }))) return;
    try {
      await api.block(u);
      for (const k of ['profile', 'feed', 'stories', 'suggestions', 'blocked']) void qc.invalidateQueries({ queryKey: [k] });
      leave();
    } catch (e) {
      say((e as Error)?.message || 'Não consegui bloquear agora. Tenta outra vez.');
    }
  }
  /** O anfitrião, na lista «A ver agora»: dizer olá, convidar para transmitir (0165) ou expulsar. */
  function viewerActions(u: FxPerson) {
    if (!host) return;
    const act = viewerGuestAction(tx.guests, u.username);
    const guest = act === 'invite'
      ? [{ text: 'Convidar para transmitir', onPress: () => void tx.hostGuest('invite', u.username).then((e) => say(e ?? `Convite enviado a @${u.username}`)) }]
      : act === 'requested'
        ? [{ text: 'Aceitar o pedido para entrar', onPress: () => void tx.hostGuest('accept', u.username).then((e) => say(e ?? `@${u.username} entrou no ecrã`)) }]
        : [];
    Alert.alert(`@${u.username}`, act === 'invited' ? `${u.displayName} · convite enviado` : act === 'full' ? `${u.displayName} · já há 3 a transmitir` : u.displayName, [
      { text: 'Dizer olá', onPress: () => fxs.helloTo(u.username) },
      ...guest,
      { text: `Expulsar @${u.username}`, style: 'destructive', onPress: () => void confirmBan(u.username) },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  }
  /** Quem vê: pedir para entrar, ou desistir do pedido. */
  async function askJoin() {
    if (g.waiting) {
      if (!(await confirm({ title: 'Desistir do pedido?', message: 'O anfitrião deixa de ver o teu pedido para entrar.', confirm: 'Desistir', cancel: 'Continuar à espera' }))) return;
      say((await tx.leaveStage()) ?? 'Desististe do pedido');
      return;
    }
    void tx.requestJoin().then((e) => say(e ?? 'Pedido enviado: o anfitrião vai ver que queres entrar'));
  }
  /** O convidado deixa de transmitir (continua a ver). */
  async function confirmLeaveStage() {
    if (!(await confirm({ title: 'Sair do ecrã?', message: 'A tua câmara e o microfone desligam-se; continuas a ver a Txillada.', confirm: 'Sair do ecrã', cancel: 'Ficar', danger: true }))) return;
    say((await tx.leaveStage()) ?? 'Saíste do ecrã: continuas a ver a Txillada');
  }
  /** O convidado desliga a câmara: sai do ecrã logo e fica a ver (sem perguntar, sem sair da Txillada). */
  function guestCamOff() {
    void tx.leaveStage().then((e) => say(e ?? 'Câmara desligada: continuas a ver a Txillada'));
  }
  /** O anfitrião desliga (ou liga) a câmara: a transmissão continua, com o som. */
  function hostCam() {
    const was = tx.cam;
    void tx.toggleCam().then((e) => say(e ?? (was ? 'Câmara desligada: o som continua' : 'Câmara ligada')));
  }
  async function acceptInvite() {
    if (accepting) return;
    setAccepting(true);
    const e = await tx.acceptInvite();
    setAccepting(false);
    if (e) say(e);
  }
  function hostGuest(what: 'accept' | 'decline' | 'remove', username: string) {
    void tx.hostGuest(what, username).then((e) => { if (e) say(e); });
  }
  async function reopen() {
    if (reopening) return;
    setReopening(true);
    const e = await tx.reopen();
    setReopening(false);
    if (e) Alert.alert('Não deu para reabrir', e);
  }
  const onFocus = () => {
    if (blurT.current) clearTimeout(blurT.current);
    setTyping(true);
    mention.inputProps.onFocus();
  };
  // O foco sai e volta ao escolher uma sugestão do @: a barra não salta para baixo nesse bocadinho.
  const onBlur = () => {
    mention.inputProps.onBlur();
    if (blurT.current) clearTimeout(blurT.current);
    blurT.current = setTimeout(() => setTyping(false), 350);
  };

  // ── Os estados sem vídeo ───────────────────────────────────────────────────────────────────────────────────────────
  if (kind === 'loading') {
    return <View style={[st.screen, webFull, st.center]}><ActivityIndicator color="#fff" /></View>;
  }
  if (kind === 'error') {
    return <View style={[st.screen, webFull]}><EndedView title="Não dá para ver esta Txillada" sub={tx.error ?? 'Esta Txillada não existe ou não a podes ver.'} onBack={leave} /></View>;
  }
  if (kind === 'ended') {
    const cut = (live.status ?? dto?.status) === 'cut';
    if (host) {
      const sum = liveSummary(dto, live, now);
      // Uma Angariação terminada antes da meta (0174): pode reabrir-se durante 24 h.
      const canReopen = !!dto?.canReopen && !cut && dto.goal != null;
      return (
        <View style={[st.screen, webFull, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <HostSummary {...sum} cut={cut} onDone={leave} reopen={canReopen ? { goal: dto!.goal!, raised: Math.max(live.raised, dto!.raised ?? 0), until: dto!.reopenUntil ?? null, busy: reopening, onPress: () => void reopen() } : null} />
        </View>
      );
    }
    // Uma privada cortada pela moderação: a entrada volta para a carteira (0167).
    if (cut && dtoKind(dto) === 'paid' && dto?.hasTicket && !dto.locked) {
      return <View style={[st.screen, webFull]}><EndedView sub="A equipa do Txillapp terminou esta Txillada. A tua entrada voltou para a tua carteira." onBack={leave} /></View>;
    }
    return <View style={[st.screen, webFull]}><EndedView onBack={leave} /></View>;
  }
  if (!dto) return null;
  // Privada sem a entrada (0167): o cartão com o cadeado e o preço; pagar liga à sala.
  if (kind === 'locked') {
    return (
      <View style={[st.screen, webFull]}>
        <LockedView dto={dto} onPay={tx.pay} onWallet={() => router.push('/wallet' as never)} onBack={leave} top={insets.top} bottom={insets.bottom} />
      </View>
    );
  }
  if (tx.error && tx.conn !== 'connected') {
    return <View style={[st.screen, webFull]}><EndedView title="Não deu para entrar" sub={tx.error} onBack={leave} /></View>;
  }

  // ── Ao vivo ────────────────────────────────────────────────────────────────────────────────────────────────────────
  const L = liveLayout({ w: W, h: H, top: insets.top, bottom: insets.bottom, left: insets.left, right: insets.right, wide });
  const K = liveKeyboard({
    web,
    typing: writing,
    stageH: H,
    winH: web ? (typeof window !== 'undefined' ? window.innerHeight : height) : (rootH || H),
    vv: web && vv ? { top: vv.top, height: vv.height } : null,
    kb: web ? 0 : kb,
    padBottom: L.padBottom,
  });
  const time = liveClock(elapsed(dto.startedAt, now));
  const barBottom = K.barBottom;
  // A barra de baixo: duas filas (as reações ou as ferramentas do anfitrião, e comentar) de 44 px com 8 entre elas; a
  // escrever, só a de comentar (a de cima esconde-se).
  const blockH = typing ? 44 : 44 + 8 + 44;
  // O fixado fica logo por cima da barra; quem entrou, os avisos e os balões sobem por cima dele.
  const pinned = live.pinned;
  const pinBottom = barBottom + blockH + 10;
  const laneBottom = pinBottom + (pinned ? pinH + 8 : 0);
  const floatBottom = laneBottom + 42;
  const menuC = menuId ? (live.comments.find((c) => c.id === menuId) ?? (pinned?.id === menuId ? pinned : null)) : null;
  const menuItems = menuC ? commentMenu(dto, menuC, tx.me, pinned?.id) : [];
  const baseFloatH = Math.max(120, Math.min(320, Math.round(H * 0.32)));
  // Com o teclado aberto, os comentários sobem com a barra e não passam acima da parte que se vê.
  const floatH = K.open ? floatHeight(baseFloatH, { stageH: H, floatBottom, visTop: K.visTop, header: 16 }) : baseFloatH;
  // A lista para ler para trás: mais alta (até perto dos números em cima).
  const listH = K.open ? floatH : Math.max(floatH, Math.min(Math.round(H * 0.5), H - floatBottom - (L.padTop + 132)));
  const waiting = !tx.tiles[0]?.track && tx.tiles[0]?.cam !== false;
  // A etiqueta dos quadrados de cima fica por baixo do cabeçalho (o anfitrião, «AO VIVO», os números).
  const headerBottom = L.padTop + 84;
  const viewersCount = Math.max(live.viewers, fxs.viewersTotal);
  // A Angariação e quem mais ofereceu, por baixo dos números (os olás descem o mesmo).
  const hasGoal = live.goal != null;
  const fundH = (hasGoal ? 48 : 0) + (live.topGivers.length ? 32 : 0);
  const paid = dtoKind(dto) === 'paid';
  // O palco: fica com a altura de antes enquanto se escreve (o vídeo não encolhe nem sobe com o teclado).
  const stage: ViewStyle = K.open || writing ? { position: 'absolute', top: 0, left: 0, right: 0, height: H } : (StyleSheet.absoluteFill as ViewStyle);

  return (
    <View style={[st.screen, webFull, web && writing ? ({ height: H, bottom: 'auto' } as unknown as ViewStyle) : null]} onLayout={(e) => { const h = Math.round(e.nativeEvent.layout.height); setRootH((o) => (o === h ? o : h)); }}>
      <View style={stage} pointerEvents="box-none">
        <TxilladaStage tiles={tx.tiles} w={W} h={H} headerBottom={headerBottom} wide={wide} />
        {waiting ? (
          <View style={[StyleSheet.absoluteFill, st.center, { gap: 12, paddingHorizontal: 24 }]} pointerEvents="none">
            <Avatar name={dto.host.displayName} username={dto.host.avatarUrl ? dto.host.username : undefined} size={84} />
            <ActivityIndicator color="#fff" />
            <Text style={st.waitText}>{tx.conn === 'failed' ? 'A ligação caiu.' : host ? 'A abrir a câmara…' : `A ligar à Txillada de @${dto.host.username}…`}</Text>
          </View>
        ) : null}
        {typing ? <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.2)' }]} pointerEvents="none" /> : null}

        {/* Os degradês suaves: em cima (o anfitrião e os números) e em baixo (a conversa e a barra). */}
        <LinearGradient colors={['rgba(0,0,0,0.58)', 'rgba(0,0,0,0.22)', 'transparent']} style={[st.gradTop, { height: L.padTop + 150 }]} pointerEvents="none" />
        <LinearGradient colors={['transparent', 'rgba(0,0,0,0.28)', 'rgba(0,0,0,0.72)']} locations={[0, 0.45, 1]} style={[st.gradBottom, { height: Math.min(H * 0.55, floatBottom + floatH + 40) }]} pointerEvents="none" />

        <CheersPour n={live.cheerBurst + tx.myBurst} size={Math.min(260, L.colW * 0.62)} />

        <View style={[st.col, { left: L.colLeft, width: L.colW }]} pointerEvents="box-none">
          {/* Em cima: o anfitrião, sair (quem vê) ou terminar (o anfitrião); «AO VIVO», o tempo e quem está a ver. */}
          <View style={[st.top, { top: L.padTop, left: L.side, right: L.side }]} pointerEvents="box-none">
            <View style={st.who} pointerEvents="box-none">
              <Pressable onPress={() => { if (!host) router.push(`/u/${dto.host.username}` as never); }} disabled={host} style={st.author} accessibilityRole={host ? undefined : 'link'} accessibilityLabel={`Txillada de ${dto.host.displayName}`}>
                <View style={st.ring}>
                  <Avatar name={dto.host.displayName} username={dto.host.avatarUrl ? dto.host.username : undefined} size={36} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }} pointerEvents="none">
                  <NameWithBadge name={dto.host.username} who={dto.host} style={st.name} />
                  {dto.title ? <Text style={st.title} numberOfLines={1}>{dto.title}</Text> : null}
                </View>
              </Pressable>
              {host ? (
                <Pressable onPress={() => void confirmEnd()} style={({ pressed }) => [st.end, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel="Terminar a Txillada">
                  <Text style={st.endText}>Terminar</Text>
                </Pressable>
              ) : (
                <>
                  {g.canRequest || g.waiting ? (
                    <Pressable onPress={() => void askJoin()} style={({ pressed }) => [st.join, g.waiting && st.joinWaiting, pressed && { transform: [{ scale: 0.95 }] }]} accessibilityRole="button" accessibilityLabel={g.waiting ? 'Pedido enviado: desistir' : 'Pedir para entrar'}>
                      <Icon name={g.waiting ? 'clock' : 'user-plus'} size={15} color="#fff" strokeWidth={2.2} />
                      <Text style={st.joinText} numberOfLines={1}>{g.waiting ? 'Pedido enviado' : 'Pedir para entrar'}</Text>
                    </Pressable>
                  ) : null}
                  <GlassButton icon="more" label="Mais opções" onPress={() => setPanel('more')} />
                  <GlassButton icon="x" label="Sair da Txillada" onPress={leave} />
                </>
              )}
            </View>
            <View style={st.stats} pointerEvents="box-none">
              <LiveBadge time={time} />
              {ui.canSeeViewers ? (
                <ViewersStack items={fxs.viewers} total={viewersCount} onPress={() => { fxs.refreshViewers(); setPanel('viewers'); }} />
              ) : (
                <ViewersPill n={live.viewers} />
              )}
              {paid ? (
                <View style={st.cheerPill} accessibilityLabel={host ? `Txillada privada: ${dto.tickets ?? 0} entradas pagas` : 'Txillada privada'}>
                  <Icon name="lock" size={13} color="#fff" strokeWidth={2.3} />
                  {host ? <Text style={st.cheerText}>{dto.tickets ?? 0}</Text> : null}
                </View>
              ) : null}
              {live.cheers > 0 ? (
                <View style={st.cheerPill} accessibilityLabel={`${live.cheers} brindes`}>
                  <Icon name="cheers" size={15} color={colors.brandWarm} strokeWidth={2} />
                  <Text style={st.cheerText}>{live.cheers}</Text>
                </View>
              ) : null}
            </View>
            {fundH ? (
              <View style={[st.fund, { maxWidth: L.floatW + 40 }]} pointerEvents="box-none">
                <GoalBar raised={live.raised} goal={live.goal} purpose={dto.goalPurpose} onGive={ui.canGift ? () => setPanel('gift') : undefined} />
                <TopGivers items={live.topGivers} />
              </View>
            ) : null}
            {tx.conn === 'reconnecting' ? <Text style={st.weak}>A ligação está fraca… a voltar a ligar</Text> : null}
            {(host || g.onStage) && !tx.mic ? (
              <View style={st.muted} pointerEvents="none">
                <CallIcon name="mic-off" size={15} color="#fff" />
                <Text style={st.mutedText}>Microfone calado</Text>
              </View>
            ) : null}
          </View>

          {/* Os olás: «@rui: Olá 👋» por baixo dos números; a saudação do anfitrião em grande, ao centro. */}
          <HelloStack items={fxs.hellos} top={L.padTop + fundH + ((host || g.onStage) && !tx.mic ? 124 : 88)} left={L.side} width={L.floatW} />

          {tx.conn === 'failed' ? (
            <View style={st.failed}>
              <Text style={st.failedText}>A ligação caiu.</Text>
              <Button label="Tentar outra vez" kind="secondary" size="md" dark onPress={tx.reconnect} />
            </View>
          ) : null}

          {tx.audioBlocked && !host ? (
            <Pressable onPress={() => void tx.startAudio()} style={st.sound} accessibilityRole="button" accessibilityLabel="Ligar o som">
              <Icon name="volume" size={18} color="#fff" strokeWidth={2.2} />
              <Text style={st.soundText}>Toca para ouvir</Text>
            </Pressable>
          ) : null}

          {/* As reações de todos sobem pelo lado direito. */}
          <FxLayer items={fxs.fx} bottom={barBottom + blockH + 4} height={Math.round(H * 0.55)} right={L.side - 12} reduce={reduce} />

          {/* A conversa por cima do vídeo (também para o anfitrião): os comentários a flutuar (e a lista para ler para trás). */}
          {panel === null ? (
            <LiveComments
              comments={live.comments}
              bottom={floatBottom}
              width={L.floatW}
              height={floatH}
              listHeight={listH}
              onOpen={tx.me ? openMenu : undefined}
              onCheer={tx.me && tx.kind === 'live' ? tx.cheerComment : undefined}
              onMention={openProfile}
              hidden={pinned?.id}
              more={tx.olderMore}
              busy={tx.olderBusy}
              onLoadOlder={() => void tx.loadOlder()}
            />
          ) : null}
          {pinned ? (
            <PinnedComment c={pinned} bottom={pinBottom} left={L.side} width={L.colW - L.side * 2} onPress={tx.me ? () => openMenu(pinned) : undefined} onHeight={(h) => setPinH((old) => (old === h ? old : h))} />
          ) : null}
          <JoinedToast users={fxs.joined?.users ?? null} bottom={laneBottom} left={L.side} onHello={host ? (u) => (u ? fxs.helloTo(u.username) : react('hello')) : undefined} />

          {flash ? <View style={[st.flash, { bottom: laneBottom }]} pointerEvents="none"><Text style={st.flashText} accessibilityRole="alert">{flash}</Text></View> : null}

          {/* Em baixo: as reações (quem vê) ou as ferramentas do anfitrião; e comentar. */}
          <View style={[st.bar, { left: L.side, right: L.side, bottom: barBottom }]} pointerEvents="box-none">
            {/* As pessoas para mencionar, logo por cima do campo (sobem com ele por cima do teclado). */}
            <MentionSuggest mention={mention} style={st.mentions} />
            {!typing ? (
              <View style={st.barRow}>
                {host ? (
                  <>
                    <GlassButton label={tx.mic ? 'Calar o microfone' : 'Ligar o microfone'} on={!tx.mic} onPress={() => void tx.toggleMic()}>
                      {tx.mic ? <Icon name="mic" size={20} color="#fff" strokeWidth={2.2} /> : <CallIcon name="mic-off" size={20} color="#fff" />}
                    </GlassButton>
                    <GlassButton label={camLabel(tx.cam)} on={!tx.cam} onPress={hostCam}>
                      {tx.cam ? <Icon name="video" size={20} color="#fff" strokeWidth={2.2} /> : <CallIcon name="video-off" size={20} color="#fff" />}
                    </GlassButton>
                    {tx.cam ? <GlassButton icon="cam-flip" label="Virar a câmara" onPress={() => void tx.flip()} /> : null}
                    <View>
                      <GlassButton icon="users" label={`Convidados${g.pending ? `: ${g.pending} pedidos para entrar` : ''}`} on={g.pending > 0} onPress={() => setPanel('guests')} />
                      {g.pending ? <View style={st.count} pointerEvents="none"><Text style={st.countText}>{g.pending > 9 ? '9+' : g.pending}</Text></View> : null}
                    </View>
                    <View style={{ flex: 1 }} />
                    <HelloAllButton onPress={() => react('hello')} />
                  </>
                ) : g.onStage ? (
                  <>
                    <GlassButton label={tx.mic ? 'Calar o microfone' : 'Ligar o microfone'} on={!tx.mic} onPress={() => void tx.toggleMic()}>
                      {tx.mic ? <Icon name="mic" size={20} color="#fff" strokeWidth={2.2} /> : <CallIcon name="mic-off" size={20} color="#fff" />}
                    </GlassButton>
                    {/* Desligar a câmara: sai do ecrã e fica a ver (sem sair da Txillada). */}
                    <GlassButton label="Desligar a câmara e ficar a ver" onPress={guestCamOff}>
                      <Icon name="video" size={20} color="#fff" strokeWidth={2.2} />
                    </GlassButton>
                    <GlassButton icon="cam-flip" label="Virar a câmara" onPress={() => void tx.flip()} />
                    <Pressable onPress={() => void confirmLeaveStage()} style={({ pressed }) => [st.leaveStage, pressed && { transform: [{ scale: 0.95 }] }]} accessibilityRole="button" accessibilityLabel="Sair do ecrã (continuar a ver)">
                      <Text style={st.leaveStageText}>Sair do ecrã</Text>
                    </Pressable>
                    <View style={{ flex: 1 }} />
                  </>
                ) : (
                  <>
                    {ui.canCheer ? <ReactionBar onReact={react} /> : null}
                    <View style={{ flex: 1 }} />
                  </>
                )}
                {ui.canShare ? (
                  <Pressable onPress={() => void share()} hitSlop={4} style={({ pressed }) => [st.barBtn, pressed && { transform: [{ scale: 0.92 }] }]} accessibilityRole="button" accessibilityLabel="Partilhar a Txillada">
                    <Icon name="share" size={22} color="#fff" />
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            <View style={st.barRow}>
              {ui.canComment ? (
                <View style={[st.pill, typing && st.pillOn]}>
                  <TextInput
                    ref={inputRef}
                    value={text}
                    onChangeText={(t) => setText(t.slice(0, COMMENT_MAX))}
                    selection={mention.inputProps.selection}
                    onSelectionChange={mention.inputProps.onSelectionChange}
                    onKeyPress={mention.inputProps.onKeyPress}
                    onFocus={onFocus}
                    onBlur={onBlur}
                    maxLength={COMMENT_MAX}
                    placeholder={host ? 'Comentar…' : 'Comentar na Txillada…'}
                    placeholderTextColor="rgba(255,255,255,0.62)"
                    returnKeyType="send"
                    blurOnSubmit={false}
                    onSubmitEditing={() => { if (!mention.open) void send(); }}
                    style={st.input}
                    accessibilityLabel="Escrever um comentário"
                  />
                  {text.trim() ? <SendButton onPress={() => void send()} disabled={sending} /> : null}
                </View>
              ) : (
                <View style={[st.pill, { paddingLeft: 16, gap: 8 }]}>
                  <Icon name="comment-off" size={15} color="rgba(255,255,255,0.6)" />
                  <Text style={st.closed} numberOfLines={1}>Os comentários estão fechados</Text>
                </View>
              )}
              {/* Oferecer vibes: sempre à vista, ao lado do comentário, com o nome escrito (não um ícone perdido nas reações). */}
              {ui.canGift && !typing ? (
                <Pressable onPress={() => setPanel('gift')} hitSlop={4} style={({ pressed }) => [st.offer, pressed && { transform: [{ scale: 0.95 }] }]} accessibilityRole="button" accessibilityLabel={`Oferecer vibes a @${dto.host.username}`}>
                  <Icon name="gift" size={19} color="#fff" strokeWidth={2.2} />
                  <Text style={st.offerText}>Oferecer</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>
      </View>

      {panel === 'more' ? (
        <View style={[StyleSheet.absoluteFill, st.over]} pointerEvents="box-none">
          <Panel title={`Txillada de @${dto.host.username}`} onClose={() => setPanel(null)} cancel>
            <ActionRow icon="share" title="Partilhar" onPress={() => { setPanel(null); void share(); }} />
            {ui.canGift ? <ActionRow icon="gift" title="Oferecer vibes" onPress={() => setPanel('gift')} /> : null}
            {g.canRequest || g.waiting ? <ActionRow icon={g.waiting ? 'clock' : 'user-plus'} title={g.waiting ? 'Desistir do pedido para entrar' : 'Pedir para entrar (transmitir)'} onPress={() => { setPanel(null); void askJoin(); }} /> : null}
            {g.onStage ? <ActionRow icon="logout" title="Sair do ecrã" danger onPress={() => { setPanel(null); void confirmLeaveStage(); }} /> : null}
            <ActionRow icon="user" title="Ver o perfil" onPress={() => { setPanel(null); router.push(`/u/${dto.host.username}` as never); }} />
            {ui.canReport ? <ActionRow icon="flag" title="Denunciar a Txillada" danger onPress={() => setPanel('report')} /> : null}
            <ActionRow icon="block" title={`Bloquear @${dto.host.username}`} danger onPress={() => { setPanel(null); void confirmBlock(); }} />
          </Panel>
        </View>
      ) : null}
      {panel === 'viewers' ? (
        <View style={[StyleSheet.absoluteFill, st.over]} pointerEvents="box-none">
          <Panel title={`A ver agora · ${viewersCount}`} onClose={() => setPanel(null)}>
            <ViewersList items={fxs.viewers} onOpen={host ? viewerActions : undefined} />
          </Panel>
        </View>
      ) : null}
      {panel === 'gift' ? (
        <View style={[StyleSheet.absoluteFill, st.over]} pointerEvents="box-none">
          <Panel title="Oferecer vibes" onClose={() => setPanel(null)}>
            <GiftSheet
              host={dto.host.username}
              goal={live.goal}
              onSend={tx.gift}
              onWallet={() => { setPanel(null); router.push('/wallet' as never); }}
              onDone={() => { if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined); }}
            />
          </Panel>
        </View>
      ) : null}
      {panel === 'guests' ? (
        <View style={[StyleSheet.absoluteFill, st.over]} pointerEvents="box-none">
          <Panel title="Convidados" onClose={() => setPanel(null)}>
            <GuestsPanel
              s={tx.guests}
              paid={paid}
              onInvite={tx.inviteByAt}
              onAccept={(u) => hostGuest('accept', u)}
              onDecline={(u) => hostGuest('decline', u)}
              onRemove={(u) => hostGuest('remove', u)}
              onOpenViewers={() => { fxs.refreshViewers(); setPanel('viewers'); }}
            />
          </Panel>
        </View>
      ) : null}
      {g.invited && panel === null ? <InviteCard inviter={tx.guests.inviter ?? dto.host} busy={accepting} onAccept={() => void acceptInvite()} onDecline={() => void tx.leaveStage().then((e) => say(e ?? 'Recusaste o convite'))} /> : null}
      {panel === 'report' ? <View style={[StyleSheet.absoluteFill, st.over]} pointerEvents="box-none"><ReportSheet type="txillada" id={dto.id} onClose={() => setPanel(null)} /></View> : null}
      {menuC && menuItems.length ? (
        <CommentMenu
          c={menuC}
          items={menuItems}
          onPick={(item) => pick(item, menuC)}
          onClose={() => setMenuId(null)}
        />
      ) : null}
      {reporting ? (
        <View style={[StyleSheet.absoluteFill, st.over]} pointerEvents="box-none">
          <ReportSheet type="txillada_comment" id={reporting.id} txilladaId={dto.id} onClose={() => setReporting(null)} onReported={() => tx.hideComment(reporting)} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * No site e no PWA o ecrã é fixo à janela (de ponta a ponta, 100dvh: no iPhone conta a barra do Safari a aparecer e a
 * desaparecer), sem depender da altura medida pelo React no primeiro desenho. Sem suporte de dvh, ficam o top/bottom 0.
 * Com o teclado aberto, a altura passa a ser a de antes (em px): o vídeo não encolhe.
 */
const webFull: ViewStyle | null = Platform.OS === 'web' ? ({ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, height: '100dvh', zIndex: 10 } as unknown as ViewStyle) : null;

const glass = Platform.OS === 'web' ? ({ backdropFilter: 'blur(14px) saturate(160%)', WebkitBackdropFilter: 'blur(14px) saturate(160%)' } as object) : {};

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center' },
  waitText: { color: 'rgba(255,255,255,0.86)', fontSize: 15, fontWeight: '600', textAlign: 'center' },
  gradTop: { position: 'absolute', left: 0, right: 0, top: 0, zIndex: 2, elevation: 2 },
  gradBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 2, elevation: 2 },
  col: { position: 'absolute', top: 0, bottom: 0, zIndex: 3, elevation: 3 },
  top: { position: 'absolute', zIndex: 5, elevation: 5, gap: 9 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  author: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 9 },
  ring: { borderRadius: 999, padding: 1.5, borderWidth: 2, borderColor: colors.brand },
  name: { color: '#fff', fontWeight: '700', fontSize: 15.5, letterSpacing: -0.2 },
  title: { marginTop: 1, color: 'rgba(255,255,255,0.86)', fontSize: 12.5, fontWeight: '500' },
  end: { height: 34, paddingHorizontal: 14, borderRadius: 17, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  endText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  stats: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 2, flexWrap: 'wrap' },
  cheerPill: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 28, paddingHorizontal: 9, borderRadius: 14, backgroundColor: 'rgba(14,14,18,0.5)' },
  cheerText: { color: '#fff', fontSize: 12.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
  fund: { gap: 6, alignSelf: 'stretch' },
  offer: { height: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, borderRadius: 22, backgroundColor: colors.brand, borderWidth: 1, borderColor: 'rgba(255,154,91,0.7)' },
  offerText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  weak: { color: '#fff', fontSize: 12.5, fontWeight: '600', alignSelf: 'flex-start', backgroundColor: 'rgba(217,119,6,0.85)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: 'hidden' },
  muted: { flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: 6, height: 28, paddingHorizontal: 10, borderRadius: 14, backgroundColor: 'rgba(14,14,18,0.6)' },
  mutedText: { color: '#fff', fontSize: 12.5, fontWeight: '700' },
  failed: { position: 'absolute', left: 24, right: 24, top: '42%', zIndex: 7, alignItems: 'center', gap: 10, padding: 16, borderRadius: 18, backgroundColor: 'rgba(14,14,18,0.82)' },
  failedText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  sound: { position: 'absolute', alignSelf: 'center', top: '46%', zIndex: 7, flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 18, borderRadius: 22, backgroundColor: 'rgba(14,14,18,0.78)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  soundText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  flash: { position: 'absolute', left: 16, right: 16, zIndex: 9, alignItems: 'center' },
  flashText: { color: '#fff', fontSize: 14, fontWeight: '600', backgroundColor: 'rgba(14,14,18,0.82)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, overflow: 'hidden', textAlign: 'center' },
  bar: { position: 'absolute', zIndex: 6, elevation: 6, gap: 8 },
  mentions: { marginHorizontal: 0, marginBottom: 0 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  pill: { flex: 1, minWidth: 0, height: 44, flexDirection: 'row', alignItems: 'center', borderRadius: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', backgroundColor: 'rgba(14,14,18,0.35)', paddingRight: 4, ...glass },
  pillOn: { borderColor: 'rgba(255,154,91,0.6)', backgroundColor: 'rgba(24,24,27,0.92)' },
  input: { flex: 1, minWidth: 0, height: 42, paddingLeft: 18, paddingRight: 8, color: '#fff', fontSize: 15, outlineStyle: 'none' as never },

  closed: { flexShrink: 1, fontSize: 14, color: 'rgba(255,255,255,0.72)' },
  barBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(14,14,18,0.42)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', ...glass },
  join: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 34, paddingHorizontal: 11, borderRadius: 17, backgroundColor: colors.brand, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', flexShrink: 0 },
  joinWaiting: { backgroundColor: 'rgba(14,14,18,0.55)', borderColor: 'rgba(255,154,91,0.55)', ...glass },
  joinText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  count: { position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  countText: { color: colors.brand, fontSize: 11, fontWeight: '900' },
  leaveStage: { height: 40, paddingHorizontal: 14, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(14,14,18,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', ...glass },
  leaveStageText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  /** Os painéis (Mais, A ver agora) por cima de tudo, também da barra de baixo. */
  over: { zIndex: 20, elevation: 20 },
});
