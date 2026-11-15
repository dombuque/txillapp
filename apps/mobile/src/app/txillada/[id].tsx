import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, Platform, Pressable, Share, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { CheersPour } from '@/components/CheersPour';
import { Icon } from '@/components/Icon';
import { NameWithBadge } from '@/components/NameWithBadge';
import { ActivityIndicator } from '@/components/PontoLoader';
import { ReportSheet } from '@/components/ReportSheet';
import { Panel, useKeyboardHeight } from '@/components/StoryParts';
import { CallIcon } from '@/components/calls/CallIcons';
import { LiveFloatComments } from '@/components/txillada/LiveFloatComments';
import { EndedView, GlassButton, HostSummary, LiveBadge, ViewersPill } from '@/components/txillada/TxilladaParts';
import { TxilladaVideo } from '@/components/txillada/TxilladaVideo';
import { SITE_URL } from '@/lib/config';
import { useDesktop } from '@/lib/desktop';
import { useNoIndex } from '@/lib/noIndex';
import { storyFrame } from '@/lib/storyFrame';
import { colors } from '@/lib/theme';
import { COMMENT_MAX, commentActions, elapsed, liveClock, liveSummary, shareLink, shareMessage, type TxilladaComment } from '@/lib/txillada';
import { KeepAwake, useNow, useTxillada } from '@/lib/txilladaRoom';

/**
 * A Txillada (o live, docs/txillada-contrato.md): o mesmo cartão 9:16 do visor dos mimos (lib/storyFrame), com o vídeo de
 * quem transmite. Em cima: o anfitrião com o selo, «AO VIVO» com o tempo, quantos estão a ver. Em baixo, no vídeo, os
 * comentários a flutuar (os balões dos mimos). Por baixo do cartão, fora do vídeo: comentar, brindar e partilhar (quem
 * vê) ou o microfone, virar a câmara e comentar (o anfitrião, que termina em cima).
 *
 * A Txillada não se grava: quando acaba, já não se pode ver («A Txillada acabou»); o anfitrião vê o resumo.
 */
