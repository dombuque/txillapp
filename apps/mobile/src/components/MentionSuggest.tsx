import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type StyleProp, type TextInput, type TextInputKeyPressEvent, type TextInputSelectionChangeEvent, type ViewStyle } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { NameWithBadge } from '@/components/NameWithBadge';
import { api, type MentionSuggestContext, type MentionSuggestion } from '@/lib/api';
import { activeMention, applyMention, moveHighlight, reasonLabel } from '@/lib/mentions';
import { colors } from '@/lib/theme';

const ROW = 52;
const DEBOUNCE_MS = 150;
const web = Platform.OS === 'web';

type Sel = { start: number; end: number };

/**
 * No site, o Modal das folhas (Sheet) fecha-se com o Esc no "keyup" do documento. Quando o Esc só fecha as
 * sugestões, esse keyup fica por aqui (apanhado antes, na janela): a folha só fecha com um segundo Esc.
 */
function swallowEscapeKeyUp() {
  if (!web || typeof window === 'undefined') return;
  const stop = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return;
    ev.stopPropagation();
    window.removeEventListener('keyup', stop, true);
  };
  window.addEventListener('keyup', stop, true);
  setTimeout(() => window.removeEventListener('keyup', stop, true), 1000);
}

/**
 * Sugestões de @menções para um campo de texto: deteta o "@palavra" no cursor, pede as pessoas mais próximas
 * (com debounce) e troca o "@par" pelo "@username " escolhido.
 *
 * Uso:
 *   const mention = useMentionSuggest({ text, setText, inputRef, context: 'post', id: post.id });
 *   <MentionSuggest mention={mention} />            ← logo por cima do campo, dentro da mesma barra
 *   <TextInput ref={inputRef} value={text} onChangeText={setText} {...mention.inputProps} />
 * Se o campo já tiver onFocus/onBlur próprios, chamar também mention.inputProps.onFocus/onBlur.
 */
