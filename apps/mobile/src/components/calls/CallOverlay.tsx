import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import {
  acceptCall, declineCall, dismissEnded, expandCall, flipCamera, fmtDuration, hangUp, minimiseCall, speakerSelectable,
  toggleCamera, toggleMic, toggleSpeaker, useCall, useStreamRev, VideoView, type CallPeer, type CallState,
} from '@/lib/calls';
import { SITE_URL } from '@/lib/config';
import { useDesktop } from '@/lib/desktop';
import { colors } from '@/lib/theme';
import { CallIcon } from './CallIcons';
import { TxFrame } from './TxFrame';

const GREEN = '#22c55e';
const RED = '#ef4444';
const native = Platform.OS !== 'web';
const QUICK = ['Estou ocupado, já te ligo', 'Estou numa reunião, ligo depois', 'Não posso falar agora, manda mensagem'];

/**
 * O ecrã da chamada, por cima de tudo (a tocar, a chamar, em chamada e o fim). Vive no layout raiz: aparece em qualquer ecrã
 * quando chega um "ring". Minimizado fica uma pílula verde no topo. No computador é um painel ao centro, não a janela toda.
 */
export function CallOverlay() {
  const c = useCall();
  if (c.phase === 'idle') return null;
  if (c.minimised) return <MiniCall c={c} />;
  const back = () => (c.phase === 'ended' ? dismissEnded() : c.phase === 'incoming' ? undefined : minimiseCall());
  return (
    <Modal visible transparent animationType="fade" onRequestClose={back} statusBarTranslucent navigationBarTranslucent>
      <CallScreen c={c} />
    </Modal>
  );
}

/** Tempo desde `startedAt`, a contar de segundo a segundo. */
function useElapsed(startedAt: number | null, endedAt: number | null = null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt || endedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt, endedAt]);
  return startedAt ? (endedAt ?? now) - startedAt : 0;
}

const avatarUrl = (p: CallPeer) => `${SITE_URL}/api/v1/avatars/${encodeURIComponent(p.username)}`;

function CallScreen({ c }: { c: CallState }) {
  const desktop = useDesktop();
  const { width, height } = useWindowDimensions();
  const videoLayout = c.video && (c.phase === 'connecting' || c.phase === 'active');
  const body =
    c.phase === 'incoming' ? <Incoming c={c} /> :
    c.phase === 'outgoing' ? <Outgoing c={c} /> :
    c.phase === 'ended' ? <Ended c={c} /> :
    videoLayout ? <VideoCall c={c} /> : <VoiceCall c={c} />;
  if (!desktop) return <View style={st.full}>{body}<TxFrame /></View>;
  const panel = videoLayout
    ? { width: Math.min(960, width - 96), height: Math.min(640, height - 96) }
    : { width: 420, height: Math.min(720, height - 64) };
  return (
    <View style={st.backdrop}>
      <View style={[st.panel, panel]}>{body}<TxFrame panel /></View>
    </View>
  );
}

/** Margens do conteúdo: no telemóvel respeita o entalhe e a barra de baixo; no painel do computador, margens fixas. */
function usePad() {
  const insets = useSafeAreaInsets();
  const desktop = useDesktop();
  return desktop ? { top: 18, bottom: 46 } : { top: insets.top + 10, bottom: Math.max(insets.bottom, 12) + 44 };
}

/** Fundo: a minha câmara (videochamada a tocar) ou a foto da pessoa desfocada. */
function Backdrop({ peer, stream, mirror }: { peer: CallPeer | null; stream?: unknown | null; mirror?: boolean }) {
  const rev = useStreamRev();
  if (stream) {
    return (
      <View style={StyleSheet.absoluteFill}>
        <VideoView key={`bg-${rev}`} stream={stream} mirror={mirror} cover style={StyleSheet.absoluteFill} />
        <LinearGradient colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0.05)', 'rgba(0,0,0,0.7)']} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />
      </View>
    );
  }
  return (
    <View style={StyleSheet.absoluteFill}>
      <LinearGradient colors={['#3b111b', '#18181b']} style={StyleSheet.absoluteFill} />
      {peer?.hasAvatar ? <Image source={{ uri: avatarUrl(peer) }} style={[StyleSheet.absoluteFill, { transform: [{ scale: 1.3 }] }]} contentFit="cover" blurRadius={Platform.OS === 'android' ? 25 : 60} /> : null}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }]} />
    </View>
  );
}