export default function TxilladaScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const wide = useDesktop();
  const kb = useKeyboardHeight();
  const tx = useTxillada(String(id));
  // As ligações das Txilladas nunca aparecem nos motores de busca (também no nginx e no robots.txt).
  useNoIndex();
  const { dto, live, kind, ui, host } = tx;
  const now = useNow(kind === 'live');
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(false);
  const [sending, setSending] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [panel, setPanel] = useState<null | 'more' | 'report'>(null);
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
  function cheer() {
    if (!tx.cheer()) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
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
    if (acts.includes('ban')) {
      buttons.push({
        text: `Expulsar @${c.author.username}`,
        style: 'destructive',
        onPress: () => Alert.alert(`Expulsar @${c.author.username}?`, 'Sai já da Txillada e não pode voltar a entrar nesta.', [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Expulsar', style: 'destructive', onPress: () => void tx.ban(c).then((e) => say(e ?? `@${c.author.username} foi expulso`)) },
        ]),
      });
    }
    buttons.push({ text: 'Cancelar', style: 'cancel' });
    Alert.alert(`Comentário de @${c.author.username}`, c.body.length > 120 ? `${c.body.slice(0, 119)}…` : c.body, buttons);
  }

  // ── Os estados sem vídeo ───────────────────────────────────────────────────────────────────────────────────────────
  if (kind === 'loading') {
    return <View style={[st.screen, st.center]}><ActivityIndicator color="#fff" /></View>;
  }
  if (kind === 'error') {
    return <EndedView title="Não dá para ver esta Txillada" sub={tx.error ?? 'Esta Txillada não existe ou não a podes ver.'} onBack={leave} />;
  }
  if (kind === 'ended') {
    if (host) {
      const sum = liveSummary(dto, live, now);
      return <View style={[st.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}><HostSummary {...sum} cut={(live.status ?? dto?.status) === 'cut'} onDone={leave} /></View>;
    }
    return <EndedView onBack={leave} />;
  }
  if (!dto) return null;
  if (tx.error && tx.conn !== 'connected') {
    return <EndedView title="Não deu para entrar" sub={tx.error} onBack={leave} />;
  }

  // ── Ao vivo ────────────────────────────────────────────────────────────────────────────────────────────────────────
  const frame = storyFrame({ w: width, h: height, top: insets.top, bottom: insets.bottom, wide });
  const time = liveClock(elapsed(dto.startedAt, now));
  const restBottom = height - (frame.barTop + frame.barH);
  const barBottom = Platform.OS !== 'web' && kb ? Math.max(restBottom, kb + 6) : restBottom;
  const floatBottom = 14;
  const floatH = Math.max(0, Math.round(frame.cardH * 0.42));
  const waiting = !tx.video;

  return (
    <View style={st.screen}>
      <KeepAwake />
      <View style={[st.card, { left: frame.cardLeft, top: frame.cardTop, width: frame.cardW, height: frame.cardH, borderRadius: frame.radius }]}>
        <TxilladaVideo track={tx.video} mirror={host && tx.front} style={StyleSheet.absoluteFill} />
        {waiting ? (
          <View style={[StyleSheet.absoluteFill, st.center, { gap: 12, paddingHorizontal: 24 }]} pointerEvents="none">
            <Avatar name={dto.host.displayName} username={dto.host.avatarUrl ? dto.host.username : undefined} size={84} />
            <ActivityIndicator color="#fff" />
            <Text style={st.waitText}>{tx.conn === 'failed' ? 'A ligação caiu.' : host ? 'A abrir a câmara…' : `A ligar à Txillada de @${dto.host.username}…`}</Text>
          </View>
        ) : null}
        {typing ? <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.2)' }]} pointerEvents="none" /> : null}

        <CheersPour n={live.cheerBurst + tx.myBurst} size={Math.min(240, frame.cardW * 0.6)} />

        {/* Em cima: o anfitrião, «AO VIVO» e o tempo, quantos estão a ver; e sair (quem vê) ou terminar (o anfitrião). */}
        <LinearGradient colors={['rgba(0,0,0,0.6)', 'rgba(0,0,0,0.2)', 'transparent']} style={st.top} pointerEvents="box-none">
          <View style={st.who} pointerEvents="box-none">
            <Pressable onPress={() => { if (!host) router.push(`/u/${dto.host.username}` as never); }} disabled={host} style={st.author} accessibilityRole={host ? undefined : 'link'} accessibilityLabel={`Txillada de ${dto.host.displayName}`}>
              <View style={st.ring}>
                <Avatar name={dto.host.displayName} username={dto.host.avatarUrl ? dto.host.username : undefined} size={34} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }} pointerEvents="none">
                <NameWithBadge name={dto.host.username} who={dto.host} style={st.name} />
                <Text style={st.title} numberOfLines={1}>{dto.title}</Text>
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
          <View style={st.stats} pointerEvents="none">
            <LiveBadge time={time} />
            <ViewersPill n={live.viewers} />
            {live.cheers > 0 ? (
              <View style={st.cheerPill} accessibilityLabel={`${live.cheers} brindes`}>
                <Icon name="cheers" size={15} color={colors.brandWarm} strokeWidth={2} />
                <Text style={st.cheerText}>{live.cheers}</Text>
              </View>
            ) : null}
          </View>
          {tx.conn === 'reconnecting' ? <Text style={st.weak}>A ligação está fraca… a voltar a ligar</Text> : null}
        </LinearGradient>

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

        {host && !tx.mic ? (
          <View style={st.muted} pointerEvents="none">
            <CallIcon name="mic-off" size={15} color="#fff" />
            <Text style={st.mutedText}>Microfone calado</Text>
          </View>
        ) : null}

        {/* Ao contrário dos mimos, a escrever os balões ficam à vista: num live quer-se ver a conversa enquanto se escreve. */}
        {panel === null ? (
          <LiveFloatComments comments={live.comments} bottom={floatBottom} width={Math.floor(frame.cardW * 0.72)} height={floatH} onHold={host || tx.me ? hold : undefined} />
        ) : null}

        {flash ? <View style={st.flash} pointerEvents="none"><Text style={st.flashText} accessibilityRole="alert">{flash}</Text></View> : null}
      </View>

      {/* A barra, fora do vídeo (como nos mimos). */}
      <View style={[st.bar, { left: frame.cardLeft, width: frame.cardW, minHeight: frame.barH, bottom: barBottom }]} pointerEvents="box-none">
        <View style={st.barRow}>
          {host && !typing ? (
            <>
              <GlassButton label={tx.mic ? 'Calar o microfone' : 'Ligar o microfone'} on={!tx.mic} onPress={() => void tx.toggleMic()}>
                {tx.mic ? <Icon name="mic" size={20} color="#fff" strokeWidth={2.2} /> : <CallIcon name="mic-off" size={20} color="#fff" />}
              </GlassButton>
              <GlassButton icon="cam-flip" label="Virar a câmara" onPress={() => void tx.flip()} />
            </>
          ) : null}
          {ui.canComment ? (
            <View style={[st.pill, typing && st.pillOn]}>
              <TextInput
                ref={inputRef}
                value={text}
                onChangeText={(t) => setText(t.slice(0, COMMENT_MAX))}
                onFocus={() => setTyping(true)}
                onBlur={() => setTyping(false)}
                maxLength={COMMENT_MAX}
                placeholder={host ? 'Comentar…' : `Comentar na Txillada…`}
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
          {!typing && ui.canCheer ? (
            <Pressable onPress={cheer} hitSlop={4} style={({ pressed }) => [st.barBtn, pressed && { transform: [{ scale: 0.9 }] }]} accessibilityRole="button" accessibilityLabel="Brindar">
              <Icon name="cheers" size={27} color={colors.brandWarm} strokeWidth={2} />
            </Pressable>
          ) : null}
          {!typing && ui.canShare ? (
            <Pressable onPress={() => void share()} hitSlop={4} style={({ pressed }) => [st.barBtn, pressed && { transform: [{ scale: 0.92 }] }]} accessibilityRole="button" accessibilityLabel="Partilhar a Txillada">
              <Icon name="share" size={24} color="#fff" />
            </Pressable>
          ) : null}
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
      {panel === 'report' ? <ReportSheet type="txillada" id={dto.id} onClose={() => setPanel(null)} /> : null}
    </View>
  );
}

