import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '@/lib/api';
import { geleiraApi, type GeleiraLevel, type MyTaste, type TasteItem, type TheirTaste } from '@/lib/api.geleira';
import { ICE, KINDS, KIND_ICON, KIND_LABEL } from '@/lib/geleira';
import { applyCheer, canCheer, canListCheers, cheerA11yLabel, cheerButtonText, cheerersTitle, cheersBadge, cheersCount, geleiraToggleLabel, ownerCheersA11yLabel, ownerCheersText, toggleCheer } from '@/lib/geleiraCheers';
import { itemA11yLabel, shareBlockReason } from '@/lib/geleiraPost';
import { colors } from '@/lib/theme';
import { timeAgo } from '@/lib/time';
import { Avatar } from './Avatar';
import { NameWithBadge } from './NameWithBadge';
import { CheersPour } from './CheersPour';
import { FridgeArt, LEVEL_LABEL, geleiraLevel, geleiraPoints, nextLevelHint } from './FridgeArt';
import { Icon, type IconName } from './Icon';
import { ActivityIndicator } from './PontoLoader';
import { Sheet } from './Sheet';
import { TasteBubble } from './TasteBubble';

type Shown = TasteItem & { rating: number | null; favorite: boolean; cheers?: number; cheered?: boolean };

/** Âmbar escuro para texto em fundo âmbar claro (contraste ≥ 4,5:1). */
const AMBER_INK = '#92400e';

/** A nota em flocos de neve, de 1 a 5 (os mesmos do editor): mais flocos, mais gelado, mais gostas. */
const SKY = '#0ea5e9';
function Frost({ rating }: { rating: number | null }) {
  if (!rating) return <View style={{ marginTop: 2, height: 14 }} />;
  return (
    <View style={st.frost}>
      {[1, 2, 3, 4, 5].map((n) => <Icon key={n} name="snowflake" size={9} strokeWidth={2.6} color={n <= rating ? SKY : colors.zinc200} />)}
    </View>
  );
}

/** Como funciona a geleira: os flocos, o coração e os níveis. Abre ao tocar no nível. */
function HowSheet({ onClose, level, points, toNext, nextTitle }: { onClose: () => void; level: number; points: number; toNext: number | null; nextTitle: string | null }) {
  const steps = [0, 1, 12, 30, 60];
  return (
    <Sheet title="Como funciona a geleira" onClose={onClose}>
      <View style={{ paddingHorizontal: 20, paddingBottom: 24, gap: 18 }}>
        <View style={{ gap: 8 }}>
          <Text style={st.howTitle}>Os flocos são a nota</Text>
          {[1, 2, 3, 4, 5].map((n) => (
            <View key={n} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flexDirection: 'row', gap: 1, width: 64 }}>{[1, 2, 3, 4, 5].map((k) => <Icon key={k} name="snowflake" size={11} strokeWidth={2.6} color={k <= n ? SKY : colors.zinc200} />)}</View>
              <Text style={st.howText}>{ICE[n]}</Text>
            </View>
          ))}
          <Text style={[st.howText, { color: colors.zinc500 }]}>Quanto mais gelado, mais gostas. Dás a nota no editor da geleira.</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={[st.heart, { position: 'relative', right: 0, top: 0 }]}><Icon name="heart" size={9} solid color="#fff" /></View>
          <Text style={st.howText}>O coração marca os teus favoritos (até 8).</Text>
        </View>
        <View style={{ gap: 8 }}>
          <Text style={st.howTitle}>O nível da geleira</Text>
          <Text style={st.howText}>Ganhas pontos por cada gosto, por cada favorito, por variedade (grupos diferentes) e por dares notas.</Text>
          {LEVEL_LABEL.map((l, n) => (
            <View key={l} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={[st.lvDot, n === level && { backgroundColor: colors.brand }]}>{n === level && <Icon name="check" size={10} strokeWidth={3} color="#fff" />}</View>
              <Text style={[st.howText, n === level && { fontWeight: '800', color: colors.zinc900 }]}>{l}</Text>
              <Text style={[st.howText, { marginLeft: 'auto', color: colors.zinc500 }]}>{n === 0 ? '0 pontos' : `${steps[n]}+ pontos`}</Text>
            </View>
          ))}
          <Text style={[st.howText, { color: colors.zinc500 }]}>{toNext === null ? `Estás no máximo com ${points} pontos.` : `Tens ${points} ${points === 1 ? 'ponto' : 'pontos'}. ${toNext === 1 ? 'Falta 1' : `Faltam ${toNext}`} para ${(nextTitle ?? '').toLowerCase()}.`}</Text>
        </View>
      </View>
    </Sheet>
  );
}