/** Foto ao centro com um anel a pulsar (enquanto toca ou chama). */
function PulseAvatar({ peer, size, pulse }: { peer: CallPeer | null; size: number; pulse?: boolean }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!pulse) return;
    const loop = Animated.loop(Animated.timing(a, { toValue: 1, duration: 1600, useNativeDriver: native }));
    loop.start();
    return () => loop.stop();
  }, [a, pulse]);
  const ring = { transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [1, 1.45] }) }], opacity: a.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }) };
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {pulse ? <Animated.View style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: 'rgba(255,255,255,0.5)' }, ring]} /> : null}
      <View style={{ borderRadius: size / 2, borderWidth: 3, borderColor: 'rgba(255,255,255,0.85)' }}>
        <Avatar name={peer?.displayName ?? '?'} username={peer?.hasAvatar ? peer.username : undefined} size={size - 6} />
      </View>
    </View>
  );
}

function Kind({ video, text }: { video: boolean; text?: string }) {
  return (
    <View style={st.kind}>
      {video ? <Icon name="video" size={16} color="rgba(255,255,255,0.9)" /> : <CallIcon name="handset" size={15} color="rgba(255,255,255,0.9)" />}
      <Text style={st.kindText}>{text ?? (video ? 'Videochamada' : 'Chamada de voz')}</Text>
    </View>
  );
}

/** Botão redondo grande (Atender / Recusar / Desligar). */
function BigBtn({ bg, label, onPress, children, size = 70 }: { bg: string; label?: string; onPress: () => void; children: ReactNode; size?: number }) {
  return (
    <View style={{ alignItems: 'center', gap: 8 }}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }, pressed && { transform: [{ scale: 0.93 }], opacity: 0.9 }]}>
        {children}
      </Pressable>
      {label ? <Text style={st.btnLabel}>{label}</Text> : null}
    </View>
  );
}

/** Botão dos controlos (microfone, câmara…): vidro escuro; desligado fica branco com o ícone escuro. */
function Ctrl({ label, off, onPress, children }: { label: string; off?: boolean; onPress: () => void; children: (color: string) => ReactNode }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!off }} style={({ pressed }) => [st.ctrl, off && { backgroundColor: '#fff' }, pressed && { transform: [{ scale: 0.92 }] }]}>
      {children(off ? colors.zinc900 : '#fff')}
    </Pressable>
  );
}

/* ---------- A tocar ---------- */

