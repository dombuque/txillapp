import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { RangeSlider } from '../RangeSlider';

/** As cores do estúdio: escuro, vidro e o coral do Txillapp a acender o que está escolhido. */
export const fxc = {
  coral: '#d6334f',
  coralHot: '#ff5c6c',
  glass: 'rgba(255,255,255,0.07)',
  glassOn: 'rgba(255,92,108,0.16)',
  line: 'rgba(255,255,255,0.10)',
  text: '#ffffff',
  muted: 'rgba(255,255,255,0.62)',
  faint: 'rgba(255,255,255,0.38)',
  glow: '0 0 0 1px rgba(255,92,108,0.85), 0 0 18px rgba(255,92,108,0.45)',
};

/** Um botão redondo de escolha (filtro, estilo, animação…). */
export function FxChip({ on, label, onPress, icon, a11y, disabled, small }: { on?: boolean; label: string; onPress: () => void; icon?: ReactNode; a11y?: string; disabled?: boolean; small?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [fx.chip, small && fx.chipSmall, on && fx.chipOn, disabled && { opacity: 0.4 }, pressed && { transform: [{ scale: 0.95 }] }]}
      accessibilityRole="button"
      accessibilityState={{ selected: !!on, disabled: !!disabled }}
      accessibilityLabel={a11y ?? label}
    >
      {icon}
      <Text style={[fx.chipText, small && { fontSize: 12 }, on && { color: '#fff' }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

/** Uma fila de escolhas que desliza para o lado. */
export function FxRow({ label, children, wrap }: { label?: string; children: ReactNode; wrap?: boolean }) {
  if (wrap) {
    return (
      <View style={fx.rowWrap}>
        {label ? <Text style={fx.label}>{label}</Text> : null}
        {children}
      </View>
    );
  }
  return (
    <View style={{ marginTop: 8 }}>
      {label ? <Text style={[fx.label, { paddingHorizontal: 16, marginBottom: 6 }]}>{label}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 6, alignItems: 'center' }} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </View>
  );
}

/** Os sub-separadores de um painel (Filtros · Ajustes · Transições · Tempo). */
export function FxSegment<T extends string>({ items, value, onChange }: { items: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={fx.seg} accessibilityRole="tablist">
      {items.map((it) => {
        const on = it.id === value;
        return (
          <Pressable key={it.id} onPress={() => onChange(it.id)} style={[fx.segBtn, on && fx.segOn]} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={it.label}>
            <Text style={[fx.segText, on && { color: '#fff' }]} numberOfLines={1}>{it.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Uma barra com o nome e o valor ao lado. */
export function FxSlider({ label, value, min, max, step, format, onChange, onCommit }: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void; onCommit?: (v: number) => void }) {
  return (
    <View style={fx.slider}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={fx.label}>{label}</Text>
        <Text style={fx.value}>{format(value)}</Text>
      </View>
      <RangeSlider label={label} value={value} min={min} max={max} step={step} format={format} onChange={onChange} onCommit={onCommit} />
    </View>
  );
}

/** Um botão pequeno de ação (Aplicar a todos, Repor…). */
export function FxAction({ label, onPress, icon, tone = 'glass', disabled, a11y }: { label: string; onPress: () => void; icon?: ReactNode; tone?: 'glass' | 'coral' | 'danger'; disabled?: boolean; a11y?: string }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [fx.action, tone === 'coral' && fx.actionCoral, tone === 'danger' && fx.actionDanger, disabled && { opacity: 0.4 }, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={a11y ?? label} accessibilityState={{ disabled: !!disabled }}>
      {icon}
      <Text style={fx.actionText}>{label}</Text>
    </Pressable>
  );
}

export const fx = StyleSheet.create({
  chip: { height: 34, borderRadius: 999, backgroundColor: fxc.glass, borderWidth: 1, borderColor: fxc.line, paddingHorizontal: 13, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center' },
  chipSmall: { height: 30, paddingHorizontal: 11 },
  chipOn: { backgroundColor: fxc.glassOn, borderColor: fxc.coralHot, boxShadow: fxc.glow } as object,
  chipText: { color: fxc.muted, fontSize: 13, fontWeight: '700' },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingHorizontal: 16, marginTop: 10 },
  label: { color: fxc.muted, fontSize: 11, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' },
  value: { color: '#fff', fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
  seg: { flexDirection: 'row', marginHorizontal: 16, marginTop: 8, padding: 3, gap: 3, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: fxc.line },
  segBtn: { flex: 1, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  segOn: { backgroundColor: 'rgba(214,51,79,0.9)', boxShadow: '0 0 14px rgba(255,92,108,0.45)' } as object,
  segText: { color: fxc.muted, fontSize: 13, fontWeight: '800' },
  slider: { paddingHorizontal: 16, marginTop: 8 },
  action: { height: 32, borderRadius: 16, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: fxc.glass, borderWidth: 1, borderColor: fxc.line },
  actionCoral: { backgroundColor: fxc.coral, borderColor: fxc.coralHot, boxShadow: '0 4px 16px rgba(214,51,79,0.45)' } as object,
  actionDanger: { backgroundColor: 'rgba(220,38,38,0.18)', borderColor: 'rgba(248,113,113,0.45)' },
  actionText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  note: { color: fxc.faint, fontSize: 12, paddingHorizontal: 16, marginTop: 6 },
});
