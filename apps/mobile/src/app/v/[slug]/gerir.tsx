import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { Empty } from '@/components/Empty';
import { Icon } from '@/components/Icon';
import { PlaceField, type PlaceFieldHandle } from '@/components/PlaceField';
import { PontoLoader } from '@/components/PontoLoader';
import { PullView, usePullToRefresh } from '@/components/PullToRefresh';
import { StackPage } from '@/components/StackPage';
import { VenueLogo } from '@/components/VenueCard';
import { VenueQr } from '@/components/VenueQr';
import { VenueTxills, venuePaymentsKey } from '@/components/VenueTxills';
import { uploadMedia } from '@/lib/api';
import { eventWhen, nearbyApi } from '@/lib/api.nearby';
import { KINDS, KIND_LABEL, ROLE_LABEL, locaisApi, type ManagerRole, type Venue, type VenueKind, type VenueProfileInput } from '@/lib/api.locais';
import { useAuth } from '@/lib/auth';
import { sized } from '@/lib/config';
import { formatAddress, needsMapPin, showsOnMap, venuePlace, venuePlaceBody, type PlaceValue } from '@/lib/placeField';
import { colors } from '@/lib/theme';

type Section = 'perfil' | 'gestores' | 'eventos' | 'qr' | 'txills' | 'painel';

/** Gerir a página de um local: perfil (logótipo, capa, contactos), gestores (convidar, papéis), eventos, QR do check-in, Txills e o painel. */
export default function ManageVenue() {
  const { slug = '', s } = useLocalSearchParams<{ slug: string; s?: Section }>();
  const q = useQuery({ queryKey: ['venue', slug], queryFn: () => locaisApi.venue(slug), retry: false });
  const v = q.data;
  const qc = useQueryClient();
  const [section, setSection] = useState<Section>(s ?? 'perfil');
  // O atalho do aviso "ainda não está no mapa": vai ao Perfil e abre o mapa (ou a pesquisa) do campo "Onde fica?".
  const [pinAsk, setPinAsk] = useState<{ what: 'map' | 'search'; n: number } | null>(null);
  const askPin = (what: 'map' | 'search') => { setSection('perfil'); setPinAsk((o) => ({ what, n: (o?.n ?? 0) + 1 })); };
  // A notificação de pagamento abre ?s=txills: se a página já estava aberta, muda de secção.
  useEffect(() => { if (s) setSection(s); }, [s]);
  const sections: [Section, string][] = [['perfil', 'Perfil'], ['gestores', 'Gestores'], ['eventos', 'Eventos'], ['qr', 'QR'], ['txills', 'Txills'], ['painel', 'Painel']];
  // Puxar para atualizar: o local (saldo, estado) e, na secção Txills, os pagamentos recebidos.
  const pull = usePullToRefresh(() => Promise.all([q.refetch(), section === 'txills' ? qc.invalidateQueries({ queryKey: venuePaymentsKey(slug) }) : section === 'eventos' ? qc.invalidateQueries({ queryKey: ['venue-events', slug] }) : null]), q.isRefetching);

  return (
    <StackPage title={v ? `Gerir ${v.name}` : 'Gerir o local'}>
      {q.isLoading ? (
        <View style={{ alignItems: 'center', paddingVertical: 64 }}><PontoLoader size={20} /></View>
      ) : !v || !v.mine ? (
        <Empty icon="lock" title="Só os gestores entram aqui" />
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <PullView pull={pull}>
          <ScrollView contentContainerStyle={{ paddingBottom: 48 }} keyboardShouldPersistTaps="handled" onScroll={pull.onScroll} scrollEventThrottle={16} refreshControl={pull.control}>
            {v.canEdit && needsMapPin(v) ? (
              <View style={st.mapNotice} accessibilityRole="alert">
                <Icon name="map-pin" size={20} color="#b45309" />
                <View style={{ flex: 1, gap: 8 }}>
                  <Text style={st.mapNoticeText}>Este local ainda não está no mapa. Marca onde fica.</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    <Pressable onPress={() => askPin('map')} style={st.noticeBtn} accessibilityRole="button"><Icon name="map" size={15} color="#fff" /><Text style={st.noticeBtnText}>Marcar no mapa</Text></Pressable>
                    <Pressable onPress={() => askPin('search')} style={[st.noticeBtn, { backgroundColor: colors.white }]} accessibilityRole="button"><Icon name="search" size={15} color={colors.zinc900} /><Text style={[st.noticeBtnText, { color: colors.zinc900 }]}>Procurar o sítio</Text></Pressable>
                  </View>
                </View>
              </View>
            ) : null}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}>
              {sections.map(([id, label]) => (
                <Pressable key={id} onPress={() => setSection(id)} accessibilityRole="tab" accessibilityState={{ selected: section === id }} style={[st.tab, section === id && st.tabOn]}>
                  <Text style={[st.tabText, section === id && { color: '#fff' }]}>{label}</Text>
                </Pressable>
              ))}
            </ScrollView>
            {section === 'perfil' && <Profile v={v} pinAsk={pinAsk} />}
            {section === 'gestores' && <Managers v={v} />}
            {section === 'eventos' && <Events v={v} />}
            {section === 'qr' && (v.qrToken ? <View style={{ paddingTop: 4 }}><VenueQr venue={v} /></View> : null)}
            {section === 'txills' && <VenueTxills v={v} />}
            {section === 'painel' && <Insights v={v} />}
          </ScrollView>
          </PullView>
        </KeyboardAvoidingView>
      )}
    </StackPage>
  );
}

