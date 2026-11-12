import { useRouter } from 'expo-router';
import { isValidElement, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '@/components/Icon';
import { colors } from '@/lib/theme';
import { useAnchor } from './SettingsPage';

/** O ícone redondo à esquerda das linhas. */
export function IconDot({ children, danger }: { children: ReactNode; danger?: boolean }) {
  return <View style={[st.icon, danger && { backgroundColor: '#fef2f2' }]}>{children}</View>;
}

/** O desenho do interruptor (a linha toda é o toque, com `accessibilityRole="switch"`). */
export function SwitchMark({ on, disabled }: { on: boolean; disabled?: boolean }) {
  return (
    <View style={[st.track, on && { backgroundColor: colors.brand }, disabled && { opacity: 0.45 }]} accessible={false} importantForAccessibility="no-hide-descendants">
      <View style={[st.thumb, on && { transform: [{ translateX: 20 }] }]} />
    </View>
  );
}

export interface SettingRowProps {
  /** Nome do ícone Tx ou um elemento já feito (ex.: o selo de verificado). */
  icon: IconName | ReactNode;
  title: string;
  /** Uma explicação curta por baixo do título. */
  description?: string;
  /** O valor atual, à direita (ex.: "Público"). */
  value?: string;
  /** Abre outro ecrã. */
  to?: string;
  onPress?: () => void;
  /** Interruptor: a linha toda liga e desliga. */
  toggle?: { on: boolean; onChange: (on: boolean) => void; disabled?: boolean };
  /** Vermelho, para o que não se desfaz (ex.: "Eliminar conta"). */
  danger?: boolean;
  /** Só para ver: mostra um cadeado em vez da seta. */
  locked?: boolean;
  /** Âncora da pesquisa (o id em lib/settingsIndex). */
  anchor?: string;
  /** Cor do título e da descrição (ex.: um erro). */
  tone?: 'error';
  hint?: string;
}

/**
 * A linha das Definições, igual em todos os ecrãs: ícone, título, descrição curta e, à direita, um valor, um interruptor
 * ou uma seta. Pelo menos 56 pt de altura (toque ≥ 44) e o texto cresce com o tamanho de letra do sistema.
 */
export function SettingRow({ icon, title, description, value, to, onPress, toggle, danger, locked, anchor, tone, hint }: SettingRowProps) {
  const router = useRouter();
  const { ref, lit } = useAnchor(anchor);
  const press = toggle ? (toggle.disabled ? undefined : () => toggle.onChange(!toggle.on)) : to ? () => router.push(to as never) : onPress;
  const iconEl = typeof icon === 'string' && !isValidElement(icon)
    ? <Icon name={icon as IconName} size={20} color={danger ? colors.red600 : colors.zinc800} />
    : icon;
  const right = toggle
    ? <SwitchMark on={toggle.on} disabled={toggle.disabled} />
    : press
      ? (danger ? null : <Icon name="chevron-right" size={18} color="#a1a1aa" />)
      : locked ? <Icon name="lock" size={16} color={colors.zinc300} /> : null;
  const body = (
    <>
      <IconDot danger={danger}>{iconEl}</IconDot>
      <View style={st.texts}>
        <Text style={[st.title, danger && { color: colors.red600 }]}>{title}</Text>
        {description ? <Text style={[st.desc, tone === 'error' && { color: colors.red600 }]}>{description}</Text> : null}
      </View>
      {value ? <Text style={st.value} numberOfLines={2}>{value}</Text> : null}
      {right}
    </>
  );
  const style = [st.row, lit && st.lit];
  if (!press && !toggle) {
    return <View ref={ref} collapsable={false} style={style} accessible accessibilityLabel={[title, value, description].filter(Boolean).join(', ')}>{body}</View>;
  }
  if (toggle) {
    return (
      <Pressable
        ref={ref}
        onPress={press}
        disabled={toggle.disabled}
        style={(s) => [style, (s.pressed || (s as { hovered?: boolean }).hovered) && st.pressed]}
        accessibilityRole="switch"
        accessibilityState={{ checked: toggle.on, disabled: !!toggle.disabled }}
        // Na web (react-native-web) o estado só chega ao leitor de ecrã pelos aria-*.
        aria-checked={toggle.on}
        aria-disabled={!!toggle.disabled}
        accessibilityLabel={title}
        accessibilityHint={hint ?? description}
      >
        {body}
      </Pressable>
    );
  }
  return (
    <Pressable
      ref={ref}
      onPress={press}
      style={(s) => [style, (s.pressed || (s as { hovered?: boolean }).hovered) && st.pressed]}
      accessibilityRole={to ? 'link' : 'button'}
      accessibilityLabel={[title, value].filter(Boolean).join(', ')}
      accessibilityHint={hint ?? description}
    >
      {body}
    </Pressable>
  );
}

/** Um bloco de linhas com título pequeno em maiúsculas e uma nota opcional por baixo. */
export function SettingsSection({ title, note, children }: { title?: string; note?: string; children: ReactNode }) {
  const kids = (Array.isArray(children) ? children : [children]).flat().filter(Boolean) as ReactNode[];
  if (kids.length === 0) return null;
  return (
    <View style={{ marginTop: 24 }}>
      {title ? <Text style={st.sectionTitle} accessibilityRole="header">{title}</Text> : null}
      <View style={st.card}>
        {kids.map((k, i) => (
          <View key={i} style={i > 0 ? { borderTopWidth: 1, borderTopColor: colors.zinc100 } : undefined}>{k}</View>
        ))}
      </View>
      {note ? <Text style={st.note}>{note}</Text> : null}
    </View>
  );
}

export const settingsStyles = StyleSheet.create({
  input: { borderRadius: 16, backgroundColor: colors.zinc100, paddingHorizontal: 16, paddingVertical: 13, minHeight: 48, fontSize: 16, color: colors.zinc900, outlineStyle: 'none' as never },
  primary: { minHeight: 54, borderRadius: 999, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  primaryText: { color: '#fff', fontSize: 17, fontWeight: '600', textAlign: 'center' },
  danger: { minHeight: 54, borderRadius: 999, backgroundColor: '#b91c1c', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  ghost: { marginTop: 12, minHeight: 50, borderRadius: 999, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  ghostText: { fontSize: 16, fontWeight: '600', color: colors.zinc800, textAlign: 'center' },
  outline: { minHeight: 44, justifyContent: 'center', borderRadius: 999, borderWidth: 1, borderColor: colors.zinc300, paddingHorizontal: 16, paddingVertical: 8 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  none: { paddingVertical: 24, textAlign: 'center', color: colors.zinc600, fontSize: 16 },
});

const st = StyleSheet.create({
  row: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.white },
  pressed: { backgroundColor: '#fafafa' },
  lit: { backgroundColor: colors.rose50 },
  icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  texts: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: '500', color: colors.zinc900 },
  desc: { marginTop: 2, fontSize: 14, lineHeight: 19, color: colors.zinc600 },
  value: { maxWidth: '40%', fontSize: 14, color: colors.zinc600, textAlign: 'right' },
  track: { width: 50, height: 30, borderRadius: 15, padding: 2, backgroundColor: colors.zinc300, justifyContent: 'center' },
  thumb: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.25)' },
  sectionTitle: { paddingHorizontal: 20, paddingBottom: 8, fontSize: 13, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', color: colors.zinc600 },
  card: { marginHorizontal: 16, overflow: 'hidden', borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.zinc100, boxShadow: '0 2px 16px rgba(0,0,0,0.06)' },
  note: { marginTop: 8, paddingHorizontal: 24, fontSize: 13, lineHeight: 18, color: colors.zinc500 },
});
