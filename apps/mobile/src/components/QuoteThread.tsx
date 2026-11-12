import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Post } from '@/lib/api';
import { sized } from '@/lib/config';
import { colors } from '@/lib/theme';
import { timeAgo } from '@/lib/time';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { VerifiedBadge } from './VerifiedBadge';
import { NameWithBadge } from './NameWithBadge';
import { VenueLogo } from './VenueCard';

/** Tamanho do avatar no fio (a original em cima e quem citou por baixo) e o espaço até ao texto. */
export const THREAD_AVATAR = 36;
export const THREAD_GAP = 12;

/** Texto mais comprido do que isto (ou com muitas linhas) mostra "Ver mais" (o corte certo à linha não existe na web). */
const LONG = { withThumb: 130, plain: 200, lines: 5 };

/** Toque simples ou duplo (o duplo brinda a citação); igual ao do cartão. */
function useTap(double?: () => void) {
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (t.current) clearTimeout(t.current); }, []);
  return (single?: () => void) => {
    if (!double) return single?.();
    if (t.current != null) {
      clearTimeout(t.current);
      t.current = null;
      double();
      return;
    }
    t.current = setTimeout(() => {
      t.current = null;
      single?.();
    }, 260);
  };
}

/** A linha fina que liga o avatar da original ao avatar de quem citou. */
function Rail({ avatar }: { avatar: React.ReactNode }) {
  return (
    <View style={styles.rail}>
      {avatar}
      <View style={styles.line} />
    </View>
  );
}

/**
 * Repost com comentário em "fio": a publicação original compacta em cima (avatar, nome, @, tempo, texto curto, miniatura,
 * contadores) e a linha que desce até quem citou. `original` a null: já não está disponível (apagada, privada, bloqueada).
 * Sem `onOpen` (pré-visualização ao escrever a citação) é só para ver: nada se toca.
 */
