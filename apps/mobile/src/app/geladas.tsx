import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { CheersPour } from '@/components/CheersPour';
import { Icon, type IconName } from '@/components/Icon';
import { ActivityIndicator } from '@/components/PontoLoader';
import { Sheet } from '@/components/Sheet';
import { StackPage } from '@/components/StackPage';
import { TasteBubble } from '@/components/TasteBubble';
import { AskSheet } from '@/components/gelada/AskSheet';
import { DrinkSheet } from '@/components/gelada/DrinkSheet';
import { ApiError, api, uploadMedia } from '@/lib/api';
import { geladaApi, geladaKeys, type GeladaBook, type GeladaDebt } from '@/lib/api.gelada';
import { useAuth } from '@/lib/auth';
import { abs } from '@/lib/config';
import { newDraftKey, saveDraft } from '@/lib/drafts';
import { bookSummary, debtLine, debtState, momentText } from '@/lib/gelada';
import { colors } from '@/lib/theme';
import { timeAgo } from '@/lib/time';

const AMBER_INK = '#92400e';

/**
 * O livro das geladas: quem me deve e a quem devo (fase 1, sem dinheiro). Destino dos avisos «Já paguei» e da sexta da gelada
 * (`/geladas?pedir=1` abre logo «Paga-me uma»). Com `?u=ana`, o livro da Ana como eu o posso ver (o dela, se o mostra; senão só
 * o que há entre nós).
 * - Quem deve: «Já paguei» (com uma foto, se quiser). Só conta como paga quando a outra pessoa confirma.
 * - Quem recebe: «Confirmar» (os copos batem e aparece «Publicar o momento»), «Ainda não» ou «Perdoar».
 */
