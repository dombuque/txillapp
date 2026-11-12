import { useGrowInput } from '@/lib/growInput';
import { LinearGradient } from 'expo-linear-gradient';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { uploadChatMedia } from '@/lib/api';
import { type GroupSendBody } from '@/lib/api.grupos';
import type { LocationMessage } from '@/lib/sendLocation';
import { colors } from '@/lib/theme';
import { Icon } from './Icon';
import { Pop, RecDot, SendButton, Tool } from './ChatComposer';
import { SendLocationSheet } from './SendLocationSheet';
import { StickerPanel } from './StickerPanel';
import { useGifsConfig } from './GifPanel';
import { gifMessage } from '@/lib/gifs';
import { pendingFrom, sendPending } from '@/lib/chatPending';
import { usePastedImage } from '@/lib/usePastedImage';
import { PastedImageSheet } from './PastedImageSheet';
import { markSeen, useIsNew } from '@/lib/whatsNew';

/**
 * A barra de escrever dos TxillGroups, com o mesmo desenho da das conversas a dois (components/ChatComposer): uma pílula,
 * câmara à esquerda, "Mensagem…" ao meio e, com o campo vazio, voz, galeria, stickers e "+" (sondagem e localização); ao escrever, Enviar.
 */
export function GroupComposer({
  send, onSent, bottom, replyTo, onClearReply, onPoll, closeTick, onOpenChange, pendingKey,
}: {
  /** A conversa nas mensagens a caminho (lib/chatPending, `g:<id>`): texto, stickers e GIFs aparecem logo. */
  pendingKey?: string;
  /** Avisa se os stickers ou os anexos estão abertos. */
  onOpenChange?: (open: boolean) => void;
  /** Muda quando se toca fora (na lista de mensagens): fecha os stickers e o menu de anexos. */
  closeTick?: number;
  send: (msg: GroupSendBody) => Promise<unknown>;
  onSent: () => void;
  bottom: number;
  replyTo?: { id: string; text: string; who?: string } | null;
  onClearReply?: () => void;
  /** TxillGroup: abre a folha de nova sondagem (no "mais"). */
  onPoll?: () => void;
}) {
  const grow = useGrowInput();
  const gifs = useGifsConfig();
  const stickersNew = useIsNew('stickers');
  const [text, setText] = useState('');
  const [panel, setPanel] = useState<null | 'stickers' | 'attach'>(null);
  useEffect(() => { if (closeTick) setPanel(null); }, [closeTick]);
  useEffect(() => { onOpenChange?.(panel !== null); }, [panel, onOpenChange]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [place, setPlace] = useState(false);
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  useEffect(() => () => clearInterval(timer.current), []);
  // Site: colar ou arrastar uma imagem para a caixa abre a pré-visualização (Enviar ou Cancelar).
  const paste = usePastedImage<React.ComponentRef<typeof TextInput>>({ onProblem: setErr, onOpen: () => { setErr(''); setPanel(null); } });

  async function dispatch(msg: GroupSendBody) {
    setErr('');
    const payload = { ...msg, ...(replyTo ? { replyTo: replyTo.id } : null) };
    // Texto, sticker ou GIF: a bolha aparece logo (lib/chatPending); se falhar, fica com "Tentar de novo" (nada se perde).
    const shown = pendingKey ? pendingFrom(msg, replyTo) : null;
    if (pendingKey && shown) {
      onClearReply?.();
      await sendPending(pendingKey, shown, () => send(payload) as Promise<{ id: string }>, { onSent });
      return;
    }
    try {
      await send(payload);
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
  /** Envia uma foto ou vídeo (da galeria, da câmara ou colado), com o texto escrito como legenda. */
  /** `caption`: a legenda escrita na pré-visualização (sem ela, vai o texto da caixa). */
  async function sendMedia(uri: string, mime: string, video: boolean, caption?: string) {
    setBusy(true);
    try {
      const mediaId = await uploadChatMedia(uri, mime);
      await dispatch({ kind: video ? 'video' : 'image', mediaId, body: (caption ?? text).trim() || undefined });
      setText('');
      grow.reset();
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
  /** "Localização": abre a folha "Enviar localização" (sem partilha em direto nos grupos). Só envia com um toque em Enviar. */
  function openPlace() {
    setPanel(null);
    setPlace(true);
  }
  /** Chamado pela folha: os erros sobem para ela (mostra-os e fica aberta). */
  async function sendLocation(msg: LocationMessage) {
    setErr('');
    const { liveMinutes: _live, ...body } = msg;
    const r = await send({ ...body, ...(replyTo ? { replyTo: replyTo.id } : null) });
    onClearReply?.();
    onSent();
    return r;
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
      await dispatch({ kind: 'voice', mediaId, durationMs: secs * 1000 });
    } catch (e) {
      setErr((e as Error).message || 'Não consegui enviar a mensagem de voz');
    } finally {
      setBusy(false);
    }
  }
  const mmss = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  // O mesmo desenho e as mesmas medidas da barra das conversas a dois (components/ChatComposer): uma pílula só.
  const pad = { paddingHorizontal: 10, paddingTop: 6, paddingBottom: Math.max(14, bottom + 8) };

  if (recording) {
    return (
      <View style={[styles.wrap, pad]}>
        <View style={[styles.pill, { alignItems: 'center' }]}>
          <Pressable onPress={() => void finishRecording(false)} hitSlop={SLOP} style={styles.recX} accessibilityRole="button" accessibilityLabel="Cancelar a gravação">
            <Icon name="trash" size={21} color={colors.zinc700} />
          </Pressable>
          <View style={styles.recMid} accessibilityLiveRegion="polite" accessibilityLabel={`A gravar, ${mmss}`}>
            <RecDot />
            <Text style={styles.recTime}>{mmss}</Text>
            <Text style={styles.recHint}>A gravar…</Text>
          </View>
          <Pop>
            <SendButton label="Enviar a mensagem de voz" onPress={() => void finishRecording(true)} />
          </Pop>
        </View>
      </View>
    );
  }

  const hasText = !!text.trim();

  return (
    <View style={styles.wrap}>
      {panel === 'attach' && (
        <View style={styles.attach}>
          {onPoll && (
            <Pressable onPress={() => { setPanel(null); onPoll(); }} style={({ pressed }) => [styles.attachItem, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel="Sondagem: perguntar à malta">
              <View style={styles.attachIcon}><Icon name="trending" size={22} color={colors.zinc800} /></View>
              <Text style={styles.attachLabel}>Sondagem</Text>
            </Pressable>
          )}
          <Pressable onPress={openPlace} style={({ pressed }) => [styles.attachItem, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel="Localização: escolher o que enviar">
            <View style={styles.attachIcon}><Icon name="map-pin" size={22} color={colors.zinc800} /></View>
            <Text style={styles.attachLabel}>Localização</Text>
          </Pressable>
        </View>
      )}
      {panel === 'stickers' && <StickerPanel onPick={(id) => { setPanel(null); void dispatch({ kind: 'sticker', body: id }); }} onGif={(g) => { setPanel(null); void dispatch(gifMessage(g)); }} />}
      <View style={pad}>
        {err ? <Text style={styles.err} accessibilityRole="alert">{err}</Text> : null}
        {replyTo && (
          <View style={styles.reply}>
            <View style={styles.replyBar} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.replyWho} numberOfLines={1}>A responder a {replyTo.who ?? ''}</Text>
              <Text style={styles.replyText} numberOfLines={1}>{replyTo.text}</Text>
            </View>
            <Pressable onPress={onClearReply} hitSlop={6} style={styles.replyX} accessibilityRole="button" accessibilityLabel="Cancelar resposta"><Icon name="x" size={18} color={colors.zinc500} /></Pressable>
          </View>
        )}
        <View style={styles.pill}>
          <Pressable onPress={() => void pick('camera')} disabled={busy} hitSlop={SLOP} style={busy && { opacity: 0.5 }} accessibilityRole="button" accessibilityLabel="Abrir a câmara" accessibilityState={{ disabled: busy }}>
            <LinearGradient colors={[colors.brand, colors.brandLight]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.camera}>
              <Icon name="camera" size={20} color="#fff" />
            </LinearGradient>
          </Pressable>
          <TextInput ref={paste.ref} value={text} onChangeText={setText} onFocus={() => setPanel(null)} multiline numberOfLines={1} maxLength={2000} placeholder="Mensagem…" placeholderTextColor={colors.zinc500} onContentSizeChange={grow.onContentSizeChange} style={[styles.input, grow.style]} accessibilityLabel="Mensagem" />
          {hasText ? (
            <Pop key="send">
              <SendButton label="Enviar" onPress={() => void sendText()} disabled={busy} />
            </Pop>
          ) : (
            <Pop key="tools" style={styles.tools}>
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
              <Tool icon={panel === 'attach' ? 'x' : 'plus'} label={panel === 'attach' ? 'Fechar o menu' : 'Mais: sondagem e localização'} on={panel === 'attach'} expanded={panel === 'attach'} onPress={() => setPanel(panel === 'attach' ? null : 'attach')} />
            </Pop>
          )}
        </View>
      </View>
      {place && <SendLocationSheet allowLive={false} onSend={sendLocation} onClose={() => setPlace(false)} />}
      {paste.pending && <PastedImageSheet uri={paste.pending.uri} caption={text.trim()} onCancel={paste.cancel} onSend={(c) => void sendPasted(c)} />}
    </View>
  );
}

const SLOP = { top: 4, bottom: 4, left: 2, right: 2 };

// As medidas da barra das conversas a dois (components/ChatComposer), para as duas serem iguais.
const styles = StyleSheet.create({
  wrap: { backgroundColor: colors.white },
  pill: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, minHeight: 48, borderRadius: 24, backgroundColor: colors.zinc100, padding: 4, borderWidth: 1.5, borderColor: colors.zinc100 },
  camera: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, minWidth: 0, minHeight: 40, maxHeight: 148, paddingHorizontal: 10, paddingTop: 10, paddingBottom: 10, fontSize: 16, lineHeight: 20, color: colors.zinc900, outlineStyle: 'none' } as object,
  tools: { flexDirection: 'row', alignItems: 'flex-end' },
  err: { textAlign: 'center', fontSize: 14, color: colors.red600, paddingBottom: 6 },
  attach: { marginHorizontal: 12, marginTop: 8, flexDirection: 'row', justifyContent: 'flex-end', gap: 4 },
  attachItem: { width: 84, alignItems: 'center', gap: 6, paddingVertical: 8, borderRadius: 16 },
  attachIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  attachLabel: { fontSize: 12, fontWeight: '600', color: colors.zinc700 },
  reply: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6, marginHorizontal: 4, borderRadius: 14, backgroundColor: '#fafafa', borderWidth: 1, borderColor: colors.zinc100, paddingVertical: 6, paddingLeft: 10, paddingRight: 2 },
  replyBar: { alignSelf: 'stretch', width: 3, borderRadius: 2, backgroundColor: colors.brand },
  replyWho: { fontSize: 13, lineHeight: 17, fontWeight: '700', color: colors.brand },
  replyText: { fontSize: 13, lineHeight: 18, color: colors.zinc600 },
  replyX: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  recX: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  recMid: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  recTime: { fontSize: 17, fontWeight: '700', color: colors.zinc900, fontVariant: ['tabular-nums'] },
  recHint: { fontSize: 14, color: colors.zinc500 },
});