function Incoming({ c }: { c: CallState }) {
  const pad = usePad();
  const [withVideo, setWithVideo] = useState(c.video);
  const [replies, setReplies] = useState(false);
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState('');
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Backdrop peer={c.peer} stream={c.video ? c.local : null} mirror />
      <View style={[st.center, { paddingTop: pad.top + 40 }]}>
        <PulseAvatar peer={c.peer} size={124} pulse />
        <Text style={st.name} numberOfLines={2}>{c.peer?.displayName ?? ''}</Text>
        <Kind video={c.video} />
      </View>

      {replies ? (
        <View style={[st.replies, { paddingBottom: pad.bottom }]}>
          <View style={st.repliesHead}>
            <Text style={st.repliesTitle}>Responder com mensagem</Text>
            <Pressable onPress={() => { setReplies(false); setWriting(false); }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Fechar"><Icon name="x" size={20} color={colors.zinc700} /></Pressable>
          </View>
          {writing ? (
            <View style={st.writeRow}>
              <TextInput autoFocus value={text} onChangeText={setText} placeholder="Escreve a tua mensagem…" placeholderTextColor={colors.zinc500} style={st.writeInput} maxLength={300} onSubmitEditing={() => text.trim() && declineCall(text)} returnKeyType="send" accessibilityLabel="Mensagem" />
              <Pressable onPress={() => text.trim() && declineCall(text)} disabled={!text.trim()} style={[st.sendBtn, !text.trim() && { opacity: 0.4 }]} accessibilityRole="button" accessibilityLabel="Enviar e recusar"><Icon name="send" size={20} color="#fff" /></Pressable>
            </View>
          ) : (
            <>
              {QUICK.map((q) => (
                <Pressable key={q} onPress={() => declineCall(q)} style={({ pressed }) => [st.reply, pressed && { backgroundColor: colors.zinc100 }]} accessibilityRole="button">
                  <Text style={st.replyText}>{q}</Text>
                </Pressable>
              ))}
              <Pressable onPress={() => setWriting(true)} style={({ pressed }) => [st.reply, pressed && { backgroundColor: colors.zinc100 }]} accessibilityRole="button">
                <Icon name="pencil" size={18} color={colors.zinc700} />
                <Text style={[st.replyText, { color: colors.zinc700 }]}>Escrever…</Text>
              </Pressable>
            </>
          )}
        </View>
      ) : (
        <View style={{ paddingBottom: pad.bottom, alignItems: 'center', gap: 22 }}>
          <Pressable onPress={() => setReplies(true)} style={({ pressed }) => [st.msgBtn, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel="Recusar com mensagem">
            <Icon name="comment" size={20} color="#fff" />
            <Text style={st.msgText}>Mensagem</Text>
          </Pressable>
          <View style={st.answerRow}>
            <BigBtn bg={RED} label="Recusar" onPress={() => declineCall()}><CallIcon name="hangup" size={30} color="#fff" strokeWidth={2.1} /></BigBtn>
            <View style={{ alignItems: 'center', gap: 8, marginBottom: 26 }}>
              <View style={st.toggle} accessibilityRole="radiogroup" accessibilityLabel="Atender com">
                <Pressable onPress={() => setWithVideo(false)} style={[st.toggleSeg, !withVideo && st.toggleOn]} accessibilityRole="radio" accessibilityState={{ selected: !withVideo }} accessibilityLabel="Atender com voz">
                  <CallIcon name="handset" size={16} color={!withVideo ? colors.zinc900 : '#fff'} />
                </Pressable>
                <Pressable onPress={() => setWithVideo(true)} style={[st.toggleSeg, withVideo && st.toggleOn]} accessibilityRole="radio" accessibilityState={{ selected: withVideo }} accessibilityLabel="Atender com vídeo">
                  <Icon name="video" size={17} color={withVideo ? colors.zinc900 : '#fff'} />
                </Pressable>
              </View>
              <Text style={st.toggleText}>{withVideo ? 'com vídeo' : 'só voz'}</Text>
            </View>
            <BigBtn bg={GREEN} label="Atender" onPress={() => void acceptCall(withVideo)}>
              {withVideo ? <Icon name="video" size={30} color="#fff" strokeWidth={2} /> : <CallIcon name="handset" size={29} color="#fff" strokeWidth={2.1} />}
            </BigBtn>
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

/* ---------- A chamar ---------- */

function Outgoing({ c }: { c: CallState }) {
  const pad = usePad();
  return (
    <View style={{ flex: 1 }}>
      <Backdrop peer={c.peer} stream={c.video && c.camOn ? c.local : null} mirror={c.front} />
      <View style={[st.center, { paddingTop: pad.top + 40 }]}>
        <PulseAvatar peer={c.peer} size={116} pulse />
        <Text style={st.name} numberOfLines={2}>{c.peer?.displayName ?? ''}</Text>
        <Kind video={c.video} text={c.callId ? 'A chamar…' : 'A ligar…'} />
      </View>
      <View style={[st.bar, { paddingBottom: pad.bottom }]}>
        <View style={{ marginTop: 7 }}><Ctrl label={c.micOn ? 'Desligar o microfone' : 'Ligar o microfone'} off={!c.micOn} onPress={toggleMic}>{(col) => c.micOn ? <Icon name="mic" size={24} color={col} /> : <CallIcon name="mic-off" size={24} color={col} />}</Ctrl></View>
        <BigBtn bg={RED} label="Cancelar" onPress={hangUp}><CallIcon name="hangup" size={30} color="#fff" strokeWidth={2.1} /></BigBtn>
        {speakerSelectable ? (
          <View style={{ marginTop: 7 }}><Ctrl label={c.speaker ? 'Desligar o altifalante' : 'Ligar o altifalante'} off={c.speaker} onPress={toggleSpeaker}>{(col) => <Icon name="volume" size={24} color={col} />}</Ctrl></View>
        ) : <View style={{ width: 56 }} />}
      </View>
    </View>
  );
}

/* ---------- Em chamada ---------- */

function Header({ c }: { c: CallState }) {
  const pad = usePad();
  const t = useElapsed(c.startedAt);
  return (
    <LinearGradient colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)']} style={[st.header, { paddingTop: pad.top }]} pointerEvents="box-none">
      <Pressable onPress={minimiseCall} style={st.headBtn} hitSlop={6} accessibilityRole="button" accessibilityLabel="Minimizar a chamada">
        <CallIcon name="chevron-down" size={26} color="#fff" strokeWidth={2.2} />
      </Pressable>
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text style={st.headName} numberOfLines={1}>{c.peer?.displayName ?? ''}</Text>
        <Text style={st.headTime}>{c.phase === 'active' ? fmtDuration(t) : 'A ligar…'}</Text>
      </View>
      <View style={{ width: 44 }} />
    </LinearGradient>
  );
}

function PeerMuted({ c }: { c: CallState }) {
  if (c.remoteMic !== false) return null;
  const first = c.peer?.displayName.split(' ')[0] ?? '';
  return (
    <View style={st.muted} accessibilityLiveRegion="polite">
      <CallIcon name="mic-off" size={15} color="#fff" />
      <Text style={st.mutedText}>{first ? `${first} · microfone desligado` : 'Microfone desligado'}</Text>
    </View>
  );
}

function Controls({ c, camera }: { c: CallState; camera: boolean }) {
  const pad = usePad();
  return (
    <View style={[st.controlsWrap, { paddingBottom: pad.bottom }]} pointerEvents="box-none">
      {c.error ? <Text style={st.err}>{c.error}</Text> : null}
      <View style={st.controls}>
        <Ctrl label={c.micOn ? 'Desligar o microfone' : 'Ligar o microfone'} off={!c.micOn} onPress={toggleMic}>{(col) => c.micOn ? <Icon name="mic" size={24} color={col} /> : <CallIcon name="mic-off" size={24} color={col} />}</Ctrl>
        {camera ? (
          <Ctrl label={c.camOn ? 'Desligar a câmara' : 'Ligar a câmara'} off={!c.camOn} onPress={() => void toggleCamera()}>{(col) => c.camOn ? <Icon name="video" size={24} color={col} /> : <CallIcon name="video-off" size={24} color={col} />}</Ctrl>
        ) : null}
        {camera && c.camOn && c.canFlip ? (
          <Ctrl label="Virar a câmara" onPress={() => void flipCamera()}>{(col) => <Icon name="flip-camera" size={24} color={col} />}</Ctrl>
        ) : null}
        {speakerSelectable ? (
          <Ctrl label={c.speaker ? 'Desligar o altifalante' : 'Ligar o altifalante'} off={c.speaker} onPress={toggleSpeaker}>{(col) => <Icon name="volume" size={24} color={col} />}</Ctrl>
        ) : null}
        <Pressable onPress={hangUp} style={({ pressed }) => [st.ctrl, { backgroundColor: RED }, pressed && { transform: [{ scale: 0.92 }] }]} accessibilityRole="button" accessibilityLabel="Desligar">
          <CallIcon name="hangup" size={26} color="#fff" strokeWidth={2.1} />
        </Pressable>
      </View>
    </View>
  );
}

function VoiceCall({ c }: { c: CallState }) {
  const pad = usePad();
  const t = useElapsed(c.startedAt);
  return (
    <View style={{ flex: 1 }}>
      <Backdrop peer={c.peer} />
      <View style={[st.topRow, { paddingTop: pad.top }]}>
        <Pressable onPress={minimiseCall} style={st.headBtn} hitSlop={6} accessibilityRole="button" accessibilityLabel="Minimizar a chamada">
          <CallIcon name="chevron-down" size={26} color="#fff" strokeWidth={2.2} />
        </Pressable>
      </View>
      <View style={[st.center, { paddingTop: 24 }]}>
        <PulseAvatar peer={c.peer} size={136} pulse={c.phase === 'connecting'} />
        <Text style={st.name} numberOfLines={2}>{c.peer?.displayName ?? ''}</Text>
        <Text style={st.timer}>{c.phase === 'active' ? fmtDuration(t) : 'A ligar…'}</Text>
        <PeerMuted c={c} />
      </View>
      <Controls c={c} camera={false} />
    </View>
  );
}

const PIP_W = 108;
const PIP_H = 156;

function VideoCall({ c }: { c: CallState }) {
  const rev = useStreamRev();
  const pad = usePad();
  const desktop = useDesktop();
  const [swapped, setSwapped] = useState(false);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const remoteVideo = !!c.remote && c.remoteCam !== false;
  const localVideo = !!c.local && c.camOn;

  const remoteView = (small: boolean) =>
    remoteVideo ? (
      <VideoView key={`r-${rev}-${small ? 's' : 'b'}`} stream={c.remote} cover={small || !desktop} zOrder={small ? 1 : 0} style={StyleSheet.absoluteFill} />
    ) : (
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <Backdrop peer={c.peer} />
        <Avatar name={c.peer?.displayName ?? '?'} username={c.peer?.hasAvatar ? c.peer.username : undefined} size={small ? 56 : 120} />
        {!small ? <Text style={[st.timer, { marginTop: 14 }]}>{c.remote ? 'Câmara desligada' : 'A ligar…'}</Text> : null}
      </View>
    );
  const localView = (small: boolean) =>
    localVideo ? (
      <VideoView key={`l-${rev}-${small ? 's' : 'b'}`} stream={c.local} mirror={c.front} cover zOrder={small ? 1 : 0} style={StyleSheet.absoluteFill} />
    ) : (
      <View style={[StyleSheet.absoluteFill, { backgroundColor: '#27272a', alignItems: 'center', justifyContent: 'center' }]}>
        <CallIcon name="video-off" size={small ? 24 : 40} color="rgba(255,255,255,0.75)" />
      </View>
    );

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }} onLayout={(e: LayoutChangeEvent) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      <View style={StyleSheet.absoluteFill}>{swapped ? localView(false) : remoteView(false)}</View>
      <Header c={c} />
      <View style={{ position: 'absolute', top: pad.top + 64, left: 0, right: 0, alignItems: 'center' }} pointerEvents="none"><PeerMuted c={c} /></View>
      {box.w > 0 ? (
        <Pip box={box} top={pad.top + 64} bottom={pad.bottom + 96} onTap={() => setSwapped((s) => !s)}>
          {swapped ? remoteView(true) : localView(true)}
        </Pip>
      ) : null}
      <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']} style={st.bottomShade} pointerEvents="none" />
      <Controls c={c} camera />
    </View>
  );
}

/** A janelinha da minha câmara: arrasta-se para qualquer canto; um toque troca com a grande. */
function Pip({ box, top, bottom, onTap, children }: { box: { w: number; h: number }; top: number; bottom: number; onTap: () => void; children: ReactNode }) {
  const M = 12;
  const corner = (right: boolean, low: boolean) => ({ x: right ? box.w - PIP_W - M : M, y: low ? box.h - PIP_H - bottom : top });
  const pos = useRef(new Animated.ValueXY(corner(true, false))).current;
  const cur = useRef(corner(true, false));
  const tap = useRef(onTap);
  tap.current = onTap;
  const geo = useRef({ box, top, bottom });
  geo.current = { box, top, bottom };

  useEffect(() => {
    const id = pos.addListener((v) => { cur.current = v; });
    return () => pos.removeListener(id);
  }, [pos]);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        pos.setOffset({ x: cur.current.x, y: cur.current.y });
        pos.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event([null, { dx: pos.x, dy: pos.y }], { useNativeDriver: false }),
      onPanResponderRelease: (_e, g) => {
        pos.flattenOffset();
        if (Math.abs(g.dx) + Math.abs(g.dy) < 6) {
          tap.current();
          return;
        }
        const { box: b, top: t, bottom: bt } = geo.current;
        const cx = cur.current.x + PIP_W / 2;
        const cy = cur.current.y + PIP_H / 2;
        const to = { x: cx > b.w / 2 ? b.w - PIP_W - M : M, y: cy > b.h / 2 ? b.h - PIP_H - bt : t };
        Animated.spring(pos, { toValue: to, useNativeDriver: false, friction: 7 }).start();
      },
      onPanResponderTerminate: () => pos.flattenOffset(),
    }),
  ).current;

  return (
    <Animated.View {...pan.panHandlers} style={[st.pip, { transform: pos.getTranslateTransform() }]} accessibilityRole="button" accessibilityLabel="Trocar os vídeos" accessibilityHint="Arrasta para mudar de canto">
      {children}
    </Animated.View>
  );
}