export default function GeladasScreen() {
  const params = useLocalSearchParams<{ u?: string; pedir?: string }>();
  const other = params.u?.replace(/^@/, '') || undefined;
  const qc = useQueryClient();
  const router = useRouter();
  const { user } = useAuth();
  const key = geladaKeys.book(other);
  const q = useQuery<GeladaBook>({ queryKey: key, queryFn: () => (other ? geladaApi.book(other) : geladaApi.myBook()), retry: false });
  const [tab, setTab] = useState<'open' | 'closed'>('open');
  const [asking, setAsking] = useState(params.pedir === '1');
  const [owing, setOwing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [burst, setBurst] = useState(0);
  const [moment, setMoment] = useState<GeladaDebt | null>(null);
  const [claiming, setClaiming] = useState<GeladaDebt | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['gelada-book'] });
    void qc.invalidateQueries({ queryKey: ['geleira-level'] });
  };
  async function act(d: GeladaDebt, run: () => Promise<GeladaDebt>, after?: (r: GeladaDebt) => void) {
    if (busy) return;
    setBusy(d.id);
    try {
      const r = await run();
      qc.setQueryData<GeladaBook>(key, (b) => (b ? { ...b, items: b.items.map((x) => (x.id === r.id ? r : x)) } : b));
      after?.(r);
      refresh();
    } catch (e) {
      Alert.alert('Não deu', e instanceof ApiError && e.message ? e.message : 'Não consegui agora. Tenta outra vez.');
    } finally {
      setBusy(null);
    }
  }
  async function claim(d: GeladaDebt, photo: boolean) {
    setClaiming(null);
    let mediaId: string | undefined;
    if (photo) {
      try {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted && perm.canAskAgain === false) return Alert.alert('Sem acesso às fotos', 'Dá acesso às fotos nas definições do telemóvel.');
        const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
        const a = r.canceled ? null : r.assets[0];
        if (!a) return;
        setBusy(d.id);
        mediaId = await uploadMedia(a.uri, a.mimeType ?? 'image/jpeg', 'public');
      } catch (e) {
        setBusy(null);
        return Alert.alert('Não deu', (e as Error).message || 'Não consegui carregar a foto.');
      }
      setBusy(null);
    }
    await act(d, () => geladaApi.paid(d.id, mediaId ? { mediaId } : {}));
  }
  async function publishMoment(d: GeladaDebt) {
    setMoment(null);
    const k = newDraftKey(user?.username ?? 'eu');
    await saveDraft(k, { body: momentText(d), place: d.venue?.name ?? '', photos: [] });
    router.push({ pathname: '/new', params: { draft: k } } as never);
  }

  const b = q.data;
  const items = (b?.items ?? []).filter((d) => (tab === 'open' ? d.status === 'open' : d.status !== 'open'));
  const mine = !other || b?.scope === 'between';
  return (
    <StackPage title={other ? `Geladas · @${other}` : 'O livro das geladas'}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 12 }}>
        <View style={st.hero}>
          <Icon name="cheers" size={30} color={colors.amber600} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={st.heroTitle} accessibilityRole="header">{b ? bookSummary(b.owe, b.owed, mine) : ' '}</Text>
            <Text style={st.heroSub}>
              {other
                ? b?.scope === 'all' ? `O livro de @${other}, que o mostra a quem vê a geleira.` : `Só o que há entre ti e @${other}. Só vocês os dois veem isto.`
                : b?.public ? 'Quem vê a tua geleira vê este livro (muda em Definições › Conteúdo).' : 'Só tu e a outra pessoa veem cada dívida.'}
            </Text>
          </View>
        </View>
        {!other && (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pill icon="cheers" label="Pede uma gelada" onPress={() => setAsking(true)} primary />
            <Pill icon="plus" label="Fico a dever" onPress={() => setOwing(true)} />
          </View>
        )}
        <View style={st.tabs} accessibilityRole="tablist">
          {([['open', 'Por pagar'], ['closed', 'Pagas e perdoadas']] as const).map(([t, label]) => (
            <Pressable key={t} onPress={() => setTab(t)} style={[st.tab, tab === t && st.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: tab === t }}>
              <Text style={[st.tabText, tab === t && { color: '#fff' }]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        {q.isLoading && <ActivityIndicator color={colors.brand} style={{ paddingVertical: 32 }} />}
        {q.isError && <Text style={st.empty} accessibilityRole="alert">Não consegui abrir o livro. Puxa para tentar outra vez.</Text>}
        {q.isSuccess && items.length === 0 && (
          <Text style={st.empty}>{tab === 'open' ? 'Tudo em dia por aqui 🙌' : 'Ainda nenhuma gelada paga. A sexta está aí!'}</Text>
        )}
        {items.map((d) => (
          <DebtCard
            key={d.id}
            d={d}
            busy={busy === d.id}
            onClaim={() => setClaiming(d)}
            onConfirm={() => void act(d, () => geladaApi.confirm(d.id), (r) => { setBurst((n) => n + 1); setMoment(r); })}
            onReject={() => void act(d, () => geladaApi.reject(d.id))}
            onForgive={() => Alert.alert('Perdoar esta gelada?', `${debtLine(d)}. Fica fechada no livro.`, [
              { text: 'Cancelar', style: 'cancel' },
              { text: 'Perdoar', onPress: () => void act(d, () => geladaApi.forgive(d.id)) },
            ])}
            onMoment={() => setMoment(d)}
          />
        ))}
        <Text style={st.fine}>Não há dinheiro nem Txills no livro: é palavra entre amigos. Bebe com moderação 🙌</Text>
      </ScrollView>
      <CheersPour n={burst} size={220} />
      {claiming && (
        <Sheet title="Já pagaste?" onClose={() => setClaiming(null)}>
          <View style={{ paddingHorizontal: 20, paddingBottom: 20, gap: 10 }}>
            <Text style={st.sheetText}>{debtLine(claiming)}. Fica como paga quando {claiming.creditor.username ? `@${claiming.creditor.username}` : 'a outra pessoa'} confirmar.</Text>
            <Pill icon="check" label="Já paguei" onPress={() => void claim(claiming, false)} primary wide />
            <Pill icon="camera" label="Já paguei, com uma foto" onPress={() => void claim(claiming, true)} wide />
          </View>
        </Sheet>
      )}
      {moment && (
        <Sheet title="Gelada paga 🙌" onClose={() => setMoment(null)}>
          <View style={{ paddingHorizontal: 20, paddingBottom: 20, gap: 10 }}>
            <Text style={st.sheetText}>{momentText(moment)}</Text>
            <Pill icon="compose" label="Publicar o momento" onPress={() => void publishMoment(moment)} primary wide />
            <Pill icon="x" label="Agora não" onPress={() => setMoment(null)} wide />
          </View>
        </Sheet>
      )}
      {asking && <AskSheet onClose={() => setAsking(false)} />}
      {owing && <OweFlow onClose={() => setOwing(false)} onDone={() => { setOwing(false); refresh(); }} />}
    </StackPage>
  );
}

function Pill({ icon, label, onPress, primary = false, wide = false }: { icon: IconName; label: string; onPress: () => void; primary?: boolean; wide?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.pill, primary && st.pillPrimary, wide ? { alignSelf: 'stretch' } : { flex: 1 }, pressed && { opacity: 0.8 }]} accessibilityRole="button">
      <Icon name={icon} size={18} color={primary ? '#fff' : colors.zinc800} />
      <Text style={[st.pillText, primary && { color: '#fff' }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

function DebtCard({ d, busy, onClaim, onConfirm, onReject, onForgive, onMoment }: { d: GeladaDebt; busy: boolean; onClaim: () => void; onConfirm: () => void; onReject: () => void; onForgive: () => void; onMoment: () => void }) {
  const photo = d.photoUrl ? abs(d.photoUrl) : null;
  const src = d.source === 'request' ? 'de um pedido' : d.source === 'round' ? 'de uma rodada' : 'à mão';
  return (
    <View style={[st.card, d.claimed && { borderColor: colors.amber300 }]}>
      <View style={st.cardRow}>
        <TasteBubble item={{ slug: d.drink.slug, kind: 'bebida', category: d.drink.category }} size={48} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.line}>{debtLine(d)}</Text>
          <Text style={st.meta}>{d.drink.masked || d.drink.alcoholic ? '' : `${d.drink.name} · `}{src} · {timeAgo(d.at).toLowerCase()}</Text>
        </View>
        <View style={[st.badge, d.status === 'paid' && { backgroundColor: '#dcfce7' }, d.claimed && { backgroundColor: '#fef3c7' }]}>
          <Text style={[st.badgeText, d.status === 'paid' && { color: colors.green700 }, d.claimed && { color: AMBER_INK }]}>{debtState(d)}</Text>
        </View>
      </View>
      {photo || d.venue ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {photo ? <Image source={{ uri: photo }} style={st.photo} contentFit="cover" accessibilityLabel="A foto do pagamento" /> : null}
          {d.venue ? <Text style={st.meta}>📍 {d.venue.name}</Text> : null}
        </View>
      ) : null}
      {busy ? <ActivityIndicator color={colors.brand} /> : (
        <View style={st.actions}>
          {d.canClaim && <Small label="Já paguei" onPress={onClaim} primary />}
          {d.canConfirm && <Small label="Confirmar" onPress={onConfirm} primary />}
          {d.canConfirm && <Small label="Ainda não" onPress={onReject} />}
          {d.canForgive && <Small label="Perdoar" onPress={onForgive} />}
          {d.status === 'paid' && (d.iOwe || d.owedToMe) && <Small label="Publicar o momento" onPress={onMoment} />}
        </View>
      )}
    </View>
  );
}

function Small({ label, onPress, primary = false }: { label: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.small, primary && st.pillPrimary, pressed && { opacity: 0.8 }]} accessibilityRole="button">
      <Text style={[st.smallText, primary && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

/** «Fico a dever-te uma»: escolher a quem (quem sigo) e a bebida. */
function OweFlow({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [who, setWho] = useState<string | null>(null);
  const friends = useQuery({ queryKey: ['gelada-friends', user?.username, search.trim()], queryFn: () => api.following(user!.username, undefined, search.trim() || undefined), enabled: !!user, staleTime: 60_000 });
  if (who) {
    return (
      <DrinkSheet
        title={`Que deves a @${who}?`}
        to={[who]}
        onPick={async (d) => {
          try {
            await geladaApi.owe(who, d.id);
            onDone();
          } catch (e) {
            Alert.alert('Não deu', e instanceof ApiError && e.message ? e.message : 'Não consegui agora. Tenta outra vez.');
          }
        }}
        onClose={onClose}
      />
    );
  }
  return (
    <Sheet title="Fico a dever-te uma" onClose={onClose} full>
      <View style={{ paddingHorizontal: 16, gap: 8, flex: 1 }}>
        <Text style={st.sheetText}>A quem ficas a dever? Só tu crias estas dívidas.</Text>
        <View style={st.search}>
          <Icon name="search" size={18} color={colors.zinc500} />
          <TextInput value={search} onChangeText={setSearch} placeholder="Procurar amigos…" placeholderTextColor={colors.zinc500} style={st.searchInput} accessibilityLabel="Procurar amigos" autoCapitalize="none" autoCorrect={false} />
        </View>
        {friends.isLoading && <ActivityIndicator color={colors.brand} />}
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          {(friends.data?.items ?? []).map((p) => (
            <Pressable key={p.username} onPress={() => setWho(p.username)} style={({ pressed }) => [st.person, pressed && { backgroundColor: colors.zinc100 }]} accessibilityRole="button" accessibilityLabel={`${p.displayName}, @${p.username}`}>
              <Avatar name={p.displayName} username={p.username} size={40} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={st.line} numberOfLines={1}>{p.displayName}</Text>
                <Text style={st.meta} numberOfLines={1}>@{p.username}</Text>
              </View>
              <Icon name="chevron-right" size={18} color={colors.zinc500} />
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 22, borderWidth: 1, borderColor: '#fde68a', backgroundColor: '#fffbeb', padding: 16 },
  heroTitle: { fontSize: 22, fontWeight: '800', color: colors.zinc900 },
  heroSub: { marginTop: 2, fontSize: 13, lineHeight: 18, color: colors.zinc600 },
  tabs: { flexDirection: 'row', gap: 8 },
  tab: { flex: 1, height: 40, borderRadius: 999, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: colors.zinc900 },
  tabText: { fontSize: 14, fontWeight: '700', color: colors.zinc700 },
  empty: { paddingVertical: 32, textAlign: 'center', fontSize: 16, color: colors.zinc600 },
  card: { borderRadius: 18, borderWidth: 1, borderColor: colors.zinc200, backgroundColor: '#fff', padding: 12, gap: 10 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  line: { fontSize: 15, fontWeight: '700', color: colors.zinc900 },
  meta: { marginTop: 2, fontSize: 12, color: colors.zinc500 },
  badge: { borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 12, fontWeight: '700', color: colors.zinc700 },
  photo: { width: 72, height: 72, borderRadius: 12, backgroundColor: colors.zinc100 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  small: { minHeight: 40, minWidth: 44, paddingHorizontal: 16, borderRadius: 999, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  smallText: { fontSize: 14, fontWeight: '700', color: colors.zinc800 },
  pill: { height: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 14 },
  pillPrimary: { backgroundColor: colors.brand },
  pillText: { flexShrink: 1, fontSize: 15, fontWeight: '700', color: colors.zinc800 },
  sheetText: { fontSize: 15, lineHeight: 22, color: colors.zinc700 },
  fine: { marginTop: 8, textAlign: 'center', fontSize: 12, color: colors.zinc500 },
  search: { height: 44, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 16 },
  searchInput: { flex: 1, minWidth: 0, fontSize: 16, color: colors.zinc900, paddingVertical: 0, outlineStyle: 'none' } as never,
  person: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, paddingHorizontal: 4, paddingVertical: 6 },
});
