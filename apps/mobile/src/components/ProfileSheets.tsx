import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { api, uploadMedia, type Profile } from '@/lib/api';
import { type TasteVisibility } from '@/lib/api.geleira';
import { settingsApi } from '@/lib/api.settings';
import { colors } from '@/lib/theme';
import { Avatar, bumpAvatars } from './Avatar';
import { Icon, type IconName } from './Icon';
import { Sheet } from './Sheet';

/** Editar foto, nome, bio, cidade, link e tipo de perfil (público ou privado). */
export function EditProfileSheet({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [bio, setBio] = useState(profile.bio ?? '');
  const [city, setCity] = useState(profile.city ?? '');
  const [website, setWebsite] = useState(profile.website ?? '');
  const [isPrivate, setIsPrivate] = useState(profile.isPrivate);
  const [hasPhoto, setHasPhoto] = useState(profile.hasAvatar);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [err, setErr] = useState('');
  const [locating, setLocating] = useState(false);
  // Quem vê a geleira (inteira). Só se guarda se mudar.
  const gSettings = useQuery({ queryKey: ['geleira', 'settings'], queryFn: settingsApi.geleiraSettings, staleTime: 30_000 });
  const [gVis, setGVis] = useState<TasteVisibility | null>(null);
  useEffect(() => {
    if (gSettings.data && gVis === null) setGVis(gSettings.data.visibility);
  }, [gSettings.data, gVis]);

  /** Preenche "Cidade ou bairro" com o sítio onde estás agora (só o nome fica guardado, nunca as coordenadas). */
  async function useMyLocation() {
    setErr('');
    setLocating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) return setErr('Sem acesso à localização. Dá permissão ou escreve o sítio');
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const r = await api.nearbyPlaces(pos.coords.latitude, pos.coords.longitude);
      const label = [r.area, r.city].filter((x, i, a) => x && a.indexOf(x) === i).join(', ');
      if (label) setCity(label.slice(0, 40));
      else setErr('Não consegui saber o nome do sítio. Escreve-o tu');
    } catch {
      setErr('Não consegui saber a localização. Escreve o sítio');
    } finally {
      setLocating(false);
    }
  }

  async function pick() {
    setErr('');
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted && perm.canAskAgain === false) return setErr('Dá acesso às fotos nas definições do telemóvel');
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.85 });
      const a = r.canceled ? null : r.assets[0];
      if (!a) return;
      setPhotoBusy(true);
      const id = await uploadMedia(a.uri, a.mimeType ?? 'image/jpeg', 'public');
      await api.setAvatar(id);
      setHasPhoto(true);
      bumpAvatars();
      void qc.invalidateQueries({ queryKey: ['profile'] });
    } catch (e) {
      setErr((e as Error).message || 'Não consegui mudar a foto');
    } finally {
      setPhotoBusy(false);
    }
  }
  async function remove() {
    setPhotoBusy(true);
    try {
      await api.clearAvatar();
      setHasPhoto(false);
      bumpAvatars();
      void qc.invalidateQueries({ queryKey: ['profile'] });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setPhotoBusy(false);
    }
  }
  async function save() {
    if (!displayName.trim()) return setErr('Diz-nos o teu nome');
    setBusy(true);
    setErr('');
    try {
      await api.updateMe({ displayName: displayName.trim(), bio: bio.trim(), isPrivate, city: city.trim(), website: website.trim() });
      if (gVis && gSettings.data && gVis !== gSettings.data.visibility) {
        await settingsApi.setGeleiraSettings({ visibility: gVis });
        void qc.invalidateQueries({ queryKey: ['geleira'] });
      }
      for (const k of ['profile', 'feed', 'privacy']) void qc.invalidateQueries({ queryKey: [k] });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  const option = (value: boolean, icon: IconName, title: string, text: string) => (
    <Pressable onPress={() => setIsPrivate(value)} style={[st.option, isPrivate === value && { borderColor: colors.brand, backgroundColor: colors.rose50 }]} accessibilityRole="radio" accessibilityState={{ checked: isPrivate === value }}>
      <Icon name={icon} size={26} />
      <Text style={{ marginTop: 4, fontWeight: '700', fontSize: 16, color: colors.zinc900 }}>{title}</Text>
      <Text style={{ marginTop: 2, fontSize: 12, lineHeight: 16, color: colors.zinc600 }}>{text}</Text>
    </Pressable>
  );
  const label = (t: string, right?: string, bad?: boolean) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
      <Text style={st.label}>{t}</Text>
      {right ? <Text style={{ fontSize: 14, fontWeight: '600', color: bad ? colors.brand : colors.zinc500 }}>{right}</Text> : null}
    </View>
  );

  return (
    <Sheet title="Editar perfil" onClose={onClose} full>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16, gap: 16 }}>
        <View style={{ alignItems: 'center', gap: 12 }}>
          <Pressable onPress={() => void pick()} disabled={photoBusy} accessibilityRole="button" accessibilityLabel="Mudar foto de perfil">
            <Avatar name={displayName || profile.displayName} username={hasPhoto ? profile.username : undefined} size={96} />
            <View style={st.cam}><Icon name="camera" size={18} color="#fff" /></View>
            {photoBusy && <View style={st.busy}><ActivityIndicator color={colors.brand} /></View>}
          </Pressable>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable onPress={() => void pick()} disabled={photoBusy} style={st.ghost}><Text style={st.ghostText}>{hasPhoto ? 'Mudar foto' : 'Pôr uma foto'}</Text></Pressable>
            {hasPhoto && <Pressable onPress={() => void remove()} disabled={photoBusy} style={st.ghost}><Text style={st.ghostText}>Tirar foto</Text></Pressable>}
          </View>
        </View>

        <View>{label('Nome')}<TextInput value={displayName} onChangeText={setDisplayName} maxLength={60} autoComplete="name" style={st.input} accessibilityLabel="Nome" /></View>
        <View>
          {label('Bio', `${bio.length}/150`, bio.length > 140)}
          <TextInput value={bio} onChangeText={setBio} maxLength={150} multiline placeholder="Conta à malta quem és…" placeholderTextColor={colors.zinc500} style={[st.input, { minHeight: 84, textAlignVertical: 'top' }]} accessibilityLabel="Bio" />
        </View>
        <View>
          {label('Cidade ou bairro')}
          <View>
            <TextInput value={city} onChangeText={setCity} maxLength={40} placeholder="Maputo, Polana…" placeholderTextColor={colors.zinc500} style={[st.input, { paddingRight: 52 }]} accessibilityLabel="Cidade ou bairro" />
            <Pressable onPress={() => void useMyLocation()} disabled={locating} hitSlop={6} style={st.locate} accessibilityRole="button" accessibilityLabel="Usar a minha localização">
              {locating ? <ActivityIndicator color={colors.brand} /> : <Icon name="locate" size={22} color={colors.brand} />}
            </Pressable>
          </View>
        </View>
        <View>{label('Link')}<TextInput value={website} onChangeText={setWebsite} maxLength={100} placeholder="o-teu-site.com" placeholderTextColor={colors.zinc500} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={st.input} accessibilityLabel="Link" /></View>
        <View>
          {label('Tipo de perfil')}
          <View style={{ flexDirection: 'row', gap: 12 }} accessibilityRole="radiogroup">
            {option(false, 'globe', 'Público', 'Qualquer pessoa vê as tuas publicações e mimos e pode seguir-te.')}
            {option(true, 'lock', 'Privado', 'Só vê quem aprovares. Seguir passa a ser um pedido.')}
          </View>
          {profile.isPrivate && !isPrivate && <Text style={{ marginTop: 8, fontSize: 12, color: colors.zinc600 }}>Ao passar a público, os pedidos pendentes são aceites.</Text>}
        </View>
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <Icon name="snowflake" size={16} color="#0284c7" />
            <Text style={st.label}>A minha geleira · quem vê</Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup">
            {([['everyone', 'globe', 'Todos'], ['followers', 'users', 'Seguidores'], ['close_friends', 'heart', 'Amigos próximos'], ['me', 'lock', 'Só eu']] as const).map(([v, ic, text]) => (
              <Pressable key={v} onPress={() => setGVis(v)} disabled={gVis === null} accessibilityRole="radio" accessibilityState={{ checked: gVis === v, disabled: gVis === null }} style={[st.gopt, gVis === v && { borderColor: colors.brand, backgroundColor: colors.rose50 }, gVis === null && { opacity: 0.5 }]}>
                <Icon name={ic} size={18} />
                <Text style={{ fontSize: 14, fontWeight: '600', color: colors.zinc900 }}>{text}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={{ marginTop: 6, fontSize: 12, color: colors.zinc600 }}>A geleira é toda pública, para seguidores, para os amigos próximos ou só tua. Não se escolhe item a item.</Text>
          <Pressable onPress={() => { onClose(); router.push('/geleira' as never); }} style={({ pressed }) => [st.gshort, pressed && { backgroundColor: '#fafafa' }]} accessibilityRole="button">
            <View style={st.gicon}><Icon name="snowflake" size={22} color="#fff" /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: colors.zinc900 }}>Escolher os meus gostos</Text>
              <Text style={{ fontSize: 14, color: colors.zinc600 }}>Vibes, bebidas, comidas e sítios de que gostas.</Text>
            </View>
            <Icon name="chevron-right" size={20} color={colors.zinc500} />
          </Pressable>
        </View>
        <Text style={{ minHeight: 20, textAlign: 'center', fontSize: 14, color: colors.red600 }} accessibilityRole="alert">{err}</Text>
        <Pressable onPress={() => void save()} disabled={busy || photoBusy} style={({ pressed }) => [st.save, (busy || photoBusy) && { opacity: 0.6 }, pressed && { transform: [{ scale: 0.98 }] }]} accessibilityRole="button">
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={st.saveText}>Guardar</Text>}
        </Pressable>
      </ScrollView>
    </Sheet>
  );
}

