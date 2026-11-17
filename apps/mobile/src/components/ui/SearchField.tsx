import type { ComponentRef, Ref } from 'react';
import { Pressable, StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { colors, dark as D, iconSize } from '@/lib/theme';
import { Icon } from '../Icon';

export type SearchFieldProps = Omit<TextInputProps, 'style' | 'value' | 'onChangeText'> & {
  value: string;
  onChangeText: (v: string) => void;
  /** Chamado no X, depois de limpar (ex.: voltar à lista inteira). */
  onClear?: () => void;
  dark?: boolean;
  style?: StyleProp<ViewStyle>;
  ref?: Ref<ComponentRef<typeof TextInput>>;
};

/** Caixa de pesquisa: 44 de altura, pílula, lupa de 18 e o X «Limpar a pesquisa» quando há texto. */
export function SearchField({ value, onChangeText, onClear, dark = false, style, placeholder = 'Pesquisar', ref, ...rest }: SearchFieldProps) {
  const fg = dark ? D.sub : colors.zinc500;
  return (
    <View style={[st.box, dark && { backgroundColor: D.raised }, style]}>
      <Icon name="search" size={iconSize.field} color={fg} />
      <TextInput
        ref={ref}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={fg}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        accessibilityLabel={rest.accessibilityLabel ?? placeholder}
        {...rest}
        style={[st.input, dark && { color: D.text }]}
      />
      {value ? (
        <Pressable onPress={() => { onChangeText(''); onClear?.(); }} hitSlop={10} style={st.clear} accessibilityRole="button" accessibilityLabel="Limpar a pesquisa">
          <Icon name="x" size={16} color={fg} strokeWidth={2.2} />
        </Pressable>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  box: { height: 44, borderRadius: 999, backgroundColor: colors.zinc100, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 14, paddingRight: 6 },
  input: { flex: 1, minWidth: 0, height: 44, fontSize: 15, color: colors.zinc900, paddingVertical: 0, outlineStyle: 'none' } as object,
  clear: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
