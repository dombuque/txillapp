import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Animated, FlatList, Pressable, Share, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { api, isTcheka, type Page, type Post } from '@/lib/api';
import type { PeopleKind } from '@/lib/api.feed';
import { sized } from '@/lib/config';
import { cardShadow, colors } from '@/lib/theme';
import { timeAgo } from '@/lib/time';
import { useIsPostVisible } from '@/lib/visiblePosts';
import { Avatar } from './Avatar';
import { BookmarkIcon } from './BookmarkIcon';
import { CarouselVideo } from './CarouselVideo';
import { CommentsSheet } from './CommentsSheet';
import { Icon } from './Icon';
import { PeopleSheet } from './PeopleSheet';
import { PhotoViewer } from './PhotoViewer';
import { RichText } from './RichText';
import { TeachBar } from './TeachBar';
import { GiftSheet, PostMenuSheet, RepostSheet } from './PostSheets';
import { ShareSheet } from './ShareSheet';
import { TrackCard } from './TrackCard';
import { VerifiedBadge } from './VerifiedBadge';
import { VenueLogo } from './VenueCard';
import { CheersPour } from './CheersPour';
import { KIND_LABEL } from '@/lib/api.locais';

/** Toque simples ou duplo: o duplo chama `double`; o simples só corre (com um pequeno atraso) se não vier segundo toque. */
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

/** Duplo toque: brinda (só põe, nunca tira) e dá o sinal para a animação do copo. */
function useBrindar(post: Post, patch: (p: Partial<Post>) => void) {
  const [burst, setBurst] = useState(0);
  async function brindar() {
    setBurst((n) => n + 1);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    if (post.cheered) return;
    patch({ cheered: true, cheers: post.cheers + 1 });
    try {
      patch(await api.cheer(post.id));
    } catch {
      patch({ cheered: post.cheered, cheers: post.cheers });
    }
  }
  /** Só a animação (quando se brinda pelo botão). */
  const celebrate = () => setBurst((n) => n + 1);
  return { burst, brindar, celebrate };
}

/** O meu perfil vive em /profile; os outros em /u/:username. */
const profileOf = (a: { id?: string; username: string }, me?: string) => (a.id && a.id === me ? '/profile' : `/u/${a.username}`);

/** Atualiza uma publicação na lista do feed (também dentro de um repost). */
function usePatch(id: string) {
  const qc = useQueryClient();
  return (p: Partial<Post>) => {
    const merge = (i: Post): Post => (i.id === id ? { ...i, ...p } : i.repostOf?.id === id ? { ...i, repostOf: { ...i.repostOf, ...p } } : i);
    for (const key of ['feed', 'profile-posts']) {
      qc.setQueriesData<InfiniteData<Page<Post>>>({ queryKey: [key] }, (d) => d && { ...d, pages: d.pages.map((pg) => ({ ...pg, items: pg.items.map(merge) })) });
    }
    qc.setQueriesData<Post>({ queryKey: ['post'] }, (d) => (d ? merge(d) : d));
  };
}

/** O cartão de uma publicação, igual ao do site: cantos de 26, sombra suave, autor, texto, fotos e a barra de ações. */
function PostCardBase({ post, me, detail, openComments, highlightComment }: { post: Post; me?: string; /** Já estamos na página desta publicação: tocar no cartão não a volta a abrir. */ detail?: boolean; /** Abre logo os comentários (vindo de uma notificação), realçando `highlightComment`. */ openComments?: boolean; highlightComment?: string }) {
  const router = useRouter();
  // A música do post toca enquanto ele está à vista neste ecrã (e o ecrã está à frente); pára ao sair.
  const inList = useIsPostVisible(post.id);
  const [focused, setFocused] = useState(true);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  const musicOn = focused && (!!detail || inList);
  if (post.kind === 'repost' && post.repostOf && !post.body) {
    return (
      <View>
        <View style={styles.repostBar}>
          <Icon name="repeat" size={16} color={colors.zinc600} />
          <Pressable onPress={() => router.push(profileOf(post.author, me) as never)} accessibilityRole="link">
            <Text style={[styles.repostText, { fontWeight: '600' }]}>{post.author.id === me ? 'Repostaste' : `${post.author.displayName} repostou`}</Text>
          </Pressable>
        </View>
        <PostCard post={post.repostOf} me={me} />
      </View>
    );
  }
  return <PostBody post={post} me={me} detail={detail} openComments={openComments} highlightComment={highlightComment} musicOn={musicOn} />;
}

type SheetState = null | 'menu' | 'comments' | 'repost' | 'share' | { gift: { username: string; displayName: string; amount?: number; note?: string } } | { people: PeopleKind };
type GiftExtra = { recipient: { username: string; displayName: string; verified?: boolean; verifiedTier?: 'verified' | 'official' | null } };

