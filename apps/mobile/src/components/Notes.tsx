import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from 'react-native-reanimated';
import { Animated, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { useKeyboardOpen } from '@/components/ChatScreen';
import { GifPanel, TxillappReaction, useGifsConfig } from '@/components/GifPanel';
import { NameWithBadge } from '@/components/NameWithBadge';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { MusicPicker } from '@/components/MusicPicker';
import { PlaceSheet } from '@/components/PlaceSheet';
import { ReportSheet } from '@/components/ReportSheet';
import { Sheet } from '@/components/Sheet';
import { TrackCredits, useAutoTrack, useMusicMuted } from '@/components/TrackCard';
import { SendButton } from '@/components/ui/SendButton';
import { ActionRow } from '@/components/ui/ActionRow';
import { useVisibleViewport, webWindowH } from '@/components/zas/useVisibleViewport';
import { notesApi, type Note, type NoteDraft } from '@/lib/api.notes';
import type { Track } from '@/lib/api.music';
import { useAuth } from '@/lib/auth';
import { pinnedTop, webKeyboardOpen } from '@/lib/chatKeyboard';
import { confirm } from '@/lib/confirm';
import { useDesktop } from '@/lib/desktop';
import { TXILLAPP_GIF, gifFit, gifPayload, gifShown, type ChatGif } from '@/lib/gifs';
import { primeKeyboard, releaseKeyboard } from '@/lib/keyboardPrime';
import { useTrackLive } from '@/lib/musicPlayer';
import {
  NOTE_COLORS, NOTE_LIMIT, NOTE_QUICK, NOTE_TONES, NOTE_WHITE, noteAgo, noteAudienceLabel, noteHasContent, noteLayout, noteReplyPlaceholder,
  noteSentText, noteTone, type NoteAudience, type NoteColor, type NoteTone,
} from '@/lib/noteLook';
import { notesRow } from '@/lib/notesRow';
import { colors } from '@/lib/theme';
import { timeAgo } from '@/lib/time';
import { showToast } from '@/lib/toast';
import { t } from '@/lib/i18n';

const trackLine = (n?: Note | null) => (n?.music ? `${n.music.title}${n.music.artist ? ` · ${n.music.artist}` : ''}` : '');
const nativeDriver = Platform.OS !== 'web';
/** O texto do campo da bolha, no editor. */
const NOTE_PLACEHOLDER = () => t('O que se passa?');

/** O selo do brinde no canto (da bolha ou, numa nota só com GIF, do quadrado do GIF): o copo e, com mais de um, a contagem. */
function CheersBadge({ cheers }: { cheers: number }) {
  if (!(cheers > 0)) return null;
  return (
    <View style={styles.cheers} accessibilityLabel={t('{count} brinde', { count: cheers, other: '{count} brindes' })}>
      <Icon name="cheers" size={14} color={colors.amber600} />
      {cheers > 1 && <Text style={styles.cheersN}>{cheers}</Text>}
    </View>
  );
}

/**
 * A cara da nota: a foto redonda da pessoa ou, se a nota tem GIF, o GIF no lugar dela, num quadrado de cantos bem
 * arredondados e a mexer (com «Reduzir movimento», parado). O ponto verde do online fica no canto, nos dois casos.
 * `cheers`: numa nota só com GIF (sem bolha), o selo do brinde vai para o canto do quadrado do GIF, como na bolha.
 */
function NoteFace({ name, username, gif, size, online = false, onlineStyle, cheers = 0 }: { name: string; username?: string; gif?: ChatGif | null; size: number; online?: boolean; onlineStyle?: object; cheers?: number }) {
  const reduce = useReducedMotion();
  // O GIF do Txillapp (largo, fundo transparente) fica inteiro dentro do quadrado, com margem (os «ll» nunca se cortam).
  const shown = gif ? gifShown(gif) : null;
  return (
    <View>
      {gif && shown ? (
        <Image source={{ uri: reduce && shown.still ? shown.still : shown.url }} autoplay={!reduce} style={{ width: size, height: size, borderRadius: Math.round(size * 0.26), backgroundColor: colors.zinc100, ...(gif.source === 'txillapp' ? { padding: Math.round(size * 0.08) } : {}) }} contentFit={gifFit(gif)} recyclingKey={shown.url} accessibilityLabel={gif.title ? `GIF: ${gif.title}` : 'GIF'} />
      ) : (
        <Avatar name={name} username={username} size={size} />
      )}
      {online && <View style={[styles.online, onlineStyle]} accessibilityLabel={t('Online')} />}
      {gif ? <CheersBadge cheers={cheers} /> : null}
    </View>
  );
}

/** A nota tem alguma coisa para o balão (texto, música ou local)? Só com GIF, não há balão: o GIF já está no lugar da foto. */
const hasBubble = (n: { body?: string | null; music?: unknown; place?: unknown }) => !!(n.body ?? '').trim() || !!n.music || !!n.place;

/**
 * O balão da nota, por cima da foto: texto curto em 3 linhas, com o "bico" a apontar para a pessoa, na cor que a pessoa
 * escolheu (lib/noteLook). A linha pequena leva a música ou, sem ela, o local.
 */
function Bubble({ text, dim = false, track = '', cheers = 0, color = null, place = '' }: { text: string; dim?: boolean; track?: string; cheers?: number; color?: string | null; place?: string }) {
  const t = noteTone(color);
  const tone = dim ? { color: colors.zinc500 } : { color: t.text };
  const small = track || place;
  return (
    <View style={styles.bubbleWrap}>
      <View style={[styles.bubble, { backgroundColor: t.bg, borderColor: t.border }]}>
        {!!text && <Text style={[styles.bubbleText, tone]} numberOfLines={small ? 2 : 3}>{text}</Text>}
        {!!small && (
          <View style={[styles.trackRow, !!text && { marginTop: 2 }]}>
            <Icon name={track ? 'music' : 'map-pin'} size={11} color={text ? t.sub : dim ? colors.zinc500 : t.text} />
            <Text style={[text ? styles.trackSmall : styles.bubbleText, { flexShrink: 1, color: text ? t.sub : t.text }]} numberOfLines={text ? 1 : 3}>{small}</Text>
          </View>
        )}
      </View>
      <View style={[styles.tail, { backgroundColor: t.bg }]} />
      <CheersBadge cheers={cheers} />
    </View>
  );
}

/**
 * Notas, como no Instagram: uma frase de até 60 caracteres por cima da tua foto, durante 24 horas.
 * Só as vêem os teus seguidores (ou só os teus amigos próximos). Não se editam. Tocar numa nota de outra pessoa abre-a
 * (ver, brindar e responder). Depois das notas vêm as pessoas com quem já conversaste, mesmo sem nota (tocar abre a
 * conversa): ver lib/notesRow.ts.
 */
export function NotesStrip() {
  const { user } = useAuth();
  const q = useQuery({ queryKey: ['notes'], queryFn: notesApi.list, staleTime: 60_000, refetchInterval: 120_000 });
  const [editing, setEditing] = useState(false);
  const [viewing, setViewing] = useState<Note | null>(null);
  const router = useRouter();
  const mine = q.data?.mine ?? null;
  const row = notesRow(q.data?.items, q.data?.people, user?.username);
  const names = row.map((e) => (e.kind === 'note' ? e.note : e.person)).filter((p) => p.hasAvatar).map((p) => p.username);
  const presence = useQuery({ queryKey: ['notes-online', names.join(',')], queryFn: () => notesApi.online(names), enabled: names.length > 0, refetchInterval: 30_000, staleTime: 15_000 });
  const online = new Set((presence.data?.online ?? []).map((x) => x.toLowerCase()));
  if (!user) return null;

  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.strip} contentContainerStyle={styles.stripIn} accessibilityLabel={t('Notas')}>
        <Pressable onPress={() => { if (!mine) primeKeyboard(); setEditing(true); }} accessibilityRole="button" accessibilityLabel={mine ? t('A tua nota') : t('Deixar uma nota')} style={({ pressed }) => [styles.item, pressed && { transform: [{ scale: 0.95 }] }]}>
          <View style={styles.bubbleSlot}>{!mine || hasBubble(mine) ? <Bubble text={mine ? mine.body : t('Deixa uma nota')} dim={!mine} track={trackLine(mine)} cheers={mine?.cheers ?? 0} color={mine?.color} place={mine?.place?.name} /> : null}</View>
          <View>
            <NoteFace name={user.displayName} username={user.username} gif={mine?.gif} size={64} cheers={mine && !hasBubble(mine) ? mine.cheers ?? 0 : 0} />
            {!mine && <View style={styles.plus}><Icon name="plus" size={14} strokeWidth={3} color="#fff" /></View>}
          </View>
          <Text style={styles.label} numberOfLines={1}>{t('A tua nota')}</Text>
        </Pressable>
        {row.map((e) => {
          if (e.kind === 'note') {
            const n = e.note;
            return (
              <Pressable key={e.key} onPress={() => { primeKeyboard(); setViewing(n); }} accessibilityRole="button" accessibilityLabel={t('Nota de {displayName}: {body}', { displayName: n.displayName, body: n.body || n.music?.title || n.place?.name || (n.gif ? 'GIF' : '') })} style={({ pressed }) => [styles.item, pressed && { transform: [{ scale: 0.95 }] }]}>
                <View style={styles.bubbleSlot}>{hasBubble(n) ? <Bubble text={n.body} track={trackLine(n)} cheers={n.cheered ? 1 : 0} color={n.color} place={n.place?.name} /> : null}</View>
                <NoteFace name={n.displayName} username={n.hasAvatar ? n.username : undefined} gif={n.gif} size={64} online={n.hasAvatar && online.has(n.username.toLowerCase())} cheers={!hasBubble(n) && n.cheered ? 1 : 0} />
                <NameWithBadge name={n.displayName.split(' ')[0]} who={n} center gap={2} style={[styles.label, styles.labelName]} containerStyle={{ marginTop: 4 }} />
              </Pressable>
            );
          }
          // Alguém das minhas conversas, sem nota: sem balão (mas com o lugar dele, para as fotos ficarem todas alinhadas).
          const p = e.person;
          return (
            <Pressable key={e.key} onPress={() => router.push(`/messages/${p.username}` as never)} accessibilityRole="button" accessibilityLabel={t('Conversa com {displayName}', { displayName: p.displayName })} style={({ pressed }) => [styles.item, pressed && { transform: [{ scale: 0.95 }] }]}>
              <View style={styles.bubbleSlot} />
              <View>
                <Avatar name={p.displayName} username={p.hasAvatar ? p.username : undefined} size={64} />
                {p.hasAvatar && online.has(p.username.toLowerCase()) && <View style={styles.online} accessibilityLabel={t('Online')} />}
              </View>
              <NameWithBadge name={p.displayName.split(' ')[0]} who={p} center gap={2} style={[styles.label, styles.labelName]} containerStyle={{ marginTop: 4 }} />
            </Pressable>
          );
        })}
      </ScrollView>
      {editing && <NoteEditor current={mine} onClose={() => setEditing(false)} />}
      {viewing && <NoteView note={viewing} online={viewing.hasAvatar && online.has(viewing.username.toLowerCase())} onClose={() => setViewing(null)} />}
    </>
  );
}

