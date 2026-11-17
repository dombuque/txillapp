import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { CheersPour } from '@/components/CheersPour';
import { Icon, type IconName } from '@/components/Icon';
import { NameWithBadge } from '@/components/NameWithBadge';
import { ActivityIndicator } from '@/components/PontoLoader';
import { Sheet } from '@/components/Sheet';
import { StackPage } from '@/components/StackPage';
import { TasteBubble } from '@/components/TasteBubble';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SearchField } from '@/components/ui/SearchField';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';
import { AskSheet } from '@/components/gelada/AskSheet';
import { DrinkSheet } from '@/components/gelada/DrinkSheet';
import { PaidSheet, type PaidChoice } from '@/components/gelada/PaidSheet';
import { api, uploadMedia } from '@/lib/api';
import { geladaApi, geladaKeys, type GeladaBook, type GeladaDebt } from '@/lib/api.gelada';
import { useAuth } from '@/lib/auth';
import { abs } from '@/lib/config';
import { newDraftKey, saveDraft } from '@/lib/drafts';
import { bookSummary, debtLine, debtState, geladaErrorText, momentText, venueTag } from '@/lib/gelada';
import { confirm } from '@/lib/confirm';
import { colors } from '@/lib/theme';
import { timeAgo } from '@/lib/time';
import { t } from '@/lib/i18n';

const AMBER_INK = '#92400e';

