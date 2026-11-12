import { useGrowInput } from '@/lib/growInput';
import { LinearGradient } from 'expo-linear-gradient';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { api, uploadChatMedia } from '@/lib/api';
import { colors } from '@/lib/theme';
import type { LocationMessage } from '@/lib/sendLocation';
import { markSeen, useIsNew } from '@/lib/whatsNew';
import { ChatAttachMenu } from './ChatAttachSheet';
import { Icon, type IconName } from './Icon';
import { GiftSheet } from './PostSheets';
import { SendLocationSheet } from './SendLocationSheet';
import { StickerPanel } from './StickerPanel';
import { useGifsConfig } from './GifPanel';
import { gifMessage } from '@/lib/gifs';
import { pendingFrom, sendPending } from '@/lib/chatPending';
import { usePastedImage } from '@/lib/usePastedImage';
import { PastedImageSheet } from './PastedImageSheet';

const nativeDriver = Platform.OS !== 'web';
const SLOP = { top: 4, bottom: 4, left: 2, right: 2 };

/**
 * A barra de escrever do chat: uma pílula só. Câmara (marca) à esquerda, "Mensagem…" ao meio e, com o campo vazio,
 * voz, galeria, stickers e "+" (câmara, foto e vídeo, localização, presente e ver uma vez, num menu por cima do "+").
 * Ao escrever, esses dão lugar a Enviar.
 */