function PostBody({ post, me, detail, openComments, highlightComment, musicOn = false }: { post: Post; me?: string; detail?: boolean; openComments?: boolean; highlightComment?: string; /** O post está à vista: a música toca. */ musicOn?: boolean }) {
  // No computador a app vive numa coluna de 576 ao centro: as medidas saem dela, não da janela.
  const width = Math.min(useWindowDimensions().width, 576);
  const router = useRouter();
  const patch = usePatch(post.id);
  const { burst, brindar, celebrate } = useBrindar(post, patch);
  const tapText = useTap(() => void brindar());
  // Tocar na publicação (fora de botões, ligações e fotos) abre a página dela; num repost com comentário abre o repost (com a original por baixo).
  const goPost = () => { if (!detail) openPost(post); };
  const mine = post.author.id === me;
  const margin = width >= 360 ? 8 : 6;
  const pad = width >= 360 ? 16 : 14;
  const inner = width - margin * 2 - pad * 2;
  const [sheet, setSheet] = useState<SheetState>(openComments ? 'comments' : null);
  const [gone, setGone] = useState(false);
  // Foto em ecrã inteiro: `of` é a publicação cujas fotos se veem (a original, num repost com comentário).
  const [viewer, setViewer] = useState<null | { of: Post; start: number }>(null);
  const quote = post.kind === 'repost' && !!post.repostOf && !!post.body ? post.repostOf : null;
  const g = post.gift;
  const goAuthor = () => router.push(profileOf(post.author, me) as never);
  const goVenue = () => post.venue && router.push({ pathname: '/v/[slug]', params: { slug: post.venue.slug } });
  const openPost = (o: Post) => router.push((isTcheka(o) ? `/r/${o.code ?? o.id}` : `/p/${o.code ?? o.id}`) as never);

  async function toggleSave() {
    const next = !post.saved;
    patch({ saved: next });
    try {
      await (next ? api.savePost(post.id) : api.unsavePost(post.id));
    } catch {
      patch({ saved: !next });
    }
  }

  if (gone) {
    return (
      <View style={[styles.gone, { marginHorizontal: 16 }]} accessibilityRole="alert">
        <Text style={styles.goneText}>Ok, vamos mostrar menos disto.</Text>
      </View>
    );
  }

  const menuBtn = (
    <Pressable onPress={() => setSheet('menu')} hitSlop={6} style={styles.more} accessibilityRole="button" accessibilityLabel="Mais opções da publicação">
      <Icon name="more" size={26} strokeWidth={3} />
    </Pressable>
  );
  const giftTo = { username: post.author.username, displayName: post.author.displayName };

  return (
    <Pressable onPress={goPost} disabled={detail} accessible={false} style={[styles.card, cardShadow, { marginHorizontal: margin, paddingHorizontal: pad }]}>
      {g ? (
        <GiftBlock post={post} g={g} me={me} onDouble={() => void brindar()} menu={menuBtn} onOpenPost={openPost} />
      ) : (
        <>
          <View style={styles.header}>
            {post.venue ? (
              // Publicada como um local: a página é a voz (logótipo, nome e selo); quem publicou fica por trás.
              <Pressable onPress={goVenue} accessibilityRole="link" accessibilityLabel={`Página de ${post.venue.name}`}>
                <VenueLogo venue={post.venue} size={52} />
              </Pressable>
            ) : (
              <Pressable onPress={goAuthor} accessibilityRole="link" accessibilityLabel={`Perfil de ${post.author.displayName}`}>
                <Avatar name={post.author.displayName} username={post.author.username} size={52} />
              </Pressable>
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Pressable onPress={post.venue ? goVenue : goAuthor} style={styles.nameRow} accessibilityRole="link">
                <Text style={[styles.name, { flexShrink: 1 }]} numberOfLines={1}>{post.venue ? post.venue.name : post.author.displayName}</Text>
                {post.venue ? (post.venue.verified && <VerifiedBadge size={16} tier="verified" />) : (post.author.verified && <VerifiedBadge size={16} tier={post.author.verifiedTier} />)}
              </Pressable>
              {post.venue && !quote ? (
                <Text style={styles.handle} numberOfLines={1}>{KIND_LABEL[post.venue.kind] ?? 'Local'} · página</Text>
              ) : quote ? (
                <View style={styles.locRow}>
                  <Icon name="repeat" size={14} color={colors.zinc500} />
                  <Text style={styles.handle} numberOfLines={1}>repostou</Text>
                </View>
              ) : post.locationLabel ? (
                <Pressable onPress={() => router.push(`/place/${encodeURIComponent(post.locationLabel as string)}` as never)} style={styles.locRow} accessibilityRole="link">
                  <Icon name="map-pin" size={14} color={colors.zinc600} />
                  <Text style={styles.loc} numberOfLines={1}>{post.locationLabel}</Text>
                </Pressable>
              ) : (
                <Text style={styles.handle} numberOfLines={1}>@{post.author.username}</Text>
              )}
            </View>
            <Text style={styles.time}>
              {timeAgo(post.createdAt)}
              {post.editedAt ? ' · editado' : ''}
            </Text>
            {!quote && (
              <Pressable onPress={() => void toggleSave()} hitSlop={6} style={styles.save} accessibilityRole="button" accessibilityLabel={post.saved ? 'Tirar dos guardados' : 'Guardar'}>
                <BookmarkIcon on={!!post.saved} size={24} />
              </Pressable>
            )}
            {menuBtn}
          </View>
          {post.body ? (
            <Pressable onPress={() => tapText(goPost)} accessibilityLabel="Abrir a publicação (duplo toque para brindar)">
              <RichText text={post.body} style={styles.body} />
            </Pressable>
          ) : null}
        </>
      )}
      {post.music ? <TrackCard track={post.music} autoplay visible={musicOn} /> : null}
      {quote || post.media.length ? (
        // O brinde aparece no meio da foto ou do vídeo (ou da publicação citada).
        <View>
          {quote ? (
            <QuoteBox original={quote} me={me} onPhoto={() => setViewer({ of: quote, start: 0 })} onOpen={openPost} onDouble={() => void brindar()} />
          ) : (
            <Carousel media={post.media} width={inner} reelId={post.code ?? post.id} onDouble={() => void brindar()} onOpen={(start) => setViewer({ of: post, start })} />
          )}
          <CheersPour n={burst} size={Math.min(220, inner * 0.6)} />
        </View>
      ) : (
        <CheersPour n={burst} size={Math.min(200, inner * 0.55)} />
      )}
      <Actions post={post} mine={mine} patch={patch} onCheer={celebrate} open={(k) => setSheet(k === 'gift' ? { gift: giftTo } : k)} people={(k) => setSheet({ people: k })} />
      {/* Publicações que o algoritmo te mostra (de quem não segues): ensina o que queres ver. */}
      {post.feed?.source === 'discover' && !mine ? <TeachBar postId={post.id} onNo={() => setGone(true)} /> : null}
      {viewer && (
        <PhotoViewer
          photos={viewer.of.media.filter((m) => m.kind !== 'video').map((m) => ({ url: m.url, width: m.width, height: m.height, tags: m.tags }))}
          start={viewer.of.media.slice(0, viewer.start).filter((m) => m.kind !== 'video').length}
          author={viewer.of.author}
          body={viewer.of.body}
          onClose={() => setViewer(null)}
          footer={
            <ViewerBar
              post={viewer.of}
              full={viewer.of.id === post.id}
              mine={mine}
              onOpen={(k) => {
                setViewer(null);
                setTimeout(() => setSheet(k === 'gift' ? { gift: giftTo } : k), 350);
              }}
            />
          }
        />
      )}
      {sheet === 'menu' && <PostMenuSheet post={post} mine={mine} onClose={() => setSheet(null)} onSaved={(saved) => patch({ saved })} onShare={() => setSheet('share')} />}
      {sheet === 'share' && <ShareSheet post={post} onClose={() => setSheet(null)} />}
      {sheet === 'comments' && (
        <CommentsSheet
          post={post}
          highlight={highlightComment}
          onClose={() => setSheet(null)}
          onDelta={(d) => patch({ comments: Math.max(0, post.comments + d) })}
          onGift={(to, amount, note) => setSheet({ gift: { ...to, amount, note } })}
        />
      )}
      {sheet === 'repost' && <RepostSheet post={post} onChange={patch} onClose={() => setSheet(null)} />}
      {typeof sheet === 'object' && sheet && 'people' in sheet && <PeopleSheet postId={post.id} kind={sheet.people} onClose={() => setSheet(null)} />}
      {typeof sheet === 'object' && sheet && 'gift' in sheet && (
        <GiftSheet
          recipient={sheet.gift}
          postId={sheet.gift.username === post.author.username && !sheet.gift.amount ? post.id : undefined}
          preset={sheet.gift.amount ? { amount: sheet.gift.amount, note: sheet.gift.note, visibility: 'private' } : undefined}
          onClose={() => setSheet(null)}
        />
      )}
    </Pressable>
  );
}

/** Barra de ações por baixo da foto em ecrã inteiro: brindar, comentar, repostar, presentear (as outras fecham a foto e abrem a folha). */
function ViewerBar({ post, full, mine, onOpen }: { post: Post; full: boolean; mine: boolean; onOpen: (k: 'comments' | 'repost' | 'gift' | 'share') => void }) {
  const patch = usePatch(post.id);
  async function cheer() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    patch({ cheered: !post.cheered, cheers: post.cheers + (post.cheered ? -1 : 1) });
    try {
      patch(await api.cheer(post.id));
    } catch {
      patch({ cheered: post.cheered, cheers: post.cheers });
    }
  }
  const B = ({ icon, n, on, label, onPress }: { icon: Parameters<typeof Icon>[0]['name']; n?: number; on?: boolean; label: string; onPress: () => void }) => (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.vBtn, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={label}>
      <View style={[styles.vCircle, on && { backgroundColor: 'rgba(255,255,255,0.9)' }]}><Icon name={icon} size={26} color={on ? colors.brand : '#fff'} /></View>
      {n ? <Text style={styles.vCount}>{n}</Text> : null}
    </Pressable>
  );
  return (
    <View style={styles.vBar}>
      <B icon="cheers" n={post.cheers} on={post.cheered} label={post.cheered ? 'Tirar o brinde' : 'Brindar'} onPress={() => void cheer()} />
      {full && (
        <>
          <B icon="comment" n={post.comments} label="Comentar" onPress={() => onOpen('comments')} />
          <B icon="repeat" n={post.reposts} on={post.reposted} label="Repostar" onPress={() => onOpen('repost')} />
          {!mine && post.canGift ? <B icon="present" n={post.gifts} label="Presentear" onPress={() => onOpen('gift')} /> : null}
          <B icon="share" label="Partilhar" onPress={() => onOpen('share')} />
        </>
      )}
    </View>
  );
}

/** Repost com comentário: a publicação original numa caixa com borda. */
function QuoteBox({ original, me, onPhoto, onOpen, onDouble }: { original: Post; me?: string; onPhoto: () => void; onOpen: (p: Post) => void; onDouble?: () => void }) {
  const router = useRouter();
  const tap = useTap(onDouble);
  const m = original.media[0];
  return (
    <Pressable onPress={() => onOpen(original)} style={styles.quote} accessibilityRole="link" accessibilityLabel="Abrir a publicação original">
      <Pressable onPress={() => router.push(profileOf(original.author, me) as never)} style={styles.quoteHead} accessibilityRole="link">
        <Avatar name={original.author.displayName} username={original.author.username} size={30} />
        <Text style={[styles.quoteName, { flexShrink: 1 }]} numberOfLines={1}>{original.author.displayName}</Text>
        {original.author.verified && <VerifiedBadge size={14} tier={original.author.verifiedTier} />}
        <Text style={styles.quoteTime}>· {timeAgo(original.createdAt)}</Text>
      </Pressable>
      {original.gift ? (
        <View style={{ marginHorizontal: 12, marginTop: 8 }}>
          <GiftCard post={original} g={original.gift} me={me} onDouble={onDouble} compact />
        </View>
      ) : null}
      {original.body && !original.gift ? <Text style={styles.quoteBody} numberOfLines={4}>{original.body}</Text> : null}
      {m?.kind === 'video' ? (
        <Pressable onPress={() => onOpen(original)} style={styles.quoteMedia} accessibilityRole="button" accessibilityLabel="Ver o vídeo">
          {m.posterUrl ? <Image source={{ uri: sized(m.posterUrl, 720) }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityIgnoresInvertColors /> : null}
          <View style={styles.playWrap} pointerEvents="none">
            <View style={styles.play}><Icon name="play" size={28} color="#fff" solid /></View>
          </View>
        </Pressable>
      ) : m ? (
        <Pressable onPress={() => tap(onPhoto)} style={[styles.quoteMedia, { height: 288 }]} accessibilityRole="button" accessibilityLabel="Ver a foto em ecrã inteiro">
          <Image source={{ uri: sized(m.url, 720) }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} accessibilityIgnoresInvertColors />
        </Pressable>
      ) : (
        <View style={{ height: 12 }} />
      )}
    </Pressable>
  );
}

/** O cartão do presente em si (degradê coral, as duas fotos, o valor e a mensagem). Também aparece dentro de um repost. */
function GiftCard({ post, g, me, onDouble, compact = false }: { post: Post; g: NonNullable<Post['gift']>; me?: string; onDouble?: () => void; compact?: boolean }) {
  const router = useRouter();
  const tap = useTap(onDouble);
  const sender = post.author;
  const rec = (g as unknown as GiftExtra).recipient;
  const go = (u: string) => router.push((u === (me ?? '') ? '/profile' : `/u/${u}`) as never);
  return (
    <Pressable onPress={() => tap()} style={[styles.giftCard, compact && { marginTop: 0, paddingTop: 16, paddingBottom: 14, borderRadius: 18 }]} accessibilityLabel="Presente (toca duas vezes para brindar)">
      <LinearGradient colors={[colors.brand, '#e8475f', '#ff8a5b']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={[styles.giftDot, { left: -24, top: -24, width: 96, height: 96, borderRadius: 48 }]} />
      <View style={[styles.giftDot, { right: -16, bottom: -32, width: 112, height: 112, borderRadius: 56 }]} />
      <View style={[styles.giftDot, { right: 32, top: 16, width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.5)' }]} />
      <View style={[styles.giftDot, { left: 40, top: 64, width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.4)' }]} />
      <View style={{ width: compact ? 104 : 132, height: compact ? 60 : 76, alignSelf: 'center' }}>
        <Pressable onPress={() => go(rec.username)} style={[styles.giftAva, { right: 0 }, compact && { borderRadius: 30, borderWidth: 3 }]} accessibilityLabel={`Perfil de ${rec.displayName}`}>
          <Avatar name={rec.displayName} username={rec.username} size={compact ? 52 : 68} />
        </Pressable>
        <Pressable onPress={() => go(sender.username)} style={[styles.giftAva, { left: 0, zIndex: 2 }, compact && { borderRadius: 30, borderWidth: 3 }]} accessibilityLabel={`Perfil de ${sender.displayName}`}>
          <Avatar name={sender.displayName} username={sender.username} size={compact ? 52 : 68} />
        </Pressable>
        <View style={[styles.giftBadge, compact && { left: 36, width: 30, height: 30, borderRadius: 15 }]}><Icon name="gift" size={20} color={colors.brand} /></View>
      </View>
      <View style={styles.giftLineRow}>
        <Text style={styles.giftLine} onPress={() => go(sender.username)}><Text style={{ fontWeight: '800' }}>{sender.displayName}</Text></Text>
        {sender.verified ? <VerifiedBadge size={15} tier={sender.verifiedTier} /> : null}
        <Text style={styles.giftLine}>presenteou</Text>
        <Text style={styles.giftLine} onPress={() => go(rec.username)}><Text style={{ fontWeight: '800' }}>{rec.displayName}</Text></Text>
        {rec.verified ? <VerifiedBadge size={15} tier={rec.verifiedTier} /> : null}
      </View>
      <Text style={[styles.giftAmount, compact && { fontSize: 30, lineHeight: 32 }]}>{g.amount.toLocaleString('pt-PT')}</Text>
      <Text style={styles.giftUnit}>TXILLS</Text>
      {post.body ? <Text style={styles.giftNote}>{post.body}</Text> : null}
    </Pressable>
  );
}

/** Cartão de presente (X presenteou Y): degradê coral, as duas fotos, o valor e a mensagem. Duplo toque também brinda. */
function GiftBlock({ post, g, me, onDouble, menu, onOpenPost }: { post: Post; g: NonNullable<Post['gift']>; me?: string; onDouble?: () => void; menu?: React.ReactNode; onOpenPost?: (p: Post) => void }) {
  return (
    <>
      <View style={styles.giftHead}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="gift" size={15} color={colors.brand} />
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.brand }}>Presente</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={{ fontSize: 14, color: colors.zinc500 }}>{timeAgo(post.createdAt)}{post.editedAt ? ' · editado' : ''}</Text>
          {menu}
        </View>
      </View>
      <GiftCard post={post} g={g} me={me} onDouble={onDouble} />
      {post.repostOf ? <GiftedPost original={post.repostOf} onOpen={onOpenPost} /> : null}
    </>
  );
}

/** A publicação que foi presenteada, dentro do cartão do presente (toca para a abrir). */
function GiftedPost({ original, onOpen }: { original: Post; onOpen?: (p: Post) => void }) {
  const m = original.media[0];
  const video = m?.kind === 'video';
  const thumb = m ? (video ? m.posterUrl : sized(m.url, 480)) : null;
  return (
    <Pressable onPress={() => onOpen?.(original)} style={({ pressed }) => [styles.gifted, pressed && { backgroundColor: '#fafafa' }]} accessibilityRole="link">
      <View style={styles.giftedHead}>
        <Avatar name={original.author.displayName} username={original.author.username} size={30} />
        <Text style={[styles.quoteName, { flexShrink: 1 }]} numberOfLines={1}>{original.author.displayName}</Text>
        <Text style={styles.quoteTime}>· {timeAgo(original.createdAt)}</Text>
      </View>
      {original.body ? <Text style={styles.quoteBody} numberOfLines={3}>{original.body}</Text> : null}
      {thumb ? (
        <View style={[styles.quoteMedia, { height: 224, backgroundColor: colors.zinc200 }]}>
          <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} accessibilityIgnoresInvertColors />
          {video && (
            <View style={styles.playWrap} pointerEvents="none">
              <View style={[styles.play, { width: 48, height: 48, borderRadius: 24 }]}><Icon name="play" size={24} color="#fff" solid /></View>
            </View>
          )}
        </View>
      ) : (
        <View style={{ height: 12 }} />
      )}
    </Pressable>
  );
}

/** Fotos e vídeos: arredondados (12), no máximo 448 de altura, com contador, pontos e pessoas identificadas. Tocar numa foto abre-a inteira. */
function Carousel({ media, width: guess, reelId, onDouble, onOpen }: { media: Post['media']; width: number; reelId?: string; onDouble?: () => void; onOpen?: (index: number) => void }) {
  const router = useRouter();
  const tap = useTap(onDouble);
  const [i, setI] = useState(0);
  const [showTags, setShowTags] = useState(false);
  // A largura real do carrossel (o cartão muda de margens no feed, na página da publicação e no computador):
  // cada foto ocupa exatamente uma página, senão aparecem bocados da seguinte.
  const [measured, setMeasured] = useState(0);
  const width = measured || guess;
  const list = useRef<FlatList<Post['media'][number]>>(null);
  // A largura mudou (janela redimensionada, rodar o ecrã): a foto atual volta a ficar alinhada.
  useEffect(() => {
    if (measured && i > 0) list.current?.scrollToOffset({ offset: i * measured, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measured]);
  if (media.length === 0) return null;
  const heightOf = (m: Post['media'][number]) => {
    const natural = m.width && m.height ? (width * m.height) / m.width : width;
    return Math.min(448, Math.max(120, natural));
  };
  const h = heightOf(media[i] ?? media[0]);
  const tags = media[i]?.tags ?? [];
  // Na web os eventos de "item visível" não disparam com a paginação: a página atual lê-se da posição do scroll.
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const n = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width));
    if (n !== i && n >= 0 && n < media.length) {
      setI(n);
      setShowTags(false);
    }
  };
  return (
    <View style={{ marginTop: 12 }}>
      <View onLayout={(e) => { const w = Math.round(e.nativeEvent.layout.width); if (w > 0 && Math.abs(w - measured) > 1) setMeasured(w); }} style={{ borderRadius: 12, overflow: 'hidden', height: h, backgroundColor: colors.zinc100 }}>
        <FlatList
          ref={list}
          data={media}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(m) => m.url}
          onScroll={onScroll}
          scrollEventThrottle={32}
          extraData={`${i}|${h}|${width}`}
          renderItem={({ item: m, index }) => m.kind === 'video' && media.length > 1 ? (
            // Carrossel com fotos e vídeos: o vídeo toca ali mesmo (uma tcheka, vídeo sozinho, abre no ecrã da Tcheka).
            <CarouselVideo url={m.url} poster={m.posterUrl} durationMs={m.durationMs} width={width} height={h} active={index === i} onDouble={onDouble} />
          ) : (
            <Pressable
              style={{ width, height: h }}
              onPress={() => tap(m.kind === 'video' ? (reelId ? () => router.push(`/r/${reelId}` as never) : undefined) : () => onOpen?.(index))}
              accessibilityRole="button"
              accessibilityLabel={m.kind === 'video' ? 'Abrir a tcheka' : `Ver a foto ${index + 1} de ${media.length} em ecrã inteiro (toca duas vezes para brindar)`}
            >
              <Image source={{ uri: sized(m.kind === 'video' ? m.posterUrl ?? m.url : m.url, 720) }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} accessibilityIgnoresInvertColors />
              {m.kind === 'video' && (
                <View style={styles.playWrap} pointerEvents="none">
                  <View style={styles.play}>
                    <Icon name="play" size={28} color="#fff" solid />
                  </View>
                </View>
              )}
            </Pressable>
          )}
        />
        {tags.length > 0 && (
          <>
            <Pressable onPress={() => setShowTags((v) => !v)} style={styles.tagsBtn} accessibilityRole="button" accessibilityLabel={`${tags.length} pessoa(s) identificadas`}>
              <Icon name="users" size={16} color="#fff" />
              <Text style={styles.counterText}>{tags.length}</Text>
            </Pressable>
            {showTags && (
              <View style={styles.tagsList}>
                {tags.map((t) => (
                  <Pressable key={t.username} onPress={() => router.push(`/u/${t.username}` as never)} style={styles.tagPill} accessibilityRole="link">
                    <Text style={styles.tagPillText}>@{t.username}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </>
        )}
        {media.length > 1 && (
          <View style={styles.counter} pointerEvents="none">
            <Text style={styles.counterText}>{i + 1}/{media.length}</Text>
          </View>
        )}
      </View>
      {media.length > 1 && (
        <View style={styles.dots}>
          {media.map((_, n) => (
            <View key={n} style={[styles.dot, { backgroundColor: n === i ? colors.brand : colors.zinc300 }]} />
          ))}
        </View>
      )}
    </View>
  );
}

/** Contadores em cima e, por baixo da linha, as ações com ícone e nome (Brindar, Comentar, Repostar, Presentear, Partilhar). */
function Actions({ post, mine, patch, open, people, onCheer }: { post: Post; mine: boolean; patch: (p: Partial<Post>) => void; open: (k: 'comments' | 'repost' | 'gift' | 'share') => void; people: (k: PeopleKind) => void; /** Brindou pelo botão: mostra a animação. */ onCheer?: () => void }) {
  const cheer = useMutation({
    mutationFn: () => api.cheer(post.id),
    onMutate: () => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (!post.cheered) onCheer?.();
      patch({ cheered: !post.cheered, cheers: post.cheers + (post.cheered ? -1 : 1) }); // responde já, confirma depois
    },
    onSuccess: (r) => patch(r),
    onError: () => patch({ cheered: post.cheered, cheers: post.cheers }),
  });
  const chips = [
    { kind: 'cheers' as const, n: post.cheers, icon: 'cheers' as const, label: post.cheers === 1 ? 'brinde' : 'brindes' },
    { kind: 'reposts' as const, n: post.reposts, icon: 'repeat' as const, label: post.reposts === 1 ? 'repost' : 'reposts' },
    { kind: 'gifts' as const, n: post.gifts, icon: 'present' as const, label: post.gifts === 1 ? 'presente' : 'presentes' },
  ].filter((c) => c.n > 0);
  // Só se pode ver quem foi se o dono deixar (e num repost só os brindes).
  const canSee = (k: PeopleKind) => (post.kind !== 'repost' || k === 'cheers') && !!post.lists?.[k];

  const Btn = ({ label, icon, onPress, color = colors.zinc800, size = 22, strokeWidth }: { label: string; icon: Parameters<typeof Icon>[0]['name']; onPress: () => void; color?: string; size?: number; strokeWidth?: number }) => (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.barBtn, pressed && { transform: [{ scale: 0.95 }] }]} accessibilityRole="button" accessibilityLabel={label}>
      <Icon name={icon} size={size} color={color} strokeWidth={strokeWidth} />
      <Text style={[styles.word, { color }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );

  return (
    <>
      <View style={styles.counts}>
        <View style={styles.chips}>
          {chips.map((c) =>
            canSee(c.kind) ? (
              <Pressable key={c.icon} onPress={() => people(c.kind)} style={({ pressed }) => [styles.chip, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={`${c.n} ${c.label}: ver quem`}>
                <Icon name={c.icon} size={18} color={colors.zinc700} />
                <Text style={styles.chipText}>{c.n}</Text>
              </Pressable>
            ) : (
              <View key={c.icon} style={styles.chip} accessibilityLabel={`${c.n} ${c.label}`}>
                <Icon name={c.icon} size={18} color={colors.zinc700} />
                <Text style={styles.chipText}>{c.n}</Text>
              </View>
            ),
          )}
        </View>
        {post.comments > 0 && (
          <Pressable onPress={() => open('comments')} hitSlop={6}>
            <Text style={styles.commentsCount}>{post.comments} {post.comments === 1 ? 'Comentário' : 'Comentários'}</Text>
          </Pressable>
        )}
      </View>
      <View style={styles.bar}>
        <Btn label={post.cheered ? 'Brindou' : 'Brindar'} icon="cheers" size={24} color={post.cheered ? colors.amber600 : colors.zinc800} onPress={() => cheer.mutate()} />
        <Btn label="Comentar" icon="comment" onPress={() => open('comments')} />
        <Btn label={post.reposted ? 'Repostado' : 'Repostar'} icon="repeat" color={post.reposted ? colors.green700 : colors.zinc800} onPress={() => open('repost')} />
        {!mine && post.canGift && <Btn label="Presentear" icon="present" onPress={() => open('gift')} />}
        <Btn label="Partilhar" icon="share" size={24} onPress={() => open('share')} />
      </View>
    </>
  );
}

export const PostCard = memo(PostCardBase);

const styles = StyleSheet.create({
  gone: { marginBottom: 20, borderRadius: 16, backgroundColor: colors.zinc100, paddingHorizontal: 16, paddingVertical: 12 },
  goneText: { textAlign: 'center', fontSize: 14, fontWeight: '600', color: colors.zinc600 },
  tagsBtn: { position: 'absolute', left: 12, bottom: 12, height: 32, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 10 },
  tagsList: { position: 'absolute', left: 12, right: 12, bottom: 56, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tagPill: { borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.75)', paddingHorizontal: 12, paddingVertical: 4 },
  tagPillText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  // Ações da foto em ecrã inteiro: fila vertical à direita, como na Tcheka.
  vBar: { alignItems: 'center', gap: 14 },
  vBtn: { alignItems: 'center', gap: 4 },
  vCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  vCount: { color: '#fff', fontSize: 13, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  quote: { marginTop: 12, overflow: 'hidden', borderRadius: 16, borderWidth: 1, borderColor: colors.zinc200 },
  quoteHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingTop: 12 },
  quoteName: { fontSize: 16, fontWeight: '600', color: colors.zinc900 },
  quoteTime: { fontSize: 14, color: colors.zinc500 },
  quoteGift: { marginHorizontal: 12, marginTop: 8, overflow: 'hidden', borderRadius: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  quoteGiftText: { fontSize: 18, fontWeight: '800', color: '#fff' },
  quoteBody: { paddingHorizontal: 12, paddingTop: 8, fontSize: 16, lineHeight: 24, color: colors.zinc800 },
  quoteMedia: { marginTop: 8, height: 256, overflow: 'hidden', backgroundColor: colors.zinc900 },
  gifted: { marginTop: 12, overflow: 'hidden', borderRadius: 16, borderWidth: 1, borderColor: colors.zinc200 },
  giftedHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingTop: 12 },
  giftLineRow: { marginTop: 16, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', columnGap: 4 },
  giftHead: { marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  giftCard: { marginTop: 8, overflow: 'hidden', borderRadius: 24, paddingHorizontal: 20, paddingTop: 24, paddingBottom: 20, alignItems: 'center', boxShadow: '0 6px 18px rgba(214,51,79,0.35)' },
  giftDot: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.1)' },
  giftAva: { position: 'absolute', top: 0, borderRadius: 38, borderWidth: 4, borderColor: 'rgba(255,255,255,0.9)' },
  giftBadge: { position: 'absolute', bottom: -4, left: 48, zIndex: 3, width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(0,0,0,0.2)' },
  giftLine: { fontSize: 16, lineHeight: 20, color: '#fff', textAlign: 'center' },
  giftAmount: { marginTop: 8, fontSize: 40, lineHeight: 40, fontWeight: '900', color: '#fff', letterSpacing: -1 },
  giftUnit: { fontSize: 13, fontWeight: '700', letterSpacing: 2.6, color: 'rgba(255,255,255,0.85)' },
  giftNote: { marginTop: 16, maxWidth: '92%', overflow: 'hidden', borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 16, paddingVertical: 10, fontSize: 16, lineHeight: 22, color: '#fff', textAlign: 'center' },
  card: { backgroundColor: colors.white, borderRadius: 26, paddingTop: 16, marginBottom: 20 },
  repostBar: { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 24, marginBottom: 6 },
  repostText: { fontSize: 14, fontWeight: '500', color: colors.zinc600, lineHeight: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontSize: 19, fontWeight: '500', color: colors.zinc800, lineHeight: 24 },
  handle: { fontSize: 15, color: colors.zinc500, lineHeight: 22 },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  loc: { fontSize: 15, color: colors.zinc600, lineHeight: 22, flexShrink: 1 },
  time: { fontSize: 15, color: colors.zinc500, alignSelf: 'flex-start', lineHeight: 22 },
  save: { width: 36, height: 40, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  more: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start', marginRight: -8 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  body: { marginTop: 16, fontSize: 19, lineHeight: 28.5, color: colors.zinc800 },
  playWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  play: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', paddingLeft: 3 },
  counter: { position: 'absolute', right: 12, top: 12, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  counterText: { color: '#fff', fontSize: 12, fontWeight: '600', lineHeight: 16 },
  dots: { marginTop: 8, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  counts: { marginTop: 12, minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  chips: { flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap', flexShrink: 1 },
  chip: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipText: { fontSize: 15, color: colors.zinc700 },
  commentsCount: { fontSize: 14, fontWeight: '500', color: colors.zinc700 },
  bar: { marginTop: 4, flexDirection: 'row', alignItems: 'stretch', borderTopWidth: 1, borderTopColor: colors.zinc200 },
  barBtn: { flex: 1, minHeight: 56, minWidth: 0, alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 2 },
  word: { fontSize: 13, fontWeight: '500', lineHeight: 16, maxWidth: '100%' },
});