const glass = Platform.OS === 'web' ? ({ backdropFilter: 'blur(14px) saturate(160%)', WebkitBackdropFilter: 'blur(14px) saturate(160%)' } as object) : {};

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center' },
  card: { position: 'absolute', overflow: 'hidden', backgroundColor: colors.zinc900 },
  waitText: { color: 'rgba(255,255,255,0.86)', fontSize: 15, fontWeight: '600', textAlign: 'center' },
  top: { position: 'absolute', left: 0, right: 0, top: 0, zIndex: 5, elevation: 5, paddingHorizontal: 10, paddingTop: 12, paddingBottom: 28, gap: 8 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  author: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 9 },
  ring: { borderRadius: 999, padding: 1.5, borderWidth: 2, borderColor: colors.brand },
  name: { color: '#fff', fontWeight: '700', fontSize: 15, letterSpacing: -0.2 },
  title: { marginTop: 1, color: 'rgba(255,255,255,0.86)', fontSize: 12.5, fontWeight: '500' },
  end: { height: 34, paddingHorizontal: 14, borderRadius: 17, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  endText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  stats: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 2 },
  cheerPill: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 24, paddingHorizontal: 8, borderRadius: 6, backgroundColor: 'rgba(14,14,18,0.5)' },
  cheerText: { color: '#fff', fontSize: 12.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
  weak: { color: '#fff', fontSize: 12.5, fontWeight: '600', alignSelf: 'flex-start', backgroundColor: 'rgba(217,119,6,0.85)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: 'hidden' },
  failed: { position: 'absolute', left: 24, right: 24, top: '42%', zIndex: 6, alignItems: 'center', gap: 10, padding: 16, borderRadius: 18, backgroundColor: 'rgba(14,14,18,0.82)' },
  failedText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  failedBtn: { height: 40, paddingHorizontal: 18, borderRadius: 20, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  failedBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  sound: { position: 'absolute', alignSelf: 'center', top: '46%', zIndex: 6, flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 18, borderRadius: 22, backgroundColor: 'rgba(14,14,18,0.78)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  soundText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  muted: { position: 'absolute', right: 10, top: 96, zIndex: 6, flexDirection: 'row', alignItems: 'center', gap: 6, height: 28, paddingHorizontal: 10, borderRadius: 14, backgroundColor: 'rgba(14,14,18,0.6)' },
  mutedText: { color: '#fff', fontSize: 12.5, fontWeight: '700' },
  flash: { position: 'absolute', left: 16, right: 16, bottom: 12, zIndex: 7, alignItems: 'center' },
  flashText: { color: '#fff', fontSize: 14, fontWeight: '600', backgroundColor: 'rgba(14,14,18,0.82)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, overflow: 'hidden', textAlign: 'center' },
  bar: { position: 'absolute', justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 8 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pill: { flex: 1, minWidth: 0, height: 44, flexDirection: 'row', alignItems: 'center', borderRadius: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', backgroundColor: 'rgba(255,255,255,0.07)', paddingRight: 4, ...glass },
  pillOn: { borderColor: 'rgba(255,154,91,0.6)', backgroundColor: 'rgba(24,24,27,0.92)' },
  input: { flex: 1, minWidth: 0, height: 42, paddingLeft: 18, paddingRight: 8, color: '#fff', fontSize: 15, outlineStyle: 'none' as never },
  send: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  closed: { flexShrink: 1, fontSize: 14, color: 'rgba(255,255,255,0.72)' },
  barBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  menuRow: { paddingVertical: 14, alignItems: 'center' },
  menuText: { fontSize: 18, color: colors.zinc900 },
});
