import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, Platform, Pressable, Share, StyleSheet, Text, TextInput, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { CheersPour } from '@/components/CheersPour';
import { Icon } from '@/components/Icon';
import { NameWithBadge } from '@/components/NameWithBadge';
import { ActivityIndicator } from '@/components/PontoLoader';
import { ReportSheet } from '@/components/ReportSheet';
import { Panel, useKeyboardHeight } from '@/components/StoryParts';
import { CallIcon } from '@/components/calls/CallIcons';
import { FxLayer, HelloAllButton, HelloStack, JoinedToast, ReactionBar, ViewersList, ViewersStack } from '@/components/txillada/LiveFx';
import { LiveFloatComments } from '@/components/txillada/LiveFloatComments';
import { EndedView, GlassButton, HostSummary, LiveBadge } from '@/components/txillada/TxilladaParts';
import { TxilladaVideo } from '@/components/txillada/TxilladaVideo';
import { txilladaApi } from '@/lib/api.txillada';
import { useAuth } from '@/lib/auth';
import { SITE_URL } from '@/lib/config';
import { useDesktop } from '@/lib/desktop';
import { useNoIndex } from '@/lib/noIndex';
import { useReduceMotion } from '@/lib/reduceMotion';
import { colors } from '@/lib/theme';
import { COMMENT_MAX, commentActions, elapsed, errorText, liveClock, liveSummary, shareLink, shareMessage, type TxilladaComment } from '@/lib/txillada';
import { liveLayout, type FxPerson, type ReactionKind } from '@/lib/txilladaFx';
import { useTxilladaFx } from '@/lib/txilladaFxRoom';
import { KeepAwake, useNow, useTxillada } from '@/lib/txilladaRoom';

/**
 * A Txillada (o live, docs/txillada-contrato.md), em ecrã inteiro: o vídeo de quem transmite ocupa o ecrã de ponta a ponta
 * (cover; uma imagem deitada fica inteira com o fundo desfocado — components/txillada/TxilladaVideo) e os controlos vão por
 * cima, com degradês suaves em cima e em baixo e as margens seguras (entalhe, barra de casa). No site/PWA o ecrã é
 * `position: fixed` com 100dvh: não depende do tamanho da janela medido no primeiro desenho. No computador, o vídeo fica ao
 * centro em altura total, com o fundo desfocado, e os controlos numa coluna ao centro (lib/txilladaFx `liveLayout`).
 *
 * Em cima: o anfitrião com o selo, «AO VIVO» com o tempo e quem está a ver (os avatares empilhados; tocar abre «A ver
 * agora»). À direita sobem as reações de todos; à esquerda, os comentários a flutuar, os olás e «@fulano entrou». Em baixo:
 * as reações de um toque e comentar (quem vê) ou o microfone, virar, «👋 Olá a todos» e comentar (o anfitrião).
 *
 * A Txillada não se grava (nem as reações): quando acaba, já não se pode ver («A Txillada acabou»); o anfitrião vê o resumo.
 */
