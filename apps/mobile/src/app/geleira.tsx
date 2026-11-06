import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '@/components/BackButton';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { TasteBubble } from '@/components/TasteBubble';
import { geleiraApi, type CatalogItem, type TasteKind } from '@/lib/api.geleira';
import { CATEGORIES, ICE, KINDS, KIND_ICON, KIND_LABEL } from '@/lib/geleira';
import { colors } from '@/lib/theme';

const SKY50 = '#f0f9ff';
const SKY500 = '#0ea5e9';
const SKY700 = '#0369a1';
const SKY800 = '#075985';
const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const fmt = (n: number) => n.toLocaleString('pt-PT');
/** Quantos já tem a malta sem mim (o servidor conta-me se já tenho o item). */
const others = (i: CatalogItem) => Math.max(0, i.fans - (i.mine ? 1 : 0));

/** Nota de 1 a 5 flocos de gelo. Tocar no mesmo outra vez tira a nota. */
function IceRating({ value, onChange, size = 30 }: { value: number | null; onChange: (v: number | null) => void; size?: number }) {
  return (
    <View style={{ flexDirection: 'row' }} accessibilityRole="radiogroup" accessibilityLabel={value ? `Nota ${value} de 5: ${ICE[value]}` : 'Sem nota'}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} onPress={() => onChange(value === n ? null : n)} accessibilityRole="radio" accessibilityState={{ checked: value === n }} accessibilityLabel={`${n} de 5: ${ICE[n]}`} style={st.ice}>
          <Icon name="snowflake" size={size} color={!!value && n <= value ? SKY500 : colors.zinc300} />
        </Pressable>
      ))}
    </View>
  );
}

/**
 * Montar a geleira (gostos). As mudanças ficam num rascunho no ecrã e só vão para o servidor quando carregas em "Guardar";
 * se saíres com mudanças por guardar, pergunta. Uma só lista pesquisável, com separadores por tipo e grupos dentro de cada um.
 */
