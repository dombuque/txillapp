import { Image } from 'expo-image';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Sticker } from '@/components/StickerPanel';
import { type ChatMessage } from '@/lib/api';
import { colors } from '@/lib/theme';

/** Bolhas do chat (copiadas de messages/[username].tsx) com o nome de quem envia, para os grupos. */
export type Msg = ChatMessage & { state?: 'sending' | 'failed'; sender?: { username: string; displayName: string; hasAvatar: boolean } };

/** Cada pessoa tem a sua cor nos grupos (a mesma do site, apps/web/src/lib/senderColor.ts). */
const PALETTE = ['#d6334f', '#ea580c', '#b45309', '#15803d', '#0f766e', '#9f1239', '#3f3f46', '#4d7c0f'];
export function senderColor(username: string): string {
  let h = 7;
  for (const c of username.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export const quoteText = (kind: ChatMessage['kind'], body: string) => (kind === 'image' ? body || 'Foto' : kind === 'voice' ? 'Mensagem de voz' : kind === 'sticker' ? 'Sticker' : kind === 'gift' ? 'Presente' : body);
const hm = (iso: string) => new Date(iso).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });

export function Bubble({ m, group = false, prevSame, nextSame, onMenu, onRetry, onOpenOnce }: { m: Msg; group?: boolean; prevSame: boolean; nextSame: boolean; onMenu: (m: Msg) => void; onRetry: (m: Msg) => void; onOpenOnce: (m: Msg) => void }) {
  const mine = m.fromMe;
  const radius = mine
    ? { borderRadius: 20, borderBottomRightRadius: 6, ...(prevSame ? { borderTopRightRadius: 6 } : null) }
    : { borderRadius: 20, borderBottomLeftRadius: 6, ...(prevSame ? { borderTopLeftRadius: 6 } : null) };
  const tone = mine ? { backgroundColor: colors.brand } : { backgroundColor: colors.zinc100 };
  const ink = mine ? '#fff' : colors.zinc900;
  const real = !m.id.startsWith('tmp-');

  let content: React.ReactNode;
  if (m.viewOnce && !m.opened && !mine) {
    content = (
      <Pressable onPress={() => onOpenOnce(m)} style={[styles.bubble, tone, radius, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
        <Icon name="once" size={20} color={ink} />
        <Text style={[styles.text, { color: ink, fontWeight: '600' }]}>Toca para abrir</Text>
      </Pressable>
    );
  } else if (m.viewOnce && mine) {
    content = (
      <View style={[styles.bubble, tone, radius, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
        <Icon name="once" size={20} color={ink} />
        <Text style={[styles.text, { color: ink }]}>{m.opened ? 'Aberta' : 'Visualização única'}</Text>
      </View>
    );
  } else if (m.viewOnce && m.opened) {
    content = <View style={[styles.bubble, tone, radius]}><Text style={[styles.text, { color: ink, fontStyle: 'italic' }]}>Já abriste esta mensagem</Text></View>;
  } else if (m.kind === 'gift') {
    content = (
      <View style={[styles.gift]}>
        <Icon name="gift" size={22} color="#fff" />
        <Text style={styles.giftAmount}>{(m.giftAmount ?? 0).toLocaleString('pt-PT')} Txills</Text>
        {m.body ? <Text style={styles.giftNote}>{m.body}</Text> : null}
      </View>
    );
  } else if (m.kind === 'sticker') {
    content = <Sticker id={m.body} size={132} />;
  } else if ((m.kind === 'image' || m.kind === 'video') && m.mediaUrl) {
    content = (
      <View style={[styles.media, radius]}>
        <Image source={{ uri: m.mediaUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
        {m.kind === 'video' && <View style={styles.play}><Icon name="play" size={22} color="#fff" solid /></View>}
        {m.body ? <View style={styles.cap}><Text style={styles.capText}>{m.body}</Text></View> : null}
      </View>
    );
  } else if (m.kind === 'location' && m.lat != null && m.lng != null) {
    content = (
      <Pressable onPress={() => void Linking.openURL(`https://www.google.com/maps?q=${m.lat},${m.lng}`)} style={[styles.bubble, tone, radius]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name="map-pin" size={18} color={ink} /><Text style={[styles.text, { color: ink }]}>Localização</Text></View>
      </Pressable>
    );
  } else if (m.kind === 'voice') {
    content = <View style={[styles.bubble, tone, radius]}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name="mic" size={18} color={ink} /><Text style={[styles.text, { color: ink }]}>Mensagem de voz{m.durationMs ? ` · ${Math.round(m.durationMs / 1000)} s` : ''}</Text></View></View>;
  } else if (m.kind === 'post') {
    content = <View style={[styles.bubble, tone, radius]}><Text style={[styles.text, { color: ink }]}>Partilhou uma publicação{m.post ? ` de ${m.post.author.displayName}` : ''}</Text></View>;
  } else if (m.kind === 'story_reaction' || m.kind === 'story_reply') {
    content = <View style={[styles.bubble, tone, radius]}><Text style={[styles.text, { color: ink }]}>{m.kind === 'story_reaction' ? (mine ? 'Reagiste ao story' : 'Reagiu ao teu story') : `${mine ? 'Respondeste ao story' : 'Respondeu ao teu story'}: ${m.body}`}</Text></View>;
  } else {
    content = <View style={[styles.bubble, tone, radius, m.state === 'sending' && { opacity: 0.7 }]}><Text style={[styles.text, { color: ink }]}>{m.body}</Text></View>;
  }

  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', marginTop: prevSame ? 2 : 10 }}>
      {group && !mine && !prevSame && m.sender && <Text style={{ marginBottom: 2, paddingHorizontal: 4, fontSize: 12, fontWeight: '700', color: senderColor(m.sender.username) }}>{m.sender.displayName.split(' ')[0]}</Text>}
      {m.replyTo && (
        <View style={[styles.reply, mine ? { borderLeftColor: 'rgba(214,51,79,0.7)', backgroundColor: 'rgba(214,51,79,0.08)' } : { borderLeftColor: '#a1a1aa', backgroundColor: '#fafafa' }]}>
          {m.replyTo.gone ? <Text style={{ fontStyle: 'italic', color: colors.zinc600, fontSize: 13 }}>Mensagem apagada</Text> : (
            <>
              <Text style={{ fontWeight: '700', color: colors.zinc700, fontSize: 13 }} numberOfLines={1}>{m.replyTo.fromMe ? 'Tu' : m.replyTo.name}</Text>
              <Text style={{ color: colors.zinc600, fontSize: 13 }} numberOfLines={2}>{quoteText(m.replyTo.kind, m.replyTo.body)}</Text>
            </>
          )}
        </View>
      )}
      <Pressable onLongPress={real ? () => onMenu(m) : undefined} delayLongPress={350} style={{ maxWidth: '78%' }}>{content}</Pressable>
      {m.reactions && m.reactions.length > 0 && (
        <View style={styles.reactions}>{m.reactions.map((r) => <Text key={r.reaction} style={{ fontSize: 13 }}>{r.reaction} {r.count > 1 ? r.count : ''}</Text>)}</View>
      )}
      {m.state === 'failed' && (
        <Pressable onPress={() => onRetry(m)}><Text style={{ marginTop: 2, fontSize: 12, color: colors.red600, fontWeight: '600' }}>Não enviou. Toca para tentar outra vez</Text></Pressable>
      )}
      {!nextSame && m.state !== 'failed' && <Text style={styles.time}>{hm(m.at)}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: { paddingHorizontal: 16, paddingVertical: 10 },
  text: { fontSize: 16, lineHeight: 21 },
  time: { marginTop: 2, paddingHorizontal: 4, fontSize: 11, color: colors.zinc500 },
  reply: { marginBottom: 2, maxWidth: '78%', borderLeftWidth: 4, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  reactions: { marginTop: -6, flexDirection: 'row', gap: 6, borderRadius: 999, backgroundColor: colors.white, paddingHorizontal: 8, paddingVertical: 2, boxShadow: '0 1px 4px rgba(0,0,0,0.15)' },
  media: { width: 240, height: 300, overflow: 'hidden', backgroundColor: colors.zinc100 },
  play: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  cap: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', padding: 8 },
  capText: { color: '#fff', fontSize: 14 },
  gift: { width: 240, borderRadius: 20, backgroundColor: colors.brand, padding: 16, alignItems: 'center', gap: 4 },
  giftAmount: { color: '#fff', fontSize: 24, fontWeight: '800' },
  giftNote: { color: 'rgba(255,255,255,0.9)', fontSize: 14, textAlign: 'center' },
  empty: { textAlign: 'center', color: colors.zinc500, paddingVertical: 24 },
});