/** Pedidos para seguir (perfis privados): aceitar ou recusar. */
export function RequestsSheet({ username, onClose }: { username: string; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['requests'], queryFn: api.followRequests });
  async function answer(u: string, accept: boolean) {
    await (accept ? api.acceptRequest(u) : api.declineRequest(u)).catch(() => undefined);
    await qc.invalidateQueries({ queryKey: ['requests'] });
    void qc.invalidateQueries({ queryKey: ['profile', username] });
  }
  const list = q.data ?? [];
  return (
    <Sheet title="Pedidos para seguir" onClose={onClose}>
      <ScrollView style={{ maxHeight: 420 }}>
        {q.isLoading && <ActivityIndicator style={{ margin: 24 }} color={colors.brand} />}
        {q.isSuccess && list.length === 0 && <Text style={{ textAlign: 'center', color: colors.zinc600, paddingVertical: 32, fontSize: 16 }}>Sem pedidos pendentes</Text>}
        {list.map((r) => (
          <View key={r.username} style={st.req}>
            <Avatar name={r.displayName} username={r.username} size={44} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: colors.zinc900 }} numberOfLines={1}>{r.displayName}</Text>
              <Text style={{ fontSize: 14, color: colors.zinc600 }} numberOfLines={1}>@{r.username}</Text>
            </View>
            <Pressable onPress={() => void answer(r.username, true)} style={st.accept} accessibilityRole="button"><Text style={{ color: '#fff', fontWeight: '600', fontSize: 14 }}>Aceitar</Text></Pressable>
            <Pressable onPress={() => void answer(r.username, false)} style={st.decline} accessibilityRole="button"><Text style={{ fontWeight: '600', fontSize: 14, color: colors.zinc900 }}>Recusar</Text></Pressable>
          </View>
        ))}
      </ScrollView>
    </Sheet>
  );
}