/** O perfil da página: logótipo, capa e os campos; só o dono e os administradores editam. */
function Profile({ v, pinAsk }: { v: Venue; pinAsk: { what: 'map' | 'search'; n: number } | null }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: v.name, kind: v.kind as VenueKind, about: v.about ?? '', hours: v.hours ?? '', phone: v.phone ?? '', whatsapp: v.whatsapp ?? '', website: v.website ?? '' });
  // O sítio (ponto, morada e cidade) e se aparece no mapa do À tua volta.
  const [place, setPlace] = useState<PlaceValue | null>(() => venuePlace(v));
  const [showOnMap, setShowOnMap] = useState(showsOnMap(v));
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<'avatar' | 'cover' | null>(null);
  const [msg, setMsg] = useState('');
  const placeRef = useRef<PlaceFieldHandle>(null);
  useEffect(() => {
    setF({ name: v.name, kind: v.kind, about: v.about ?? '', hours: v.hours ?? '', phone: v.phone ?? '', whatsapp: v.whatsapp ?? '', website: v.website ?? '' });
    setPlace(venuePlace(v));
    setShowOnMap(showsOnMap(v));
  }, [v]);
  useEffect(() => {
    if (!pinAsk) return;
    const t = setTimeout(() => (pinAsk.what === 'map' ? placeRef.current?.openMap() : placeRef.current?.focus()), 60);
    return () => clearTimeout(t);
  }, [pinAsk]);
  // Sem ponto ainda: a pesquisa já começa com a morada (ou o nome e a cidade) que o local tinha em texto.
  const startQuery = v.address ? formatAddress(v) : v.city ? `${v.name}, ${v.city}` : '';
  const set = (k: keyof typeof f, val: string) => setF((o) => ({ ...o, [k]: val }));

  async function save(patch?: VenueProfileInput) {
    setBusy(true);
    setMsg('');
    try {
      const body: VenueProfileInput = patch ?? {
        name: f.name.trim(), kind: f.kind, about: f.about.trim() || null,
        // Sem sítio escolhido a morada e a cidade em texto ficam como estavam.
        ...venuePlaceBody(place, showOnMap),
        hours: f.hours.trim() || null, phone: f.phone.trim() || null, whatsapp: f.whatsapp.trim() || null, website: f.website.trim() || null,
      };
      const nv = await locaisApi.updateVenue(v.slug, body);
      qc.setQueryData(['venue', v.slug], nv);
      void qc.invalidateQueries({ queryKey: ['venues-mine'] });
      setMsg('Guardado.');
    } catch (e) {
      setMsg((e as Error).message);
    }
    setBusy(false);
  }
  /** Escolhe uma foto (galeria do aparelho ou ficheiro no computador), envia-a e põe-na como logótipo ou capa. */
  async function pick(what: 'avatar' | 'cover') {
    try {
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: what === 'avatar' ? [1, 1] : [16, 7], quality: 0.9 });
      if (r.canceled || !r.assets[0]) return;
      setUploading(what);
      const a = r.assets[0];
      const id = await uploadMedia(a.uri, a.mimeType ?? 'image/jpeg', 'public');
      await save(what === 'avatar' ? { avatarMediaId: id } : { coverMediaId: id });
    } catch (e) {
      Alert.alert('Não consegui enviar a foto', (e as Error).message || 'Tenta outra vez.');
    } finally {
      setUploading(null);
    }
  }

  if (!v.canEdit) {
    return (
      <View style={{ paddingHorizontal: 16 }}>
        <Text style={st.hint}>Só o dono e os administradores editam o perfil. Tu és {ROLE_LABEL[v.role ?? 'editor'].toLowerCase()}: podes publicar como a página.</Text>
      </View>
    );
  }
  const input = (k: keyof typeof f, placeholder: string, extra?: Partial<React.ComponentProps<typeof TextInput>>) => (
    <TextInput key={k} value={f[k] as string} onChangeText={(t) => set(k, t)} placeholder={placeholder} placeholderTextColor={colors.zinc500} accessibilityLabel={placeholder} style={[st.input, extra?.multiline && { height: 110, textAlignVertical: 'top' }]} {...extra} />
  );
  return (
    <View style={{ paddingHorizontal: 16, gap: 12 }}>
      <Pressable onPress={() => void pick('cover')} style={st.coverPick} accessibilityRole="button" accessibilityLabel="Mudar a capa">
        {v.coverUrl ? <Image source={{ uri: sized(v.coverUrl, 1080) }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
        <View style={st.pickBadge}><Icon name="camera" size={16} color="#fff" /><Text style={st.pickText}>{uploading === 'cover' ? 'A enviar…' : v.coverUrl ? 'Mudar a capa' : 'Pôr uma capa'}</Text></View>
      </Pressable>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <VenueLogo venue={v} size={72} />
        <Pressable onPress={() => void pick('avatar')} style={st.secondary} accessibilityRole="button"><Icon name="image" size={18} color={colors.zinc900} /><Text style={st.secondaryText}>{uploading === 'avatar' ? 'A enviar…' : v.avatarUrl ? 'Mudar o logótipo' : 'Pôr o logótipo'}</Text></Pressable>
      </View>

      <Text style={st.label}>Nome e tipo</Text>
      {input('name', 'Nome do local', { maxLength: 80 })}
      <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {KINDS.map((k) => (
          <Pressable key={k} onPress={() => setF((o) => ({ ...o, kind: k }))} accessibilityRole="radio" accessibilityState={{ selected: f.kind === k }} style={[st.chip, f.kind === k && { backgroundColor: colors.zinc900 }]}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: f.kind === k ? '#fff' : colors.zinc800 }}>{KIND_LABEL[k]}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={st.label}>Onde e quando</Text>
      <PlaceField ref={placeRef} label="Onde fica?" value={place} onChange={setPlace} initialQuery={place ? '' : startQuery} placeholder="Procurar o sítio… (nome, rua ou bairro)" mapHint="Arrasta o mapa até o alfinete ficar na porta do local." />
      {!place && (v.address || v.city) ? <Text style={st.hint}>Em texto: {formatAddress(v)}. Escolhe o sítio para o local aparecer no mapa.</Text> : null}
      <View style={st.switchRow}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.zinc900 }}>Mostrar no mapa</Text>
          <Text style={{ fontSize: 13, lineHeight: 18, color: colors.zinc600 }}>O teu local aparece no mapa do À tua volta. Desliga se não tiver porta aberta ao público.</Text>
        </View>
        <Switch value={showOnMap} onValueChange={setShowOnMap} trackColor={{ true: colors.brand, false: colors.zinc300 }} thumbColor="#fff" {...({ activeThumbColor: '#fff' } as object)} accessibilityLabel="Mostrar no mapa do À tua volta" />
      </View>
      {input('hours', 'Horário (ex.: Ter a Dom, 18h às 2h)', { maxLength: 300 })}
      <Text style={st.label}>Contactos</Text>
      {input('phone', 'Telefone', { keyboardType: 'phone-pad', maxLength: 30 })}
      {input('whatsapp', 'WhatsApp (com indicativo, ex.: +258 84…)', { keyboardType: 'phone-pad', maxLength: 30 })}
      {input('website', 'Site (https://…)', { autoCapitalize: 'none', keyboardType: 'url', maxLength: 200 })}
      <Text style={st.label}>Sobre</Text>
      {input('about', 'Conta o que é o local, o ambiente, o que a malta vem cá fazer', { multiline: true, maxLength: 1000 })}
      <Text accessibilityRole="alert" style={{ minHeight: 20, textAlign: 'center', fontSize: 14, color: msg === 'Guardado.' ? colors.green700 : colors.red600 }}>{msg}</Text>
      <Pressable onPress={() => void save()} disabled={busy || f.name.trim().length < 2} style={[st.cta, (busy || f.name.trim().length < 2) && { opacity: 0.5 }]} accessibilityRole="button">
        <Text style={st.ctaText}>{busy ? 'A guardar…' : 'Guardar'}</Text>
      </Pressable>
    </View>
  );
}

