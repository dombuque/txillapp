import { useGrowInput } from '@/lib/growInput';
import { LinearGradient } from 'expo-linear-gradient';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { uploadChatMedia } from '@/lib/api';
import { type GroupSendBody } from '@/lib/api.grupos';
import type { LocationMessage } from '@/lib/sendLocation';
import { colors } from '@/lib/theme';
import { Icon, type IconName } from './Icon';
import { SendLocationSheet } from './SendLocationSheet';
import { StickerPanel } from './StickerPanel';
import { NewBadge } from './WhatsNew';
import { markSeen } from '@/lib/whatsNew';

/**
 * A barra de escrever do chat, igual à do site: câmara à esquerda (degradê), o campo ao meio e, à direita,
 * visualização única, voz, galeria, stickers e "mais" (localização e presente). Com texto, só aparece "Enviar".
 */
export function GroupComposer({
  send, onSent, bottom, replyTo, onClearReply, onPoll,
}: {
  send: (msg: GroupSendBody) => Promise<unknown>;
  onSent: () => void;
  bottom: number;
  replyTo?: { id: string; text: string; who?: string } | null;
  onClearReply?: () => void;
  /** TxillGroup: abre a folha de nova sondagem (no "mais"). */
  onPoll?: () => void;
}) {
  const grow = useGrowInput();
  const [text, setText] = useState('');
  const [panel, setPanel] = useState<null | 'stickers' | 'attach'>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [place, setPlace] = useState(false);
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  useEffect(() => () => clearInterval(timer.current), []);

  async function dispatch(msg: GroupSendBody) {
    setErr('');
    try {
      await send({ ...msg, ...(replyTo ? { replyTo: replyTo.id } : null) });
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
      setBusy(true);
      const video = a.type === 'video';
      const mime = a.mimeType ?? (video ? 'video/mp4' : 'image/jpeg');
      const mediaId = await uploadChatMedia(a.uri, mime);
      await dispatch({ kind: video ? 'video' : 'image', mediaId, body: text.trim() || undefined });
      setText('');
    grow.reset();
    } catch (e) {
      setErr((e as Error).message || 'Não consegui enviar');
    } finally {
      setBusy(false);
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

  if (recording) {
    return (
      <View style={[styles.rec, { paddingBottom: Math.max(bottom, 12) }]}>
        <Pressable onPress={() => void finishRecording(false)} style={styles.recX} accessibilityRole="button" accessibilityLabel="Cancelar a gravação"><Icon name="trash" size={22} color={colors.zinc700} /></Pressable>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
          <View style={styles.recDot} />
          <Text style={styles.recTime}>{mmss}</Text>
        </View>
        <Pressable onPress={() => void finishRecording(true)} style={styles.recSend} accessibilityRole="button" accessibilityLabel="Enviar"><Icon name="send" size={20} color="#fff" /></Pressable>
      </View>
    );
  }

  const Bar = ({ icon, label, onPress, on, size = 22, light, badge }: { icon: IconName; label: string; onPress: () => void; on?: boolean; size?: number; light?: boolean; badge?: boolean }) => (
    <Pressable onPress={onPress} style={[styles.bar, on && { backgroundColor: light ? '#fff' : colors.brand }, badge && { overflow: 'visible' }]} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!on }}>
      <Icon name={icon} size={size} color={on ? (light ? colors.brand : '#fff') : colors.zinc800} />
      {badge && <View style={{ position: 'absolute', right: -8, top: -8 }}><NewBadge id="stickers" /></View>}
    </Pressable>
  );

  return (
    <View style={{ borderTopWidth: 1, borderTopColor: colors.zinc100 }}>
      {panel === 'attach' && (
        <View style={styles.attach}>
          {onPoll && <Pressable onPress={() => { setPanel(null); onPoll(); }} style={styles.attachItem}><View style={styles.attachIcon}><Icon name="trending" size={22} /></View><Text style={styles.attachLabel}>Sondagem</Text></Pressable>}
          <Pressable onPress={openPlace} style={styles.attachItem} accessibilityRole="button" accessibilityLabel="Localização: escolher o que enviar"><View style={styles.attachIcon}><Icon name="map-pin" size={22} /></View><Text style={styles.attachLabel}>Localização</Text></Pressable>
        </View>
      )}
      {replyTo && (
        <View style={styles.reply}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.replyText, { fontWeight: '700' }]} numberOfLines={1}>A responder a {replyTo.who ?? ''}</Text>
            <Text style={[styles.replyText, { color: colors.zinc600 }]} numberOfLines={1}>{replyTo.text}</Text>
          </View>
          <Pressable onPress={onClearReply} hitSlop={8} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }} accessibilityRole="button" accessibilityLabel="Cancelar resposta"><Icon name="x" size={18} color={colors.zinc500} /></Pressable>
        </View>
      )}
      {panel === 'stickers' && <StickerPanel onPick={(id) => { setPanel(null); void dispatch({ kind: 'sticker', body: id }); }} />}
      <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: Math.max(20, bottom + 10) }}>
        {err ? <Text style={styles.err} accessibilityRole="alert">{err}</Text> : null}
        <View style={styles.composer}>
          <Pressable onPress={() => void pick('camera')} disabled={busy} accessibilityRole="button" accessibilityLabel="Abrir a câmara">
            <LinearGradient colors={[colors.brand, colors.brandLight]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.camera}>
              <Icon name="camera" size={20} color="#fff" />
            </LinearGradient>
          </Pressable>
          <TextInput value={text} onChangeText={setText} onFocus={() => setPanel(null)} multiline numberOfLines={1} maxLength={2000} placeholder="Mensagem…" placeholderTextColor={colors.zinc500} onContentSizeChange={grow.onContentSizeChange} style={[styles.input, grow.style]} accessibilityLabel="Mensagem" />
          {text.trim() ? (
            <Pressable onPress={() => void sendText()} style={styles.send} accessibilityRole="button"><Text style={styles.sendText}>Enviar</Text></Pressable>
          ) : (
            <>
              <Bar icon="mic" label="Gravar mensagem de voz" onPress={() => void startRecording()} />
              <Bar icon="image" label="Enviar foto ou vídeo da galeria" onPress={() => void pick('library')} />
              <Bar icon="sticker" label="Stickers" light badge on={panel === 'stickers'} onPress={() => { markSeen('stickers'); setPanel(panel === 'stickers' ? null : 'stickers'); }} />
              <Bar icon="plus" label="Mais" light on={panel === 'attach'} onPress={() => setPanel(panel === 'attach' ? null : 'attach')} />
            </>
          )}
        </View>
      </View>
      {place && <SendLocationSheet allowLive={false} onSend={sendLocation} onClose={() => setPlace(false)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, borderRadius: 26, backgroundColor: colors.zinc100, padding: 6 },
  camera: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, minWidth: 0, minHeight: 40, maxHeight: 128, paddingHorizontal: 8, paddingVertical: 10, fontSize: 16, color: colors.zinc900, outlineStyle: 'none' } as object,
  bar: { width: 32, height: 32, marginBottom: 4, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  send: { height: 40, borderRadius: 20, backgroundColor: colors.brand, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: '#fff', fontWeight: '700' },
  err: { textAlign: 'center', fontSize: 14, color: colors.red600, paddingBottom: 4 },
  help: { marginHorizontal: 12, marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 16, backgroundColor: colors.zinc900, paddingHorizontal: 16, paddingVertical: 8 },
  helpText: { flex: 1, color: '#fff', fontSize: 13, fontWeight: '600' },
  attach: { marginHorizontal: 12, marginTop: 8, flexDirection: 'row', justifyContent: 'flex-end', gap: 4 },
  attachItem: { width: 84, alignItems: 'center', gap: 6, paddingVertical: 8 },
  attachIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  attachLabel: { fontSize: 12, fontWeight: '600', color: colors.zinc700 },
  reply: { marginHorizontal: 12, marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 16, borderLeftWidth: 4, borderLeftColor: colors.brand, backgroundColor: '#fafafa', paddingVertical: 6, paddingLeft: 12, paddingRight: 6 },
  replyText: { fontSize: 13, lineHeight: 18, color: colors.zinc700 },
  rec: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.zinc100 },
  recX: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.red600 },
  recTime: { fontSize: 18, fontWeight: '700', color: colors.zinc900, fontVariant: ['tabular-nums'] },
  recSend: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
});