const st = StyleSheet.create({
  label: { fontSize: 14, fontWeight: '600', color: colors.zinc700 },
  input: { borderRadius: 16, backgroundColor: colors.zinc100, paddingHorizontal: 16, paddingVertical: 12, fontSize: 16, color: colors.zinc900, outlineStyle: 'none' as never },
  option: { flex: 1, borderRadius: 16, borderWidth: 2, borderColor: colors.zinc200, padding: 14 },
  locate: { position: 'absolute', right: 6, top: 0, bottom: 0, width: 44, alignItems: 'center', justifyContent: 'center' },
  cam: { position: 'absolute', right: -4, bottom: -4, width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: '#fff', backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  busy: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 48, backgroundColor: 'rgba(255,255,255,0.7)', alignItems: 'center', justifyContent: 'center' },
  ghost: { borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 16, paddingVertical: 8 },
  ghostText: { fontSize: 14, fontWeight: '600', color: colors.zinc900 },
  save: { height: 58, borderRadius: 999, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 24px rgba(214,51,79,0.35)' },
  saveText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  gopt: { width: '48.5%', height: 48, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 16, borderWidth: 2, borderColor: colors.zinc200, paddingHorizontal: 12 },
  gshort: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, borderWidth: 2, borderColor: colors.zinc200, padding: 12 },
  gicon: { width: 44, height: 44, borderRadius: 16, backgroundColor: '#0ea5e9', alignItems: 'center', justifyContent: 'center' },
  req: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  accept: { borderRadius: 999, backgroundColor: colors.brand, paddingHorizontal: 14, paddingVertical: 8 },
  decline: { borderRadius: 999, borderWidth: 1, borderColor: colors.zinc300, paddingHorizontal: 14, paddingVertical: 8 },
});
