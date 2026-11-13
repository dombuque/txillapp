import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError, api } from '@/lib/api';
import { geladaApi, geladaKeys, type DrinkChoice, type GeladaChannel } from '@/lib/api.gelada';
import { useAuth } from '@/lib/auth';
import { drinkEmoji, drinkPhrase, pickable } from '@/lib/gelada';
import { colors } from '@/lib/theme';
import { Avatar } from '../Avatar';
import { Icon } from '../Icon';
import { ActivityIndicator } from '../PontoLoader';
import { Sheet } from '../Sheet';
import { TasteBubble } from '../TasteBubble';
import { DrinkSheet } from './DrinkSheet';

const AMBER_INK = '#92400e';
type Friend = { username: string; displayName: string; mutual: boolean };

/**
 * «Paga-me uma»: pedir a um ou mais amigos que te paguem uma bebida. Numa folha só: a bebida (vem escolhida — a que tocaste
 * na geleira ou a tua favorita — e muda-se com «Mudar»), os amigos (mútuos primeiro, depois quem segues; com `lockTo` já vêm
 * escolhidos), «Mandar no chat» ou «Publicar» (em público só a seguidores mútuos, com legenda opcional) e quantos pedidos
 * ainda tens hoje. Com menores no pedido só há refrescos: o servidor já manda as bebidas sem álcool e o texto muda sozinho.
 */