export function useMentionSuggest({ text, setText, inputRef, context, id }: {
  text: string;
  setText: (t: string) => void;
  inputRef: RefObject<React.ComponentRef<typeof TextInput> | null>;
  /** Onde se está a escrever: sobe o autor/quem comentou ('post'), só membros ('group'), o autor ('story', 'zas'). */
  context?: MentionSuggestContext;
  id?: string;
}) {
  const [sel, setSel] = useState<Sel>({ start: text.length, end: text.length });
  // Depois de escolher: o cursor vai para a seguir ao "@username " (só até a próxima mudança de seleção).
  const [forced, setForced] = useState<Sel | undefined>(undefined);
  const [focused, setFocused] = useState(false);
  // O @ fechado com Esc: fica fechado enquanto se escrever nessa mesma palavra.
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [hi, setHi] = useState(0);
  const pressing = useRef(false);

  const token = useMemo(() => (sel.start === sel.end ? activeMention(text, sel.end) : null), [text, sel.start, sel.end]);
  useEffect(() => {
    if (dismissed !== null && token?.start !== dismissed) setDismissed(null);
  }, [token?.start, dismissed]);
  const active = focused && token && token.start !== dismissed ? token : null;

  const q = active ? active.query : null;
  const [debounced, setDebounced] = useState<string | null>(null);
  useEffect(() => {
    if (q === null) { setDebounced(null); return; }
    const t = setTimeout(() => setDebounced(q), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);
  const res = useQuery({
    queryKey: ['mention-suggest', context ?? '', id ?? '', debounced],
    queryFn: () => api.mentionSuggest(debounced ?? '', context, id),
    enabled: debounced !== null,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const items: MentionSuggestion[] = q !== null && debounced !== null ? res.data?.items ?? [] : [];
  useEffect(() => setHi(0), [debounced]);
  const open = items.length > 0;

  function pick(p: MentionSuggestion) {
    pressing.current = false;
    if (!active) return;
    const r = applyMention(text, active, p.username);
    setText(r.text);
    const at = { start: r.cursor, end: r.cursor };
    setSel(at);
    setForced(at);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  const inputProps = {
    selection: forced,
    onSelectionChange: (e: TextInputSelectionChangeEvent) => {
      setSel(e.nativeEvent.selection);
      if (forced) setForced(undefined);
    },
    onFocus: () => setFocused(true),
    // Ao tocar fora o campo perde o foco e a lista fecha; ao tocar numa sugestão (no site isso também tira o foco) não.
    onBlur: () => { if (!pressing.current) setFocused(false); },
    // No site: ↑/↓ escolhem, Enter (ou Tab) menciona, Esc fecha.
    onKeyPress: (e: TextInputKeyPressEvent) => {
      if (!web || !active) return;
      const key = e.nativeEvent.key;
      if (key === 'Escape') { e.preventDefault(); swallowEscapeKeyUp(); setDismissed(active.start); return; }
      if (!open) return;
      if (key === 'ArrowDown' || key === 'ArrowUp') { e.preventDefault(); setHi((h) => moveHighlight(h, key === 'ArrowDown' ? 1 : -1, items.length)); return; }
      if (key === 'Enter' || key === 'Tab') { e.preventDefault(); const p = items[Math.min(hi, items.length - 1)]; if (p) pick(p); }
    },
  };

  return {
    open,
    items,
    hi,
    setHi,
    pick,
    inputProps,
    pressIn: () => { pressing.current = true; },
    pressOut: () => {
      setTimeout(() => {
        pressing.current = false;
        if (!inputRef.current?.isFocused?.()) setFocused(false);
      }, 60);
    },
  };
}

export type MentionSuggestState = ReturnType<typeof useMentionSuggest>;

/**
 * A lista de sugestões, para pôr logo por cima do campo (no fluxo, dentro da mesma barra que sobe com o teclado):
 * assim nunca tapa o campo nem fica tapada pelo teclado. Foto, nome, @username e uma razão discreta.
 */
export function MentionSuggest({ mention, style }: { mention: MentionSuggestState; style?: StyleProp<ViewStyle> }) {
  const { height } = useWindowDimensions();
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const maxHeight = Math.max(ROW * 2.5, Math.min(ROW * 4.5, Math.round(height * 0.3)));
  const { hi, open } = mention;
  useEffect(() => {
    if (open) scroll.current?.scrollTo({ y: Math.max(0, (hi - 2) * ROW), animated: false });
  }, [hi, open]);
  if (!open) return null;
  return (
    <View style={[st.box, style]} accessibilityLabel="Pessoas para mencionar">
      <ScrollView ref={scroll} style={{ maxHeight }} keyboardShouldPersistTaps="always" nestedScrollEnabled showsVerticalScrollIndicator={false}>
        {mention.items.map((p, i) => {
          const why = reasonLabel(p.reason);
          return (
            <Pressable
              key={p.username}
              onPressIn={mention.pressIn}
              onPressOut={mention.pressOut}
              onPress={() => mention.pick(p)}
              onHoverIn={web ? () => mention.setHi(i) : undefined}
              accessibilityRole="button"
              accessibilityLabel={`Mencionar ${p.displayName}`}
              style={({ pressed }) => [st.row, web && i === hi && st.rowOn, pressed && st.rowPressed]}
            >
              <Avatar name={p.displayName} username={p.hasAvatar ? p.username : undefined} size={36} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <NameWithBadge name={p.displayName} who={p} style={st.name} gap={4} />
                <Text style={st.handle} numberOfLines={1}>@{p.username}</Text>
              </View>
              {why ? <Text style={st.why} numberOfLines={1}>{why}</Text> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  box: { backgroundColor: colors.white, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.zinc200, overflow: 'hidden', marginHorizontal: 8, marginBottom: 6, boxShadow: '0 4px 18px rgba(0,0,0,0.12)' } as object,
  row: { minHeight: ROW, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8 },
  rowOn: { backgroundColor: colors.zinc100 },
  rowPressed: { backgroundColor: colors.zinc200 },
  name: { flexShrink: 1, fontSize: 15, fontWeight: '700', color: colors.zinc900 },
  handle: { fontSize: 13, color: colors.zinc500 },
  why: { flexShrink: 0, maxWidth: 110, fontSize: 12, color: colors.zinc500 },
});
