import type { ReactNode } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { brandGradient, buttonLook, disabledOpacity, type ButtonKind, type ButtonSize } from '@/lib/theme';
import { Icon, type IconName } from '../Icon';
import { PontoLoader } from '../PontoLoader';

export type { ButtonKind, ButtonSize } from '@/lib/theme';

export type ButtonProps = {
  label: string;
  onPress?: () => void;
  /** `primary` coral (por omissão), `gradient` o degradê coral (entrar, criar conta, apresentação), `secondary` cinzento, `ghost` só texto, `danger` vermelho claro, `dangerSolid` vermelho cheio (só na caixa de confirmação). */
  kind?: ButtonKind;
  /** `lg` 52 (CTA de ecrã e de folha, por omissão), `md` 44 (em cartões e listas), `sm` 36 (chips de ação, com área de toque de 44). */
  size?: ButtonSize;
  /** Ícone Tx antes do texto (ou um nó próprio). */
  icon?: IconName | ReactNode;
  /** A gravar/enviar: o ponto do Txillapp no lugar do texto e o botão não aceita toques. */
  loading?: boolean;
  disabled?: boolean;
  /** Numa superfície escura (folha escura, por cima de vídeo). */
  dark?: boolean;
  /** Ocupa a largura toda. */
  block?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  /** Por omissão o próprio `label`. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
};

/**
 * O botão do Txillapp: pílula (raio 999), letra 16/700 (14/700 no `sm`), três alturas e cinco tipos (lib/theme `buttonLook`).
 * Desligado fica a 45%; a carregar mostra o PontoLoader (nunca «Um momento…»). Na web, passar o rato clareia os cheios e dá
 * um fundo um tom acima aos outros (como a apresentação tinha).
 */
export function Button({ label, onPress, kind = 'primary', size = 'lg', icon, loading = false, disabled = false, dark = false, block = false, style, textStyle, accessibilityLabel, accessibilityHint, testID }: ButtonProps) {
  const look = buttonLook(kind, size, dark);
  const off = disabled || loading;
  const iconNode = typeof icon === 'string' ? <Icon name={icon as IconName} size={look.iconSize} color={look.fg} /> : icon;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      hitSlop={look.hitSlop || undefined}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: off, busy: loading }}
      testID={testID}
      style={(s) => {
        const { pressed } = s;
        const hovered = !!(s as { hovered?: boolean }).hovered && !off;
        return [
        st.base,
        { height: look.height, borderRadius: look.radius, backgroundColor: look.bg, paddingHorizontal: look.paddingHorizontal },
        block && st.block,
        hovered && (look.hoverBg ? { backgroundColor: look.hoverBg } : { opacity: look.hoverOpacity }),
        disabled && !loading && { opacity: disabledOpacity },
        pressed && !off && { opacity: 0.88, transform: [{ scale: 0.98 }] },
        style,
        ];
      }}
    >
      {kind === 'gradient' ? <LinearGradient colors={brandGradient} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={[StyleSheet.absoluteFill, { borderRadius: look.radius }]} pointerEvents="none" /> : null}
      {loading ? (
        <PontoLoader size={size === 'sm' ? 8 : 10} color={look.fg} />
      ) : (
        <View style={st.row}>
          {iconNode}
          <Text style={[st.text, { fontSize: look.fontSize, fontWeight: look.fontWeight, color: look.fg }, textStyle]} numberOfLines={1}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

const st = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  block: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minWidth: 0 },
  text: { textAlign: 'center', flexShrink: 1 },
});
