import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { RemixButton } from '@/components/remix/RemixParts';
import type { Post } from '@/lib/api';

const SHADOW = { textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 } as const;

/**
 * Um botão das ações do lado de uma tcheka (o círculo com o ícone e, por baixo, o número ou a etiqueta). Os botões novos
 * (ex.: «Remix») usam este para ficarem iguais aos outros.
 */
export function RailButton({ icon, label, onPress, accessibilityLabel, selected, onLabelPress, labelA11y }: {
  icon: ReactNode;
  /** O número (brindes, comentários) ou uma etiqueta curta; sem ela fica só o ícone. */
  label?: string | number | null;
  onPress: () => void;
  accessibilityLabel: string;
  selected?: boolean;
  /** Tocar no número faz outra coisa (ex.: ver quem brindou). */
  onLabelPress?: () => void;
  labelA11y?: string;
}) {
  const text = label === undefined || label === null || label === '' ? null : <Text style={st.text}>{label}</Text>;
  return (
    <View style={st.wrap}>
      <Pressable onPress={onPress} style={({ pressed }) => [st.hit, pressed && { transform: [{ scale: 0.88 }] }]} accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={selected === undefined ? undefined : { selected }}>
        {icon}
      </Pressable>
      {text && onLabelPress ? (
        <Pressable onPress={onLabelPress} style={st.count} accessibilityRole="button" accessibilityLabel={labelA11y}>{text}</Pressable>
      ) : text ? <View style={st.count}>{text}</View> : null}
    </View>
  );
}

/**
 * O sítio da equipa do remix nas ações do lado (entre «Partilhar» e o disco do som): «Remix» (fazer dueto e ver os duetos e
 * respostas, components/remix). Usa o círculo e o texto das outras ações para ficar igual a elas.
 */
export function ReelExtraActions({ post }: { post: Post; active: boolean }): ReactNode {
  return <RemixButton post={post} circleStyle={railStyles.circle} labelStyle={st.text} />;
}

export const railStyles = StyleSheet.create({
  /** O círculo atrás do ícone (dá para ler por cima de vídeos claros). */
  circle: { width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(0,0,0,0.22)', alignItems: 'center', justifyContent: 'center' },
});

const st = StyleSheet.create({
  wrap: { alignItems: 'center' },
  hit: { alignItems: 'center', justifyContent: 'center' },
  count: { minHeight: 20, minWidth: 40, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  text: { color: '#fff', fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'], ...SHADOW },
});