/** Três barrinhas a subir e a descer: a música da nota está a tocar. */
function Playing({ color }: { color: string }) {
  const bars = useRef([0, 1, 2].map(() => new Animated.Value(0.4))).current;
  useEffect(() => {
    const loops = bars.map((a, i) =>
      Animated.loop(Animated.sequence([
        Animated.timing(a, { toValue: 1, duration: 260 + i * 90, useNativeDriver: nativeDriver }),
        Animated.timing(a, { toValue: 0.3, duration: 260 + i * 90, useNativeDriver: nativeDriver }),
      ])),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [bars]);
  return (
    <View style={styles.playing}>
      {bars.map((a, i) => <Animated.View key={i} style={[styles.playingBar, { backgroundColor: color, transform: [{ scaleY: a }] }]} />)}
    </View>
  );
}

/**
 * A música da nota numa linha («Título · Artista»), dentro da bolha. Toca sozinha ao abrir (o mesmo leitor do cartão
 * da música, useAutoTrack); o botão redondo silencia ou volta a ligar o som da app, e o nome mostra os créditos.
 */
function NoteTrackLine({ track, tone, autoplay = true }: { track: Track; tone: NoteTone; autoplay?: boolean }) {
  const { on, me } = useAutoTrack(track, { autoplay, playNow: autoplay });
  const live = useTrackLive(me);
  const [muted, toggleMute] = useMusicMuted();
  const [info, setInfo] = useState(false);
  const playing = on && live && !muted;
  const dark = tone.text === '#ffffff';
  const artist = track.kind === 'clip' ? t('Áudio original') : track.artist || '';
  return (
    <View style={styles.trackLine}>
      {autoplay ? (
        <Pressable onPress={toggleMute} hitSlop={8} accessibilityRole="button" accessibilityState={{ selected: muted }} accessibilityLabel={muted ? t('Ativar o som') : t('Silenciar')} style={[styles.trackBtn, { borderColor: dark ? 'rgba(255,255,255,0.4)' : colors.zinc200 }]}>
          {playing ? <Playing color={dark ? '#fff' : colors.brand} /> : <Icon name={muted ? 'volume-off' : 'music'} size={12} strokeWidth={2.2} color={tone.text} />}
        </Pressable>
      ) : (
        <Icon name="music" size={14} strokeWidth={2.2} color={tone.text} />
      )}
      <Pressable onPress={() => track.kind !== 'clip' && setInfo(true)} style={{ flexShrink: 1 }} accessibilityRole="button" accessibilityLabel={t('Música: {title}{value}. Créditos', { title: track.title, value: artist ? `, ${artist}` : '' })}>
        <Text style={[styles.trackTitle, { color: tone.text }]} numberOfLines={1}>
          {track.title}
          {artist ? <Text style={{ fontWeight: '400', color: tone.sub }}>{` · ${artist}`}</Text> : null}
        </Text>
      </Pressable>
      {info && <TrackCredits track={track} onClose={() => setInfo(false)} />}
    </View>
  );
}

/** A linha do local, dentro da bolha: o pino e o nome do sítio. */
function PlaceLine({ name, tone, center = false }: { name: string; tone: NoteTone; center?: boolean }) {
  return (
    <View style={[styles.placeLine, center && { justifyContent: 'center' }]} accessibilityLabel={t('Local: {name}', { name })}>
      <Icon name="map-pin" size={13} strokeWidth={2} color={tone.sub} />
      <Text style={[styles.placeText, { color: tone.sub }]} numberOfLines={1}>{name}</Text>
    </View>
  );
}

/**
 * A nota de outra pessoa, como nas redes sociais: em cima «Nome · há 1 h» (com o selo); a foto (com o ponto verde se
 * estiver online) e a bolha da nota ao lado. Com música, a bolha leva a música numa linha (a tocar sozinha) e o texto
 * sai para baixo, grande e a negrito; sem música, o texto vai dentro da bolha. Em baixo, colada ao teclado (que abre
 * logo), a barra de resposta: a pílula com o campo e três reações rápidas (tocar numa envia-a logo) e, fora dela, o
 * Brindar. Com texto escrito, as reações dão lugar ao Enviar. Enviado: a folha fecha e aparece «Enviada a @x» com «Ver»
 * (abre a conversa). `inChat` = aberta do cabeçalho da conversa com essa pessoa: aí só fecha e põe a conversa em dia.
 */
export function NoteView({ note, onClose, inChat = false, online = false }: { note: Note; onClose: () => void; inChat?: boolean; online?: boolean }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { width } = useWindowDimensions();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [cheered, setCheered] = useState(!!note.cheered);
  const pop = useRef(new Animated.Value(1)).current;
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const tone = noteTone(note.color);
  const layout = noteLayout(note);
  const avatar = width < 360 ? 72 : 88;
  const { user } = useAuth();
  const mine = !!user && user.username.toLowerCase() === note.username.toLowerCase();
  const [step, setStep] = useState<'view' | 'more' | 'report'>('view');
  const reported = useRef(false);
  useEffect(() => releaseKeyboard, []);

  async function cheer() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    setCheered((c) => !c);
    Animated.sequence([Animated.timing(pop, { toValue: 1.3, duration: 150, useNativeDriver: nativeDriver }), Animated.timing(pop, { toValue: 1, duration: 250, useNativeDriver: nativeDriver })]).start();
    try {
      const r = await notesApi.cheer(note.username);
      setCheered(r.cheered);
      void qc.invalidateQueries({ queryKey: ['notes'] });
      if (inChat) void qc.invalidateQueries({ queryKey: ['chat-thread', note.username] });
    } catch (e) {
      setCheered((c) => !c);
      setErr((e as Error).message);
    }
  }

  /** Responder (o texto escrito ou uma reação rápida): vai como mensagem para a conversa a dois. */
  /** `gif`: a reação «Txillapp» (o GIF da marca vai a seguir à linha «Em resposta à tua nota»). */
  async function send(body: string, gif?: ChatGif) {
    const said = body.trim();
    if ((!said && !gif) || busy) return;
    setBusy(true);
    setErr('');
    try {
      await notesApi.reply(note.username, said, gif);
      onClose();
      if (inChat) void qc.invalidateQueries({ queryKey: ['chat-thread', note.username] });
      else showToast(noteSentText(note.username), { label: t('Ver'), onPress: () => router.push(`/messages/${note.username}` as never) });
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }
  const typed = !!text.trim();

  // O «⋯» troca a folha da nota pelo menu, e o «Denunciar» troca o menu pela folha da denúncia (uma folha de cada vez,
  // nunca uma por cima da outra). Fechar o menu, ou a denúncia sem a enviar, volta à nota (com o que já se escreveu).
  // Denunciada, a nota sai logo da fila (o servidor esconde-a a quem denunciou) e, ao fechar o «Obrigado», fecha-se.
  if (step === 'more') return <NoteMoreSheet username={note.username} onReport={() => setStep('report')} onClose={() => setStep('view')} />;
  if (step === 'report') {
    return (
      <ReportSheet
        type="note"
        id={note.username}
        onReported={() => {
          reported.current = true;
          void qc.invalidateQueries({ queryKey: ['notes'] });
          if (inChat) void qc.invalidateQueries({ queryKey: ['chat-thread', note.username] });
        }}
        onClose={() => (reported.current ? onClose() : setStep('view'))}
      />
    );
  }

  return (
    <Sheet onClose={onClose}>
      <View style={styles.view}>
        <View style={styles.viewHead}>
          <NameWithBadge name={note.displayName} who={note} style={styles.viewName} containerStyle={{ flexShrink: 1 }} />
          <Text style={styles.viewAgo}>{` · ${noteAgo(note.createdAt)}`}</Text>
          {mine ? null : (
            <Pressable onPress={() => setStep('more')} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('Mais opções da nota')} style={({ pressed }) => [styles.viewMore, pressed && { opacity: 0.6 }]}>
              <Icon name="more" size={22} color={colors.zinc800} strokeWidth={2.4} />
            </Pressable>
          )}
        </View>
        <View style={[styles.viewRow, !hasBubble(note) && { justifyContent: 'center' }]}>
          {/* Com GIF, o GIF fica no lugar da foto (quadrado arredondado, a mexer). Só com GIF, não há bolha. */}
          <NoteFace name={note.displayName} username={note.hasAvatar ? note.username : undefined} gif={note.gif} size={note.gif ? avatar + 12 : avatar} online={online} onlineStyle={styles.onlineBig} />
          {hasBubble(note) ? (
            <View style={styles.viewBubbleWrap}>
              <View style={[styles.viewDot, { backgroundColor: tone.bg, borderColor: tone.border }]} />
              <View style={[styles.viewBubble, { backgroundColor: tone.bg, borderColor: tone.border }]}>
                {layout === 'music' && note.music ? <NoteTrackLine track={note.music} tone={tone} /> : null}
                {layout === 'text' && !!note.body ? <Text style={[styles.viewBubbleText, { color: tone.text }]} numberOfLines={4}>{note.body}</Text> : null}
                {note.place ? <PlaceLine name={note.place.name} tone={tone} /> : null}
              </View>
            </View>
          ) : null}
        </View>
        {layout === 'music' && !!note.body ? <Text style={styles.viewBig}>{note.body}</Text> : null}
        {!!err && <Text accessibilityRole="alert" style={styles.err}>{err}</Text>}
        <View style={styles.replyRow}>
          <View style={styles.replyPill} {...({ dataSet: { pill: '1' } } as object)}>
            <TextInput
              ref={input}
              value={text}
              onChangeText={setText}
              maxLength={400}
              autoFocus
              onFocus={releaseKeyboard}
              placeholder={noteReplyPlaceholder(note)}
              placeholderTextColor={colors.zinc500}
              accessibilityLabel={t('Responder à nota')}
              returnKeyType="send"
              submitBehavior="submit"
              onSubmitEditing={() => void send(text)}
              style={styles.replyInput}
            />
            {typed ? (
              <SendButton label={t('Enviar resposta')} keep={input} disabled={busy} onPress={() => void send(text)} style={styles.replySend} />
            ) : (
              <View style={styles.quickRow}>
                {NOTE_QUICK.map((e) => (
                  <Pressable key={e} disabled={busy} onPress={() => void send(e)} hitSlop={4} accessibilityRole="button" accessibilityLabel={t('Responder com {e}', { e })} style={({ pressed }) => [styles.quickBtn, pressed && { transform: [{ scale: 1.25 }] }]}>
                    <Text style={styles.quickEmoji}>{e}</Text>
                  </Pressable>
                ))}
                <TxillappReaction width={42} height={40} disabled={busy} label={t('Responder com o GIF Txillapp')} onPress={() => void send('', gifPayload(TXILLAPP_GIF))} />
              </View>
            )}
          </View>
          <Pressable onPress={() => void cheer()} hitSlop={6} accessibilityRole="button" accessibilityLabel={cheered ? t('Brindado. Tirar o brinde') : t('Brindar')} accessibilityState={{ selected: cheered }} style={({ pressed }) => [styles.cheerOut, pressed && { transform: [{ scale: 0.92 }] }]}>
            <Animated.View style={{ transform: [{ scale: pop }] }}>
              <Icon name="cheers" size={30} strokeWidth={cheered ? 2.2 : 1.8} color={cheered ? colors.amber600 : colors.zinc800} />
            </Animated.View>
          </Pressable>
        </View>
      </View>
    </Sheet>
  );
}

/** O menu do «⋯» da nota de outra pessoa: «Denunciar» (abre a folha da denúncia no lugar do menu). */
function NoteMoreSheet({ username, onReport, onClose }: { username: string; onReport: () => void; onClose: () => void }) {
  return (
    <Sheet title={t('Nota de @{username}', { username })} onClose={onClose} variant="menu" cancel>
      <View style={{ paddingHorizontal: 16, paddingBottom: 4 }}>
        <ActionRow icon="flag" title={t('Denunciar')} text={t('Avisa a moderação. A pessoa não sabe.')} danger onPress={onReport} />
      </View>
    </Sheet>
  );
}

/**
 * O editor em ecrã inteiro, colado ao teclado. Na web do iPhone o teclado tapa a página sem a encolher: com ele aberto,
 * o editor ocupa só a zona visível (o mesmo método das conversas, lib/chatKeyboard `pinnedTop`). No telemóvel é o
 * KeyboardAvoidingView. No computador é uma janela ao centro.
 */
function EditorFrame({ desktop, onClose, children }: { desktop: boolean; onClose: () => void; children: ReactNode }) {
  const vv = useVisibleViewport();
  const pinned = Platform.OS === 'web' && !!vv && typeof window !== 'undefined' && webKeyboardOpen(vv.height, webWindowH(), vv.scale);
  const box = useRef<HTMLElement | null>(null);
  const [parentTop, setParentTop] = useState(0);
  useEffect(() => {
    if (!pinned || typeof window === 'undefined') { setParentTop(0); return; }
    const measure = () => {
      const el = box.current?.parentElement;
      const t = el && typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect().top : 0;
      setParentTop((p) => (Math.abs(p - t) < 0.5 ? p : t));
    };
    const fix = () => { window.scrollTo(0, 0); measure(); };
    fix();
    window.addEventListener('scroll', fix);
    return () => window.removeEventListener('scroll', fix);
  }, [pinned, vv?.top, vv?.height]);

  if (desktop) {
    return (
      <View style={styles.edDeskRoot}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('Fechar')} />
        <View style={styles.edDeskCard} accessibilityViewIsModal>{children}</View>
      </View>
    );
  }
  if (Platform.OS !== 'web') return <KeyboardAvoidingView style={styles.edRoot} behavior="padding">{children}</KeyboardAvoidingView>;
  return (
    <View ref={box as never} style={[styles.edRoot, pinned && vv ? { position: 'absolute', left: 0, right: 0, top: pinnedTop(vv.top, parentTop), height: vv.height, flex: 0 } : null]}>
      {children}
    </View>
  );
}

