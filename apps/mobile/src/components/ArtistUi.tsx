import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { colors } from '@/lib/theme';

/** Peças comuns dos ecrãs do programa de artistas (Sou artista, Carregar música, Gerir as minhas músicas). */

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <View style={{ marginTop: 18 }}>
      <Text style={ast.label}>{label}</Text>
      {children}
      {hint ? <Text style={ast.hint}>{hint}</Text> : null}
    </View>
  );
}

/** Escolha de várias opções em pastilhas (estilos), com um máximo. */
export function Chips({ options, value, onChange, max = 5 }: { options: readonly string[]; value: string[]; onChange: (v: string[]) => void; max?: number }) {
  return (
    <View style={ast.chips}>
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <Pressable
            key={o}
            onPress={() => onChange(on ? value.filter((x) => x !== o) : value.length >= max ? value : [...value, o])}
            style={[ast.chip, on && ast.chipOn]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
          >
            <Text style={[ast.chipTxt, on && { color: '#fff' }]}>{o}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Uma caixa de confirmação (aceitar a licença, música explícita). */
export function Check({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <Pressable onPress={() => onChange(!on)} style={ast.check} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
      <View style={[ast.box, on && ast.boxOn]}>{on ? <Icon name="check" size={14} color="#fff" strokeWidth={2.6} /> : null}</View>
      <Text style={ast.checkTxt}>{children}</Text>
    </Pressable>
  );
}

export function Primary({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [ast.primary, disabled && { opacity: 0.45 }, pressed && { transform: [{ scale: 0.98 }] }]} accessibilityRole="button" accessibilityState={{ disabled: !!disabled }}>
      <Text style={ast.primaryTxt}>{title}</Text>
    </Pressable>
  );
}

export function Ghost({ title, onPress, danger }: { title: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [ast.ghost, pressed && { opacity: 0.7 }]} accessibilityRole="button">
      <Text style={[ast.ghostTxt, danger && { color: colors.red600 }]}>{title}</Text>
    </Pressable>
  );
}

const TONE = { green: ['#dcfce7', '#166534'], amber: ['#fef3c7', '#92400e'], red: ['#fee2e2', '#991b1b'], zinc: [colors.zinc100, colors.zinc700] } as const;
export function Pill({ tone, children }: { tone: keyof typeof TONE; children: ReactNode }) {
  return <View style={[ast.pill, { backgroundColor: TONE[tone][0] }]}><Text style={[ast.pillTxt, { color: TONE[tone][1] }]}>{children}</Text></View>;
}

/** A etiqueta «Artista» do perfil (não é o selo de verificado). */
export function ArtistTag() {
  return (
    <View style={ast.tag} accessibilityLabel="Artista">
      <Icon name="music" size={12} color={colors.brand} strokeWidth={2.2} />
      <Text style={ast.tagTxt}>Artista</Text>
    </View>
  );
}

export const ast = StyleSheet.create({
  label: { marginBottom: 6, fontSize: 14, fontWeight: '600', color: colors.zinc900 },
  hint: { marginTop: 6, fontSize: 13, lineHeight: 18, color: colors.zinc500 },
  input: { borderRadius: 16, backgroundColor: colors.zinc100, paddingHorizontal: 16, paddingVertical: 13, fontSize: 16, color: colors.zinc900, outlineStyle: 'none' as never },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { height: 34, paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: colors.brand },
  chipTxt: { fontSize: 14, fontWeight: '600', color: colors.zinc700 },
  check: { marginTop: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  box: { marginTop: 1, width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.zinc300, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  checkTxt: { flex: 1, fontSize: 15, lineHeight: 21, color: colors.zinc800 },
  primary: { marginTop: 24, height: 54, borderRadius: 999, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  primaryTxt: { color: '#fff', fontSize: 17, fontWeight: '600' },
  ghost: { marginTop: 12, alignSelf: 'flex-start', borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 18, paddingVertical: 10 },
  ghostTxt: { fontSize: 14, fontWeight: '600', color: colors.zinc800 },
  card: { marginTop: 16, borderRadius: 20, borderWidth: 1, borderColor: colors.zinc200, padding: 16 },
  cardTitle: { fontSize: 17, fontWeight: '700', color: colors.zinc900 },
  cardSub: { marginTop: 4, fontSize: 15, lineHeight: 21, color: colors.zinc600 },
  err: { marginTop: 10, fontSize: 14, color: colors.red600 },
  pill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  pillTxt: { fontSize: 12, fontWeight: '700' },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, borderWidth: 1, borderColor: colors.brand, paddingHorizontal: 8, paddingVertical: 2 },
  tagTxt: { fontSize: 12, fontWeight: '700', color: colors.brand },
  license: { maxHeight: 260, borderRadius: 16, backgroundColor: '#fafafa', borderWidth: 1, borderColor: colors.zinc200, padding: 14 },
  licenseTxt: { fontSize: 14, lineHeight: 20, color: colors.zinc700 },
});