export function AskSheet({ to, itemId, lockTo = false, defaultChannel = 'chat', onClose }: { to?: string[]; itemId?: string | null; lockTo?: boolean; defaultChannel?: 'chat' | 'post'; onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [chosen, setChosen] = useState<Friend[]>(() => (to ?? []).map((u) => ({ username: u.replace(/^@/, ''), displayName: u.replace(/^@/, ''), mutual: true })));
  const [channel, setChannel] = useState<GeladaChannel>(defaultChannel);
  const [caption, setCaption] = useState('');
  const [search, setSearch] = useState('');
  const [drinkId, setDrinkId] = useState<string | null>(itemId ?? null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');
  const doneTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(doneTimer.current), []);

  const names = chosen.map((c) => c.username);
  const drinks = useQuery({ queryKey: geladaKeys.drinks(names), queryFn: () => geladaApi.drinks(names), staleTime: 60_000, placeholderData: (prev) => prev });
  // Os amigos: quem eu sigo (mútuos primeiro). A pesquisa vai ao servidor.
  const friends = useQuery({
    queryKey: ['gelada-friends', user?.username, search.trim()],
    queryFn: () => api.following(user!.username, undefined, search.trim() || undefined),
    enabled: !lockTo && !!user,
    staleTime: 60_000,
  });

  // A bebida: a escolhida (se ainda pode ir, p.ex. sem álcool quando há menores), senão a favorita, senão a primeira.
  const list = drinks.data?.drinks ?? [];
  const picked = list.find((d) => d.id === drinkId);
  const fallback = list.find((d) => d.id === drinks.data?.suggested) ?? list[0];
  const drink: DrinkChoice | undefined = picked ?? fallback;
  const swapped = !!drinkId && !picked && !!drinks.data?.soft && list.length > 0;

  const people: Friend[] = useMemo(
    () => pickable((friends.data?.items ?? []).map((p) => ({ username: p.username, displayName: p.displayName, mutual: !!p.followsYou })), channel),
    [friends.data, channel],
  );
  const toggle = (f: Friend) => setChosen((l) => (l.some((x) => x.username === f.username) ? l.filter((x) => x.username !== f.username) : l.length >= 10 ? l : [...l, f]));
  const notMutual = !lockTo && channel === 'post' ? chosen.filter((c) => !c.mutual) : [];
  const left = drinks.data?.left ?? 10;
  const canSend = !!drink && chosen.length > 0 && chosen.length <= left && !busy && notMutual.length === 0;

  async function send() {
    if (!drink || !canSend) return;
    setBusy(true);
    setErr('');
    try {
      const r = await geladaApi.ask({ to: names, itemId: drink.id, channel, caption: channel === 'post' ? caption.trim() || undefined : undefined });
      void qc.invalidateQueries({ queryKey: ['gelada-drinks'] });
      if (r.post) {
        onClose();
        router.push(`/p/${r.post.id}` as never);
      } else if (names.length === 1) {
        onClose();
        router.push(`/messages/${names[0]}` as never);
      } else {
        setDone(`Pedido enviado a ${names.length} amigos ${drinkEmoji(drink)}`);
        doneTimer.current = setTimeout(onClose, 1400);
      }
    } catch (e) {
      setErr(e instanceof ApiError && e.message ? e.message : 'Não consegui mandar o pedido. Tenta outra vez.');
      setBusy(false);
    }
  }

  const who = chosen.length ? chosen.map((c) => `@${c.username}`).join(', ') : 'a malta';
  const ask = drink ? `Paga-me ${drinkPhrase(drink)} ${drinkEmoji(drink)}` : 'Paga-me uma';

  return (
    <>
    <Sheet title="Paga-me uma" onClose={onClose} full>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, gap: 16 }}>
        {/* O cartão, como vai chegar. */}
        <LinearGradient colors={['#fffbeb', '#fef3c7']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.preview}>
          {drink ? <TasteBubble item={{ slug: drink.slug, kind: 'bebida', category: drink.category }} size={72} /> : <View style={[st.bubbleSkel]} />}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={st.previewTo} numberOfLines={1}>Para {who}</Text>
            <Text style={st.previewText} accessibilityRole="header">{ask}</Text>
            {drink && !drink.alcoholic ? <Text style={st.previewSub} numberOfLines={1}>{drink.name}</Text> : null}
          </View>
          <Pressable onPress={() => setPicking(true)} style={({ pressed }) => [st.change, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={drink ? `Mudar a bebida, agora ${drink.name}` : 'Escolher a bebida'}>
            <Text style={st.changeText}>Mudar</Text>
          </Pressable>
        </LinearGradient>
        {swapped ? <Text style={st.note}>Há menores no pedido: vai um refresco no lugar.</Text> : drinks.data?.soft ? <Text style={st.note}>Só refrescos e sumos neste pedido.</Text> : null}

        {/* Por onde vai. */}
        <View style={st.seg} accessibilityRole="radiogroup" accessibilityLabel="Por onde mandar">
          {([['chat', 'messages', 'Mandar no chat'], ['post', 'compose', 'Publicar']] as const).map(([c, ic, label]) => {
            const on = channel === c;
            return (
              <Pressable key={c} onPress={() => setChannel(c)} style={[st.segBtn, on && st.segOn]} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                <Icon name={ic} size={18} color={on ? '#fff' : colors.zinc700} />
                <Text style={[st.segText, on && { color: '#fff' }]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={st.hint}>
          {channel === 'chat' ? 'Chega como um cartão na conversa, com «Bora!», «Hoje não» e «Fica a dever».' : 'Vai para o teu perfil com a malta identificada. Só quem pediste responde; os outros brindam e comentam.'}
        </Text>
        {channel === 'post' && (
          <TextInput value={caption} onChangeText={setCaption} maxLength={300} placeholder="Legenda (opcional) · ex.: É sexta, malta!" placeholderTextColor={colors.zinc500} style={st.input} accessibilityLabel="Legenda" multiline />
        )}

        {/* A quem. */}
        <View style={{ gap: 8 }}>
          <Text style={st.label}>{lockTo ? 'A quem' : 'A quem pedes'}</Text>
          {chosen.length > 0 && (
            <View style={st.chips}>
              {chosen.map((c) => (
                <Pressable key={c.username} disabled={lockTo} onPress={() => toggle(c)} style={[st.chip, !lockTo && notMutual.includes(c) && { borderColor: colors.red600 }]} accessibilityRole="button" accessibilityLabel={lockTo ? `@${c.username}` : `Tirar @${c.username}`}>
                  <Avatar name={c.displayName} username={c.username} size={24} />
                  <Text style={st.chipText} numberOfLines={1}>@{c.username}</Text>
                  {!lockTo && <Icon name="x" size={14} color={colors.zinc600} />}
                </Pressable>
              ))}
            </View>
          )}
          {notMutual.length > 0 && <Text style={st.err}>Em público só pedes a quem te segue de volta. Tira {notMutual.map((n) => `@${n.username}`).join(', ')} ou manda no chat.</Text>}
          {!lockTo && (
            <>
              <View style={st.search}>
                <Icon name="search" size={18} color={colors.zinc500} />
                <TextInput value={search} onChangeText={setSearch} placeholder="Procurar amigos…" placeholderTextColor={colors.zinc500} style={st.searchInput} accessibilityLabel="Procurar amigos" autoCapitalize="none" autoCorrect={false} maxLength={40} />
              </View>
              {friends.isLoading && <ActivityIndicator color={colors.brand} style={{ paddingVertical: 12 }} />}
              {friends.isSuccess && people.length === 0 && <Text style={st.hint}>{channel === 'post' ? 'Ninguém mútuo com esse nome.' : 'Ninguém com esse nome entre quem segues.'}</Text>}
              {people.slice(0, 30).map((p) => {
                const on = chosen.some((c) => c.username === p.username);
                return (
                  <Pressable key={p.username} onPress={() => toggle(p)} style={({ pressed }) => [st.person, pressed && { backgroundColor: colors.zinc100 }]} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`${p.displayName}, @${p.username}${p.mutual ? ', seguem-se os dois' : ''}`}>
                    <Avatar name={p.displayName} username={p.username} size={40} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={st.personName} numberOfLines={1}>{p.displayName}</Text>
                      <Text style={st.personHandle} numberOfLines={1}>@{p.username}{p.mutual ? ' · seguem-se' : ''}</Text>
                    </View>
                    <View style={[st.tick, on && st.tickOn]}>{on && <Icon name="check" size={14} color="#fff" />}</View>
                  </Pressable>
                );
              })}
            </>
          )}
        </View>

        <Text style={[st.hint, left <= 2 && { color: AMBER_INK, fontWeight: '600' }]} accessibilityLiveRegion="polite">
          {left <= 0 ? 'Já fizeste os pedidos todos de hoje. Amanhã há mais 🙌' : `Ainda podes fazer ${left} ${left === 1 ? 'pedido' : 'pedidos'} hoje (até 3 ao mesmo amigo).`}
        </Text>
        {err ? <Text style={st.err} accessibilityRole="alert">{err}</Text> : null}
        {done ? <Text style={st.done} accessibilityLiveRegion="polite">{done}</Text> : null}
        <Pressable onPress={() => void send()} disabled={!canSend} style={({ pressed }) => [st.send, !canSend && { opacity: 0.45 }, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityState={{ disabled: !canSend, busy }}>
          {busy ? <ActivityIndicator color="#fff" /> : <Icon name={channel === 'post' ? 'compose' : 'send'} size={18} color="#fff" />}
          <Text style={st.sendText}>{channel === 'post' ? 'Publicar o pedido' : chosen.length > 1 ? `Mandar a ${chosen.length}` : 'Mandar'}</Text>
        </Pressable>
        <Text style={st.fine}>Sem dinheiro nem Txills: é entre amigos. Bebe com moderação 🙌</Text>
      </ScrollView>
    </Sheet>
      {picking && (
        <DrinkSheet
          title="Que bebida pedes?"
          to={names}
          selected={drink?.id ?? null}
          onPick={(d) => {
            setDrinkId(d.id);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}

const st = StyleSheet.create({
  preview: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 22, borderWidth: 1, borderColor: '#fde68a', padding: 14 },
  bubbleSkel: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.zinc100 },
  previewTo: { fontSize: 13, fontWeight: '600', color: AMBER_INK },
  previewText: { marginTop: 2, fontSize: 19, lineHeight: 24, fontWeight: '800', color: colors.zinc900 },
  previewSub: { marginTop: 2, fontSize: 13, color: colors.zinc600 },
  change: { height: 36, paddingHorizontal: 14, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: '#fcd34d', alignItems: 'center', justifyContent: 'center', minWidth: 44 },
  changeText: { fontSize: 14, fontWeight: '700', color: AMBER_INK },
  note: { marginTop: -8, fontSize: 13, color: colors.zinc600 },
  seg: { flexDirection: 'row', gap: 8 },
  segBtn: { flex: 1, height: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 999, backgroundColor: colors.zinc100 },
  segOn: { backgroundColor: colors.zinc900 },
  segText: { fontSize: 15, fontWeight: '700', color: colors.zinc800 },
  hint: { fontSize: 13, lineHeight: 18, color: colors.zinc600 },
  input: { minHeight: 48, borderRadius: 16, backgroundColor: colors.zinc100, paddingHorizontal: 16, paddingVertical: 12, fontSize: 16, color: colors.zinc900, textAlignVertical: 'top', outlineStyle: 'none' } as never,
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: colors.zinc500 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { height: 36, maxWidth: 220, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.zinc200, paddingLeft: 6, paddingRight: 10, backgroundColor: '#fff' },
  chipText: { flexShrink: 1, fontSize: 14, fontWeight: '600', color: colors.zinc900 },
  search: { height: 44, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 16 },
  searchInput: { flex: 1, minWidth: 0, fontSize: 16, color: colors.zinc900, paddingVertical: 0, outlineStyle: 'none' } as never,
  person: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, paddingHorizontal: 4, paddingVertical: 6 },
  personName: { fontSize: 15, fontWeight: '600', color: colors.zinc900 },
  personHandle: { fontSize: 13, color: colors.zinc500 },
  tick: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.zinc300, alignItems: 'center', justifyContent: 'center' },
  tickOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  err: { fontSize: 14, lineHeight: 20, color: colors.red600 },
  done: { fontSize: 15, fontWeight: '700', color: colors.green700, textAlign: 'center' },
  send: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 999, backgroundColor: colors.brand },
  sendText: { fontSize: 17, fontWeight: '800', color: '#fff' },
  fine: { textAlign: 'center', fontSize: 12, color: colors.zinc500 },
});
