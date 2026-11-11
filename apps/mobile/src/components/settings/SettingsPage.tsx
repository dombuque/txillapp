import { useLocalSearchParams, useRouter } from 'expo-router';
import type React from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '@/components/BackButton';
import { FillView } from '@/components/FillView';
import { colors } from '@/lib/theme';

/** No computador o grupo aberto fica à direita da lista (settings/_layout): sem "voltar", que a lista está sempre à vista. */
export const SettingsPaneContext = createContext(false);

type Node = React.ComponentRef<typeof View>;
interface AnchorCtx {
  /** A opção que a pesquisa (ou uma ligação antiga) mandou mostrar: `?o=<id>`. */
  target: string | undefined;
  reveal: (node: Node | null) => void;
}
const Anchors = createContext<AnchorCtx | null>(null);

/**
 * Uma linha com âncora: quando é a opção pedida, a página rola até ela e assinala-a uns segundos.
 * Devolve a `ref` para pôr na linha e se está assinalada.
 */
export function useAnchor(id: string | undefined) {
  const ctx = useContext(Anchors);
  const ref = useRef<Node>(null);
  const hit = !!id && !!ctx && ctx.target === id;
  const [lit, setLit] = useState(false);
  useEffect(() => {
    if (!hit || !ctx) return;
    // Espera que a página assente (folhas a carregar, a animação de entrada) antes de medir.
    const a = setTimeout(() => { ctx.reveal(ref.current); setLit(true); }, 350);
    const b = setTimeout(() => setLit(false), 2800);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [hit, ctx]);
  return { ref, lit };
}

/** A parte que rola, com as âncoras: o ecrã de cada grupo e, no computador, a lista da esquerda. */
export function AnchorScroll({ children, target, contentStyle }: { children: ReactNode; target?: string; contentStyle?: object }) {
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const content = useRef<Node>(null);
  const reveal = useCallback((node: Node | null) => {
    const base = content.current;
    if (!node || !base) return;
    try {
      node.measureLayout(base, (_x: number, y: number) => scroll.current?.scrollTo({ y: Math.max(0, y - 96), animated: true }), () => undefined);
    } catch { /* sem medida: fica onde está */ }
  }, []);
  const value = useMemo(() => ({ target, reveal }), [target, reveal]);
  return (
    <Anchors.Provider value={value}>
      <ScrollView ref={scroll} contentContainerStyle={[{ paddingBottom: 48 }, contentStyle]} keyboardShouldPersistTaps="handled">
        <View ref={content} collapsable={false}>{children}</View>
      </ScrollView>
    </Anchors.Provider>
  );
}

/**
 * O ecrã de um grupo das Definições: cabeçalho com "voltar" e o título, e a lista a rolar.
 * Lê `?o=` para levar logo à opção que se procurou.
 */
export function SettingsPage({ title, children }: { title: string; children: ReactNode }) {
  const pane = useContext(SettingsPaneContext);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { o } = useLocalSearchParams<{ o?: string }>();
  const back = () => (router.canGoBack() ? router.back() : router.replace('/settings' as never));
  return (
    <View style={{ flex: 1, backgroundColor: colors.white, paddingTop: pane ? 0 : insets.top }}>
      <View style={[st.header, pane && st.headerPane]}>
        {pane ? null : <BackButton onPress={back} />}
        <Text style={st.title} accessibilityRole="header" numberOfLines={2}>{title}</Text>
      </View>
      <FillView>
        <AnchorScroll target={typeof o === 'string' ? o : undefined}>{children}</AnchorScroll>
      </FillView>
    </View>
  );
}

const st = StyleSheet.create({
  header: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 4, borderBottomWidth: 1, borderBottomColor: colors.zinc100, backgroundColor: colors.white, paddingHorizontal: 8, paddingVertical: 8 },
  headerPane: { paddingHorizontal: 24, paddingTop: 20 },
  title: { flex: 1, fontSize: 20, fontWeight: '800', color: colors.zinc900 },
});
