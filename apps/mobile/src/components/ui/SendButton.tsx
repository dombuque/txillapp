import { useRef, type RefObject } from 'react';
import { Platform, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '@/lib/theme';
import { Icon } from '../Icon';
import { t } from '@/lib/i18n';

const SLOP = { top: 4, bottom: 4, left: 2, right: 2 };

/**
 * O «Enviar» de tudo o que se escreve a alguém (conversa, resposta ao mimo e ao Zás, comentário em direto, SuperTxill):
 * círculo coral de 40 com a seta para cima.
 * `keep`: o campo de escrever. Enviar não fecha o teclado: no site (PWA) tocar num botão tira o foco ao campo e o
 * teclado do telemóvel fecha a cada mensagem; o mousedown fica sem efeito e, se o foco sair na mesma, volta ao campo.
 */
export function SendButton({ label = t('Enviar'), onPress, disabled, keep, style }: { label?: string; onPress: () => void; disabled?: boolean; keep?: RefObject<{ focus: () => void; isFocused?: () => boolean } | null>; style?: StyleProp<ViewStyle> }) {
  const had = useRef(false);
  return (
    <Pressable
      onPress={() => {
        onPress();
        if (keep && had.current && !keep.current?.isFocused?.()) keep.current?.focus();
      }}
      onPressIn={() => { had.current = !!keep?.current?.isFocused?.(); }}
      {...(Platform.OS === 'web' && keep ? { onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault() } : null)}
      disabled={disabled}
      hitSlop={SLOP}
      style={({ pressed }) => [st.send, pressed && { transform: [{ scale: 0.92 }] }, disabled && { opacity: 0.6 }, style]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
    >
      <Icon name="arrow-up" size={22} color="#fff" strokeWidth={2.4} />
    </Pressable>
  );
}

const st = StyleSheet.create({
  send: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
});