/* ---------- Fim ---------- */

function endText(c: CallState, ms: number): string {
  switch (c.endReason) {
    case 'declined': return 'Chamada recusada';
    case 'busy': return 'Está noutra chamada';
    case 'no-answer': return 'Sem resposta';
    case 'cancelled': return 'Chamada cancelada';
    case 'blocked': return c.error ?? 'Não podes ligar a esta pessoa';
    case 'failed': return c.error ?? 'A ligação caiu';
    default: return c.startedAt ? `Chamada terminada · ${fmtDuration(ms)}` : 'Chamada terminada';
  }
}

function Ended({ c }: { c: CallState }) {
  const ms = useElapsed(c.startedAt, c.endedAt);
  return (
    <Pressable style={{ flex: 1 }} onPress={dismissEnded} accessibilityRole="button" accessibilityLabel="Fechar">
      <Backdrop peer={c.peer} />
      <View style={[st.center, { justifyContent: 'center', flex: 1 }]}>
        <PulseAvatar peer={c.peer} size={104} />
        <Text style={st.name} numberOfLines={2}>{c.peer?.displayName ?? ''}</Text>
        <Text style={[st.timer, { textAlign: 'center' }]} accessibilityLiveRegion="assertive">{endText(c, ms)}</Text>
        {c.message ? <Text style={st.endMsg} numberOfLines={3}>"{c.message}"</Text> : null}
      </View>
    </Pressable>
  );
}