/**
 * O livro das geladas: quem me deve e a quem devo (fase 1, sem dinheiro). Destino dos avisos «Já paguei» e da sexta da gelada
 * (`/geladas?pedir=1` abre logo «Paga-me uma»). Com `?u=ana`, o livro da Ana como eu o posso ver (o dela, se o mostra; senão só
 * o que há entre nós).
 * - Quem deve: «Já paguei» (com uma foto e/ou o local onde foi, se quiser: components/gelada/PaidSheet). Só conta como paga
 *   quando a outra pessoa confirma, que vê o local («no Bar X», com «estiveram lá» se a pessoa estava mesmo lá).
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
      Alert.alert(t('Não deu'), geladaErrorText(e, t('Não consegui agora. Tenta outra vez.')));
    } finally {
      setBusy(null);
    }
  }
  async function claim(d: GeladaDebt, { photo, place, at }: PaidChoice) {
    setClaiming(null);
    let mediaId: string | undefined;
    if (photo) {
      try {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted && perm.canAskAgain === false) return Alert.alert(t('Sem acesso às fotos'), t('Dá acesso às fotos nas definições do telemóvel.'));
        const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
        const a = r.canceled ? null : r.assets[0];
        if (!a) return;
        setBusy(d.id);
        mediaId = await uploadMedia(a.uri, a.mimeType ?? 'image/jpeg', 'public');
      } catch (e) {
        setBusy(null);
        return Alert.alert(t('Não deu'), geladaErrorText(e, t('Não consegui carregar a foto.')));
      }
      setBusy(null);
    }
    // O local (se o escolheu) e a posição de agora, para o selo «estiveram lá» (o servidor não a guarda).
    await act(d, () => geladaApi.paid(d.id, { ...(mediaId ? { mediaId } : {}), ...(place ? { venueSlug: place.slug, ...(at ? { lat: at.lat, lng: at.lng } : {}) } : {}) }));
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
    <StackPage title={other ? t('Geladas · @{others}', { others: other }) : t('O livro das geladas')}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 12 }}>
        <View style={st.hero}>
          <Icon name="cheers" size={30} color={colors.amber600} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={st.heroTitle} accessibilityRole="header">{b ? bookSummary(b.owe, b.owed, mine) : ' '}</Text>
            <Text style={st.heroSub}>
              {other
                ? b?.scope === 'all' ? t('O livro de @{others}, que o mostra a quem vê a geleira.', { others: other }) : t('Só o que há entre ti e @{others}. Só vocês os dois veem isto.', { others: other })
                : b?.public ? t('Quem vê a tua geleira vê este livro (muda em Definições › Conteúdo).') : t('Só tu e a outra pessoa veem cada dívida.')}
            </Text>
          </View>
        </View>
        {!other && (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pill icon="cheers" label={t('Pede uma gelada')} onPress={() => setAsking(true)} primary />
            <Pill icon="plus" label={t('Fico a dever')} onPress={() => setOwing(true)} />
          </View>
        )}
        <SegmentedTabs tabs={[{ value: 'open', label: t('Por pagar') }, { value: 'closed', label: t('Pagas e perdoadas') }]} value={tab} onChange={setTab} />
        {q.isLoading && <ActivityIndicator color={colors.brand} style={{ paddingVertical: 32 }} />}
        {q.isError && <ErrorState what={t('o livro')} onRetry={() => void q.refetch()} style={{ marginTop: 16 }} />}
        {q.isSuccess && items.length === 0 && (
          tab === 'open'
            ? <EmptyState icon="check-circle" title={t('Tudo em dia por aqui')} text={t('Ninguém te deve e não deves a ninguém.')} style={{ marginTop: 16 }} />
            : <EmptyState icon="cheers" title={t('Ainda nenhuma gelada paga')} text={t('A sexta está aí!')} style={{ marginTop: 16 }} />
        )}
        {items.map((d) => (
          <DebtCard
            key={d.id}
            d={d}
            busy={busy === d.id}
            onClaim={() => setClaiming(d)}
            onConfirm={() => void act(d, () => geladaApi.confirm(d.id), (r) => { setBurst((n) => n + 1); setMoment(r); })}
            onReject={() => void act(d, () => geladaApi.reject(d.id))}
            onForgive={() => void confirm({ title: t('Perdoar esta gelada?'), message: t('{debtLine}. Fica fechada no livro.', { debtLine: debtLine(d) }), confirm: t('Perdoar') }).then((ok) => { if (ok) void act(d, () => geladaApi.forgive(d.id)); })}
            onMoment={() => setMoment(d)}
          />
        ))}
        <Text style={st.fine}>{t('Não há dinheiro nem vibes no livro: é palavra entre amigos. Bebe com moderação.')}</Text>
      </ScrollView>
      <CheersPour n={burst} size={220} />
      {claiming && <PaidSheet debt={claiming} onClose={() => setClaiming(null)} onClaim={(c) => void claim(claiming, c)} />}
      {moment && (
        <Sheet title={t('Gelada paga')} onClose={() => setMoment(null)}>
          <View style={{ paddingHorizontal: 20, paddingBottom: 20, gap: 10 }}>
            <Text style={st.sheetText}>{momentText(moment)}</Text>
            {moment.venue ? <VenueLine v={moment.venue} /> : null}
            <Pill icon="compose" label={t('Publicar o momento')} onPress={() => void publishMoment(moment)} primary wide />
            <Pill icon="x" label={t('Agora não')} onPress={() => setMoment(null)} wide />
          </View>
        </Sheet>
      )}
      {asking && <AskSheet onClose={() => setAsking(false)} />}
      {owing && <OweFlow onClose={() => setOwing(false)} onDone={() => { setOwing(false); refresh(); }} />}
    </StackPage>
  );
}

/** Os botões grandes do livro: o Button comum (coral ou cinzento), lado a lado ou à largura toda (`wide`). */
function Pill({ icon, label, onPress, primary = false, wide = false }: { icon: IconName; label: string; onPress: () => void; primary?: boolean; wide?: boolean }) {
  return <Button label={label} icon={icon} kind={primary ? 'primary' : 'secondary'} size="md" block={wide} onPress={onPress} style={wide ? undefined : { flex: 1 }} />;
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
          {photo ? <Image source={{ uri: photo }} style={st.photo} contentFit="cover" accessibilityLabel={t('A foto do pagamento')} /> : null}
          {d.venue ? <VenueLine v={d.venue} /> : null}
        </View>
      ) : null}
      {busy ? <ActivityIndicator color={colors.brand} /> : (
        <View style={st.actions}>
          {d.canClaim && <Small label={t('Já paguei')} onPress={onClaim} primary />}
          {d.canConfirm && <Small label={t('Confirmar')} onPress={onConfirm} primary />}
          {d.canConfirm && <Small label={t('Ainda não')} onPress={onReject} />}
          {d.canForgive && <Small label={t('Perdoar')} onPress={onForgive} />}
          {d.status === 'paid' && (d.iOwe || d.owedToMe) && <Small label={t('Publicar o momento')} onPress={onMoment} />}
        </View>
      )}
    </View>
  );
}