/**
 * Quem brindou a geleira: o dono vê sempre; os outros só se o dono mostra a lista (`cheersListable`). Tocar numa pessoa
 * abre o perfil dela.
 */
function CheerersSheet({ username, name, isMe, onClose }: { username: string; name: string; isMe: boolean; onClose: () => void }) {
  const router = useRouter();
  const q = useQuery({ queryKey: ['geleira-cheers', username], queryFn: () => geleiraApi.cheers(username), retry: false });
  const items = q.data?.items ?? [];
  return (
    <Sheet title={cheerersTitle(isMe, name)} onClose={onClose}>
      {q.isLoading && <ActivityIndicator color={colors.brand} style={{ paddingVertical: 24 }} />}
      {q.isError && <Text style={st.msg} accessibilityRole="alert">Esta lista não está disponível agora.</Text>}
      {q.isSuccess && items.length === 0 && <Text style={st.msg}>{isMe ? 'Ainda ninguém brindou. Enche a geleira e mostra-a: os brindes vêm a seguir!' : 'Ainda não há brindes para mostrar.'}</Text>}
      <ScrollView style={{ maxHeight: 420 }}>
        {items.map((p) => (
          <Pressable
            key={p.username}
            onPress={() => {
              onClose();
              router.push(`/u/${p.username}` as never);
            }}
            style={({ pressed }) => [st.row, pressed && { backgroundColor: colors.zinc100 }]}
            accessibilityRole="button"
            accessibilityLabel={`${p.displayName}, ${timeAgo(p.at).toLowerCase()}`}
            accessibilityHint="Abre o perfil"
          >
            <Avatar name={p.displayName} username={p.hasAvatar ? p.username : undefined} size={44} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <NameWithBadge name={p.displayName} who={p} style={st.name} />
              <Text style={st.handle} numberOfLines={1}>@{p.username}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={st.handle}>{timeAgo(p.at)}</Text>
              {p.post ? <Text style={st.viaPost}>no post da geleira</Text> : null}
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </Sheet>
  );
}

/**
 * Os brindes à geleira: um botão próprio, por baixo do cabeçalho do cartão, com a largura do cartão (46 pt de altura,
 * ícone de 22 pt, texto de 15 pt). Visitante: brinda ou tira o brinde ("Brindar · 12" / "Brindaste · 12"; responde já,
 * confirma depois; ao brindar saltam os copos e o telemóvel vibra). Se o dono mostra quem brindou (`cheersListable`), ao
 * lado fica a contagem ("12 brindes"), que abre a lista. Dono: "N brindes", que abre a lista (sem brindes, nada).
 * Sem `cheers` no nível (servidor antigo) não aparece nada.
 */
function CheerBar({ username, name, isMe, level, onBurst, onOpenList }: { username: string; name: string; isMe: boolean; level: GeleiraLevel | undefined; onBurst: () => void; onOpenList: () => void }) {
  const qc = useQueryClient();
  const busy = useRef(false);
  if (!level || !canCheer(level)) return null;
  const n = level.cheers ?? 0;
  const listed = canListCheers(level, isMe);

  // A contagem que abre a lista de quem brindou (dono, ou visitante com a lista à vista).
  const countButton = (wide: boolean) => (
    <Pressable onPress={onOpenList} style={({ pressed }) => [st.cheerBtn, wide ? { flex: 1, justifyContent: 'flex-start' } : st.cheerCount, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={ownerCheersA11yLabel(n)}>
      {wide && <Icon name="cheers" size={22} color={colors.amber600} />}
      <Text style={[st.cheerText, { color: colors.zinc800 }, wide && { flex: 1 }]} numberOfLines={1}>{wide && isMe ? ownerCheersText(n).replace(/^🥂 /, '') : cheersCount(n)}</Text>
      <Icon name="chevron-right" size={16} color={colors.zinc500} />
    </Pressable>
  );

  if (isMe) return n > 0 ? <View style={st.cheerRow}>{countButton(true)}</View> : null;

  const key = ['geleira-level', username];
  async function toggle() {
    const cur = qc.getQueryData<GeleiraLevel>(key);
    if (!cur || busy.current) return;
    busy.current = true;
    await qc.cancelQueries({ queryKey: key });
    const next = toggleCheer(cur);
    qc.setQueryData(key, next); // responde já, confirma depois
    if (next.cheered) {
      onBurst();
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    }
    try {
      const r = await (next.cheered ? geleiraApi.cheer(username) : geleiraApi.uncheer(username));
      qc.setQueryData<GeleiraLevel>(key, (old) => (old ? applyCheer(old, r) : old));
    } catch (e) {
      qc.setQueryData(key, cur);
      Alert.alert('Não deu', e instanceof ApiError && e.message ? e.message : next.cheered ? 'Não consegui brindar agora. Tenta outra vez.' : 'Não consegui tirar o brinde agora. Tenta outra vez.');
    } finally {
      busy.current = false;
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ['geleira-cheers', username] });
    }
  }
  const on = !!level.cheered;
  const tint = on ? AMBER_INK : colors.zinc800;
  return (
    <View style={st.cheerRow}>
      <Pressable
        onPress={() => void toggle()}
        style={({ pressed }) => [st.cheerBtn, st.cheerToggle, on && st.cheerOn, pressed && { opacity: 0.7, transform: [{ scale: 0.98 }] }]}
        accessibilityRole="button"
        accessibilityLabel={cheerA11yLabel(on, name)}
        accessibilityValue={n > 0 ? { text: cheersCount(n) } : undefined}
        accessibilityState={{ selected: on }}
      >
        <Icon name="cheers" size={22} color={on ? colors.amber600 : colors.zinc800} />
        <Text style={[st.cheerText, { color: tint, flexShrink: 1 }]} numberOfLines={1}>{cheerButtonText(n, on, listed && n > 0)}</Text>
      </Pressable>
      {listed && n > 0 && countButton(false)}
    </View>
  );
}

/** Um gosto: bolinha de vidro com o ícone, o nome e a nota. O favorito leva um coração. */
function Tile({ item, onPress }: { item: Shown; /** Visitante: tocar brinda este gosto (o mesmo brinde que no post da geleira). */ onPress?: () => void }) {
  const label = `${item.name}${item.rating ? `, ${ICE[item.rating]}` : ''}${item.favorite ? ', favorito' : ''}`;
  const n = item.cheers ?? 0;
  const Box = onPress ? Pressable : View;
  const a11y = onPress
    ? { accessibilityRole: 'button' as const, accessibilityState: { selected: !!item.cheered }, accessibilityLabel: itemA11yLabel({ ...item, name: label }, false) }
    : { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: n ? `${label}, ${cheersCount(n)}` : label };
  return (
    <Box style={st.tile} onPress={onPress} {...a11y}>
      <View>
        <View style={[st.tileRing, item.cheered && { borderColor: colors.amber300 }]}><TasteBubble item={item} size={44} /></View>
        {n > 0 && (
          <View style={[st.tileCheers, item.cheered && { backgroundColor: colors.amber300 }]}>
            <Icon name="cheers" size={9} color={AMBER_INK} />
            <Text style={st.tileCheersText}>{n > 99 ? '99+' : n}</Text>
          </View>
        )}
        {item.favorite && (
          <View style={st.heart}>
            <Icon name="heart" size={9} solid color="#fff" />
          </View>
        )}
      </View>
      <Text numberOfLines={2} style={st.tileName}>{item.name}</Text>
      {item.pending ? <Text style={{ marginTop: 4, fontSize: 10, fontWeight: '500', color: colors.zinc500 }}>à espera</Text> : <Frost rating={item.rating} />}
    </Box>
  );
}

/** Prateleira: os gostos em fila e, por baixo, a tábua de vidro. */
function Shelf({ title, icon, items, onTap }: { title: string; icon: IconName; items: Shown[]; onTap?: (i: Shown) => void }) {
  return (
    <View style={{ marginTop: 12 }}>
      <View style={st.shelfHead}>
        <Icon name={icon} size={14} color="rgba(39,39,42,0.7)" />
        <Text style={st.shelfTitle}>{title}</Text>
        <Text style={[st.shelfTitle, { color: 'rgba(39,39,42,0.45)', fontWeight: '600' }]}>{items.length}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 4, paddingTop: 4, paddingBottom: 8 }} style={{ marginHorizontal: -4 }}>
        {items.map((i) => <Tile key={i.id} item={i} onPress={onTap && !i.pending ? () => onTap(i) : undefined} />)}
      </ScrollView>
      <LinearGradient colors={['rgba(228,228,231,0.7)', '#fff', 'rgba(228,228,231,0.7)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={st.board} />
    </View>
  );
}

function useTastes(username: string, isMe: boolean) {
  return useQuery({ queryKey: ['geleira', isMe ? 'me' : username], queryFn: (): Promise<(MyTaste | TheirTaste)[]> => (isMe ? geleiraApi.mine() : geleiraApi.of(username)), retry: false });
}

/** O nível (com os brindes) de uma geleira: a mesma chave para a prateleira e o botão, para não pedir duas vezes. */
function useLevel(username: string, enabled = true) {
  return useQuery({ queryKey: ['geleira-level', username], queryFn: () => geleiraApi.level(username), retry: false, staleTime: 60_000, enabled });
}

/** Largura a partir da qual o botão largo (o meu) leva os brindes ao lado do frigorífico em vez do selo. */
const INLINE_CHEERS_MIN = 92;

/**
 * Botão da geleira na linha de ações do perfil: abre/fecha a prateleira para baixo. Nos perfis dos outros só aparece se
 * houver o que mostrar. Com brindes, mostra-os já fechada: um selo âmbar no canto ou, no botão largo com espaço, ao lado
 * do frigorífico. O selo fica por cima do canto, sem mudar o tamanho do botão.
 */
export function GeleiraToggle({ username, isMe, open, onToggle, icon = false, grow = false }: { username: string; isMe: boolean; open: boolean; onToggle: () => void; icon?: boolean; grow?: boolean }) {
  const q = useTastes(username, isMe);
  const shown = (q.data ?? []).filter((i) => i.kind === 'bebida' || i.kind === 'comida');
  const visible = isMe || (!q.isError && shown.length > 0);
  const lv = useLevel(username, visible);
  const [w, setW] = useState(0);
  if (!visible) return null;
  const fg = open ? '#fff' : colors.zinc900;
  const n = canCheer(lv.data) ? (lv.data?.cheers ?? 0) : 0;
  const badge = cheersBadge(n);
  const inline = !!badge && (!icon || (grow && w >= INLINE_CHEERS_MIN));
  return (
    <Pressable
      onPress={onToggle}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={geleiraToggleLabel(open, n)}
      style={[st.toggle, { backgroundColor: open ? colors.zinc900 : colors.zinc100 }, icon ? (grow ? { flex: 1 } : { width: 44, paddingHorizontal: 0 }) : { flex: 1 }]}
    >
      <FridgeArt count={shown.length} level={geleiraLevel(geleiraPoints(shown.filter((i) => !i.pending)))} open={open} size={24} />
      {!icon && <Text style={{ fontSize: 14, fontWeight: '700', color: fg }}>Geleira</Text>}
      {inline && (
        <View style={st.inlineCheers}>
          <Icon name="cheers" size={12} color={AMBER_INK} />
          <Text style={st.badgeText} numberOfLines={1}>{badge}</Text>
        </View>
      )}
      {!icon && <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}><Icon name="chevron-right" size={14} color={fg} /></View>}
      {!!badge && !inline && (
        <View style={st.badge} pointerEvents="none">
          <Icon name="cheers" size={10} color={AMBER_INK} />
          <Text style={st.badgeText} numberOfLines={1}>{badge}</Text>
        </View>
      )}
    </Pressable>
  );
}

/**
 * A geleira: vitrine de gostos (bebidas e comidas), só para ver. Editar fica em /geleira. Nos perfis dos outros só mostra o que a pessoa deixa ver.
 * `compact`: fechada por omissão (cabeçalho e o frigorífico); toca-se para abrir as prateleiras.
 */
export function GeleiraShelf({ username, name, isMe, flush = false, compact = false, pointed = false, arrowRight = 11 }: { username: string; name?: string; isMe: boolean; flush?: boolean; compact?: boolean; pointed?: boolean; arrowRight?: number }) {
  const [open, setOpen] = useState(!compact);
  const [how, setHow] = useState(false);
  const [cheerers, setCheerers] = useState(false);
  const [burst, setBurst] = useState(0); // muda a cada brinde: dispara os copos
  const q = useTastes(username, isMe);
  const items = (q.data ?? []).filter((i) => i.kind === 'bebida' || i.kind === 'comida');
  const lv = useLevel(username);
  const router = useRouter();
  const qc = useQueryClient();
  const cheering = useRef(new Set<string>());
  const margin = flush ? 0 : 16;

  /**
   * Visitante: tocar num gosto brinda-o (ou tira o brinde). É o mesmo brinde que no cartão do post da geleira: uma vez por
   * pessoa e gosto. Responde já, confirma depois.
   */
  async function cheerItem(i: Shown) {
    if (isMe || cheering.current.has(i.id)) return;
    cheering.current.add(i.id);
    const key = ['geleira', username];
    const flip = (on: boolean, n: number) => qc.setQueryData<Shown[]>(key, (old) => old?.map((x) => (x.id === i.id ? { ...x, cheered: on, cheers: Math.max(0, n) } : x)));
    const was = !!i.cheered;
    const n0 = i.cheers ?? 0;
    flip(!was, n0 + (was ? -1 : 1));
    if (!was) {
      setBurst((k) => k + 1);
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    }
    try {
      const r = await geleiraApi.cheerItem(username, i.id, !was);
      flip(r.cheered, r.cheers);
    } catch (e) {
      flip(was, n0);
      Alert.alert('Não deu', e instanceof ApiError && e.message ? e.message : 'Não consegui brindar agora. Tenta outra vez.');
    } finally {
      cheering.current.delete(i.id);
    }
  }
  /** Dono: «Partilhar a minha geleira» abre o ecrã de publicar com o cartão; geleira vazia explica porque não dá. */
  function shareMine() {
    const why = shareBlockReason(items);
    if (why) return Alert.alert('Ainda não dá para partilhar', why);
    router.push('/partilhar-geleira' as never);
  }
  if (q.isLoading) return <View style={[st.skel, { marginHorizontal: margin, height: compact ? 60 : 192 }]} accessibilityLabel="A carregar a geleira" />;
  if (!isMe && (q.isError || items.length === 0)) return null;

  const favorites = items.filter((i) => i.favorite).slice(0, 8);
  const total = items.filter((i) => !i.pending).length;
  const points = geleiraPoints(items);
  const level = lv.data?.level ?? geleiraLevel(points);
  const title = lv.data ? lv.data.title : LEVEL_LABEL[level];
  // Frase de progresso: não aparece no cartão do site, mas serve de legenda ao nível (como no site, vem do servidor).
  const hint = lv.data
    ? lv.data.toNext === null
      ? `Nível máximo: ${lv.data.title.toLowerCase()}!`
      : `${lv.data.toNext === 1 ? 'Falta 1 ponto' : `Faltam ${lv.data.toNext} pontos`} para ${(lv.data.nextTitle ?? '').toLowerCase()}. Bebidas com álcool e vibes de festa valem mais.`
    : nextLevelHint(points);
  const folded = compact && !open;
  // Progresso dentro do nível atual (0–1), para a barrinha.
  const stepsAll = [0, 1, 12, 30, 60];
  const lo = stepsAll[level], hi = level >= 4 ? null : stepsAll[level + 1];
  const progress = hi === null ? 1 : Math.max(0, Math.min(1, (points - lo) / (hi - lo)));

  const head = (
      <View style={st.head}>
        {compact ? (
          <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={open ? 'Fechar a geleira' : 'Abrir a geleira'}>
            <FridgeArt count={total} level={level} open={!folded} invite={folded} size={folded ? 64 : 56} />
          </Pressable>
        ) : (
          <FridgeArt count={total} level={level} open={!folded} size={52} />
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 16, fontWeight: '800', lineHeight: 20, color: colors.zinc900 }}>{isMe ? 'A minha geleira' : 'Geleira'}</Text>
          <Text style={{ fontSize: 12, lineHeight: 16, color: colors.zinc600 }}>
            {items.length === 0 ? 'Ainda vazia' : `${total} ${total === 1 ? 'gosto' : 'gostos'}${favorites.length ? ` · ${favorites.length} ${favorites.length === 1 ? 'favorito' : 'favoritos'}` : ''}`}
          </Text>
          {total > 0 && (
            <View style={st.tags}>
              <Pressable onPress={() => setHow(true)} style={st.level} accessibilityRole="button" accessibilityLabel={`Nível: ${title}`} accessibilityHint={hint}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: colors.brand }}>{title}</Text>
                <Icon name="info" size={12} strokeWidth={2.4} color={colors.brand} />
              </Pressable>
            </View>
          )}
          {total > 0 && isMe && (
            <View style={{ marginTop: 6, gap: 3 }} pointerEvents="none">
              <View style={st.barTrack}><View style={[st.barFill, { width: `${Math.round(progress * 100)}%` }]} /></View>
              <Text style={{ fontSize: 11, lineHeight: 14, color: colors.zinc500 }} numberOfLines={2}>{hint}</Text>
            </View>
          )}
        </View>
      </View>
  );
  // Os brindes: botão próprio, com a largura do cartão, por baixo do cabeçalho (também com a geleira fechada).
  const cheer = (
    <>
      <CheerBar username={username} name={name ?? `@${username}`} isMe={isMe} level={lv.data} onBurst={() => setBurst((k) => k + 1)} onOpenList={() => setCheerers(true)} />
      {cheerers && <CheerersSheet username={username} name={name ?? `@${username}`} isMe={isMe} onClose={() => setCheerers(false)} />}
    </>
  );
  const rest = (
    <>
      {how && <HowSheet onClose={() => setHow(false)} level={level} points={lv.data?.points ?? points} toNext={lv.data ? lv.data.toNext : level >= 4 ? null : stepsAll[level + 1] - points} nextTitle={lv.data ? lv.data.nextTitle : level >= 4 ? null : LEVEL_LABEL[level + 1]} />}
      {items.length === 0 && (!compact || open) ? (
        <View style={st.empty}>
          <Text style={{ fontSize: 18, fontWeight: '800', color: colors.zinc900 }}>Geleira vazia!</Text>
          <Text style={{ marginTop: 4, maxWidth: 272, textAlign: 'center', fontSize: 16, lineHeight: 24, color: colors.zinc600 }}>
            {isMe ? 'Para a encher, abre Editar perfil e escolhe a tua geleira.' : 'Ainda não há nada para mostrar.'}
          </Text>
        </View>
      ) : (
        !folded &&
        items.length > 0 &&
        KINDS.map((k) => {
          const list = items.filter((i) => i.kind === k).sort((a, b) => Number(b.favorite) - Number(a.favorite)); // os favoritos primeiro
          return list.length ? <Shelf key={k} title={KIND_LABEL[k]} icon={KIND_ICON[k]} items={list} onTap={!isMe && typeof list[0].cheers === 'number' ? (i) => void cheerItem(i) : undefined} /> : null;
        })
      )}
      {!folded && !isMe && items.length > 0 && typeof items[0].cheers === 'number' ? <Text style={st.tapHint}>Toca num gosto para lhe brindar.</Text> : null}
      {/* Partilhar a minha geleira: abre o ecrã de publicar já com o cartão da geleira. */}
      {isMe && !folded ? (
        <Pressable onPress={shareMine} style={({ pressed }) => [st.cheerBtn, st.share, pressed && { opacity: 0.7, transform: [{ scale: 0.98 }] }]} accessibilityRole="button" accessibilityHint="Abre o ecrã de publicar com o cartão da geleira">
          <Icon name="share" size={20} color={colors.white} />
          <Text style={[st.cheerText, { color: colors.white }]} numberOfLines={1}>Partilhar a minha geleira</Text>
        </Pressable>
      ) : null}
    </>
  );

  const cardStyle = [st.card, { marginHorizontal: margin, borderColor: pointed ? colors.zinc300 : colors.zinc200, paddingTop: folded ? 12 : 16 }];
  const inner = (
    <LinearGradient colors={['#fafafa', '#fff', 'rgba(255,255,255,0.6)']} style={StyleSheet.absoluteFill} />
  );
  // Fechada, o cabeçalho todo abre a geleira; os brindes ficam fora desse toque (botões próprios para o leitor de ecrã).
  // Os copos (CheersPour) ocupam o cartão inteiro e ficam centrados nele.
  return (
    <View style={cardStyle} accessibilityLabel="Geleira">
      {inner}
      {folded ? (
        <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel="Abrir a geleira" accessibilityState={{ expanded: false }}>
          {head}
        </Pressable>
      ) : (
        head
      )}
      {cheer}
      {rest}
      <CheersPour n={burst} size={170} />
    </View>
  );
}