export function ChatComposer({
  username, person, onSent, bottom, replyTo, onClearReply, onTyping, closeTick, onOpenChange,
}: {
  /** Avisa se os stickers ou o menu "+" estão abertos (para a conversa só pedir para fechar quando há algo aberto). */
  onOpenChange?: (open: boolean) => void;
  /** Muda quando se toca fora (na lista de mensagens): fecha os stickers e o menu "+". */
  closeTick?: number;
  username: string;
  person?: { username: string; displayName: string; canGift?: boolean };
  onSent: () => void;
  bottom: number;
  replyTo?: { id: string; text: string; who?: string } | null;
  onClearReply?: () => void;
  /** Chamado ao escrever (a conversa avisa a outra pessoa, no máximo de 3 em 3 segundos). */
  onTyping?: () => void;
}) {
  const grow = useGrowInput();
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  /** A pílula: o menu "+" mede-a para abrir logo por cima dela. */
  const pill = useRef<React.ComponentRef<typeof View>>(null);
  const [text, setText] = useState('');
  const [once, setOnce] = useState(false);
  const [onceHelp, setOnceHelp] = useState(false);
  const [panel, setPanel] = useState<null | 'stickers'>(null);
  const [more, setMore] = useState(false);
  useEffect(() => { if (closeTick) { setPanel(null); setMore(false); } }, [closeTick]);
  useEffect(() => { onOpenChange?.(panel !== null || more); }, [panel, more, onOpenChange]);
  const [gift, setGift] = useState(false);
  const [place, setPlace] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const stickersNew = useIsNew('stickers');
  const gifs = useGifsConfig();
  // Site: colar ou arrastar uma imagem para a caixa abre a pré-visualização (Enviar ou Cancelar).
  const paste = usePastedImage({ inputRef: input, onProblem: setErr, onOpen: () => { setErr(''); setPanel(null); setMore(false); } });
  useEffect(() => () => clearInterval(timer.current), []);
  // Ao escolher "Responder" numa mensagem, o teclado abre logo para escrever a resposta.
  useEffect(() => {
    if (replyTo?.id) input.current?.focus();
  }, [replyTo?.id]);

  async function dispatch(msg: Parameters<typeof api.chatSend>[1]) {
    setErr('');
    const payload = { ...msg, ...(replyTo ? { replyTo: replyTo.id } : null) };
    // Texto, sticker ou GIF: a bolha aparece logo (lib/chatPending); se falhar, fica com "Tentar de novo" (nada se perde).
    const shown = pendingFrom(msg, replyTo);
    if (shown) {
      onClearReply?.();
      await sendPending(`u:${username}`, shown, () => api.chatSend(username, payload), { onSent });
      return;
    }
    try {
      await api.chatSend(username, payload);
      onClearReply?.();
      onSent();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function sendText() {
    const body = text.trim();
    if (!body) return;
    setText('');
    grow.reset();
    await dispatch({ body });
  }
  async function pick(source: 'camera' | 'library') {
    setPanel(null);
    try {
      if (source === 'camera') {
        const p = await ImagePicker.requestCameraPermissionsAsync();
        if (!p.granted) return setErr('Preciso de acesso à câmara para tirar a foto.');
      }
      const r = await (source === 'camera'
        ? ImagePicker.launchCameraAsync({ mediaTypes: ['images', 'videos'], quality: 0.8, videoMaxDuration: 30 })
        : ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.8 }));
      const a = r.canceled ? null : r.assets[0];
      if (!a) return;
      const video = a.type === 'video';
      await sendMedia(a.uri, a.mimeType ?? (video ? 'video/mp4' : 'image/jpeg'), video);
    } catch (e) {
      setErr((e as Error).message || 'Não consegui enviar');
    }
  }
  /** Envia uma foto ou vídeo (da galeria, da câmara ou colado), com o texto escrito como legenda e "Ver uma vez". */
  /** `caption`: a legenda escrita na pré-visualização (sem ela, vai o texto da caixa). */
  async function sendMedia(uri: string, mime: string, video: boolean, caption?: string) {
    setBusy(true);
    try {
      const mediaId = await uploadChatMedia(uri, mime);
      await dispatch({ kind: video ? 'video' : 'image', mediaId, body: (caption ?? text).trim() || undefined, once });
      setText('');
      grow.reset();
      setOnce(false);
    } finally {
      setBusy(false);
    }
  }
  /** "Enviar" na pré-visualização da imagem colada ou arrastada: o mesmo caminho da galeria. */
  async function sendPasted(caption: string) {
    const p = paste.take();
    if (!p) return;
    try {
      await sendMedia(p.uri, p.type, false, caption);
    } catch (e) {
      setErr((e as Error).message || 'Não consegui enviar');
    } finally {
      paste.release(p);
    }
  }
  /** "Localização": abre a folha "Enviar localização" (como no WhatsApp). Nada se envia sem um toque em Enviar nela. */
  function openPlace() {
    setPanel(null);
    Keyboard.dismiss();
    setPlace(true);
  }
  /** Chamado pela folha: os erros sobem para ela (mostra-os e fica aberta). Devolve o id (para a partilha em direto). */
  async function sendLocation(msg: LocationMessage) {
    setErr('');
    const r = await api.chatSend(username, { ...msg, ...(replyTo ? { replyTo: replyTo.id } : null) });
    onClearReply?.();
    onSent();
    return r;
  }
  function toggleOnce() {
    if (!once) setOnceHelp(true);
    setOnce(!once);
  }
  async function startRecording() {
    try {
      const p = await requestRecordingPermissionsAsync();
      if (!p.granted) return setErr('Preciso de acesso ao microfone para gravar.');
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setSecs(0);
      setRecording(true);
      timer.current = setInterval(() => setSecs((s) => s + 1), 1000);
    } catch {
      setErr('Não consegui gravar.');
    }
  }
  async function finishRecording(send: boolean) {
    clearInterval(timer.current);
    setRecording(false);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!send || !uri || secs < 1) return;
      setBusy(true);
      const mediaId = await uploadChatMedia(uri, Platform.OS === 'web' ? 'audio/webm' : 'audio/mp4');
      await dispatch({ kind: 'voice', mediaId, durationMs: secs * 1000, once });
    } catch (e) {
      setErr((e as Error).message || 'Não consegui enviar a mensagem de voz');
    } finally {
      setBusy(false);
    }
  }
  const mmss = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const pad = { paddingHorizontal: 10, paddingTop: 6, paddingBottom: Math.max(14, bottom + 8) };

  if (recording) {
    return (
      <View style={[st.wrap, pad]}>
        <View style={[st.pill, { alignItems: 'center' }]}>
          <Pressable onPress={() => void finishRecording(false)} hitSlop={SLOP} style={st.recX} accessibilityRole="button" accessibilityLabel="Cancelar a gravação">
            <Icon name="trash" size={21} color={colors.zinc700} />
          </Pressable>
          <View style={st.recMid} accessibilityLiveRegion="polite" accessibilityLabel={`A gravar, ${mmss}`}>
            <RecDot />
            <Text style={st.recTime}>{mmss}</Text>
            <Text style={st.recHint}>A gravar…</Text>
          </View>
          <Pop>
            <SendButton label="Enviar a mensagem de voz" onPress={() => void finishRecording(true)} />
          </Pop>
        </View>
      </View>
    );
  }

  const hasText = !!text.trim();
  const firstName = person?.displayName.split(' ')[0];

  return (
    <View style={st.wrap}>
      {once && onceHelp && (
        <View style={st.help} accessibilityRole="alert">
          <Icon name="once" size={18} color="#fff" />
          <Text style={st.helpText}>Ver uma vez: a próxima foto, vídeo ou voz só se abre uma vez.</Text>
          <Pressable onPress={() => setOnceHelp(false)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Fechar a explicação"><Icon name="x" size={16} color="#fff" /></Pressable>
        </View>
      )}
      {panel === 'stickers' && <StickerPanel onPick={(id) => { setPanel(null); void dispatch({ kind: 'sticker', body: id }); }} onGif={(g) => { setPanel(null); void dispatch(gifMessage(g)); }} />}
      <View style={pad}>
        {err ? <Text style={st.err} accessibilityRole="alert">{err}</Text> : null}
        {replyTo && (
          <View style={st.reply}>
            <View style={st.replyBar} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={st.replyWho} numberOfLines={1}>A responder a {replyTo.who ?? ''}</Text>
              <Text style={st.replyText} numberOfLines={1}>{replyTo.text}</Text>
            </View>
            <Pressable onPress={onClearReply} hitSlop={6} style={st.replyX} accessibilityRole="button" accessibilityLabel="Cancelar resposta"><Icon name="x" size={18} color={colors.zinc500} /></Pressable>
          </View>
        )}
        <View ref={pill} collapsable={false} style={[st.pill, once && st.pillOnce]}>
          <Pressable onPress={() => void pick('camera')} disabled={busy} hitSlop={SLOP} style={busy && { opacity: 0.5 }} accessibilityRole="button" accessibilityLabel="Abrir a câmara" accessibilityState={{ disabled: busy }}>
            <LinearGradient colors={[colors.brand, colors.brandLight]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.camera}>
              <Icon name="camera" size={20} color="#fff" />
            </LinearGradient>
          </Pressable>
          {once && (
            <Pressable onPress={toggleOnce} hitSlop={SLOP} style={st.onceChip} accessibilityRole="switch" accessibilityState={{ checked: true }} accessibilityLabel="Ver uma vez ligado. Toca para desligar">
              <Icon name="once" size={16} color={colors.brand} strokeWidth={2.2} />
              <Text style={st.onceText}>Uma vez</Text>
            </Pressable>
          )}
          <TextInput
            ref={paste.ref}
            value={text}
            onChangeText={(v) => { setText(v); if (v) onTyping?.(); }}
            onFocus={() => setPanel(null)}
            multiline
            numberOfLines={1}
            maxLength={2000}
            placeholder="Mensagem…"
            placeholderTextColor={colors.zinc500}
            onContentSizeChange={grow.onContentSizeChange}
            style={[st.input, grow.style]}
            accessibilityLabel="Mensagem"
          />
          {hasText ? (
            <Pop key="send">
              <SendButton label="Enviar" onPress={() => void sendText()} disabled={busy} />
            </Pop>
          ) : (
            <Pop key="tools" style={st.tools}>
              <Tool icon="mic" label="Gravar mensagem de voz" onPress={() => void startRecording()} />
              <Tool icon="image" label="Enviar foto ou vídeo da galeria" onPress={() => void pick('library')} disabled={busy} />
              <Tool
                icon="sticker"
                label={`${gifs.enabled ? 'Stickers e GIFs' : 'Stickers'}${stickersNew ? ' (novos)' : ''}`}
                on={panel === 'stickers'}
                dot={stickersNew}
                onPress={() => {
                  markSeen('stickers');
                  if (panel !== 'stickers') Keyboard.dismiss();
                  setPanel(panel === 'stickers' ? null : 'stickers');
                }}
              />
              {/* O teclado fica como está: o menu abre por cima da barra e cabe no espaço que sobra. */}
              <Tool icon={more ? 'x' : 'plus'} label={more ? 'Fechar o menu' : 'Mais: câmara, foto e vídeo, localização, presente e ver uma vez'} on={more} expanded={more} onPress={() => { setPanel(null); setMore(!more); }} />
            </Pop>
          )}
        </View>
      </View>
      {more && (
        <ChatAttachMenu
          anchor={pill}
          firstName={firstName}
          canGift={!!person?.canGift}
          once={once}
          onClose={() => setMore(false)}
          onCamera={() => void pick('camera')}
          onLibrary={() => void pick('library')}
          onPlace={openPlace}
          onGift={() => setGift(true)}
          onToggleOnce={toggleOnce}
        />
      )}
      {gift && person && <GiftSheet recipient={person} onClose={() => { setGift(false); onSent(); }} />}
      {place && <SendLocationSheet allowLive who={firstName} onSend={sendLocation} onClose={() => setPlace(false)} />}
      {paste.pending && <PastedImageSheet uri={paste.pending.uri} caption={text.trim()} once={once} onCancel={paste.cancel} onSend={(c) => void sendPasted(c)} />}
    </View>
  );
}