export default function TxilladaScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const wide = useDesktop();
  const kb = useKeyboardHeight();
  const reduce = useReduceMotion();
  const { user } = useAuth();
  const tx = useTxillada(String(id));
  // As ligações das Txilladas nunca aparecem nos motores de busca (também no nginx, pelo X-Robots-Tag).
  useNoIndex();
  const { dto, live, kind, ui, host } = tx;
  const now = useNow(kind === 'live');
  const fxs = useTxilladaFx({
    id: String(id),
    live: kind === 'live',
    host,
    // A foto vem pelo @ (o Avatar mostra as iniciais por baixo, se não houver).
    me: user ? { username: user.username, displayName: user.displayName || user.username, avatarUrl: `/api/v1/avatars/${encodeURIComponent(user.username)}`, verified: !!user.verified, verifiedTier: user.verifiedTier ?? null } : null,
    reduce,
    onCheer: () => tx.cheer(),
  });
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(false);
  const [sending, setSending] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [panel, setPanel] = useState<null | 'more' | 'report' | 'viewers'>(null);
  const flashT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);

  const say = (m: string) => {
    setFlash(m);
    clearTimeout(flashT.current);
    flashT.current = setTimeout(() => setFlash(null), 2600);
  };
  useEffect(() => () => clearTimeout(flashT.current), []);

  const leave = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/' as never);
  };
  function confirmEnd() {
    Alert.alert('Terminar a Txillada?', 'Quem está a ver sai, e a Txillada não fica gravada.', [
      { text: 'Continuar', style: 'cancel' },
      { text: 'Terminar', style: 'destructive', onPress: () => void tx.end().then((e) => { if (e) say(e); }) },
    ]);
  }
  // No Android, o botão de voltar do anfitrião pergunta antes de terminar (sair sem terminar deixava a sala sem vídeo).
  const hostLive = host && kind === 'live';
  useEffect(() => {
    if (!hostLive || Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { confirmEnd(); return true; });
    return () => sub.remove();
  }, [hostLive]); // eslint-disable-line react-hooks/exhaustive-deps

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
  /** O toque longo num comentário: apagar (o anfitrião ou o autor) e expulsar (o anfitrião). */
  function hold(c: TxilladaComment) {
    const acts = commentActions(dto, c, tx.me);
    if (!acts.length) return;
    const buttons: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [];
    if (acts.includes('remove')) buttons.push({ text: 'Apagar o comentário', style: 'destructive', onPress: () => void tx.removeComment(c).then((e) => say(e ?? 'Comentário apagado')) });
    if (acts.includes('ban')) buttons.push({ text: `Expulsar @${c.author.username}`, style: 'destructive', onPress: () => confirmBan(c.author.username) });
    buttons.push({ text: 'Cancelar', style: 'cancel' });
    Alert.alert(`Comentário de @${c.author.username}`, c.body.length > 120 ? `${c.body.slice(0, 119)}…` : c.body, buttons);
  }
  function confirmBan(username: string) {
    Alert.alert(`Expulsar @${username}?`, 'Sai já da Txillada e não pode voltar a entrar nesta.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Expulsar',
        style: 'destructive',
        onPress: () => void txilladaApi.ban(String(id), username).then(
          () => { say(`@${username} foi expulso`); fxs.refreshViewers(); },
          (e: { status?: number; message?: string }) => say(errorText(e?.status, e?.message)),
        ),
      },
    ]);
  }
  /** O anfitrião, na lista «A ver agora»: dizer olá ou expulsar. */
  function viewerActions(u: FxPerson) {
    if (!host) return;
    Alert.alert(`@${u.username}`, u.displayName, [
      { text: 'Dizer olá 👋', onPress: () => fxs.helloTo(u.username) },
      { text: `Expulsar @${u.username}`, style: 'destructive', onPress: () => confirmBan(u.username) },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  }

  // ── Os estados sem vídeo ───────────────────────────────────────────────────────────────────────────────────────────
  if (kind === 'loading') {
    return <View style={[st.screen, webFull, st.center]}><ActivityIndicator color="#fff" /></View>;
  }
  if (kind === 'error') {
    return <View style={[st.screen, webFull]}><EndedView title="Não dá para ver esta Txillada" sub={tx.error ?? 'Esta Txillada não existe ou não a podes ver.'} onBack={leave} /></View>;
  }
  if (kind === 'ended') {
    if (host) {
      const sum = liveSummary(dto, live, now);
      return <View style={[st.screen, webFull, { paddingTop: insets.top, paddingBottom: insets.bottom }]}><HostSummary {...sum} cut={(live.status ?? dto?.status) === 'cut'} onDone={leave} /></View>;
    }
    return <View style={[st.screen, webFull]}><EndedView onBack={leave} /></View>;
  }
  if (!dto) return null;
  if (tx.error && tx.conn !== 'connected') {
    return <View style={[st.screen, webFull]}><EndedView title="Não deu para entrar" sub={tx.error} onBack={leave} /></View>;
  }

  // ── Ao vivo ────────────────────────────────────────────────────────────────────────────────────────────────────────
  const L = liveLayout({ w: width, h: height, top: insets.top, bottom: insets.bottom, left: insets.left, right: insets.right, wide });
  const time = liveClock(elapsed(dto.startedAt, now));
  const barBottom = Platform.OS !== 'web' && kb ? Math.max(L.padBottom, kb + 6) : L.padBottom;
  // A barra de baixo: duas filas (as reações ou as ferramentas do anfitrião, e comentar) de 44 px com 8 entre elas.
  const blockH = 44 + 8 + 44;
  const laneBottom = barBottom + blockH + 10;
  const floatBottom = laneBottom + 42;
  const floatH = Math.max(120, Math.min(320, Math.round(height * 0.32)));
  const waiting = !tx.video;
  const viewersCount = Math.max(live.viewers, fxs.viewersTotal);

  return (
    <View style={[st.screen, webFull]}>
      <KeepAwake />
      <TxilladaVideo track={tx.video} mirror={host && tx.front} fit={host ? 'cover' : 'auto'} style={StyleSheet.absoluteFill} />
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
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.28)', 'rgba(0,0,0,0.72)']} locations={[0, 0.45, 1]} style={[st.gradBottom, { height: Math.min(height * 0.55, floatBottom + floatH + 40) }]} pointerEvents="none" />

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
              <Pressable onPress={confirmEnd} style={({ pressed }) => [st.end, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel="Terminar a Txillada">
                <Text style={st.endText}>Terminar</Text>
              </Pressable>
            ) : (
              <>
                <GlassButton icon="more" label="Mais opções" onPress={() => setPanel('more')} />
                <GlassButton icon="x" label="Sair da Txillada" onPress={leave} />
              </>
            )}
          </View>
          <View style={st.stats} pointerEvents="box-none">
            <LiveBadge time={time} />
            <ViewersStack items={fxs.viewers} total={viewersCount} onPress={() => { fxs.refreshViewers(); setPanel('viewers'); }} />
            {live.cheers > 0 ? (
              <View style={st.cheerPill} accessibilityLabel={`${live.cheers} brindes`}>
                <Icon name="cheers" size={15} color={colors.brandWarm} strokeWidth={2} />
                <Text style={st.cheerText}>{live.cheers}</Text>
              </View>
            ) : null}
          </View>
          {tx.conn === 'reconnecting' ? <Text style={st.weak}>A ligação está fraca… a voltar a ligar</Text> : null}
          {host && !tx.mic ? (
            <View style={st.muted} pointerEvents="none">
              <CallIcon name="mic-off" size={15} color="#fff" />
              <Text style={st.mutedText}>Microfone calado</Text>
            </View>
          ) : null}
        </View>

        {/* Os olás: «@rui: Olá 👋» por baixo dos números; a saudação do anfitrião em grande, ao centro. */}
        <HelloStack items={fxs.hellos} top={L.padTop + (host && !tx.mic ? 124 : 88)} left={L.side} width={L.floatW} />

        {tx.conn === 'failed' ? (
          <View style={st.failed}>
            <Text style={st.failedText}>A ligação caiu.</Text>
            <Pressable onPress={tx.reconnect} style={st.failedBtn} accessibilityRole="button"><Text style={st.failedBtnText}>Tentar outra vez</Text></Pressable>
          </View>
        ) : null}

        {tx.audioBlocked && !host ? (
          <Pressable onPress={() => void tx.startAudio()} style={st.sound} accessibilityRole="button" accessibilityLabel="Ligar o som">
            <Icon name="volume" size={18} color="#fff" strokeWidth={2.2} />
            <Text style={st.soundText}>Toca para ouvir</Text>
          </Pressable>
        ) : null}

        {/* As reações de todos sobem pelo lado direito. */}
        <FxLayer items={fxs.fx} bottom={barBottom + blockH + 4} height={Math.round(height * 0.55)} right={L.side - 12} reduce={reduce} />

        {/* A conversa por cima do vídeo (também para o anfitrião): os comentários a flutuar e quem entrou. */}
        {panel === null ? (
          <LiveFloatComments comments={live.comments} bottom={floatBottom} width={L.floatW} height={floatH} onHold={host || tx.me ? hold : undefined} />
        ) : null}
        <JoinedToast users={fxs.joined?.users ?? null} bottom={laneBottom} left={L.side} onHello={host ? (u) => (u ? fxs.helloTo(u.username) : react('hello')) : undefined} />

        {flash ? <View style={[st.flash, { bottom: laneBottom }]} pointerEvents="none"><Text style={st.flashText} accessibilityRole="alert">{flash}</Text></View> : null}

        {/* Em baixo: as reações (quem vê) ou as ferramentas do anfitrião; e comentar. */}
        <View style={[st.bar, { left: L.side, right: L.side, bottom: barBottom }]} pointerEvents="box-none">
          {!typing ? (
            <View style={st.barRow}>
              {host ? (
                <>
                  <GlassButton label={tx.mic ? 'Calar o microfone' : 'Ligar o microfone'} on={!tx.mic} onPress={() => void tx.toggleMic()}>
                    {tx.mic ? <Icon name="mic" size={20} color="#fff" strokeWidth={2.2} /> : <CallIcon name="mic-off" size={20} color="#fff" />}
                  </GlassButton>
                  <GlassButton icon="cam-flip" label="Virar a câmara" onPress={() => void tx.flip()} />
                  <View style={{ flex: 1 }} />
                  <HelloAllButton onPress={() => react('hello')} />
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
                  onFocus={() => setTyping(true)}
                  onBlur={() => setTyping(false)}
                  maxLength={COMMENT_MAX}
                  placeholder={host ? 'Comentar…' : 'Comentar na Txillada…'}
                  placeholderTextColor="rgba(255,255,255,0.62)"
                  returnKeyType="send"
                  blurOnSubmit={false}
                  onSubmitEditing={() => void send()}
                  style={st.input}
                  accessibilityLabel="Escrever um comentário"
                />
                {text.trim() ? (
                  <Pressable onPress={() => void send()} disabled={sending} style={({ pressed }) => [st.send, pressed && { transform: [{ scale: 0.92 }] }, sending && { opacity: 0.5 }]} accessibilityRole="button" accessibilityLabel="Enviar">
                    <Icon name="send" size={17} color="#fff" strokeWidth={2.2} />
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <View style={[st.pill, { paddingLeft: 16, gap: 8 }]}>
                <Icon name="comment-off" size={15} color="rgba(255,255,255,0.6)" />
                <Text style={st.closed} numberOfLines={1}>Os comentários estão fechados</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {panel === 'more' ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <Panel title={`Txillada de ${dto.host.username}`} onClose={() => setPanel(null)}>
            <Pressable onPress={() => { setPanel(null); void share(); }} style={st.menuRow} accessibilityRole="button"><Text style={st.menuText}>Partilhar</Text></Pressable>
            {ui.canReport ? <Pressable onPress={() => setPanel('report')} style={st.menuRow} accessibilityRole="button"><Text style={[st.menuText, { color: colors.red600, fontWeight: '600' }]}>Denunciar a Txillada</Text></Pressable> : null}
            <Pressable onPress={() => { setPanel(null); router.push(`/u/${dto.host.username}` as never); }} style={st.menuRow} accessibilityRole="button"><Text style={st.menuText}>Ver o perfil (para bloquear)</Text></Pressable>
            <Pressable onPress={() => setPanel(null)} style={st.menuRow}><Text style={st.menuText}>Cancelar</Text></Pressable>
          </Panel>
        </View>
      ) : null}
      {panel === 'viewers' ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <Panel title={`A ver agora · ${viewersCount}`} onClose={() => setPanel(null)}>
            <ViewersList items={fxs.viewers} onOpen={host ? viewerActions : undefined} />
          </Panel>
        </View>
      ) : null}
      {panel === 'report' ? <ReportSheet type="txillada" id={dto.id} onClose={() => setPanel(null)} /> : null}
    </View>
  );
}

/**
 * No site e no PWA o ecrã é fixo à janela (de ponta a ponta, 100dvh: no iPhone conta a barra do Safari a aparecer e a
 * desaparecer), sem depender da altura medida pelo React no primeiro desenho. Sem suporte de dvh, ficam o top/bottom 0.
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
  weak: { color: '#fff', fontSize: 12.5, fontWeight: '600', alignSelf: 'flex-start', backgroundColor: 'rgba(217,119,6,0.85)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: 'hidden' },
  muted: { flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: 6, height: 28, paddingHorizontal: 10, borderRadius: 14, backgroundColor: 'rgba(14,14,18,0.6)' },
  mutedText: { color: '#fff', fontSize: 12.5, fontWeight: '700' },
  failed: { position: 'absolute', left: 24, right: 24, top: '42%', zIndex: 7, alignItems: 'center', gap: 10, padding: 16, borderRadius: 18, backgroundColor: 'rgba(14,14,18,0.82)' },
  failedText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  failedBtn: { height: 40, paddingHorizontal: 18, borderRadius: 20, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  failedBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  sound: { position: 'absolute', alignSelf: 'center', top: '46%', zIndex: 7, flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 18, borderRadius: 22, backgroundColor: 'rgba(14,14,18,0.78)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  soundText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  flash: { position: 'absolute', left: 16, right: 16, zIndex: 9, alignItems: 'center' },
  flashText: { color: '#fff', fontSize: 14, fontWeight: '600', backgroundColor: 'rgba(14,14,18,0.82)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, overflow: 'hidden', textAlign: 'center' },
  bar: { position: 'absolute', zIndex: 6, elevation: 6, gap: 8 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  pill: { flex: 1, minWidth: 0, height: 44, flexDirection: 'row', alignItems: 'center', borderRadius: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', backgroundColor: 'rgba(14,14,18,0.35)', paddingRight: 4, ...glass },
  pillOn: { borderColor: 'rgba(255,154,91,0.6)', backgroundColor: 'rgba(24,24,27,0.92)' },
  input: { flex: 1, minWidth: 0, height: 42, paddingLeft: 18, paddingRight: 8, color: '#fff', fontSize: 15, outlineStyle: 'none' as never },
  send: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  closed: { flexShrink: 1, fontSize: 14, color: 'rgba(255,255,255,0.72)' },
  barBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(14,14,18,0.42)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', ...glass },
  menuRow: { paddingVertical: 14, alignItems: 'center' },
  menuText: { fontSize: 18, color: colors.zinc900 },
});