/** Os gestores: o dono, os administradores e os editores; convidar por @; mudar papel; tirar; sair. */
function Managers({ v }: { v: Venue }) {
  const qc = useQueryClient();
  const router = useRouter();
  const { user } = useAuth();
  const q = useQuery({ queryKey: ['venue-managers', v.slug], queryFn: () => locaisApi.managers(v.slug), retry: false });
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<ManagerRole>('editor');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const refresh = (data?: unknown) => { if (Array.isArray(data)) qc.setQueryData(['venue-managers', v.slug], data); else void qc.invalidateQueries({ queryKey: ['venue-managers', v.slug] }); };

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setMsg('');
    try { refresh(await fn()); setMsg(ok); } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  }
  const invite = () => run(() => locaisApi.invite(v.slug, username.trim(), role), 'Convite enviado. A pessoa recebe uma notificação para aceitar.').then(() => setUsername(''));
  const remove = (u: string, self: boolean) => {
    const go = () => run(async () => {
      const r = await locaisApi.removeManager(v.slug, u);
      if ('left' in r) { void qc.invalidateQueries({ queryKey: ['venue', v.slug] }); void qc.invalidateQueries({ queryKey: ['venues-mine'] }); router.back(); }
      return r;
    }, self ? 'Saíste da página.' : 'Gestor removido.');
    if (Platform.OS === 'web') { if (confirm(self ? 'Sair desta página?' : `Tirar @${u} da página?`)) void go(); return; }
    Alert.alert(self ? 'Sair da página?' : `Tirar @${u}?`, self ? 'Deixas de poder publicar como este local.' : 'Deixa de poder gerir ou publicar como este local.', [{ text: 'Cancelar', style: 'cancel' }, { text: self ? 'Sair' : 'Tirar', style: 'destructive', onPress: () => void go() }]);
  };

  return (
    <View style={{ paddingHorizontal: 16, gap: 12 }}>
      <Text style={st.hint}>Administradores editam o perfil e gerem os gestores. Editores publicam como a página. Só o dono não pode ser tirado.</Text>
      {(q.data ?? []).map((m) => {
        const self = m.username === user?.username;
        return (
          <View key={m.username} style={st.mRow}>
            <Pressable onPress={() => router.push(`/u/${m.username}` as never)} accessibilityRole="link"><Avatar name={m.displayName} username={m.hasAvatar ? m.username : undefined} size={44} /></Pressable>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: colors.zinc900 }} numberOfLines={1}>{m.displayName}{self ? ' (tu)' : ''}</Text>
              <Text style={{ fontSize: 13, color: colors.zinc500 }} numberOfLines={1}>@{m.username} · {ROLE_LABEL[m.role]}{m.status === 'pending' ? ' · convite por aceitar' : ''}</Text>
            </View>
            {m.role !== 'owner' && (v.canEdit || self) ? (
              <View style={{ flexDirection: 'row', gap: 4 }}>
                {v.canEdit && m.status === 'active' ? (
                  <Pressable onPress={() => void run(() => locaisApi.setRole(v.slug, m.username, m.role === 'admin' ? 'editor' : 'admin'), 'Papel alterado.')} disabled={busy} style={st.iconBtn} accessibilityRole="button" accessibilityLabel={m.role === 'admin' ? 'Passar a editor' : 'Passar a administrador'}>
                    <Icon name={m.role === 'admin' ? 'user' : 'shield'} size={18} color={colors.zinc800} />
                  </Pressable>
                ) : null}
                <Pressable onPress={() => remove(m.username, self)} disabled={busy} style={st.iconBtn} accessibilityRole="button" accessibilityLabel={self ? 'Sair da página' : 'Tirar da página'}>
                  <Icon name={self ? 'logout' : 'x'} size={18} color={colors.red600} />
                </Pressable>
              </View>
            ) : null}
          </View>
        );
      })}
      {v.canEdit ? (
        <View style={st.inviteBox}>
          <Text style={{ fontSize: 16, fontWeight: '800', color: colors.zinc900 }}>Convidar um gestor</Text>
          <TextInput value={username} onChangeText={setUsername} placeholder="@utilizador" placeholderTextColor={colors.zinc500} autoCapitalize="none" autoCorrect={false} accessibilityLabel="Nome de utilizador" style={st.input} />
          <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 8 }}>
            {(['editor', 'admin'] as const).map((r) => (
              <Pressable key={r} onPress={() => setRole(r)} accessibilityRole="radio" accessibilityState={{ selected: role === r }} style={[st.chip, role === r && { backgroundColor: colors.zinc900 }]}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: role === r ? '#fff' : colors.zinc800 }}>{ROLE_LABEL[r]}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={() => void invite()} disabled={busy || username.trim().length < 3} style={[st.cta, (busy || username.trim().length < 3) && { opacity: 0.5 }]} accessibilityRole="button">
            <Text style={st.ctaText}>{busy ? 'A enviar…' : 'Enviar convite'}</Text>
          </Pressable>
        </View>
      ) : null}
      {msg ? <Text accessibilityRole="alert" style={{ textAlign: 'center', fontSize: 14, color: colors.zinc700 }}>{msg}</Text> : null}
    </View>
  );
}

