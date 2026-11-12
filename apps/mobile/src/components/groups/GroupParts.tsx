import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useState, type ReactNode } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { NameWithBadge } from '@/components/NameWithBadge';
import { Icon, type IconName } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { abs, sized } from '@/lib/config';
import { GROUP_KINDS, groupsApi, kindInfo, toIsoDay, dayOf, type GroupKind, type VenueHit } from '@/lib/api.groups';
import { colors } from '@/lib/theme';

/** A capa do TxillGroup (foto) ou, sem capa, o ícone do tipo sobre o coral claro. */
export function GroupCover({ url, kind, size = 48, radius }: { url?: string | null; kind?: GroupKind | null; size?: number; radius?: number }) {
  const r = radius ?? Math.round(size * 0.3);
  const src = url ? abs(url) ?? url : null;
  if (src) return <Image source={{ uri: sized(src, size * 3) }} style={{ width: size, height: size, borderRadius: r, backgroundColor: colors.zinc100 }} contentFit="cover" accessibilityIgnoresInvertColors />;
  return (
    <View style={{ width: size, height: size, borderRadius: r, backgroundColor: colors.rose50, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={kindInfo(kind).icon} size={Math.round(size * 0.48)} color={colors.brand} />
    </View>
  );
}

/** Os chips do tipo (Viagem, Festa, Fim de semana, Outro). */
export function KindChips({ value, onChange }: { value: GroupKind; onChange: (k: GroupKind) => void }) {
  return (
    <View style={ps.chips} accessibilityRole="radiogroup" accessibilityLabel="Tipo de TxillGroup">
      {GROUP_KINDS.map((k) => {
        const on = k.id === value;
        return (
          <Pressable key={k.id} onPress={() => onChange(k.id)} style={[ps.chip, on && ps.chipOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
            <Icon name={k.icon} size={18} color={on ? '#fff' : colors.zinc800} />
            <Text style={[ps.chipText, on && { color: '#fff' }]}>{k.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Um bloco do Plano: título, à direita uma ação opcional, e o conteúdo num cartão. */
export function Section({ title, icon, action, children, style }: { title: string; icon?: IconName; action?: ReactNode; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[ps.section, style]}>
      <View style={ps.sectionHead}>
        {icon && <Icon name={icon} size={18} color={colors.zinc700} />}
        <Text style={ps.sectionTitle}>{title}</Text>
        <View style={{ flex: 1 }} />
        {action}
      </View>
      {children}
    </View>
  );
}

/** Botão pílula (coral cheio, cinzento ou só texto). */
export function Pill({ label, onPress, kind = 'brand', icon, disabled, busy, small, style }: { label: string; onPress: () => void; kind?: 'brand' | 'soft' | 'ghost' | 'danger'; icon?: IconName; disabled?: boolean; busy?: boolean; small?: boolean; style?: StyleProp<ViewStyle> }) {
  const bg = kind === 'brand' ? colors.brand : kind === 'soft' ? colors.zinc100 : kind === 'danger' ? '#fef2f2' : 'transparent';
  const fg = kind === 'brand' ? '#fff' : kind === 'danger' ? '#b91c1c' : colors.zinc900;
  return (
    <Pressable onPress={onPress} disabled={disabled || busy} accessibilityRole="button" accessibilityState={{ disabled: !!(disabled || busy) }} style={({ pressed }) => [ps.pill, small && ps.pillSmall, { backgroundColor: bg }, (disabled || busy) && { opacity: 0.45 }, pressed && { transform: [{ scale: 0.97 }] }, style]}>
      {icon && <Icon name={icon} size={small ? 15 : 18} color={fg} />}
      <Text style={[ps.pillText, small && { fontSize: 13 }, { color: fg }]} numberOfLines={1}>{busy ? 'Um momento…' : label}</Text>
    </Pressable>
  );
}

export function Field(props: React.ComponentProps<typeof TextInput>) {
  return <TextInput placeholderTextColor={colors.zinc500} {...props} style={[ps.input, props.multiline && { height: undefined, minHeight: 80, borderRadius: 20, paddingTop: 12, textAlignVertical: 'top' }, props.style]} />;
}

export const ErrText = ({ text }: { text: string }) => (text ? <Text style={ps.err} accessibilityRole="alert">{text}</Text> : null);

/**
 * Confirmação na folha da app (igual no telemóvel e no site): título, as consequências, uma sugestão discreta e dois botões.
 * Só "Confirmar" faz o pedido; enquanto grava, os botões ficam presos; um erro mostra a mensagem do servidor e a folha fica aberta.
 */
export function ConfirmSheet({ title, lines, hint, confirmLabel = 'Confirmar', cancelLabel = 'Voltar', danger, onConfirm, onClose }: { title: string; lines: string[]; hint?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean; onConfirm: () => Promise<unknown>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function go() {
    setBusy(true);
    setErr('');
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setErr((e as Error).message || 'Não deu. Verifica a internet e tenta outra vez.');
      setBusy(false);
    }
  }
  return (
    <Sheet title={title} onClose={() => { if (!busy) onClose(); }}>
      <View style={{ paddingHorizontal: 24, gap: 10 }} accessibilityLiveRegion="polite">
        {lines.map((l, i) => <Text key={i} style={ps.confirmText}>{l}</Text>)}
        {hint ? <Text style={ps.confirmHint}>{hint}</Text> : null}
        <ErrText text={err} />
        <Pressable onPress={() => void go()} disabled={busy} style={[ps.confirmGo, danger && { backgroundColor: '#b91c1c' }, busy && { opacity: 0.6 }]} accessibilityRole="button" accessibilityState={{ disabled: busy, busy }} accessibilityLabel={busy ? 'A guardar' : confirmLabel}>
          <Text style={ps.confirmGoText}>{busy ? 'A guardar…' : confirmLabel}</Text>
        </Pressable>
        <Pressable onPress={onClose} disabled={busy} style={ps.confirmBack} accessibilityRole="button">
          <Text style={ps.confirmBackText}>{cancelLabel}</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

// ----- datas -----
const WEEK = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];
/** Calendário do Plano: toca no primeiro dia e depois no último (ou só num, para um dia). Igual no telemóvel e no site. */
export function DateRangeSheet({ start, end, onSave, onClose }: { start: string | null; end: string | null; onSave: (start: string | null, end: string | null) => void; onClose: () => void }) {
  const [a, setA] = useState<string | null>(start);
  const [b, setB] = useState<string | null>(end);
  const base = a ? dayOf(a) : new Date();
  const [month, setMonth] = useState(new Date(base.getFullYear(), base.getMonth(), 1));
  const today = toIsoDay(new Date());
  const first = (month.getDay() + 6) % 7; // semana começa à segunda
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (string | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => toIsoDay(new Date(month.getFullYear(), month.getMonth(), i + 1)))];
  while (cells.length % 7) cells.push(null);
  function tap(d: string) {
    if (!a || b || d < a) { setA(d); setB(null); return; }
    setB(d === a ? null : d);
  }
  const label = month.toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });
  return (
    <Sheet title="Datas" onClose={onClose}>
      <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
        <View style={ps.calHead}>
          <Pressable onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} style={ps.calNav} accessibilityRole="button" accessibilityLabel="Mês anterior"><Icon name="chevron-left" size={20} /></Pressable>
          <Text style={ps.calTitle}>{label.charAt(0).toUpperCase() + label.slice(1)}</Text>
          <Pressable onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} style={ps.calNav} accessibilityRole="button" accessibilityLabel="Mês seguinte"><Icon name="chevron-right" size={20} /></Pressable>
        </View>
        <View style={ps.calGrid}>
          {WEEK.map((w, i) => <Text key={`w${i}`} style={ps.calWeek}>{w}</Text>)}
          {cells.map((d, i) => {
            if (!d) return <View key={`e${i}`} style={ps.calCell} />;
            const edge = d === a || d === b;
            const inside = !!a && !!b && d > a && d < b;
            return (
              <Pressable key={d} onPress={() => tap(d)} style={ps.calCell} accessibilityRole="button" accessibilityState={{ selected: edge }} accessibilityLabel={dayOf(d).toLocaleDateString('pt-PT', { day: 'numeric', month: 'long' })}>
                <View style={[ps.calDay, inside && { backgroundColor: colors.rose50 }, edge && { backgroundColor: colors.brand }]}>
                  <Text style={[ps.calNum, d === today && { color: colors.brand, fontWeight: '800' }, edge && { color: '#fff' }, d < today && !edge && { color: colors.zinc300 }]}>{Number(d.slice(8))}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
        <Text style={ps.calHint}>{!a ? 'Toca no primeiro dia.' : !b ? 'Toca no último dia (ou guarda só este).' : 'Pronto. Podes guardar.'}</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
          {(start || a) && <Pill label="Tirar datas" kind="ghost" onPress={() => { onSave(null, null); onClose(); }} />}
          <Pill label="Guardar" disabled={!a} onPress={() => { onSave(a, b); onClose(); }} style={{ flex: 1 }} />
        </View>
      </View>
    </Sheet>
  );
}

// ----- locais -----
/** Procura um local (página) do Txillapp. Com `txillsOnly`, só mostra os que aceitam Txills. */
export function VenuePickerSheet({ title, txillsOnly = false, onPick, onClose }: { title: string; txillsOnly?: boolean; onPick: (v: VenueHit) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const term = q.trim();
  const r = useQuery({ queryKey: ['venue-search', term], queryFn: () => groupsApi.searchVenues(term), enabled: term.length >= 2, staleTime: 30_000 });
  const rows = (r.data ?? []).filter((v) => !txillsOnly || v.acceptsTxills !== false);
  return (
    <Sheet title={title} onClose={onClose} full>
      <View style={{ flex: 1, paddingHorizontal: 16 }}>
        <View style={ps.search}>
          <Icon name="search" size={18} color={colors.zinc500} />
          <TextInput value={q} onChangeText={setQ} autoFocus placeholder="Nome do local ou cidade" placeholderTextColor={colors.zinc500} style={ps.searchInput} accessibilityLabel="Procurar locais" />
        </View>
        {txillsOnly && <Text style={ps.calHint}>Só aparecem locais que aceitam Txills.</Text>}
        <FlatList
          data={rows}
          keyExtractor={(v) => v.slug}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<Text style={ps.none}>{term.length < 2 ? 'Escreve pelo menos duas letras.' : r.isLoading ? 'A procurar…' : 'Nenhum local com esse nome.'}</Text>}
          renderItem={({ item: v }) => (
            <Pressable onPress={() => { onPick(v); onClose(); }} style={({ pressed }) => [ps.row, pressed && { backgroundColor: colors.zinc100 }]}>
              {v.avatarUrl ? <Image source={{ uri: sized(abs(v.avatarUrl) ?? v.avatarUrl, 120) }} style={{ width: 44, height: 44, borderRadius: 12 }} /> : <View style={[ps.venueIcon]}><Icon name="store" size={20} color={colors.zinc600} /></View>}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={ps.rowName} numberOfLines={1}>{v.name}</Text>
                <Text style={ps.rowSub} numberOfLines={1}>{[v.city, v.acceptsTxills ? 'Aceita Txills' : null].filter(Boolean).join(' · ') || `@${v.slug}`}</Text>
              </View>
            </Pressable>
          )}
        />
      </View>
    </Sheet>
  );
}

// ----- pessoas -----
export interface MiniPerson { username: string; displayName: string; hasAvatar: boolean; /** Selo de verificado. */ verified?: boolean; verifiedTier?: 'verified' | 'official' | 'paid' | null }
/** Escolher uma ou várias pessoas do TxillGroup (para quem paga, dividir entre, responsável). */
export function MemberPickSheet({ title, people, selected, multiple, allowNone, onDone, onClose }: { title: string; people: MiniPerson[]; selected: string[]; multiple?: boolean; allowNone?: boolean; onDone: (usernames: string[]) => void; onClose: () => void }) {
  const [sel, setSel] = useState<string[]>(selected);
  const toggle = (u: string) => {
    if (!multiple) { onDone([u]); onClose(); return; }
    setSel((l) => (l.includes(u) ? l.filter((x) => x !== u) : [...l, u]));
  };
  return (
    <Sheet title={title} onClose={onClose} full>
      <View style={{ flex: 1, paddingHorizontal: 12 }}>
        <FlatList
          data={people}
          keyExtractor={(p) => p.username}
          ListHeaderComponent={allowNone && !multiple ? (
            <Pressable onPress={() => { onDone([]); onClose(); }} style={({ pressed }) => [ps.row, pressed && { backgroundColor: colors.zinc100 }]}>
              <View style={ps.venueIcon}><Icon name="x" size={18} color={colors.zinc600} /></View>
              <Text style={ps.rowName}>Ninguém</Text>
            </Pressable>
          ) : multiple ? (
            <Pressable onPress={() => setSel(sel.length === people.length ? [] : people.map((p) => p.username))} style={{ paddingHorizontal: 8, paddingVertical: 8 }} accessibilityRole="button">
              <Text style={{ color: colors.brand, fontWeight: '700' }}>{sel.length === people.length ? 'Tirar todos' : 'Escolher todos'}</Text>
            </Pressable>
          ) : undefined}
          renderItem={({ item: p }) => {
            const on = sel.includes(p.username);
            return (
              <Pressable onPress={() => toggle(p.username)} accessibilityState={{ selected: on }} style={({ pressed }) => [ps.row, pressed && { backgroundColor: colors.zinc100 }]}>
                <Avatar name={p.displayName} username={p.hasAvatar ? p.username : undefined} size={40} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <NameWithBadge name={p.displayName} who={p} style={ps.rowName} />
                  <Text style={ps.rowSub} numberOfLines={1}>@{p.username}</Text>
                </View>
                {multiple ? <View style={[ps.check, on && { borderColor: colors.brand, backgroundColor: colors.brand }]}>{on && <Icon name="check" size={14} strokeWidth={3} color="#fff" />}</View> : on ? <Icon name="check" size={18} color={colors.brand} /> : null}
              </Pressable>
            );
          }}
        />
        {multiple && <View style={{ paddingVertical: 12 }}><Pill label={`Feito${sel.length ? ` · ${sel.length}` : ''}`} disabled={!sel.length} onPress={() => { onDone(sel); onClose(); }} /></View>}
      </View>
    </Sheet>
  );
}

/** Pequena fila de avatares sobrepostos (máx. 5) com "+N". */
export function AvatarStack({ people, size = 28, max = 5 }: { people: MiniPerson[]; size?: number; max?: number }) {
  const shown = people.slice(0, max);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {shown.map((p, i) => (
        <View key={p.username} style={{ marginLeft: i ? -size * 0.3 : 0, borderRadius: size, borderWidth: 2, borderColor: colors.white }}>
          <Avatar name={p.displayName} username={p.hasAvatar ? p.username : undefined} size={size} />
        </View>
      ))}
      {people.length > max && <Text style={{ marginLeft: 6, fontSize: 12, fontWeight: '700', color: colors.zinc600 }}>+{people.length - max}</Text>}
    </View>
  );
}

export const ps = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { height: 40, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 14 },
  chipOn: { backgroundColor: colors.brand },
  chipText: { fontSize: 14, fontWeight: '700', color: colors.zinc800 },
  section: { marginBottom: 14, borderRadius: 20, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.zinc100, padding: 14 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, minHeight: 28 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: colors.zinc900 },
  pill: { height: 44, flexDirection: 'row', gap: 6, borderRadius: 999, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  pillSmall: { height: 32, paddingHorizontal: 12 },
  pillText: { fontSize: 15, fontWeight: '700' },
  input: { height: 46, borderRadius: 23, backgroundColor: colors.zinc100, paddingHorizontal: 18, fontSize: 16, color: colors.zinc900, outlineStyle: 'none' } as object,
  err: { marginVertical: 6, textAlign: 'center', fontSize: 14, color: colors.red600 },
  calHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  calNav: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.zinc100 },
  calTitle: { fontSize: 16, fontWeight: '800', color: colors.zinc900 },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calWeek: { width: `${100 / 7}%`, textAlign: 'center', fontSize: 12, fontWeight: '700', color: colors.zinc500, paddingVertical: 6 },
  calCell: { width: `${100 / 7}%`, aspectRatio: 1, padding: 2 },
  calDay: { flex: 1, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  calNum: { fontSize: 15, fontWeight: '600', color: colors.zinc900 },
  calHint: { marginTop: 8, textAlign: 'center', fontSize: 13, color: colors.zinc500 },
  search: { height: 44, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 22, backgroundColor: colors.zinc100, paddingHorizontal: 16 },
  searchInput: { flex: 1, minWidth: 0, fontSize: 16, color: colors.zinc900, padding: 0, outlineStyle: 'none' } as object,
  none: { paddingVertical: 40, textAlign: 'center', color: colors.zinc500 },
  row: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, paddingHorizontal: 8 },
  rowName: { fontSize: 16, fontWeight: '600', color: colors.zinc900 },
  rowSub: { fontSize: 13, color: colors.zinc500 },
  venueIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.zinc300, alignItems: 'center', justifyContent: 'center' },
  confirmText: { fontSize: 16, lineHeight: 22, color: colors.zinc700 },
  confirmHint: { fontSize: 13, lineHeight: 18, color: colors.zinc500 },
  confirmGo: { marginTop: 6, height: 48, borderRadius: 24, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  confirmGoText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  confirmBack: { height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  confirmBackText: { fontSize: 16, fontWeight: '600', color: colors.zinc700 },
});
