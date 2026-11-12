import { usePathname, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { isStudioFull } from '@/lib/studio/immersive';
import { inMessages, isTypingTarget, overlayOpen, ROUTE_OF, shortcutFor, SHORTCUTS, type ShortcutAction } from '@/lib/desktopKeys';
import { emitTabPress, sameTabPress } from '@/lib/tabPress';
import { colors } from '@/lib/theme';
import { Sheet } from './Sheet';

/** Onde está o campo da pesquisa (ecrã /search): o foco vai para lá depois do atalho. */
const focusSearch = () => {
  for (let k = 0; k < 10; k++) {
    setTimeout(() => {
      const el = document.querySelector<HTMLInputElement>('input[aria-label="Pesquisar"]');
      if (el && document.activeElement !== el) el.focus();
    }, 120 * (k + 1));
  }
};

/**
 * Atalhos do teclado no computador (com sessão, dentro do DesktopShell): «/» ou Ctrl/Cmd+K pesquisa, «n» nova publicação,
 * «g» e depois «h», «m», «p», «n» (Início, Mensagens, Perfil, Notificações) e «?» esta ajuda. Nunca enquanto se escreve
 * nem com uma folha aberta. Nas Mensagens o Ctrl/Cmd+K fica para a equipa das Mensagens (procurar conversas).
 */
export function DesktopShortcuts() {
  const router = useRouter();
  const path = usePathname();
  const [help, setHelp] = useState(false);
  const live = useRef({ path, router });
  live.current = { path, router };

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    let chordAt: number | null = null;
    const run = (a: ShortcutAction) => {
      const { path: here, router: r } = live.current;
      if (a === 'help') return setHelp(true);
      if (a === 'search') {
        if (here !== '/search') r.navigate('/search' as never);
        return focusSearch();
      }
      // Já no Início, nas Mensagens ou no Perfil: volta ao topo (como o clique na barra lateral).
      const key = a === 'home' ? 'home' : a === 'messages' ? 'messages' : a === 'profile' ? 'profile' : null;
      const same = key ? sameTabPress(key, here) : null;
      if (same) return emitTabPress(same);
      r.navigate(ROUTE_OF[a] as never);
    };
    const onKey = (e: KeyboardEvent) => {
      // No estúdio das tchekas valem os atalhos dele (espaço, S, Delete, Ctrl+Z…), não os do site.
      if (e.defaultPrevented || e.repeat || isStudioFull()) return;
      const typing = isTypingTarget(e.target as HTMLElement) || isTypingTarget(document.activeElement as HTMLElement | null);
      const r = shortcutFor(e, { typing, overlay: overlayOpen(), path: live.current.path }, chordAt, Date.now());
      chordAt = r.chordAt;
      if (!r.action) return;
      e.preventDefault();
      run(r.action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!help) return null;
  return (
    <Sheet title="Atalhos do teclado" onClose={() => setHelp(false)}>
      <View style={st.list} accessibilityRole="list">
        {SHORTCUTS.map((s) => (
          <View key={s.label} style={st.row} accessibilityRole="text" accessibilityLabel={`${s.keys.join(' ')}: ${s.label}`}>
            <Text style={st.label}>{s.label}</Text>
            <View style={st.keys}>
              {s.keys.map((k, i) => (
                <View key={`${k}${i}`} style={st.key}><Text style={st.keyText}>{k}</Text></View>
              ))}
            </View>
          </View>
        ))}
        {inMessages(path) ? <Text style={st.note}>Nas Mensagens, Ctrl/Cmd+K procura nas conversas.</Text> : null}
      </View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  list: { paddingHorizontal: 24, paddingBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.zinc100 },
  label: { flex: 1, fontSize: 15, color: colors.zinc800 },
  keys: { flexDirection: 'row', gap: 6 },
  key: { minWidth: 28, height: 28, paddingHorizontal: 8, borderRadius: 7, borderWidth: 1, borderColor: colors.zinc300, borderBottomWidth: 2, backgroundColor: '#fafafa', alignItems: 'center', justifyContent: 'center' },
  keyText: { fontSize: 13, fontWeight: '700', color: colors.zinc800 },
  note: { marginTop: 12, fontSize: 13, color: colors.zinc500 },
});
