import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, FlatList, PixelRatio, Platform, Pressable, Share, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { api, isTcheka, type Page, type Post } from '@/lib/api';
import type { PeopleKind } from '@/lib/api.feed';
import { sized } from '@/lib/config';
import { carouselWindowProps, listImageProps } from '@/lib/listImage';
import { servedWidth } from '@/lib/photoSize';
import { clampPostRatio } from '@/lib/postAspect';
import { cardShadow, colors } from '@/lib/theme';
import { timeAgo } from '@/lib/time';
import { useIsPostVisible } from '@/lib/visiblePosts';
import { Avatar } from './Avatar';
import { BookmarkIcon } from './BookmarkIcon';
import { mergePost } from '@/lib/postPatch';
import { CarouselVideo } from './CarouselVideo';
import { CommentsSheet } from './CommentsSheet';
import { Icon } from './Icon';
import { PeopleSheet } from './PeopleSheet';
import { PhotoViewer } from './PhotoViewer';
import { viewerMedia } from '@/lib/viewerMedia';
import { RichText } from './RichText';
import { TeachBar } from './TeachBar';
import { QuotedOriginal, THREAD_AVATAR, THREAD_GAP } from './QuoteThread';
import { GiftSheet, PostMenuSheet, RepostSheet } from './PostSheets';
import { ShareSheet } from './ShareSheet';
import { MusicBadge, MusicCard } from './PostMusic';
import { musicPlacement, musicPlayback, soundHref, wavesOverMedia } from '@/lib/musicLook';
import { soundRemovedText } from '@/lib/sounds';
import { showRepostButton } from '@/lib/repost';
import { VerifiedBadge } from './VerifiedBadge';
import { NameWithBadge } from './NameWithBadge';
import { VenueLogo } from './VenueCard';
import { CheersPour } from './CheersPour';
import { CheeredByLine, CheeredFriends } from './CheeredBy';
import { cheeredByView, floatingCheerers } from '@/lib/cheeredBy';
import { GeleiraPostCard } from './GeleiraPostCard';
import { GeladaPostCard } from './gelada/GeladaPostCard';
import { RemixesLink, RemixTag, ReplyStickerOverlay } from './remix/RemixParts';
import { KIND_LABEL } from '@/lib/api.locais';
import { navTap } from '@/lib/tapGuard';
import { useDesktop } from '@/lib/desktop';
import { anchorOf, finePointer, isTypingTarget, overlayOpen, type Rect } from '@/lib/desktopKeys';
import { DEFAULT_TEXT_FONT, normTextFont, postFontSize } from '@/lib/textLayers';
import { useTextFontStyle } from '@/lib/useTextFonts';
import { vibesWord } from '@/lib/vibes';
import { HIDDEN_BANNER } from '@/lib/hidePost';
import { setPostHidden } from '@/lib/hidePostAction';
import { intlLocale, t } from '@/lib/i18n';

/**
 * A letra de uma publicação só com texto (`textFont`, lib/textLayers): o tamanho acertado à fonte (as de cartaz são
 * estreitas, a «À mão» pequena); a família vem de `useTextFontStyle(id)`, quando carregar. Clássica, desconhecida ou com
 * fotos: a letra de sempre (null).
 */
export function postBodyFont(post: Pick<Post, 'textFont' | 'media' | 'kind'> & { gelada?: unknown; geleira?: unknown }) {
  const f = normTextFont(post.textFont);
  if (f === DEFAULT_TEXT_FONT || post.kind !== 'post' || post.media.length > 0 || post.gelada || post.geleira) return null;
  return { id: f, size: postFontSize(f, 19) };
}

/** Abre um ecrã, mas só uma vez: dois toques rápidos no cartão já não empilham dois ecrãs iguais. */
const pushOnce = (router: ReturnType<typeof useRouter>, to: string) => { if (navTap(to)) router.push(to as never); };

type Hover = { pressed: boolean; hovered?: boolean };
/** Dica do browser (title) nos botões só com ícone: só na web. */
const tip = (t: string) => (finePointer() ? ({ dataSet: { tip: t } } as object) : null);
/** O botão direito num campo, numa ligação ou com texto selecionado fica com o menu do browser (copiar, abrir noutro separador). */
function contextMenuIsBrowser(target: unknown): boolean {
  if (typeof window === 'undefined') return true;
  const sel = window.getSelection?.();
  if (sel && !sel.isCollapsed && String(sel).trim()) return true;
  for (let el = target as HTMLElement | null, k = 0; el && k < 12; el = el.parentElement, k++) {
    if (isTypingTarget(el) || el.tagName === 'A' || el.tagName === 'VIDEO') return true;
  }
  return false;
}

/** Toque simples ou duplo: o duplo chama `double`; o simples só corre (com um pequeno atraso) se não vier segundo toque. */
function useTap(double?: () => void) {
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDouble = useRef(0);
  useEffect(() => () => { if (t.current) clearTimeout(t.current); }, []);
  const run = (single?: () => void) => {
    if (!double) return single?.();
    if (t.current != null) {
      clearTimeout(t.current);
      t.current = null;
      lastDouble.current = Date.now();
      double();
      return;
    }
    t.current = setTimeout(() => {
      t.current = null;
      single?.();
    }, 260);
  };
  /** O `dblclick` do DOM (computador): o mesmo duplo toque, sem contar duas vezes se o 2.º clique já chegou. */
  run.dbl = () => {
    if (!double || Date.now() - lastDouble.current < 500) return;
    if (t.current != null) { clearTimeout(t.current); t.current = null; }
    lastDouble.current = Date.now();
    double();
  };
  return run;
}

/**
 * Uma zona que brinda com o duplo toque (o cartão da geleira partilhada): no telemóvel dois toques seguidos, no computador o
 * duplo clique. Os toques nos gostos lá dentro continuam a ser deles (brindar esse gosto); o duplo toque no resto brinda o post.
 */