/* ---------- Minimizada ---------- */

function MiniCall({ c }: { c: CallState }) {
  const insets = useSafeAreaInsets();
  const t = useElapsed(c.startedAt);
  const label = c.phase === 'incoming' ? 'A tocar' : c.phase === 'outgoing' ? 'A chamar…' : c.phase === 'active' ? fmtDuration(t) : 'A ligar…';
  return (
    <View style={[st.miniWrap, { top: Math.max(insets.top, 8) + 4 }]} pointerEvents="box-none">
      <Pressable onPress={expandCall} style={({ pressed }) => [st.mini, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel="Voltar à chamada">
        {c.video ? <Icon name="video" size={16} color="#fff" /> : <CallIcon name="handset" size={15} color="#fff" />}
        <Text style={st.miniText} numberOfLines={1}>{c.peer?.displayName ?? ''} · {label}</Text>
        {c.micOn ? null : <CallIcon name="mic-off" size={15} color="#fff" />}
      </Pressable>
    </View>
  );
}

const glass = 'rgba(255,255,255,0.18)';
const st = StyleSheet.create({
  full: { flex: 1, backgroundColor: '#0b0b0c' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  panel: { borderRadius: 28, overflow: 'hidden', backgroundColor: '#0b0b0c', boxShadow: '0 20px 60px rgba(0,0,0,0.45)' } as object,
  center: { flex: 1, alignItems: 'center', paddingHorizontal: 24, gap: 10 },
  name: { marginTop: 14, fontSize: 28, fontWeight: '800', color: '#fff', textAlign: 'center', letterSpacing: -0.4 },
  kind: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kindText: { fontSize: 15, fontWeight: '600', color: 'rgba(255,255,255,0.9)' },
  timer: { fontSize: 16, fontWeight: '600', color: 'rgba(255,255,255,0.88)', fontVariant: ['tabular-nums'] },
  endMsg: { marginTop: 6, fontSize: 15, color: 'rgba(255,255,255,0.8)', textAlign: 'center', fontStyle: 'italic' },
  btnLabel: { fontSize: 13, fontWeight: '600', color: '#fff' },
  answerRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', width: '100%', maxWidth: 360, paddingHorizontal: 28 },
  toggle: { flexDirection: 'row', backgroundColor: glass, borderRadius: 999, padding: 3 },
  toggleSeg: { width: 40, height: 32, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  toggleOn: { backgroundColor: '#fff' },
  toggleText: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.85)' },
  msgBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingHorizontal: 16, borderRadius: 999, backgroundColor: glass },
  msgText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  replies: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 10, paddingHorizontal: 12 },
  repliesHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 8 },
  repliesTitle: { fontSize: 16, fontWeight: '700', color: colors.zinc900 },
  reply: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 14, borderRadius: 14 },
  replyText: { fontSize: 16, color: colors.zinc900 },
  writeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, paddingVertical: 8 },
  writeInput: { flex: 1, height: 46, borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 18, fontSize: 16, color: colors.zinc900, outlineStyle: 'none' } as object,
  sendBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  bar: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-evenly', paddingHorizontal: 24 },
  ctrl: { width: 56, height: 56, borderRadius: 28, backgroundColor: glass, alignItems: 'center', justifyContent: 'center' },
  controlsWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', gap: 10 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, backgroundColor: 'rgba(24,24,27,0.55)' },
  bottomShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 200 },
  err: { fontSize: 13, color: '#fff', backgroundColor: 'rgba(220,38,38,0.85)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, overflow: 'hidden' },
  header: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 22 },
  topRow: { flexDirection: 'row', paddingHorizontal: 8 },
  headBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  headName: { fontSize: 17, fontWeight: '700', color: '#fff' },
  headTime: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.85)', fontVariant: ['tabular-nums'] },
  muted: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.45)', marginTop: 6 },
  mutedText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  pip: { position: 'absolute', left: 0, top: 0, width: PIP_W, height: PIP_H, borderRadius: 16, overflow: 'hidden', backgroundColor: '#27272a', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  miniWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 1000 },
  mini: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: 320, height: 36, paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.green600, boxShadow: '0 4px 14px rgba(0,0,0,0.2)' } as object,
  miniText: { color: '#fff', fontSize: 14, fontWeight: '700', flexShrink: 1, fontVariant: ['tabular-nums'] },
});