export function QuotedOriginal({ original, me, onOpen, onPhoto, onDouble }: { original: Post | null; me?: string; onOpen?: (p: Post) => void; onPhoto?: (p: Post) => void; onDouble?: () => void }) {
  const router = useRouter();
  const tap = useTap(onDouble);
  const [open, setOpen] = useState(false);
  if (!original) {
    return (
      <View style={styles.row} accessibilityRole="text" accessibilityLabel="Esta publicação já não está disponível">
        <Rail avatar={<View style={styles.goneDot}><Icon name="eye-off" size={18} color={colors.zinc500} /></View>} />
        <View style={styles.goneBox}>
          <Text style={styles.goneText}>Esta publicação já não está disponível</Text>
        </View>
      </View>
    );
  }
  const live = !!onOpen;
  const a = original.author;
  const name = original.venue ? original.venue.name : a.displayName;
  const verified = original.venue ? (original.venue.verified ? 'verified' as const : null) : a.verified ? (a.verifiedTier ?? 'verified') : null;
  const g = original.gift;
  const m = original.media[0];
  const video = m?.kind === 'video';
  const thumb = m ? (video ? sized(m.posterUrl, 360) : sized(m.url, 360)) : undefined;
  const body = original.body;
  // Só foto (sem texto): a miniatura vai por baixo, mais larga; com texto fica à direita, pequena.
  const side = !!m && !!body;
  const long = !!body && (body.length > (side ? LONG.withThumb : LONG.plain) || body.split('\n').length > LONG.lines);
  const goAuthor = () => router.push((original.venue ? `/v/${original.venue.slug}` : a.id === me ? '/profile' : `/u/${a.username}`) as never);
  const quoted = original.kind === 'repost' && original.repostOf ? original.repostOf : null;

  const media = m ? (
    <Pressable
      disabled={!live}
      onPress={() => (video ? onOpen?.(original) : tap(() => onPhoto?.(original)))}
      style={side ? styles.thumbSide : styles.thumbBelow}
      accessibilityRole="button"
      accessibilityLabel={video ? 'Ver o vídeo' : 'Ver a foto em ecrã inteiro'}
    >
      {thumb ? <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} accessibilityIgnoresInvertColors /> : null}
      {video ? (
        <View style={styles.playWrap} pointerEvents="none">
          <View style={[styles.play, side && { width: 30, height: 30, borderRadius: 15 }]}><Icon name="play" size={side ? 14 : 22} color="#fff" solid /></View>
        </View>
      ) : null}
      {original.media.length > 1 ? (
        <View style={styles.more} pointerEvents="none"><Text style={styles.moreText}>+{original.media.length - 1}</Text></View>
      ) : null}
    </Pressable>
  ) : null;

  return (
    <Pressable
      onPress={() => onOpen?.(original)}
      disabled={!live}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
      accessibilityRole={live ? 'link' : 'text'}
      accessibilityLabel={`Publicação de ${name}: ${g ? `presente de ${g.amount} Txills a ${g.recipient.displayName}. ` : ''}${body || (m ? (video ? 'vídeo' : 'foto') : '')}`}
      accessibilityHint={live ? 'Abre a publicação original' : undefined}
    >
      <Rail
        avatar={
          <Pressable onPress={goAuthor} disabled={!live} accessibilityRole="link" accessibilityLabel={`Perfil de ${name}`}>
            {original.venue ? <VenueLogo venue={original.venue} size={THREAD_AVATAR} /> : <Avatar name={a.displayName} username={a.username} size={THREAD_AVATAR} />}
          </Pressable>
        }
      />
      <View style={styles.col}>
        <View style={styles.head}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          {verified ? <VerifiedBadge size={14} tier={verified} /> : null}
          <Text style={styles.meta} numberOfLines={1}>
            {original.venue ? 'página' : `@${a.username}`} · {timeAgo(original.createdAt)}
          </Text>
        </View>
        {g ? (
          <View style={styles.gift}>
            <Icon name="gift" size={15} color={colors.brand} />
            <NameWithBadge
              name={<>Presenteou <Text style={{ fontWeight: '700' }}>{g.recipient.displayName}</Text></>}
              who={g.recipient}
              style={styles.giftText}
              containerStyle={{ flexShrink: 1 }}
            >
              <Text style={[styles.giftText, { flexShrink: 0 }]}>com {g.amount.toLocaleString('pt-PT')} Txills</Text>
            </NameWithBadge>
          </View>
        ) : null}
        <View style={side ? styles.sideRow : undefined}>
          <View style={{ flex: side ? 1 : undefined, minWidth: 0 }}>
            {body ? (
              <Text style={styles.body} numberOfLines={open ? undefined : LONG.lines}>{body}</Text>
            ) : null}
            {long && !open ? (
              <Pressable onPress={() => setOpen(true)} disabled={!live} hitSlop={6} accessibilityRole="button" accessibilityLabel="Ver o texto todo">
                <Text style={styles.seeMore}>Ver mais</Text>
              </Pressable>
            ) : null}
            {quoted ? (
              <View style={styles.quoted}>
                <Icon name="repeat" size={13} color={colors.zinc500} />
                <Text style={styles.quotedText} numberOfLines={1}>a citar {quoted.author.displayName}</Text>
              </View>
            ) : null}
          </View>
          {side ? media : null}
        </View>
        {!side ? media : null}
        {original.cheers > 0 || original.comments > 0 ? (
          <View style={styles.counts}>
            {original.cheers > 0 ? (
              <View style={styles.count} accessibilityLabel={`${original.cheers} ${original.cheers === 1 ? 'brinde' : 'brindes'}`}>
                <Icon name="cheers" size={15} color={colors.zinc500} />
                <Text style={styles.countText}>{original.cheers}</Text>
              </View>
            ) : null}
            {original.comments > 0 ? (
              <View style={styles.count} accessibilityLabel={`${original.comments} ${original.comments === 1 ? 'comentário' : 'comentários'}`}>
                <Icon name="comment" size={14} color={colors.zinc500} />
                <Text style={styles.countText}>{original.comments}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: THREAD_GAP },
  rail: { width: THREAD_AVATAR, alignItems: 'center' },
  // A linha do fio: 2 pt, cinzento claro, do avatar da original até ao de quem citou (o espaço de 4 fica de cada lado).
  line: { flex: 1, width: 2, minHeight: 16, marginTop: 4, marginBottom: 4, borderRadius: 1, backgroundColor: colors.zinc300 },
  col: { flex: 1, minWidth: 0, paddingBottom: 14 },
  head: { minHeight: THREAD_AVATAR / 2 + 6, flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { flexShrink: 1, fontSize: 15, fontWeight: '600', color: colors.zinc900, lineHeight: 20 },
  meta: { flexShrink: 2, fontSize: 14, color: colors.zinc500, lineHeight: 20 },
  body: { marginTop: 2, fontSize: 15, lineHeight: 21, color: colors.zinc800 },
  seeMore: { marginTop: 2, fontSize: 14, fontWeight: '600', color: colors.zinc600, lineHeight: 20 },
  sideRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  thumbSide: { marginTop: 4, width: 72, height: 72, borderRadius: 10, overflow: 'hidden', backgroundColor: colors.zinc100 },
  thumbBelow: { marginTop: 8, height: 176, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.zinc100 },
  playWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  play: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', paddingLeft: 2 },
  more: { position: 'absolute', right: 6, bottom: 6, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 6, paddingVertical: 1 },
  moreText: { color: '#fff', fontSize: 11, fontWeight: '700', lineHeight: 15 },
  gift: { marginTop: 2, flexDirection: 'row', alignItems: 'center', gap: 6 },
  giftText: { flexShrink: 1, fontSize: 15, lineHeight: 21, color: colors.zinc800 },
  quoted: { marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 4 },
  quotedText: { flexShrink: 1, fontSize: 13, color: colors.zinc500 },
  counts: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 14 },
  count: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  countText: { fontSize: 13, color: colors.zinc500, lineHeight: 18 },
  goneDot: { width: THREAD_AVATAR, height: THREAD_AVATAR, borderRadius: THREAD_AVATAR / 2, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  goneBox: { flex: 1, minWidth: 0, marginBottom: 14, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, backgroundColor: colors.zinc100 },
  goneText: { fontSize: 15, lineHeight: 20, color: colors.zinc600 },
});