/** Um botão em pílula do editor (música, local, GIF): escolhido, mostra o que se escolheu e um × para tirar. */
function OptionPill({ icon, label, chosen, onPress, onClear, a11y }: { icon: ReactNode; label?: string; chosen: boolean; onPress: () => void; onClear: () => void; a11y: string }) {
  return (
    <View style={[styles.opt, chosen && styles.optOn]}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={chosen ? t('{a11y}: {label}. Mudar', { a11y, label: String(label) }) : a11y} style={({ pressed }) => [styles.optMain, pressed && { opacity: 0.6 }]}>
        {icon}
        {chosen && label ? <Text style={styles.optText} numberOfLines={1}>{label}</Text> : null}
      </Pressable>
      {chosen ? (
        <Pressable onPress={onClear} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('Tirar {a11y}', { a11y: a11y.toLowerCase() })} style={styles.optX}>
          <Icon name="x" size={14} strokeWidth={2.4} color={colors.zinc600} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** O botão da paleta, na foto: quatro pintas das cores das bolhas. */
function PaletteIcon() {
  const dots: NoteColor[] = ['coral', 'ambar', 'verde', 'ceu'];
  return (
    <View style={styles.paletteDots}>
      {dots.map((c) => <View key={c} style={[styles.paletteDot, { backgroundColor: c === 'ambar' ? '#f59e0b' : c === 'verde' ? '#16a34a' : c === 'ceu' ? '#0ea5e9' : NOTE_TONES[c].bg }]} />)}
    </View>
  );
}

/**
 * A minha nota, em ecrã inteiro (como nas redes sociais): o × em cima; ao centro a minha foto com a bolha por cima, onde
 * se escreve diretamente (o teclado abre logo); a paleta na foto escolhe a cor da bolha; por baixo, música, local e GIF;
 * em baixo, colados ao teclado, o público («Seguidores ›» ou «Amigos próximos ›») e «Partilhar». Uma nota não se
 * edita: a que já está publicada abre aqui com o que tem e com «Apagar» (pergunta antes).
 */
function NoteEditor({ current, onClose }: { current: Note | null; onClose: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const desktop = useDesktop();
  const kbOpen = useKeyboardOpen();
  const gifs = useGifsConfig();
  const [body, setBody] = useState('');
  const [music, setMusic] = useState<Track | null>(null);
  const [color, setColor] = useState<NoteColor | null>(null);
  const [place, setPlace] = useState<NoteDraft['place']>(null);
  const [gif, setGif] = useState<ChatGif | null>(null);
  const [audience, setAudience] = useState<NoteAudience>('mutual');
  const [panel, setPanel] = useState<null | 'music' | 'place' | 'gif' | 'gifMenu' | 'audience'>(null);
  const [palette, setPalette] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [inputH, setInputH] = useState(22);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const view = current;
  const tone = noteTone(view ? view.color : color);
  useEffect(() => releaseKeyboard, []);

  async function run(job: () => Promise<unknown>) {
    setBusy(true);
    setErr('');
    try {
      await job();
      await qc.invalidateQueries({ queryKey: ['notes'] });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }
  async function remove() {
    if (await confirm({ title: t('Apagar a nota?'), message: t('A nota desaparece já para toda a gente. Podes escrever outra quando quiseres.'), confirm: t('Apagar'), danger: true })) {
      void run(() => notesApi.remove());
    }
  }
  const back = () => { setPanel(null); setTimeout(() => input.current?.focus(), 60); };
  const canShare = !busy && noteHasContent({ body, music, gif, place });
  const shown = view
    ? { body: view.body, music: view.music ?? null, gif: view.gif ?? null, place: view.place?.name ?? '' }
    : { body, music, gif, place: place?.name ?? '' };

  return (
    <Modal visible transparent animationType={desktop ? 'fade' : 'slide'} onRequestClose={onClose} statusBarTranslucent>
      <EditorFrame desktop={desktop} onClose={onClose}>
        <View style={[styles.edTop, { paddingTop: desktop ? 14 : insets.top + 8 }]}>
          <Pressable onPress={onClose} hitSlop={6} accessibilityRole="button" accessibilityLabel={t('Fechar')} style={({ pressed }) => [styles.edX, pressed && { transform: [{ scale: 0.94 }] }]}>
            <Icon name="x" size={22} strokeWidth={2.2} color={colors.zinc900} />
          </Pressable>
          <Text style={styles.edTitle} accessibilityRole="header">{view ? t('A tua nota') : t('Nova nota')}</Text>
          <View style={{ width: 44 }} />
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.edCenter} keyboardShouldPersistTaps="handled">
          {!view || hasBubble(view) ? (
          <View style={styles.edBubbleWrap}>
            <View style={[styles.edBubble, { backgroundColor: tone.bg, borderColor: tone.border }]} {...({ dataSet: { pill: '1' } } as object)}>
              {view ? (
                !!view.body && <Text style={[styles.edText, { color: tone.text }]}>{view.body}</Text>
              ) : (
                // A altura do campo segue o texto (ou o «Partilha o que…»): mede-se um Text invisível com a mesma letra e
                // largura. O onContentSizeChange da web não encolhe (a altura do placeholder de duas linhas ficava).
                <View style={styles.edField}>
                  <Text aria-hidden style={[styles.edText, styles.edMeasure]} onLayout={(e) => setInputH(Math.min(88, Math.max(22, Math.ceil(e.nativeEvent.layout.height))))}>
                    {`${body || NOTE_PLACEHOLDER()}​`}
                  </Text>
                  <TextInput
                    ref={input}
                    value={body}
                    onChangeText={(t) => setBody(t.replace(/\n/g, ' ').slice(0, NOTE_LIMIT))}
                    multiline
                    autoFocus
                    onFocus={releaseKeyboard}
                    maxLength={NOTE_LIMIT}
                    placeholder={NOTE_PLACEHOLDER()}
                    placeholderTextColor={tone === NOTE_WHITE ? colors.zinc500 : tone.sub}
                    accessibilityLabel={t('Nota')}
                    style={[styles.edText, styles.edInput, { color: tone.text, height: inputH }]}
                  />
                </View>
              )}
              {shown.music ? <NoteTrackLine track={shown.music} tone={tone} autoplay={!!view} /> : null}
              {shown.place ? <PlaceLine name={shown.place} tone={tone} center /> : null}
            </View>
            <View style={[styles.edTail, { backgroundColor: tone.bg, borderColor: tone.border }]} />
            {!view && !!body ? (
              // O × pequeno no canto da bolha: limpa o texto (o resto da nota fica).
              <Pressable onPress={() => { setBody(''); input.current?.focus(); }} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('Limpar o texto')} style={styles.edClear}>
                <Icon name="x" size={12} strokeWidth={3} color="#fff" />
              </Pressable>
            ) : null}
          </View>
          ) : null}
          {!view && body.length >= NOTE_LIMIT - 15 ? <Text style={[styles.count, body.length >= NOTE_LIMIT && { color: colors.brand }]}>{body.length}/{NOTE_LIMIT}</Text> : null}
          <View style={styles.edAvatar}>
            {/* Com GIF, o GIF fica no lugar da foto; tocar nele dá «Trocar o GIF» e «Tirar o GIF». */}
            {!view && gif ? (
              <Pressable onPress={() => setPanel('gifMenu')} accessibilityRole="button" accessibilityLabel={t('GIF da nota. Trocar ou tirar')}>
                <NoteFace name={user?.displayName ?? '?'} username={user?.username} gif={gif} size={108} />
              </Pressable>
            ) : (
              <NoteFace name={user?.displayName ?? '?'} username={user?.username} gif={view?.gif} size={view?.gif ? 108 : 96} />
            )}
            {!view && (
              <Pressable onPress={() => setPalette((p) => !p)} hitSlop={6} accessibilityRole="button" accessibilityLabel={t('Cor da bolha')} accessibilityState={{ expanded: palette }} style={({ pressed }) => [styles.paletteBtn, palette && { borderColor: colors.brand }, pressed && { transform: [{ scale: 0.92 }] }]}>
                <PaletteIcon />
              </Pressable>
            )}
          </View>
          {!view && palette && (
            <View style={styles.colorRow} accessibilityRole="radiogroup" accessibilityLabel={t('Cor da bolha')}>
              {([null, ...NOTE_COLORS] as (NoteColor | null)[]).map((c) => {
                const t = noteTone(c);
                const on = color === c;
                return (
                  <Pressable key={c ?? 'branca'} onPress={() => setColor(c)} accessibilityRole="radio" accessibilityLabel={t.label} accessibilityState={{ checked: on }} hitSlop={4} style={[styles.colorRing, on && { borderColor: colors.brand }]}>
                    <View style={[styles.colorDot, { backgroundColor: t.bg, borderColor: c ? t.bg : colors.zinc300 }]} />
                  </Pressable>
                );
              })}
            </View>
          )}
          {!view ? (
            <View style={styles.optRow}>
              <OptionPill a11y={t('Música')} chosen={!!music} label={music?.title} onPress={() => setPanel('music')} onClear={() => setMusic(null)} icon={<Icon name="music" size={20} strokeWidth={2} color={colors.brand} />} />
              <OptionPill a11y={t('Local')} chosen={!!place} label={place?.name} onPress={() => setPanel('place')} onClear={() => setPlace(null)} icon={<Icon name="map-pin" size={20} strokeWidth={2} color={colors.sky} />} />
              {gifs.enabled || gif ? (
                <OptionPill a11y="GIF" chosen={!!gif} label="GIF" onPress={() => setPanel('gif')} onClear={() => setGif(null)} icon={gif ? <Image source={{ uri: gifShown(gif).still ?? gifShown(gif).url }} style={styles.optGif} contentFit={gifFit(gif)} /> : <View style={styles.gifBadge}><Text style={styles.gifBadgeText}>GIF</Text></View>} />
              ) : null}
            </View>
          ) : (
            <View style={{ alignItems: 'center' }}>
              {!!view.cheers && (
                <View style={styles.cheerRow}><Icon name="cheers" size={18} color={colors.amber600} /><Text style={styles.cheerRowText}>{view.cheers} {view.cheers === 1 ? t('brinde') : t('brindes')}</Text></View>
              )}
              <Text style={styles.hint}>{view.audience === 'close_friends' ? t('{timeAgo} · visível para os teus amigos próximos. Uma nota não se edita: apaga-a para publicar outra.', { timeAgo: timeAgo(view.createdAt) }) : t('{timeAgo} · visível para os teus seguidores. Uma nota não se edita: apaga-a para publicar outra.', { timeAgo: timeAgo(view.createdAt) })}</Text>
            </View>
          )}
          {!!err && <Text accessibilityRole="alert" style={styles.err}>{err}</Text>}
        </ScrollView>
        <View style={[styles.edBar, { paddingBottom: desktop ? 16 : kbOpen ? 8 : Math.max(insets.bottom, 12) + 4 }]}>
          {view ? (
            <View style={styles.audBtn}>
              <Icon name={view.audience === 'close_friends' ? 'star' : 'users'} size={18} strokeWidth={2} color={colors.zinc800} />
              <Text style={styles.audText}>{noteAudienceLabel(view.audience)}</Text>
            </View>
          ) : (
            <Pressable onPress={() => setPanel('audience')} accessibilityRole="button" accessibilityLabel={t('{noteAudienceLabel}. Mudar quem vê', { noteAudienceLabel: noteAudienceLabel(audience) })} style={({ pressed }) => [styles.audBtn, pressed && { opacity: 0.6 }]}>
              <Icon name={audience === 'close_friends' ? 'star' : 'users'} size={18} strokeWidth={2} color={audience === 'close_friends' ? colors.green600 : colors.zinc800} />
              <Text style={styles.audText} numberOfLines={1}>{noteAudienceLabel(audience)}</Text>
              <Icon name="chevron-right" size={16} strokeWidth={2.2} color={colors.zinc700} />
            </Pressable>
          )}
          {view ? (
            <Pressable disabled={busy} onPress={() => void remove()} accessibilityRole="button" style={({ pressed }) => [styles.shareBtn, { backgroundColor: colors.dangerSoft }, pressed && { opacity: 0.8 }]}>
              <Text style={[styles.shareText, { color: colors.danger }]}>{t('Apagar')}</Text>
            </Pressable>
          ) : (
            <Pressable disabled={!canShare} onPress={() => void run(async () => { await notesApi.set({ body: body.trim(), music, color, place, gif, audience }); showToast(t('Nota partilhada')); })} accessibilityRole="button" accessibilityState={{ disabled: !canShare }} style={({ pressed }) => [styles.shareBtn, !canShare && { opacity: 0.4 }, pressed && { transform: [{ scale: 0.97 }] }]}>
              <Text style={styles.shareText}>{t('Partilhar')}</Text>
            </Pressable>
          )}
        </View>
      </EditorFrame>
      {panel === 'music' && <MusicPicker hint={body} onPick={(t) => { setMusic(t); back(); }} onClose={back} />}
      {panel === 'place' && (
        <PlaceSheet
          value={place?.name ?? ''}
          onChange={(v) => setPlace(v.trim() ? { name: v.trim().slice(0, 80) } : null)}
          onClose={back}
        />
      )}
      {panel === 'gif' && (
        <Sheet title="GIF" onClose={back}>
          <GifPanel height={360} onPick={(g) => { setGif(gifPayload(g)); back(); }} />
        </Sheet>
      )}
      {panel === 'gifMenu' && (
        <Sheet title={t('GIF da nota')} onClose={back} variant="menu" cancel>
          <View style={{ paddingHorizontal: 16, paddingBottom: 4 }}>
            <ActionRow icon="repeat" title={t('Trocar o GIF')} onPress={() => setPanel('gif')} />
            <ActionRow icon="trash" title={t('Tirar o GIF')} danger onPress={() => { setGif(null); back(); }} />
          </View>
        </Sheet>
      )}
      {panel === 'audience' && (
        <Sheet title={t('Quem vê a tua nota')} onClose={back}>
          <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            {(['mutual', 'close_friends'] as NoteAudience[]).map((a) => (
              <ActionRow
                key={a}
                icon={a === 'close_friends' ? 'star' : 'users'}
                title={noteAudienceLabel(a)}
                text={a === 'close_friends' ? t('Só quem está na tua lista de amigos próximos.') : t('Os teus seguidores.')}
                right={audience === a ? <Icon name="check" size={20} strokeWidth={2.4} color={colors.brand} /> : undefined}
                onPress={() => { setAudience(a); back(); }}
              />
            ))}
          </View>
        </Sheet>
      )}
    </Modal>
  );
}

const SHADOW = '0 1px 3px rgba(24,24,27,0.12), 0 4px 14px -2px rgba(24,24,27,0.14)';

const styles = StyleSheet.create({
  strip: { marginHorizontal: -16, flexGrow: 0 },
  stripIn: { gap: 16, paddingHorizontal: 16, paddingBottom: 8, paddingTop: 12 },
  item: { width: 84, alignItems: 'center' },
  bubbleSlot: { height: 54, justifyContent: 'flex-end', alignItems: 'center' },
  bubbleWrap: { marginBottom: 6, maxWidth: 84 },
  bubble: { maxWidth: 84, borderRadius: 14, backgroundColor: '#fff', paddingHorizontal: 8, paddingVertical: 6, borderWidth: 1, borderColor: colors.zinc100, boxShadow: '0 1px 6px rgba(0,0,0,0.18)' } as object,
  bubbleText: { fontSize: 11, fontWeight: '500', lineHeight: 12.65, textAlign: 'center', color: colors.zinc800 },
  trackRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 },
  trackSmall: { fontSize: 10, lineHeight: 12, textAlign: 'center', color: colors.zinc500 },
  tail: { position: 'absolute', bottom: -4, left: '50%', marginLeft: -5, width: 10, height: 10, backgroundColor: '#fff', transform: [{ rotate: '45deg' }] },
  cheers: { position: 'absolute', right: -8, top: -10, height: 22, minWidth: 22, borderRadius: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 4, backgroundColor: '#fff', borderWidth: 1, borderColor: '#fef3c7', boxShadow: '0 1px 5px rgba(0,0,0,0.25)' } as object,
  cheersN: { fontSize: 10, fontWeight: '700', color: colors.amber600 },
  plus: { position: 'absolute', right: -2, bottom: -2, width: 24, height: 24, borderRadius: 12, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  online: { position: 'absolute', right: 0, bottom: 0, width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: '#fff', backgroundColor: '#10b981' },
  onlineBig: { right: 2, bottom: 2, width: 20, height: 20, borderRadius: 10, borderWidth: 3 },
  label: { marginTop: 4, width: '100%', textAlign: 'center', fontSize: 12, color: colors.zinc600 },
  /** Na linha com o selo (o selo fica a seguir ao nome, os dois centrados). */
  labelName: { marginTop: 0, width: undefined },
  hint: { marginTop: 8, textAlign: 'center', fontSize: 12, color: colors.zinc500, maxWidth: 320 },
  err: { marginTop: 8, textAlign: 'center', fontSize: 14, color: colors.danger },
  count: { marginTop: 6, textAlign: 'center', fontSize: 12, color: colors.zinc500 },
  cheerRow: { marginTop: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  cheerRowText: { fontSize: 14, fontWeight: '600', color: colors.zinc700 },

  // A nota aberta (NoteView).
  view: { paddingHorizontal: 16 },
  viewHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  viewName: { fontSize: 15, fontWeight: '700', color: colors.zinc900 },
  viewAgo: { fontSize: 15, color: colors.zinc500 },
  viewMore: { position: 'absolute', right: -8, top: '50%', marginTop: -18, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  viewRow: { marginTop: 18, flexDirection: 'row', alignItems: 'center', gap: 6 },
  viewBubbleWrap: { flexShrink: 1, flexDirection: 'row', alignItems: 'center' },
  viewDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1, marginRight: 2, marginTop: -18, boxShadow: SHADOW } as object,
  viewBubble: { flexShrink: 1, borderRadius: 22, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 11, minHeight: 46, justifyContent: 'center', boxShadow: SHADOW } as object,
  viewBubbleText: { fontSize: 16, lineHeight: 21, fontWeight: '500' },
  viewBig: { marginTop: 22, textAlign: 'center', fontSize: 19, lineHeight: 25, fontWeight: '800', color: colors.zinc900, paddingHorizontal: 12 },
  trackLine: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0, maxWidth: '100%' },
  trackBtn: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  trackTitle: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  playing: { flexDirection: 'row', alignItems: 'center', gap: 1.5, height: 12 },
  playingBar: { width: 2.5, height: 12, borderRadius: 1.25 },
  placeLine: { marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 0, maxWidth: '100%' },
  placeText: { flexShrink: 1, fontSize: 13, lineHeight: 17, fontWeight: '500' },
  replyRow: { marginTop: 26, flexDirection: 'row', alignItems: 'center', gap: 10 },
  replyPill: { flex: 1, minHeight: 50, borderRadius: 25, backgroundColor: colors.zinc100, flexDirection: 'row', alignItems: 'center', paddingLeft: 18, paddingRight: 6 },
  replyInput: { flex: 1, minWidth: 0, paddingVertical: 12, fontSize: 16, color: colors.zinc900, outlineStyle: 'none' } as object,
  replySend: { marginLeft: 6 },
  quickRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: 4 },
  quickBtn: { width: 34, height: 40, alignItems: 'center', justifyContent: 'center' },
  quickEmoji: { fontSize: 25, lineHeight: 32 },
  cheerOut: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },

  // O editor da minha nota (NoteEditor).
  edRoot: { flex: 1, backgroundColor: colors.white },
  edDeskRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.4)' },
  edDeskCard: { width: '100%', maxWidth: 480, height: 600, maxHeight: '100%', borderRadius: 24, backgroundColor: colors.white, overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.25)' } as object,
  edTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  edX: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.zinc100, alignItems: 'center', justifyContent: 'center', boxShadow: SHADOW } as object,
  edTitle: { fontSize: 16, fontWeight: '700', color: colors.zinc900 },
  edCenter: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 16 },
  edBubbleWrap: { alignItems: 'center', marginBottom: 8 },
  edBubble: { minWidth: 170, maxWidth: 280, borderRadius: 22, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center', gap: 2, boxShadow: SHADOW } as object,
  edClear: { position: 'absolute', right: -6, top: -6, width: 24, height: 24, borderRadius: 12, backgroundColor: colors.zinc900, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  edTail: { position: 'absolute', bottom: -6, left: '50%', marginLeft: -16, width: 12, height: 12, borderRadius: 6, borderWidth: 1 },
  edText: { fontSize: 17, lineHeight: 22, fontWeight: '500', textAlign: 'center' },
  edField: { width: 210 },
  edMeasure: { position: 'absolute', left: 0, right: 0, top: 0, opacity: 0 },
  edInput: { width: '100%', padding: 0, outlineStyle: 'none' } as object,
  edAvatar: { marginTop: 8 },
  paletteBtn: { position: 'absolute', right: -4, bottom: -2, width: 34, height: 34, borderRadius: 17, backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.zinc200, alignItems: 'center', justifyContent: 'center', boxShadow: SHADOW } as object,
  paletteDots: { width: 16, height: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
  paletteDot: { width: 7, height: 7, borderRadius: 3.5 },
  colorRow: { marginTop: 14, flexDirection: 'row', gap: 8 },
  colorRing: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  colorDot: { width: 26, height: 26, borderRadius: 13, borderWidth: 1 },
  optRow: { marginTop: 18, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 },
  opt: { height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.zinc200, backgroundColor: colors.white, flexDirection: 'row', alignItems: 'center', boxShadow: '0 1px 2px rgba(24,24,27,0.06)' } as object,
  optOn: { backgroundColor: colors.zinc50, borderColor: colors.zinc300 },
  optMain: { height: 40, minWidth: 54, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  optText: { maxWidth: 110, fontSize: 14, fontWeight: '600', color: colors.zinc800 },
  optX: { width: 30, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  optGif: { width: 26, height: 20, borderRadius: 4 },
  gifBadge: { height: 20, paddingHorizontal: 4, borderRadius: 5, borderWidth: 1.6, borderColor: colors.green600, alignItems: 'center', justifyContent: 'center' },
  gifBadgeText: { fontSize: 10, fontWeight: '800', color: colors.green600 },
  edBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingTop: 8 },
  audBtn: { flexShrink: 1, height: 44, flexDirection: 'row', alignItems: 'center', gap: 6 },
  audText: { flexShrink: 1, fontSize: 15, fontWeight: '700', color: colors.zinc900 },
  shareBtn: { height: 44, paddingHorizontal: 22, borderRadius: 22, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  shareText: { fontSize: 16, fontWeight: '700', color: '#fff' },
});