const st = StyleSheet.create({
  arrow: { position: 'absolute', top: 6, zIndex: 10, width: 0, height: 0, borderLeftWidth: 11, borderRightWidth: 11, borderBottomWidth: 10, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: colors.zinc300 },
  card: { marginTop: 16, overflow: 'hidden', borderRadius: 24, borderWidth: 1, paddingHorizontal: 16, paddingBottom: 12, boxShadow: '0 2px 12px rgba(0,0,0,0.1)', backgroundColor: '#fff' },
  skel: { marginTop: 16, borderRadius: 24, backgroundColor: colors.zinc100 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tags: { marginTop: 2, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 6, rowGap: 6 },
  level: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, backgroundColor: colors.rose50, paddingHorizontal: 8, height: 20 },
  empty: { marginTop: 16, alignItems: 'center', borderRadius: 16, borderWidth: 1, borderColor: colors.zinc100, backgroundColor: 'rgba(255,255,255,0.7)', paddingHorizontal: 16, paddingVertical: 24 },
  frost: { marginTop: 2, flexDirection: 'row', alignItems: 'center', gap: 1, alignSelf: 'center', height: 14 },
  barTrack: { height: 4, borderRadius: 2, backgroundColor: colors.zinc100, overflow: 'hidden' },
  barFill: { height: 4, borderRadius: 2, backgroundColor: colors.brand },
  howTitle: { fontSize: 15, fontWeight: '800', color: colors.zinc900 },
  howText: { fontSize: 14, lineHeight: 19, color: colors.zinc700 },
  lvDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.zinc200, alignItems: 'center', justifyContent: 'center' },
  tile: { width: 58, alignItems: 'center' },
  tileRing: { borderRadius: 25, borderWidth: 2, borderColor: 'transparent' },
  tileCheers: { position: 'absolute', left: -8, top: -6, height: 18, minWidth: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 1, borderRadius: 9, borderWidth: 1.5, borderColor: '#fff', paddingHorizontal: 4, backgroundColor: '#fef3c7' },
  tileCheersText: { fontSize: 10, lineHeight: 13, fontWeight: '800', color: AMBER_INK, includeFontPadding: false },
  tapHint: { marginTop: 8, fontSize: 12, lineHeight: 16, color: colors.zinc500 },
  share: { marginTop: 12, width: '100%', backgroundColor: colors.brand, borderColor: colors.brand },
  viaPost: { fontSize: 11, fontWeight: '600', color: '#0369a1' },
  tileName: { marginTop: 4, minHeight: 23, width: '100%', textAlign: 'center', fontSize: 11, fontWeight: '600', lineHeight: 11.5, color: colors.zinc800 },
  heart: { position: 'absolute', right: -6, top: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.brand, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shelfHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2, marginBottom: 4 },
  shelfTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 1.44, textTransform: 'uppercase', color: 'rgba(39,39,42,0.7)' },
  board: { height: 4, borderRadius: 999, boxShadow: '0 3px 5px rgba(0,0,0,0.18)' },
  // Os brindes: uma fila com a largura do cartão, botões de 46 pt (ícone 22 pt, texto 15 pt). No perfil, num ecrã de 320 pt
  // o cartão tem ~214 pt por dentro: "Brindar" e "12 brindes" não cabem lado a lado e a contagem passa para a linha de baixo
  // (`flexWrap`), também com a largura toda; a partir de ~360 pt ficam lado a lado.
  cheerRow: { marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  cheerBtn: { minWidth: 44, height: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.zinc200, paddingHorizontal: 16, backgroundColor: colors.zinc100 },
  cheerToggle: { flexGrow: 1, flexBasis: 132 },
  cheerOn: { backgroundColor: '#fffbeb', borderColor: colors.amber300 },
  cheerCount: { flexGrow: 1, flexShrink: 0, gap: 4, paddingLeft: 14, paddingRight: 10, backgroundColor: '#fff' },
  cheerText: { fontSize: 15, fontWeight: '600' },
  // Os brindes no botão da geleira do perfil: selo âmbar no canto (por cima, não muda o tamanho do botão) ou ao lado do frigorífico.
  badge: { position: 'absolute', top: -7, right: -6, height: 18, minWidth: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: 9, borderWidth: 1.5, borderColor: '#fff', paddingHorizontal: 4, backgroundColor: colors.amber300 },
  inlineCheers: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 20, borderRadius: 10, paddingHorizontal: 6, backgroundColor: colors.amber300 },
  badgeText: { fontSize: 11, lineHeight: 14, fontWeight: '800', color: AMBER_INK, includeFontPadding: false },
  msg: { paddingVertical: 24, paddingHorizontal: 24, textAlign: 'center', color: colors.zinc600, fontSize: 16, lineHeight: 22 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 24 },
  name: { fontSize: 16, fontWeight: '600', color: colors.zinc900 },
  handle: { fontSize: 14, color: colors.zinc500 },
  toggle: { height: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, paddingHorizontal: 12 },
});