/** O painel: números da semana e os check-ins dos últimos 14 dias. */
/** Eventos do local: criar um novo (dono e todos os gestores ativos) e ver os próximos. Aparecem na página e no mapa À tua volta. */
function Events({ v }: { v: Venue }) {
  const router = useRouter();
  const q = useQuery({ queryKey: ['venue-events', v.slug], queryFn: () => nearbyApi.venueEvents(v.slug), staleTime: 60_000, retry: false });
  const list = q.data ?? [];
  return (
    <View style={{ paddingHorizontal: 16, gap: 12 }}>
      <Text style={st.hint}>Anuncia o que vai acontecer: uma noite de kizomba, o jogo no ecrã grande, um concerto. Aparece na página do local e no mapa À tua volta.</Text>
      <Pressable onPress={() => router.push(`/evento/novo?venue=${encodeURIComponent(v.slug)}` as never)} style={[st.cta, { flexDirection: 'row', gap: 8 }]} accessibilityRole="button">
        <Icon name="plus" size={18} color="#fff" />
        <Text style={st.ctaText}>Criar evento</Text>
      </Pressable>
      {q.isLoading ? (
        <View style={{ alignItems: 'center', paddingVertical: 24 }}><PontoLoader size={20} /></View>
      ) : list.length ? (
        <View style={{ gap: 8 }}>
          <Text style={st.label}>Próximos</Text>
          {list.map((e) => (
            <Pressable key={e.id} onPress={() => router.push(`/evento/${e.id}` as never)} style={st.mRow} accessibilityRole="link">
              <View style={st.iconBtn}><Icon name="calendar" size={18} color={colors.zinc800} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: colors.zinc900 }} numberOfLines={1}>{e.title}</Text>
                <Text style={{ fontSize: 13, color: colors.zinc500 }} numberOfLines={1}>{eventWhen(e.startsAt, e.endsAt)}{e.interested ? ` · ${e.interested} com interesse` : ''}</Text>
              </View>
              <Icon name="chevron-right" size={18} color={colors.zinc500} />
            </Pressable>
          ))}
        </View>
      ) : (
        <Text style={[st.hint, { textAlign: 'center', paddingVertical: 16 }]}>Ainda não há eventos marcados.</Text>
      )}
    </View>
  );
}