function DoubleTapArea({ onDouble, label, children }: { onDouble: () => void; label: string; children: ReactNode }) {
  const tap = useTap(onDouble);
  const tapRef = useRef(tap);
  tapRef.current = tap;
  const dblRef = useCallback((node: unknown) => {
    const el = node as HTMLElement | null;
    if (!el || typeof el.addEventListener !== 'function') return;
    el.addEventListener('dblclick', (e) => { e.preventDefault(); tapRef.current.dbl(); });
  }, []);
  return (
    <Pressable ref={Platform.OS === 'web' ? (dblRef as never) : undefined} onPress={() => tap()} accessibilityLabel={label} accessibilityHint={t('Toca duas vezes para brindar')}>
      {children}
    </Pressable>
  );
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
    // Todas as listas em memória que tenham esta publicação (ver lib/postPatch).
    for (const q of qc.getQueryCache().getAll()) {
      const d = q.state.data;
      if (d === undefined) continue;
      const next = mergePost(d, id, p as Record<string, unknown>);
      if (next !== d) qc.setQueryData(q.queryKey, next);
    }
  };
}

/** O cartão de uma publicação, igual ao do site: cantos de 26, sombra suave, autor, texto, fotos e a barra de ações. */
/** Destaque pago (Bombar): a etiqueta por cima do cartão, lida pelo leitor de ecrã, e o aviso de que tocaram nele. */
export interface SponsoredInfo {
  label: string;
  /** O que o leitor de ecrã diz (a etiqueta e quem paga). */
  a11y: string;
  onOpen?: () => void;
}

function PostCardBase({ post, me, detail, openComments, highlightComment, sponsored, myRepost }: { post: Post; me?: string; /** O meu repost simples que mostra esta publicação: no menu dá para o ocultar (0169). */ myRepost?: Pick<Post, 'id' | 'hidden'> | null; /** Já estamos na página desta publicação: tocar no cartão não a volta a abrir. */ detail?: boolean; /** Abre logo os comentários (vindo de uma notificação), realçando `highlightComment`. */ openComments?: boolean; highlightComment?: string; /** Destaque pago do Bombar (com a etiqueta "Patrocinado"). */ sponsored?: SponsoredInfo }) {
  const router = useRouter();
  // A música do post toca enquanto ele está à vista neste ecrã (e o ecrã está à frente); pára ao sair.
  const inList = useIsPostVisible(post.id);
  const [focused, setFocused] = useState(true);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  const musicOn = focused && (!!detail || inList);
  const width = Math.min(useWindowDimensions().width, 576);
  if (post.kind === 'repost' && post.repostOf && !post.body) {
    // "↻ Ana repostou" discreto por cima do cartão: o ícone encostado à direita da coluna do avatar, o texto alinhado com o nome.
    const edge = (width >= 360 ? 8 : 6) + (width >= 360 ? 16 : 14);
    const inner = post.repostOf;
    const col = inner.kind === 'repost' && inner.body ? THREAD_AVATAR : 52;
    return (
      <View>
        <View style={[styles.repostBar, { marginLeft: edge }]}>
          <View style={{ width: col, alignItems: 'flex-end' }}>
            <Icon name="repeat" size={15} color={colors.zinc500} strokeWidth={2} />
          </View>
          <Pressable onPress={() => pushOnce(router, profileOf(post.author, me))} accessibilityRole="link" style={{ flexShrink: 1 }}>
            {post.author.id === me
              ? <Text style={styles.repostText} numberOfLines={1}>{t('Repostaste')}</Text>
              : <NameWithBadge name={post.author.displayName} who={post.author} style={styles.repostText}><Text style={[styles.repostText, { flexShrink: 0 }]}>{t('repostou')}</Text></NameWithBadge>}
          </Pressable>
        </View>
        <PostCard post={post.repostOf} me={me} myRepost={post.author.id === me ? post : null} />
      </View>
    );
  }
  return <PostBody post={post} me={me} detail={detail} openComments={openComments} highlightComment={highlightComment} musicOn={musicOn} sponsored={sponsored} myRepost={myRepost} />;
}

type SheetState = null | 'menu' | 'comments' | 'repost' | 'share' | { gift: { username: string; displayName: string; amount?: number; note?: string } } | { people: PeopleKind };
type GiftExtra = { recipient: { username: string; displayName: string; verified?: boolean; verifiedTier?: 'verified' | 'official' | 'paid' | null } };