/** Um ícone da pílula (44 de largura, 40 de altura; com o hitSlop a área de toque passa os 44). */
function Tool({ icon, label, onPress, on, dot, disabled, expanded }: { icon: IconName; label: string; onPress: () => void; on?: boolean; dot?: boolean; disabled?: boolean; expanded?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={SLOP}
      style={({ pressed }) => [st.tool, (on || pressed) && { backgroundColor: on ? '#fff' : colors.zinc200 }, disabled && { opacity: 0.5 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!on, disabled: !!disabled, ...(expanded === undefined ? null : { expanded }) }}
    >
      <Icon name={icon} size={23} color={on ? colors.brand : colors.zinc700} />
      {dot ? <View style={st.dot} pointerEvents="none" /> : null}
    </Pressable>
  );
}

function SendButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={SLOP} style={({ pressed }) => [st.send, pressed && { transform: [{ scale: 0.92 }] }, disabled && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={label}>
      <Icon name="arrow-up" size={22} color="#fff" strokeWidth={2.4} />
    </Pressable>
  );
}

/** Entra com uma animação curta (aparece e cresce um pouco): usado para a troca ícones ↔ Enviar. */
function Pop({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 160, easing: Easing.out(Easing.back(1.6)), useNativeDriver: nativeDriver }).start();
  }, [v]);
  const scale = v.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  return <Animated.View style={[style, { opacity: v.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 1, 1] }), transform: [{ scale }] }]}>{children}</Animated.View>;
}