/** O local da gelada: o alfinete e «no Bar X» e, se estiveram mesmo lá, o selo «estiveram lá» com o visto. Só as duas pessoas o recebem. */
function VenueLine({ v }: { v: NonNullable<GeladaDebt['venue']> }) {
  return (
    <View style={st.venue} accessibilityLabel={`${venueTag(v)}${v.there ? t(', estiveram lá') : ''}`}>
      <Icon name="map-pin" size={15} color={colors.zinc600} />
      <Text style={st.venueText} numberOfLines={1}>{venueTag(v)}</Text>
      {v.there ? <View style={st.thereBadge}><Icon name="check" size={12} strokeWidth={2.6} color={colors.green700} /><Text style={st.thereText}>{t('estiveram lá')}</Text></View> : null}
    </View>
  );
}

/** As ações de cada dívida: o Button pequeno (36, com área de toque de 44). */
function Small({ label, onPress, primary = false }: { label: string; onPress: () => void; primary?: boolean }) {
  return <Button label={label} kind={primary ? 'primary' : 'secondary'} size="sm" onPress={onPress} />;
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
        title={t('Que deves a @{who}?', { who })}
        to={[who]}
        onPick={async (d) => {
          try {
            await geladaApi.owe(who, d.id);
            onDone();
          } catch (e) {
            Alert.alert(t('Não deu'), geladaErrorText(e, t('Não consegui agora. Tenta outra vez.')));
          }
        }}
        onClose={onClose}
      />
    );
  }
  return (
    <Sheet title={t('Fico a dever-te uma')} onClose={onClose} full>
      <View style={{ paddingHorizontal: 16, gap: 8, flex: 1 }}>
        <Text style={st.sheetText}>{t('A quem ficas a dever? Só tu crias estas dívidas.')}</Text>
        <SearchField value={search} onChangeText={setSearch} placeholder={t('Procurar amigos…')} accessibilityLabel={t('Procurar amigos')} />
        {friends.isLoading && <ActivityIndicator color={colors.brand} />}
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          {(friends.data?.items ?? []).map((p) => (
            <Pressable key={p.username} onPress={() => setWho(p.username)} style={({ pressed }) => [st.person, pressed && { backgroundColor: colors.zinc100 }]} accessibilityRole="button" accessibilityLabel={`${p.displayName}, @${p.username}`}>
              <Avatar name={p.displayName} username={p.username} size={40} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <NameWithBadge name={p.displayName} who={p} style={st.line} />
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

  card: { borderRadius: 18, borderWidth: 1, borderColor: colors.zinc200, backgroundColor: '#fff', padding: 12, gap: 10 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  line: { fontSize: 15, fontWeight: '700', color: colors.zinc900 },
  meta: { marginTop: 2, fontSize: 12, color: colors.zinc500 },
  badge: { borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 12, fontWeight: '700', color: colors.zinc700 },
  photo: { width: 72, height: 72, borderRadius: 12, backgroundColor: colors.zinc100 },
  venue: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  venueText: { flexShrink: 1, fontSize: 13, fontWeight: '600', color: colors.zinc700 },
  thereBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 999, backgroundColor: '#dcfce7', paddingHorizontal: 8, paddingVertical: 2 },
  thereText: { fontSize: 12, fontWeight: '700', color: colors.green700 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  sheetText: { fontSize: 15, lineHeight: 22, color: colors.zinc700 },
  fine: { marginTop: 8, textAlign: 'center', fontSize: 12, color: colors.zinc500 },

  person: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, paddingHorizontal: 4, paddingVertical: 6 },
});