function PostBody({ post, me, detail, openComments, highlightComment, musicOn = false, sponsored, myRepost = null }: { myRepost?: Pick<Post, 'id' | 'hidden'> | null; post: Post; me?: string; detail?: boolean; openComments?: boolean; highlightComment?: string; /** O post está à vista: a música toca. */ musicOn?: boolean; sponsored?: SponsoredInfo }) {
  // No computador a app vive numa coluna de 576 ao centro: as medidas saem dela, não da janela.
  const width = Math.min(useWindowDimensions().width, 576);
  const router = useRouter();
  const qc = useQueryClient();
  const patch = usePatch(post.id);
  const { burst, brindar, celebrate } = useBrindar(post, patch);
  const tapText = useTap(() => void brindar());
  const bodyFont = postBodyFont(post);
  const bodyFace = useTextFontStyle(bodyFont?.id);
  // Tocar na publicação (fora de botões, ligações e fotos) abre a página dela; num repost com comentário abre o repost (com a original por baixo).
  const goPost = () => { if (!detail) { sponsored?.onOpen?.(); openPost(post); } };
  const mine = post.author.id === me;
  const margin = width >= 360 ? 8 : 6;
  const pad = width >= 360 ? 16 : 14;
  const inner = width - margin * 2 - pad * 2;
  const [sheet, setSheet] = useState<SheetState>(openComments ? 'comments' : null);
  // Computador: o «⋯» abre um menu pendente junto a ele; o botão direito no cartão abre o mesmo menu junto ao rato.
  const desktop = useDesktop();
  const [menuAt, setMenuAt] = useState<Rect | null>(null);
  const [hot, setHot] = useState(false);
  const openMenu = (at: Rect | null) => { setMenuAt(at); setSheet('menu'); };
  // Telemóvel: segurar no cartão (no texto ou nas fotos) abre o mesmo menu do «⋯». No computador há o botão direito.
  const hold = desktop ? undefined : () => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined); openMenu(null); };
  const [gone, setGone] = useState(false);
  // Foto em ecrã inteiro: `of` é a publicação cujas fotos se veem (a original, num repost com comentário).
  const [viewer, setViewer] = useState<null | { of: Post; start: number }>(null);
  const [viewerBurst, setViewerBurst] = useState(0);
  // Repost com comentário (citação): em "fio", a original em cima (ou o aviso de que já não está disponível) e quem citou por baixo.
  const quote = post.kind === 'repost' && !!post.body && !post.gift;
  const g = post.gift;
  const goAuthor = () => pushOnce(router, profileOf(post.author, me));
  const goVenue = () => { if (!post.venue) return; sponsored?.onOpen?.(); if (navTap(`/v/${post.venue.slug}`)) router.push({ pathname: '/v/[slug]', params: { slug: post.venue.slug } }); };
  const openPost = (o: Post) => pushOnce(router, isTcheka(o) ? `/r/${o.code ?? o.id}` : `/p/${o.code ?? o.id}`);

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
        <Text style={styles.goneText}>{t('Ok, vamos mostrar menos disto.')}</Text>
      </View>
    );
  }

  const menuBtn = (
    <Pressable onPress={(e) => openMenu(anchorOf(e))} hitSlop={6} style={(st) => [styles.more, (st as Hover).hovered && styles.iconHover]} accessibilityRole="button" accessibilityLabel={t('Mais opções da publicação')} {...tip(t('Mais opções'))}>
      <Icon name="more" size={24} />
    </Pressable>
  );
  const giftTo = { username: post.author.username, displayName: post.author.displayName };

  return (
    <Pressable
      onPress={goPost}
      onLongPress={hold}
      accessible={false}
      style={[styles.card, cardShadow, { marginHorizontal: margin, paddingHorizontal: pad }, desktop && hot && styles.cardHot]}
      {...(desktop ? {
        // DOM (mouseenter/leave): o hover do Pressable não chega ao cartão quando o rato está por cima de um filho clicável.
        onMouseEnter: () => setHot(true),
        onMouseLeave: () => setHot(false),
        // Botão direito: o menu da publicação junto ao rato (no texto selecionado, nas ligações e nos campos fica o do browser).
        onContextMenu: (e: { preventDefault: () => void; clientX?: number; clientY?: number; nativeEvent?: { clientX?: number; clientY?: number }; target?: unknown }) => {
          if (contextMenuIsBrowser(e.target)) return;
          e.preventDefault();
          const x = e.nativeEvent?.clientX ?? e.clientX ?? 0;
          const y = e.nativeEvent?.clientY ?? e.clientY ?? 0;
          openMenu({ x, y, w: 0, h: 0 });
        },
      } : null)}
    >
      {sponsored ? (
        <View style={styles.sponsored} accessible accessibilityRole="text" accessibilityLabel={sponsored.a11y}>
          <Icon name="flame" size={14} color={colors.brand} />
          <Text style={styles.sponsoredText}>{sponsored.label}</Text>
        </View>
      ) : null}
      {post.hidden && mine ? (
        // Oculta (0169): só o autor a vê assim; um toque volta a mostrá-la (no mesmo sítio, com tudo o que tinha).
        <View style={styles.hiddenBar} accessibilityRole="text">
          <Icon name="eye-off" size={16} color={colors.zinc600} />
          <Text style={styles.hiddenText} numberOfLines={2}>{HIDDEN_BANNER()}</Text>
          <Pressable onPress={() => void setPostHidden(qc, post, false)} hitSlop={8} style={(s) => [styles.hiddenBtn, (s as Hover).pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={t('Voltar a mostrar a publicação')}>
            <Text style={styles.hiddenBtnText}>{t('Voltar a mostrar')}</Text>
          </Pressable>
        </View>
      ) : null}
      {g ? (
        <GiftBlock post={post} g={g} me={me} onDouble={() => void brindar()} menu={menuBtn} onOpenPost={openPost} />
      ) : quote ? (
        <>
          <QuotedOriginal original={post.repostOf ?? null} me={me} onOpen={openPost} onPhoto={(o) => setViewer({ of: o, start: 0 })} onDouble={() => void brindar()} />
          <View style={styles.qHead}>
            {post.venue ? (
              <Pressable onPress={goVenue} accessibilityRole="link" accessibilityLabel={t('Página de {name}', { name: post.venue.name })}>
                <VenueLogo venue={post.venue} size={THREAD_AVATAR} />
              </Pressable>
            ) : (
              <Pressable onPress={goAuthor} accessibilityRole="link" accessibilityLabel={t('Perfil de {displayName}', { displayName: post.author.displayName })}>
                <Avatar name={post.author.displayName} username={post.author.username} size={THREAD_AVATAR} />
              </Pressable>
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Pressable onPress={post.venue ? goVenue : goAuthor} style={styles.nameRow} accessibilityRole="link">
                <Text style={[styles.qName, { flexShrink: 1 }]} numberOfLines={1}>{post.venue ? post.venue.name : post.author.displayName}</Text>
                {post.venue ? (post.venue.verified && <VerifiedBadge size={15} tier="verified" />) : (post.author.verified && <VerifiedBadge size={15} tier={post.author.verifiedTier} />)}
              </Pressable>
              <Text style={styles.qMeta} numberOfLines={1}>
                {post.venue ? t('página') : `@${post.author.username}`} · {timeAgo(post.createdAt)}
                {post.editedAt ? (' ' + t('· editado')) : ''}
              </Text>
            </View>
            {menuBtn}
          </View>
          <Pressable onPress={() => tapText(goPost)} onLongPress={hold} accessibilityLabel={t('Abrir a publicação (duplo toque para brindar)')}>
            <RichText text={post.body} style={styles.qBody} />
          </Pressable>
        </>
      ) : (
        <>
          <View style={styles.header}>
            {post.venue ? (
              // Publicada como um local: a página é a voz (logótipo, nome e selo); quem publicou fica por trás.
              <Pressable onPress={goVenue} accessibilityRole="link" accessibilityLabel={t('Página de {name}', { name: post.venue.name })}>
                <VenueLogo venue={post.venue} size={52} />
              </Pressable>
            ) : (
              <Pressable onPress={goAuthor} accessibilityRole="link" accessibilityLabel={t('Perfil de {displayName}', { displayName: post.author.displayName })}>
                <Avatar name={post.author.displayName} username={post.author.username} size={52} />
              </Pressable>
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Pressable onPress={post.venue ? goVenue : goAuthor} style={styles.nameRow} accessibilityRole="link">
                <Text style={[styles.name, { flexShrink: 1 }]} numberOfLines={1}>{post.venue ? post.venue.name : post.author.displayName}</Text>
                {post.venue ? (post.venue.verified && <VerifiedBadge size={16} tier="verified" />) : (post.author.verified && <VerifiedBadge size={16} tier={post.author.verifiedTier} />)}
              </Pressable>
              {post.venue ? (
                <Text style={styles.handle} numberOfLines={1}>{t('{kindLabel} · página', { kindLabel: KIND_LABEL[post.venue.kind] ?? t('Local') })}</Text>
              ) : post.locationLabel ? (
                <Pressable onPress={() => pushOnce(router, `/place/${encodeURIComponent(post.locationLabel as string)}`)} style={styles.locRow} accessibilityRole="link">
                  <Icon name="map-pin" size={14} color={colors.zinc600} />
                  <Text style={styles.loc} numberOfLines={1}>{post.locationLabel}</Text>
                </Pressable>
              ) : (
                <Text style={styles.handle} numberOfLines={1}>@{post.author.username}</Text>
              )}
            </View>
            <Text style={styles.time}>
              {timeAgo(post.createdAt)}
              {post.editedAt ? (' ' + t('· editado')) : ''}
            </Text>
            <Pressable onPress={() => void toggleSave()} hitSlop={6} style={(st) => [styles.save, (st as Hover).hovered && styles.iconHover]} accessibilityRole="button" accessibilityLabel={post.saved ? t('Tirar dos guardados') : t('Guardar')} {...tip(post.saved ? t('Tirar dos guardados') : t('Guardar'))}>
              <BookmarkIcon on={!!post.saved} size={24} />
            </Pressable>
            {menuBtn}
          </View>
          {post.body ? (
            <Pressable onPress={() => tapText(goPost)} onLongPress={hold} accessibilityLabel={t('Abrir a publicação (duplo toque para brindar)')}>
              <RichText text={post.body} style={bodyFont ? [styles.body, bodyFont.size, bodyFace] : styles.body} customFont={!!bodyFont} />
            </Pressable>
          ) : null}
        </>
      )}
      {/* Dueto ou resposta com tcheka: «Dueto com @x» leva ao original. O som já vem no vídeo (o original e a voz): a música
          da publicação fica só como ligação ao som (a etiqueta), sem tocar por cima nem calar o vídeo. */}
      {post.remixOf ? <View style={{ paddingBottom: 8 }}><RemixTag remix={post.remixOf} dark={false} /></View> : null}
      {/* A música: o cartão completo nas publicações só com texto; com fotos ou vídeo, o selo por cima da imagem. */}
      {post.music && musicPlacement(post) === 'card' ? <MusicCard track={post.music} visible={musicOn} soundTo={soundHref(post as { sound?: unknown })} /> : null}
      {/* A geleira partilhada (0143): o frigorífico com os gostos; tocar num gosto brinda-o, o botão Brindar brinda o post todo. */}
      {/* «Paga-me uma» publicado (0145): a bebida, quem foi identificado e o estado de cada um; os botões só para quem foi identificado. */}
      {!quote && post.gelada ? (
        <DoubleTapArea onDouble={() => void brindar()} label={t('Pedido de gelada (toca duas vezes para brindar)')}>
          <GeladaPostCard post={post} onOpen={detail ? undefined : goPost} />
          <CheersPour n={burst} size={Math.min(200, inner * 0.55)} />
        </DoubleTapArea>
      ) : !quote && post.geleira ? (
        <DoubleTapArea onDouble={() => void brindar()} label={t('Geleira (toca duas vezes para brindar)')}>
          <GeleiraPostCard post={post} me={me} detail={detail} onOpen={goPost} />
          <CheersPour n={burst} size={Math.min(200, inner * 0.55)} />
        </DoubleTapArea>
      ) : !quote && post.media.length ? (
        // O brinde aparece no meio da foto ou do vídeo. Com a música já gravada no vídeo (`musicBaked`), o vídeo toca com o som
        // dele e o selo fica só com o crédito (sem a tocar outra vez por cima).
        <View>
          <Carousel media={post.media} width={inner} reelId={post.code ?? post.id} inView={musicOn} covered={!!viewer} mute={musicPlayback(post).muteVideo} onDouble={() => void brindar()} onOpen={(start) => setViewer({ of: post, start })} onHold={hold} overlay={mediaOverlay(post, musicOn, () => setSheet({ people: 'cheers' }))} />
          <ReplyStickerOverlay remix={post.remixOf} />
          {/* O som que a tcheka usava foi tirado: o vídeo fica sem som e diz porquê. */}
          {soundRemovedText(post.soundRemoved) ? <View style={{ position: 'absolute', left: 10, bottom: 10, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 10, paddingVertical: 5 }} pointerEvents="none"><Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>♪ {soundRemovedText(post.soundRemoved)}</Text></View> : null}
          <CheersPour n={burst} size={Math.min(220, inner * 0.6)} />
        </View>
      ) : (
        <CheersPour n={burst} size={Math.min(200, inner * 0.55)} />
      )}
      <Actions hot={desktop && hot} post={post} mine={mine} patch={patch} onCheer={celebrate} open={(k) => setSheet(k === 'gift' ? { gift: giftTo } : k)} people={(k) => setSheet({ people: k })} />
      {/* Aberta: «Duetos e respostas» (ou «Fazer dueto» numa tcheka que ainda não tem nenhum). */}
      {detail ? <RemixesLink post={post} /> : null}
      {/* Publicações que o algoritmo te mostra (de quem não segues): ensina o que queres ver. */}
      {post.feed?.source === 'discover' && !mine ? <TeachBar postId={post.id} onNo={() => setGone(true)} /> : null}
      {viewer && (
        <PhotoViewer
          // Todos os itens pela ordem da publicação (fotos e vídeos): o contador e o item onde abre contam com os vídeos.
          photos={viewerMedia(viewer.of.media)}
          start={viewer.start}
          author={viewer.of.author}
          body={viewer.of.body}
          music={viewer.of.music}
          muteVideo={musicPlayback(viewer.of).muteVideo}
          onClose={() => setViewer(null)}
          burst={viewerBurst}
          footer={
            <ViewerBar
              post={livePost(post, viewer.of)}
              onCheered={() => setViewerBurst((n) => n + 1)}
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
      {sheet === 'menu' && <PostMenuSheet post={post} mine={mine} anchor={desktop ? menuAt : null} myRepost={myRepost} onClose={() => setSheet(null)} onSaved={(saved) => patch({ saved })} onShare={() => setSheet('share')} />}
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

/** Barra de ações por baixo da foto em ecrã inteiro: brindar, comentar, repostar, oferecer vibes (as outras fecham a foto e abrem a folha). */
/**
 * O visor guarda a publicação de quando abriu. Os brindes (e o resto) atualizam a publicação da lista, por isso a barra do
 * visor lê sempre a versão atual: a própria, ou a original de um repost. Sem isto, brindar parecia não fazer nada e o
 * segundo toque tirava o brinde do primeiro.
 */
export function livePost(current: Post, opened: Post): Post {
  if (opened.id === current.id) return current;
  if (current.repostOf && opened.id === current.repostOf.id) return current.repostOf;
  return opened;
}

function ViewerBar({ post, full, mine, onOpen, onCheered }: { post: Post; full: boolean; mine: boolean; onOpen: (k: 'comments' | 'repost' | 'gift' | 'share') => void; /** Brindou (não ao tirar o brinde): os copos no meio da foto. */ onCheered?: () => void }) {
  const patch = usePatch(post.id);
  // O estado do brinde fica aqui também: o visor pode ter aberto a partir de uma lista que o patch não atualiza
  // (pesquisa, hashtags, guardados…). Acompanha a publicação quando ela muda por fora.
  const [mine2, setMine2] = useState({ cheered: post.cheered, cheers: post.cheers });
  useEffect(() => setMine2({ cheered: post.cheered, cheers: post.cheers }), [post.cheered, post.cheers]);
  const busy = useRef(false);
  async function cheer() {
    if (busy.current) return;
    busy.current = true;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    const before = mine2;
    const next = { cheered: !before.cheered, cheers: Math.max(0, before.cheers + (before.cheered ? -1 : 1)) };
    setMine2(next);
    patch(next);
    if (next.cheered) onCheered?.();
    try {
      const r = await api.cheer(post.id);
      setMine2({ cheered: r.cheered, cheers: r.cheers });
      patch(r);
    } catch {
      setMine2(before);
      patch(before);
    } finally {
      busy.current = false;
    }
  }
  const B = ({ icon, n, on, label, onPress }: { icon: Parameters<typeof Icon>[0]['name']; n?: number; on?: boolean; label: string; onPress: () => void }) => (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.vBtn, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={label}>
      <View style={[styles.vCircle, on && { backgroundColor: 'rgba(255,255,255,0.9)' }]}><Icon name={icon} size={28}color={on ? colors.brand : '#fff'} /></View>
      {n ? <Text style={styles.vCount}>{n}</Text> : null}
    </Pressable>
  );
  return (
    <View style={styles.vBar}>
      <B icon="cheers" n={mine2.cheers} on={mine2.cheered} label={mine2.cheered ? t('Tirar o brinde') : t('Brindar')} onPress={() => void cheer()} />
      {full && (
        <>
          <B icon="comment" n={post.comments} label={t('Comentar')} onPress={() => onOpen('comments')} />
          {showRepostButton(post) ? <B icon="repeat" n={post.reposts} on={post.reposted} label={t('Repostar')} onPress={() => onOpen('repost')} /> : null}
          {!mine && post.canGift ? <B icon="gift" n={post.gifts} label={t('Oferecer vibes')} onPress={() => onOpen('gift')} /> : null}
          <B icon="share" label={t('Partilhar')} onPress={() => onOpen('share')} />
        </>
      )}
    </View>
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
    <Pressable onPress={() => tap()} style={[styles.giftCard, compact && { marginTop: 0, paddingTop: 16, paddingBottom: 14, borderRadius: 18 }]} accessibilityLabel={t('Presente (toca duas vezes para brindar)')}>
      <LinearGradient colors={[colors.brand, '#e8475f', '#ff8a5b']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={[styles.giftDot, { left: -24, top: -24, width: 96, height: 96, borderRadius: 48 }]} />
      <View style={[styles.giftDot, { right: -16, bottom: -32, width: 112, height: 112, borderRadius: 56 }]} />
      <View style={[styles.giftDot, { right: 32, top: 16, width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.5)' }]} />
      <View style={[styles.giftDot, { left: 40, top: 64, width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.4)' }]} />
      <View style={{ width: compact ? 104 : 132, height: compact ? 60 : 76, alignSelf: 'center' }}>
        <Pressable onPress={() => go(rec.username)} style={[styles.giftAva, { right: 0 }, compact && { borderRadius: 30, borderWidth: 3 }]} accessibilityLabel={t('Perfil de {displayName}', { displayName: rec.displayName })}>
          <Avatar name={rec.displayName} username={rec.username} size={compact ? 52 : 68} />
        </Pressable>
        <Pressable onPress={() => go(sender.username)} style={[styles.giftAva, { left: 0, zIndex: 2 }, compact && { borderRadius: 30, borderWidth: 3 }]} accessibilityLabel={t('Perfil de {displayName}', { displayName: sender.displayName })}>
          <Avatar name={sender.displayName} username={sender.username} size={compact ? 52 : 68} />
        </Pressable>
        <View style={[styles.giftBadge, compact && { left: 36, width: 30, height: 30, borderRadius: 15 }]}><Icon name="gift" size={20} color={colors.brand} /></View>
      </View>
      <View style={styles.giftLineRow}>
        <Text style={styles.giftLine} onPress={() => go(sender.username)}><Text style={{ fontWeight: '800' }}>{sender.displayName}</Text></Text>
        {sender.verified ? <VerifiedBadge size={15} tier={sender.verifiedTier} /> : null}
        <Text style={styles.giftLine}>{t('ofereceu a')}</Text>
        <Text style={styles.giftLine} onPress={() => go(rec.username)}><Text style={{ fontWeight: '800' }}>{rec.displayName}</Text></Text>
        {rec.verified ? <VerifiedBadge size={15} tier={rec.verifiedTier} /> : null}
      </View>
      <Text style={[styles.giftAmount, compact && { fontSize: 30, lineHeight: 32 }]}>{g.amount.toLocaleString(intlLocale())}</Text>
      <Text style={styles.giftUnit}>{vibesWord(g.amount).toUpperCase()}</Text>
      {post.body ? <Text style={styles.giftNote}>{post.body}</Text> : null}
    </Pressable>
  );
}

/** Cartão de presente (X ofereceu a Y): degradê coral, as duas fotos, o valor e a mensagem. Duplo toque também brinda. */
function GiftBlock({ post, g, me, onDouble, menu, onOpenPost }: { post: Post; g: NonNullable<Post['gift']>; me?: string; onDouble?: () => void; menu?: React.ReactNode; onOpenPost?: (p: Post) => void }) {
  return (
    <>
      <View style={styles.giftHead}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="gift" size={15} color={colors.brand} />
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.brand }}>{t('Presente')}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={{ fontSize: 14, color: colors.zinc500 }}>{timeAgo(post.createdAt)}{post.editedAt ? (' ' + t('· editado')) : ''}</Text>
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
        <NameWithBadge name={original.author.displayName} who={original.author} style={styles.quoteName} containerStyle={{ flexShrink: 1 }} />
        <Text style={styles.quoteTime}>· {timeAgo(original.createdAt)}</Text>
      </View>
      {original.body ? <Text style={styles.quoteBody} numberOfLines={3}>{original.body}</Text> : null}
      {thumb ? (
        <View style={[styles.quoteMedia, { height: 224, backgroundColor: colors.zinc200 }]}>
          <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} contentFit="cover" {...listImageProps(Platform.OS, 150)} accessibilityIgnoresInvertColors />
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

/** Fotos e vídeos: arredondados (12), na proporção da primeira (entre 4:5 e 1,91:1), com contador, pontos e pessoas identificadas. Tocar numa foto abre-a inteira. */
/**
 * Por cima da foto ou do vídeo, no canto de baixo à esquerda: o selo da música e, acima dele, os meus amigos próximos que
 * brindaram (a flutuar; tocar abre «Quem brindou»). Sem nenhum dos dois: nada (as pessoas identificadas ficam à esquerda).
 */
function mediaOverlay(post: Post, musicOn: boolean, openCheers: () => void): ReactNode {
  const music = post.music && !post.remixOf ? <MusicBadge track={post.music} visible={musicOn} waves={wavesOverMedia(post.media)} play={musicPlayback(post).apart} soundTo={soundHref(post as { sound?: unknown })} /> : null;
  const above = !!music || !!soundRemovedText(post.soundRemoved);
  const friends = floatingCheerers(post).users.length ? <CheeredFriends post={post} onOpen={openCheers} style={above ? { bottom: 12 + 34 + 10 } : undefined} /> : null;
  if (!music && !friends) return undefined;
  return <>{music}{friends}</>;
}

function Carousel({ media, width: guess, reelId, onDouble, onOpen, onHold, inView = false, covered = false, mute = false, overlay }: { media: Post['media']; width: number; reelId?: string; onDouble?: () => void; onOpen?: (index: number) => void; /** Segurar numa foto: o menu da publicação. */ onHold?: () => void; /** O post está à vista: os vídeos arrancam sozinhos. */ inView?: boolean; /** O visor em ecrã inteiro está aberto por cima: os vídeos daqui param e largam o leitor (só um ativo). */ covered?: boolean; /** O post tem música: os vídeos ficam sem som. */ mute?: boolean; /** Por cima das fotos e por baixo dos controlos: o selo e as ondas da música (o selo no canto de baixo à esquerda). */ overlay?: ReactNode }) {
  const router = useRouter();
  const tap = useTap(onDouble);
  const winH = useWindowDimensions().height;
  const [i, setI] = useState(0);
  const [showTags, setShowTags] = useState(false);
  // A largura real do carrossel (o cartão muda de margens no feed, na página da publicação e no computador):
  // cada foto ocupa exatamente uma página, senão aparecem bocados da seguinte.
  const [measured, setMeasured] = useState(0);
  const width = measured || guess;
  const list = useRef<FlatList<Post['media'][number]>>(null);
  // Computador: setas ‹ › por cima da foto ao passar o rato, e ←/→ do teclado enquanto o rato está por cima.
  const desktop = useDesktop();
  const [over, setOver] = useState(false);
  const cur = useRef({ i, n: media.length, width });
  cur.current = { i, n: media.length, width };
  // Duplo clique (computador): brinda, também quando o browser não passa o 2.º clique ao Pressable.
  const tapRef = useRef(tap);
  tapRef.current = tap;
  const dblRef = useCallback((node: unknown) => {
    const el = node as HTMLElement | null;
    if (!el || typeof el.addEventListener !== 'function') return;
    el.addEventListener('dblclick', (e) => { e.preventDefault(); tapRef.current.dbl(); });
  }, []);
  const goTo = useCallback((n: number) => {
    const c = cur.current;
    const k = Math.max(0, Math.min(c.n - 1, n));
    if (k === c.i) return;
    list.current?.scrollToOffset({ offset: k * c.width, animated: true });
    setI(k);
    setShowTags(false);
  }, []);
  useEffect(() => {
    if (!desktop || !over || media.length < 2 || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target as HTMLElement) || overlayOpen()) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(cur.current.i - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); goTo(cur.current.i + 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [desktop, over, media.length, goTo]);
  // A largura mudou (janela redimensionada, rodar o ecrã): a foto atual volta a ficar alinhada.
  useEffect(() => {
    if (measured && i > 0) list.current?.scrollToOffset({ offset: i * measured, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measured]);
  if (media.length === 0) return null;
  // Como no Instagram: a caixa tem a proporção da PRIMEIRA foto, limitada entre 4:5 e 1,91:1, e é a mesma para todas as
  // páginas (a altura não salta ao deslizar); cada foto preenche-a (cover, centrada). A largura já vem limitada pela coluna
  // de 576 do computador; o teto pela altura da janela só pesa em janelas baixas (telemóvel deitado), para a foto caber à vista.
  const first = media[0];
  const h = Math.round(Math.min(width / clampPostRatio(first.width, first.height), Math.max(320, winH * 0.8)));
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
      <View
        onLayout={(e) => { const w = Math.round(e.nativeEvent.layout.width); if (w > 0 && Math.abs(w - measured) > 1) setMeasured(w); }}
        style={[{ borderRadius: 12, overflow: 'hidden', height: h, backgroundColor: colors.zinc100 }, desktop && ({ userSelect: 'none' } as object)]}
        {...(desktop ? ({ onMouseEnter: () => setOver(true), onMouseLeave: () => setOver(false) } as object) : null)}
        ref={desktop ? dblRef : undefined}
      >
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
          getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
          {...carouselWindowProps(Platform.OS)}
          renderItem={({ item: m, index }) => {
            // Uma tcheka (vídeo sozinho) abre no ecrã da Tcheka; num carrossel com fotos e vídeos, o vídeo toca ali mesmo
            // (o som no botão do canto) e um toque abre o visor em ecrã inteiro nesse vídeo, como nas fotos.
            const reel = m.kind === 'video' && media.length < 2;
            return (
            <Pressable
              style={{ width, height: h }}
              onPress={() => tap(reel ? (reelId ? () => pushOnce(router, `/r/${reelId}`) : undefined) : () => onOpen?.(index))}
              onLongPress={onHold}
              accessibilityRole="button"
              accessibilityLabel={reel ? t('Abrir a tcheka') : m.kind === 'video' ? t('Ver o vídeo {n} de {n2} em ecrã inteiro (toca duas vezes para brindar)', { n: index + 1, n2: media.length }) : t('Ver a foto {n} de {n2} em ecrã inteiro (toca duas vezes para brindar)', { n: index + 1, n2: media.length })}
            >
              {m.kind === 'video' ? (
                // Corre sozinho sem som enquanto está à vista (e é o item em cena); pára com o visor aberto por cima.
                <CarouselVideo url={m.url} poster={m.posterUrl} durationMs={m.durationMs} width={width} height={h} active={(reel || index === i) && !covered} inView={inView} mute={mute} passive />
              ) : (
                // Na web: a foto que se vê e a seguinte carregam logo e sem fade (senão piscavam ao rolar o feed); as outras ficam lazy.
                <Image source={{ uri: sized(m.url, servedWidth(width, PixelRatio.get())) }} style={StyleSheet.absoluteFill} contentFit="cover" {...listImageProps(Platform.OS, 150, index <= i + 1)} accessibilityIgnoresInvertColors />
              )}
            </Pressable>
            );
          }}
        />
        {overlay}
        {tags.length > 0 && (
          <>
            <Pressable onPress={() => setShowTags((v) => !v)} style={[styles.tagsBtn, overlay ? styles.tagsRight : null]} accessibilityRole="button" accessibilityLabel={t('{n} pessoa(s) identificadas', { n: tags.length })}>
              <Icon name="users" size={16} color="#fff" />
              <Text style={styles.counterText}>{tags.length}</Text>
            </Pressable>
            {showTags && (
              <View style={styles.tagsList}>
                {tags.map((t) => (
                  <Pressable key={t.username} onPress={() => router.push(`/u/${t.username}` as never)} style={styles.tagPill} accessibilityRole="link">
                    <NameWithBadge name={`@${t.username}`} who={t} style={styles.tagPillText} />
                  </Pressable>
                ))}
              </View>
            )}
          </>
        )}
        {desktop && over && media.length > 1 ? (
          <>
            {i > 0 ? (
              <Pressable onPress={() => goTo(i - 1)} style={(st) => [styles.arrow, { left: 10 }, (st as Hover).hovered && styles.arrowHover]} accessibilityRole="button" accessibilityLabel={t('Foto anterior')} {...tip(t('Foto anterior (←)'))}>
                <Icon name="chevron-left" size={22} color={colors.zinc900} strokeWidth={2.4} />
              </Pressable>
            ) : null}
            {i < media.length - 1 ? (
              <Pressable onPress={() => goTo(i + 1)} style={(st) => [styles.arrow, { right: 10 }, (st as Hover).hovered && styles.arrowHover]} accessibilityRole="button" accessibilityLabel={t('Foto seguinte')} {...tip(t('Foto seguinte (→)'))}>
                <Icon name="chevron-right" size={22} color={colors.zinc900} strokeWidth={2.4} />
              </Pressable>
            ) : null}
          </>
        ) : null}
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

/** Contadores em cima e, por baixo da linha, as ações com ícone e nome (Brindar, Comentar, Repostar, Oferecer, Partilhar). */
function Actions({ post, mine, patch, open, people, onCheer, hot = false }: { /** Computador: o rato está por cima do cartão (as ações ficam realçadas). */ hot?: boolean; post: Post; mine: boolean; patch: (p: Partial<Post>) => void; open: (k: 'comments' | 'repost' | 'gift' | 'share') => void; people: (k: PeopleKind) => void; /** Brindou pelo botão: mostra a animação. */ onCheer?: () => void }) {
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
    { kind: 'cheers' as const, n: post.cheers, icon: 'cheers' as const, label: post.cheers === 1 ? t('brinde') : t('brindes') },
    { kind: 'reposts' as const, n: post.reposts, icon: 'repeat' as const, label: post.reposts === 1 ? 'repost' : t('reposts') },
    { kind: 'gifts' as const, n: post.gifts, icon: 'gift' as const, label: post.gifts === 1 ? t('presente') : t('presentes') },
  ].filter((c) => c.n > 0);
  // Só se pode ver quem foi se o dono deixar (e num repost só os brindes).
  const canSee = (k: PeopleKind) => (post.kind !== 'repost' || k === 'cheers') && !!post.lists?.[k];
  // «Brindado por @fulano e outras N pessoas» (lib/cheeredBy): no lugar do «🍻 N» quando o servidor manda quem brindou;
  // sem isso (o dono não deixa ver, ou a publicação veio da cache) fica a contagem de sempre.
  const byNames = cheeredByView(post)?.kind === 'names';
  const shown = byNames ? chips.filter((c) => c.kind !== 'cheers') : chips;


  return (
    <>
      {byNames ? <CheeredByLine post={post} onOpen={() => people('cheers')} /> : null}
      {byNames && !shown.length && post.comments <= 0 ? null : (
      <View style={[styles.counts, byNames && { marginTop: 4 }]}>
        <View style={styles.chips}>
          {shown.map((c) =>
            canSee(c.kind) ? (
              <Pressable key={c.icon} onPress={() => people(c.kind)} hitSlop={8} style={({ pressed }) => [styles.chip, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={t('{n} {label}: ver quem', { n: c.n, label: c.label })}>
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
          <Pressable onPress={() => open('comments')} hitSlop={12} accessibilityRole="button">
            <Text style={styles.commentsCount}>{post.comments} {post.comments === 1 ? t('Comentário') : t('Comentários')}</Text>
          </Pressable>
        )}
      </View>
      )}
      <View style={[styles.bar, hot && styles.barHot, byNames && !shown.length && post.comments <= 0 && { marginTop: 10 }]}>
        <BarBtn hot={hot} label={post.cheered ? t('Brindou') : t('Brindar')} icon="cheers" color={post.cheered ? colors.amber600 : colors.zinc800} onPress={() => cheer.mutate()} />
        <BarBtn hot={hot} label={t('Comentar')} icon="comment" onPress={() => open('comments')} />
        {/* Quem publicou não deixa repostar (lib/repost): o botão some, a não ser que haja um repost meu para desfazer. */}
        {showRepostButton(post) && <BarBtn hot={hot} label={post.reposted ? t('Repostado') : t('Repostar')} icon="repeat" color={post.reposted ? colors.green700 : colors.zinc800} onPress={() => open('repost')} />}
        {!mine && post.canGift && <BarBtn hot={hot} label={t('Oferecer')} a11y={t('Oferecer vibes')} icon="gift" onPress={() => open('gift')} />}
        <BarBtn hot={hot} label={t('Partilhar')} icon="share" onPress={() => open('share')} />
      </View>
    </>
  );
}

/**
 * Botão da fila de ações: todos os ícones a 24 (o mesmo tamanho em todos os botões da barra). Fica fora do cartão para não
 * se voltar a montar quando o cartão muda de `hot` ao passar o rato (o primeiro clique ao entrar no cartão perdia-se).
 */
function BarBtn({ label, icon, onPress, color = colors.zinc800, a11y, hot }: { label: string; icon: Parameters<typeof Icon>[0]['name']; onPress: () => void; color?: string; /** O que o leitor de ecrã diz, quando o rótulo curto não chega. */ a11y?: string; hot?: boolean }) {
  return (
    <Pressable onPress={onPress} style={(st) => [styles.barBtn, hot && styles.barBtnHot, (st as Hover).hovered && styles.barBtnHover, st.pressed && { transform: [{ scale: 0.95 }] }]} accessibilityRole="button" accessibilityLabel={a11y ?? label}>
      <Icon name={icon} size={24} color={color} />
      <Text style={[styles.word, { color }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

export const PostCard = memo(PostCardBase);

const styles = StyleSheet.create({
  gone: { marginBottom: 20, borderRadius: 16, backgroundColor: colors.zinc100, paddingHorizontal: 16, paddingVertical: 12 },
  goneText: { textAlign: 'center', fontSize: 14, fontWeight: '600', color: colors.zinc600 },
  tagsRight: { left: undefined, right: 12 },
  tagsBtn: { position: 'absolute', left: 12, bottom: 12, height: 32, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 10 },
  tagsList: { position: 'absolute', left: 12, right: 12, bottom: 56, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tagPill: { borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.75)', paddingHorizontal: 12, paddingVertical: 4 },
  tagPillText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  // Ações da foto em ecrã inteiro: fila vertical à direita, como na Tcheka.
  vBar: { alignItems: 'center', gap: 14 },
  vBtn: { alignItems: 'center', gap: 4 },
  vCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  vCount: { color: '#fff', fontSize: 13, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  quoteName: { fontSize: 16, fontWeight: '600', color: colors.zinc900 },
  quoteTime: { fontSize: 14, color: colors.zinc500 },
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
  arrow: { position: 'absolute', top: '50%', marginTop: -18, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.88)', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.2)' },
  arrowHover: { backgroundColor: '#fff' },
  cardHot: { boxShadow: '0 4px 22px rgba(0,0,0,0.13)' },
  iconHover: { backgroundColor: colors.zinc100, borderRadius: 20 },
  barHot: { borderTopColor: colors.zinc300 },
  barBtnHot: { backgroundColor: '#fafafa' },
  barBtnHover: { backgroundColor: colors.zinc100, borderRadius: 14 },
  sponsored: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginBottom: 10, borderRadius: 999, backgroundColor: colors.rose50, paddingHorizontal: 10, paddingVertical: 4 },
  sponsoredText: { fontSize: 12, fontWeight: '800', color: colors.brand, letterSpacing: 0.2 },
  hiddenBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, borderRadius: 14, backgroundColor: colors.zinc100, paddingLeft: 12, paddingRight: 6, paddingVertical: 6 },
  hiddenText: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.zinc700 },
  hiddenBtn: { borderRadius: 999, backgroundColor: colors.white, paddingHorizontal: 12, paddingVertical: 7 },
  hiddenBtnText: { fontSize: 13, fontWeight: '700', color: colors.zinc900 },
  repostBar: { flexDirection: 'row', alignItems: 'center', gap: THREAD_GAP, marginRight: 24, marginBottom: 6 },
  repostText: { fontSize: 14, fontWeight: '600', color: colors.zinc500, lineHeight: 20 },
  // Quem citou, por baixo da original no fio: avatar de 36, nome e @ · tempo, e o comentário em letra maior.
  qHead: { flexDirection: 'row', alignItems: 'center', gap: THREAD_GAP },
  qName: { fontSize: 16, fontWeight: '600', color: colors.zinc900, lineHeight: 21 },
  qMeta: { fontSize: 14, color: colors.zinc500, lineHeight: 19 },
  qBody: { marginTop: 10, fontSize: 17, lineHeight: 24, color: colors.zinc900 },
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