export default function GeleiraEditor() {
  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ kind?: string }>();
  const initial = (KINDS as string[]).includes(params.kind ?? '') ? (params.kind as TasteKind) : 'vibe';
  const [kind, setKind] = useState<TasteKind>(initial);
  const [text, setText] = useState('');
  const [group, setGroup] = useState<string>('todas');
  const [open, setOpen] = useState<string | null>(null);
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [saved, setSaved] = useState<CatalogItem[] | null>(null);
  const [toast, setToast] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [world, setWorld] = useState(false);
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const geo = useQuery({ queryKey: ['geo'], queryFn: geleiraApi.geo, staleTime: 10 * 60_000, retry: false });
  const countryName = (() => {
    const c = geo.data?.country;
    if (!c) return null;
    try {
      const DN = (Intl as unknown as { DisplayNames?: new (l: string[], o: { type: string }) => { of: (c: string) => string | undefined } }).DisplayNames;
      return DN ? (new DN(['pt'], { type: 'region' }).of(c) ?? null) : null;
    } catch {
      return null;
    }
  })();
  const cat = useQuery({ queryKey: ['geleira', 'catalog'], queryFn: () => geleiraApi.catalog('', undefined), staleTime: 0, gcTime: 0 });
  useEffect(() => {
    if (cat.data && !items) {
      setItems(cat.data);
      setSaved(cat.data);
    }
  }, [cat.data, items]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const say = (msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2500);
  };
  const edit = (id: string, patch: Partial<CatalogItem>) => setItems((l) => l && l.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  function toggle(i: CatalogItem) {
    if (i.mine) {
      edit(i.id, { mine: false, rating: null, favorite: false });
      setOpen(null);
    } else {
      edit(i.id, { mine: true });
      setOpen(i.id); // abre já para dar a nota
    }
  }

  // Sugerir cria o item no servidor (fica pendente e já entra na tua geleira), sem tocar no resto do rascunho.
  const create = useMutation({
    mutationFn: (b: { name: string; category: string }) => geleiraApi.suggest({ ...b, kind }),
    onSuccess: (n) => {
      const fresh: CatalogItem = { ...n, mine: true, rating: null, favorite: false, fans: 1, region: 'global' };
      setItems((l) => (l && !l.some((i) => i.id === n.id) ? [fresh, ...l] : l));
      setSaved((l) => (l && !l.some((i) => i.id === n.id) ? [fresh, ...l] : l));
      setText('');
      setSuggesting(false);
      void qc.invalidateQueries({ queryKey: ['geleira'], refetchType: 'none' });
    },
    onError: (e) => say((e as Error).message),
  });

  // Mudanças por guardar: entrou, saiu, ou mudou nota ou favorito.
  const changes = useMemo(() => {
    if (!items || !saved) return [];
    const was = new Map(saved.map((i) => [i.id, i]));
    return items.filter((i) => {
      const o = was.get(i.id);
      if (!o) return false;
      return i.mine !== o.mine || (i.mine && (i.rating !== o.rating || i.favorite !== o.favorite));
    });
  }, [items, saved]);

  const leave = () => (router.canGoBack() ? router.back() : router.replace('/wallet' as never));
  const back = () => (changes.length > 0 ? setLeaving(true) : leave());

  // O botão de voltar do Android também pergunta se há mudanças por guardar.
  const backRef = useRef(back);
  backRef.current = back;
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (changes.length === 0) return false;
      backRef.current();
      return true;
    });
    return () => sub.remove();
  }, [changes.length]);

  async function save() {
    if (!changes.length || saving) return;
    setSaving(true);
    try {
      await Promise.all(changes.map((i) => (i.mine ? geleiraApi.put(i.id, { rating: i.rating, favorite: i.favorite }) : geleiraApi.remove(i.id))));
      await qc.invalidateQueries({ queryKey: ['geleira'], refetchType: 'none' });
      void qc.invalidateQueries({ queryKey: ['geleira-level'] });
      leave();
    } catch {
      say('Não consegui guardar. Tenta outra vez.');
      setSaving(false);
    }
  }

  const list = items ?? [];
  const mine = list.filter((i) => i.mine);
  const count = useMemo(() => {
    const c: Record<TasteKind, number> = { vibe: 0, bebida: 0, comida: 0, sitio: 0 };
    for (const i of list) if (i.mine) c[i.kind] += 1;
    return c;
  }, [list]);

  const q = norm(text.trim());
  const groups = CATEGORIES[kind];
  // Só o que faz sentido onde estás (as do teu país e as de todo o lado); as de outros países vêm a pedido ou se já as tens.
  const inScope = (i: CatalogItem) => i.region !== 'foreign' || world || i.mine;
  const hiddenForeign = list.filter((i) => i.kind === kind && !inScope(i) && (!q || norm(i.name).includes(q))).length;
  const shown = list.filter((i) => i.kind === kind && inScope(i) && (group === 'todas' || i.category === group) && (!q || norm(i.name).includes(q)));
  const sections = useMemo(() => {
    const by = new Map<string, CatalogItem[]>();
    for (const i of shown) by.set(i.category, [...(by.get(i.category) ?? []), i]);
    const label = (slug: string) => groups.find((g) => g.slug === slug)?.label ?? slug.replace(/-/g, ' ');
    const pos = (slug: string) => {
      const k = groups.findIndex((g) => g.slug === slug);
      return k < 0 ? 99 : k;
    };
    return [...by.entries()].sort((a, b) => pos(a[0]) - pos(b[0])).map(([slug, rows]) => ({ slug, label: label(slug), rows }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, kind, group, world, q]);
  const exact = shown.some((i) => norm(i.name) === q);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.white, paddingTop: insets.top }}>
      <View style={{ borderBottomWidth: 1, borderBottomColor: colors.zinc100, backgroundColor: colors.white }}>
        <View style={st.top}>
          <BackButton onPress={back} />
          <Text style={st.title} numberOfLines={1}>A minha geleira</Text>
          <View style={st.count} accessibilityLiveRegion="polite">
            <Icon name="snowflake" size={16} color={SKY700} />
            <Text style={{ fontSize: 14, fontWeight: '800', color: SKY700 }}>{fmt(mine.length)}</Text>
          </View>
        </View>
        <View style={st.tabs} accessibilityRole="tablist">
          {KINDS.map((k) => {
            const on = kind === k;
            return (
              <Pressable
                key={k}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                onPress={() => {
                  setKind(k);
                  setGroup('todas');
                  setOpen(null);
                  setSuggesting(false);
                }}
                style={[st.tab, { backgroundColor: on ? colors.zinc900 : colors.zinc100 }]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Icon name={KIND_ICON[k]} size={16} color={on ? '#fff' : colors.zinc700} />
                  {count[k] > 0 && (
                    <View style={{ borderRadius: 999, paddingHorizontal: 6, backgroundColor: on ? 'rgba(255,255,255,0.25)' : '#fff' }}>
                      <Text style={{ fontSize: 11, lineHeight: 16, color: on ? '#fff' : colors.zinc700 }}>{count[k]}</Text>
                    </View>
                  )}
                </View>
                <Text style={{ fontSize: 12, fontWeight: '700', color: on ? '#fff' : colors.zinc700 }}>{KIND_LABEL[k]}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
          <View style={st.search}>
            <Icon name="search" size={18} color={colors.zinc500} />
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={`Procurar em ${KIND_LABEL[kind].toLowerCase()}…`}
              placeholderTextColor={colors.zinc500}
              accessibilityLabel="Procurar"
              maxLength={40}
              style={st.input}
            />
            {text ? (
              <Pressable onPress={() => setText('')} accessibilityLabel="Limpar" style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="x" size={16} color={colors.zinc500} />
              </Pressable>
            ) : null}
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingBottom: 12 }} style={{ flexGrow: 0 }} accessibilityRole="radiogroup" accessibilityLabel="Grupo">
          {[{ slug: 'todas', label: 'Tudo' }, ...groups].map((g) => {
            const on = group === g.slug;
            return (
              <Pressable key={g.slug} onPress={() => setGroup(g.slug)} accessibilityRole="radio" accessibilityState={{ checked: on }} style={[st.chip, { backgroundColor: on ? colors.brand : colors.zinc100 }]}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: on ? '#fff' : colors.zinc700 }}>{g.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {(kind === 'bebida' || kind === 'sitio') && (hiddenForeign > 0 || world) && (
          <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
            <Pressable onPress={() => setWorld(!world)} accessibilityRole="button" accessibilityState={{ selected: world }} style={st.world}>
              <Icon name="globe" size={16} color={SKY800} />
              <Text style={{ fontSize: 14, fontWeight: '600', color: SKY800, flexShrink: 1 }} numberOfLines={1}>
                {world
                  ? `A mostrar bebidas de todo o mundo · só ${countryName ?? 'do meu país'}`
                  : `${countryName ? `Bebidas de ${countryName} e de todo o lado` : 'Bebidas do teu país'} · ver de outros países (${hiddenForeign})`}
              </Text>
            </Pressable>
          </View>
        )}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 128 }} keyboardShouldPersistTaps="handled">
        {!items && (
          <View style={{ gap: 8 }} accessibilityLabel="A carregar">
            {[0, 1, 2, 3, 4, 5].map((n) => <View key={n} style={{ height: 68, borderRadius: 16, backgroundColor: colors.zinc100 }} />)}
          </View>
        )}
        {cat.isError && !items && <Text style={st.none}>Não consegui abrir a geleira.</Text>}
        {items &&
          sections.map((s) => (
            <View key={s.slug} style={{ marginBottom: 16 }} accessibilityLabel={s.label}>
              <Text style={st.sectionTitle}>{s.label}</Text>
              <View style={st.card}>
                {s.rows.map((i, n) => {
                  const expanded = open === i.id && i.mine;
                  return (
                    <View key={i.id} style={{ backgroundColor: i.mine ? 'rgba(240,249,255,0.5)' : '#fff', borderTopWidth: n ? 1 : 0, borderTopColor: colors.zinc100 }}>
                      <View style={st.row}>
                        <Pressable onPress={() => (i.mine ? setOpen(expanded ? null : i.id) : toggle(i))} accessibilityRole="button" accessibilityState={i.mine ? { expanded } : undefined} style={st.rowMain}>
                          <TasteBubble item={i} size={46} dim={!i.mine} />
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                              <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 16, fontWeight: '600', lineHeight: 20, color: colors.zinc900 }}>{i.name}</Text>
                              {i.favorite && <Icon name="heart" size={14} solid color={colors.brand} />}
                            </View>
                            <Text numberOfLines={1} style={{ fontSize: 13, lineHeight: 18, color: colors.zinc500 }}>
                              {i.pending ? 'À espera de aprovação' : i.mine ? (i.rating ? ICE[i.rating] : 'Dá-lhe gelo') : others(i) > 0 ? `${fmt(others(i))} na geleira da malta` : 'Ninguém tem ainda. Sê o primeiro'}
                            </Text>
                          </View>
                        </Pressable>
                        <Pressable
                          onPress={() => toggle(i)}
                          accessibilityRole="button"
                          accessibilityState={{ selected: i.mine }}
                          accessibilityLabel={i.mine ? `Tirar ${i.name}` : `Juntar ${i.name}`}
                          style={[st.plus, i.mine ? { backgroundColor: colors.brand } : { borderWidth: 1, borderColor: colors.zinc300 }]}
                        >
                          <Icon name={i.mine ? 'check' : 'plus'} size={20} color={i.mine ? '#fff' : colors.zinc600} />
                        </Pressable>
                      </View>
                      {expanded && (
                        <View style={{ paddingHorizontal: 12, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <IceRating value={i.rating} onChange={(rating) => edit(i.id, { rating })} />
                          <Pressable
                            onPress={() => edit(i.id, { favorite: !i.favorite })}
                            accessibilityRole="button"
                            accessibilityState={{ selected: i.favorite }}
                            accessibilityLabel="Favorito"
                            style={[st.plus, { backgroundColor: i.favorite ? colors.rose50 : colors.zinc100 }]}
                          >
                            <Icon name="heart" size={20} solid={i.favorite} color={i.favorite ? colors.brand : colors.zinc600} />
                          </Pressable>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            </View>
          ))}

        {items && sections.length === 0 && <Text style={st.none}>Nada com esse nome em {KIND_LABEL[kind].toLowerCase()}.</Text>}

        {items && q.length >= 2 && !exact && (
          <View style={st.suggest}>
            {!suggesting ? (
              <Pressable onPress={() => setSuggesting(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }} accessibilityRole="button">
                <View style={st.sparkle}><Icon name="sparkles" size={22} color={colors.zinc900} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '600', color: colors.zinc900 }}>Não está cá? Sugere “{text.trim()}”</Text>
                  <Text style={{ fontSize: 14, color: colors.zinc500 }}>Entra já na tua geleira; a malta vê depois de aprovado.</Text>
                </View>
              </Pressable>
            ) : (
              <>
                <Text style={{ fontSize: 16, fontWeight: '600', color: colors.zinc900 }}>Em que grupo fica “{text.trim()}”?</Text>
                <View style={{ marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {groups.map((g) => (
                    <Pressable key={g.slug} disabled={create.isPending} onPress={() => create.mutate({ name: text.trim(), category: g.slug })} accessibilityRole="button" style={[st.pick, create.isPending && { opacity: 0.5 }]}>
                      <Text style={{ fontSize: 14, fontWeight: '600', color: '#fff' }}>{g.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}
          </View>
        )}
      </ScrollView>

      <View style={[st.bar, { paddingBottom: Math.max(12, insets.bottom) }]}>
        <Text style={{ flex: 1, fontSize: 14, lineHeight: 18, color: colors.zinc600 }}>
          <Text style={{ fontWeight: '700', color: colors.zinc900 }}>{mine.length}</Text> {mine.length === 1 ? 'gosto' : 'gostos'}
        </Text>
        <Pressable onPress={() => void save()} disabled={changes.length === 0 || saving} accessibilityRole="button" style={[st.save, (changes.length === 0 || saving) && { backgroundColor: 'rgba(214,51,79,0.4)' }]}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#fff' }}>{saving ? 'A guardar…' : changes.length > 0 ? `Guardar (${changes.length})` : 'Guardar'}</Text>
        </Pressable>
      </View>

      {leaving && (
        <Sheet title="Sair sem guardar?" onClose={() => setLeaving(false)}>
          <View style={{ paddingHorizontal: 24 }}>
            <Text style={{ marginBottom: 16, fontSize: 16, lineHeight: 24, color: colors.zinc600 }}>
              Tens {changes.length} {changes.length === 1 ? 'mudança' : 'mudanças'} na geleira que ainda não guardaste.
            </Text>
            <Pressable onPress={() => { setLeaving(false); void save(); }} accessibilityRole="button" style={[st.big, { backgroundColor: colors.brand }]}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: '#fff' }}>Guardar e sair</Text>
            </Pressable>
            <Pressable onPress={leave} accessibilityRole="button" style={[st.big, { marginTop: 8 }]}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: '#b91c1c' }}>Sair sem guardar</Text>
            </Pressable>
            <Pressable onPress={() => setLeaving(false)} accessibilityRole="button" style={[st.big, { marginTop: 4 }]}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: colors.zinc700 }}>Continuar a editar</Text>
            </Pressable>
          </View>
        </Sheet>
      )}
      {toast ? (
        <View pointerEvents="none" style={st.toast} accessibilityLiveRegion="polite">
          <Text style={{ fontSize: 14, fontWeight: '500', color: '#fff' }}>{toast}</Text>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 8 },
  title: { flex: 1, fontSize: 20, fontWeight: '800', color: colors.zinc900 },
  count: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, backgroundColor: SKY50, paddingHorizontal: 12, paddingVertical: 6 },
  tabs: { flexDirection: 'row', gap: 4, paddingHorizontal: 12, paddingBottom: 8 },
  tab: { flex: 1, height: 56, alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: 16 },
  search: { height: 44, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 16 },
  input: { flex: 1, minWidth: 0, fontSize: 16, color: colors.zinc900, paddingVertical: 0, outlineStyle: 'none' } as never,
  chip: { height: 36, borderRadius: 999, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  world: { height: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 999, backgroundColor: SKY50, paddingHorizontal: 12 },
  sectionTitle: { paddingHorizontal: 4, paddingBottom: 4, paddingTop: 8, fontSize: 12, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: colors.zinc500 },
  card: { overflow: 'hidden', borderRadius: 16, borderWidth: 1, borderColor: colors.zinc200 },
  row: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12 },
  rowMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  plus: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  ice: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  none: { paddingVertical: 40, textAlign: 'center', fontSize: 16, color: colors.zinc600 },
  suggest: { marginTop: 8, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.zinc300, padding: 16 },
  sparkle: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  pick: { height: 40, borderRadius: 999, backgroundColor: colors.zinc900, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderTopColor: colors.zinc100, backgroundColor: 'rgba(255,255,255,0.95)', paddingHorizontal: 16, paddingTop: 12 },
  save: { height: 48, borderRadius: 999, backgroundColor: colors.brand, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' },
  big: { height: 48, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  toast: { position: 'absolute', bottom: 96, alignSelf: 'center', borderRadius: 999, backgroundColor: colors.zinc900, paddingHorizontal: 20, paddingVertical: 10 },
});