/** O ponto vermelho da gravação, a pulsar. */
function RecDot() {
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 0.3, duration: 600, useNativeDriver: nativeDriver }),
      Animated.timing(v, { toValue: 1, duration: 600, useNativeDriver: nativeDriver }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return <Animated.View style={[st.recDot, { opacity: v }]} />;
}

const st = StyleSheet.create({
  wrap: { backgroundColor: colors.white },
  pill: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, minHeight: 48, borderRadius: 24, backgroundColor: colors.zinc100, padding: 4, borderWidth: 1.5, borderColor: colors.zinc100 },
  pillOnce: { borderColor: colors.brand, backgroundColor: '#fff5f6' },
  camera: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, minWidth: 0, minHeight: 40, maxHeight: 148, paddingHorizontal: 10, paddingTop: 10, paddingBottom: 10, fontSize: 16, lineHeight: 20, color: colors.zinc900, outlineStyle: 'none' } as object,
  tools: { flexDirection: 'row', alignItems: 'flex-end' },
  tool: { width: 44, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: 7, right: 9, width: 9, height: 9, borderRadius: 5, backgroundColor: colors.brand, borderWidth: 1.5, borderColor: colors.zinc100 },
  send: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  onceChip: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 32, marginBottom: 4, marginLeft: 4, borderRadius: 16, paddingHorizontal: 10, backgroundColor: 'rgba(214,51,79,0.12)' },
  onceText: { fontSize: 13, fontWeight: '700', color: colors.brand },
  err: { textAlign: 'center', fontSize: 14, color: colors.red600, paddingBottom: 6 },
  help: { marginHorizontal: 10, marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, backgroundColor: colors.zinc900, paddingHorizontal: 14, paddingVertical: 10 },
  helpText: { flex: 1, color: '#fff', fontSize: 13, lineHeight: 18, fontWeight: '600' },
  reply: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6, marginHorizontal: 4, borderRadius: 14, backgroundColor: '#fafafa', borderWidth: 1, borderColor: colors.zinc100, paddingVertical: 6, paddingLeft: 10, paddingRight: 2 },
  replyBar: { alignSelf: 'stretch', width: 3, borderRadius: 2, backgroundColor: colors.brand },
  replyWho: { fontSize: 13, lineHeight: 17, fontWeight: '700', color: colors.brand },
  replyText: { fontSize: 13, lineHeight: 18, color: colors.zinc600 },
  replyX: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  recX: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  recMid: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.red600 },
  recTime: { fontSize: 17, fontWeight: '700', color: colors.zinc900, fontVariant: ['tabular-nums'] },
  recHint: { fontSize: 14, color: colors.zinc500 },
});