function Insights({ v }: { v: Venue }) {
  const q = useQuery({ queryKey: ['venue-insights', v.slug], queryFn: () => locaisApi.insights(v.slug), retry: false });
  const d = q.data;
  if (!d) return <View style={{ alignItems: 'center', paddingVertical: 40 }}><PontoLoader size={20} /></View>;
  const max = Math.max(1, ...d.days.map((x) => x.checkins));
  const stat = (n: number, label: string, sub?: string) => (
    <View key={label} style={st.stat}>
      <Text style={{ fontSize: 24, fontWeight: '800', color: colors.zinc900 }}>{n.toLocaleString('pt-PT')}</Text>
      <Text style={{ fontSize: 13, fontWeight: '600', color: colors.zinc700 }}>{label}</Text>
      {sub ? <Text style={{ fontSize: 12, color: colors.zinc500 }}>{sub}</Text> : null}
    </View>
  );
  return (
    <View style={{ paddingHorizontal: 16, gap: 12 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {stat(d.followers, 'Seguidores', `+${d.followersWeek} esta semana`)}
        {stat(d.checkins, 'Check-ins', `${d.checkinsWeek} esta semana`)}
        {stat(d.peopleMonth, 'Pessoas no último mês')}
        {stat(d.posts, 'Publicações da página', `${d.cheers} brindes · ${d.comments} comentários`)}
        {stat(d.mentions, 'Posts da malta aqui')}
      </View>
      <View style={st.chart}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: colors.zinc900, marginBottom: 10 }}>Check-ins nos últimos 14 dias</Text>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 90 }}>
          {d.days.map((x) => (
            <View key={x.day} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' }} accessibilityLabel={`${x.day}: ${x.checkins} check-ins`}>
              <View style={{ width: '100%', height: `${Math.max(4, Math.round((x.checkins / max) * 100))}%`, borderRadius: 4, backgroundColor: x.checkins ? colors.brand : colors.zinc200 }} />
            </View>
          ))}
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
          <Text style={{ fontSize: 11, color: colors.zinc500 }}>{d.days[0]?.day.slice(5).split('-').reverse().join('/')}</Text>
          <Text style={{ fontSize: 11, color: colors.zinc500 }}>hoje</Text>
        </View>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  mapNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginHorizontal: 16, marginTop: 12, borderRadius: 16, backgroundColor: '#fffbeb', padding: 14 },
  mapNoticeText: { fontSize: 15, lineHeight: 21, fontWeight: '700', color: '#78350f' },
  noticeBtn: { height: 36, borderRadius: 999, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.zinc900 },
  noticeBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, backgroundColor: '#fafafa', padding: 14 },
  tab: { height: 36, borderRadius: 999, paddingHorizontal: 16, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: colors.zinc900 },
  tabText: { fontSize: 14, fontWeight: '700', color: colors.zinc700 },
  hint: { fontSize: 14, lineHeight: 20, color: colors.zinc600 },
  label: { marginTop: 6, fontSize: 13, fontWeight: '700', color: colors.zinc500, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { borderRadius: 16, backgroundColor: colors.zinc100, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: colors.zinc900 },
  chip: { height: 40, borderRadius: 999, paddingHorizontal: 16, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  cta: { height: 48, borderRadius: 999, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  ctaText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  secondary: { height: 40, borderRadius: 999, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.zinc100 },
  secondaryText: { fontSize: 14, fontWeight: '700', color: colors.zinc900 },
  coverPick: { height: 150, borderRadius: 20, overflow: 'hidden', backgroundColor: colors.zinc900, alignItems: 'center', justifyContent: 'center' },
  pickBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 14, paddingVertical: 8 },
  pickText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  mRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, backgroundColor: '#fafafa', padding: 12 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  inviteBox: { gap: 10, borderRadius: 20, backgroundColor: colors.rose50, padding: 14 },
  stat: { flexBasis: '48%', flexGrow: 1, borderRadius: 16, backgroundColor: '#fafafa', padding: 14 },
  chart: { borderRadius: 20, backgroundColor: '#fafafa', padding: 14 },
});
