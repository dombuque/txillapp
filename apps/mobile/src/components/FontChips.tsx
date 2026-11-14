import { Pressable, ScrollView, Text, type StyleProp, type ViewStyle } from 'react-native';
import { fontById } from '@/lib/studio/effects';
import { colors } from '@/lib/theme';
import { textFontStyle } from '@/lib/textFonts';
import { TEXT_FONT_IDS, normTextFont, type TextFontId } from '@/lib/textLayers';
import { useTextFonts } from '@/lib/useTextFonts';

/**
 * A fila das letras (as 10 do estúdio), na horizontal: cada uma escreve o próprio nome na sua letra. Serve nos textos dos
 * mimos, nas publicações só com texto e na legenda do Zás. `dark`: por cima da foto ou da câmara (pílulas de vidro).
 */
export function FontChips({ value, onChange, dark = false, style, label = 'Letra' }: {
  value: string | null | undefined;
  onChange: (id: TextFontId) => void;
  dark?: boolean;
  style?: StyleProp<ViewStyle>;
  /** O nome da fila para o leitor de ecrã. */
  label?: string;
}) {
  useTextFonts(TEXT_FONT_IDS);
  const cur = normTextFont(value);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="always"
      style={[{ flexGrow: 0 }, style]}
      contentContainerStyle={{ gap: 8, paddingHorizontal: 12, alignItems: 'center' }}
      accessibilityRole="tablist"
      accessibilityLabel={label}
    >
      {TEXT_FONT_IDS.map((id) => {
        const on = cur === id;
        const f = fontById(id);
        const bg = dark ? (on ? '#fff' : 'rgba(0,0,0,0.45)') : on ? colors.zinc900 : colors.zinc100;
        const fg = dark ? (on ? colors.zinc900 : '#fff') : on ? '#fff' : colors.zinc800;
        return (
          <Pressable
            key={id}
            onPress={() => onChange(id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`Letra ${f.name}`}
            style={({ pressed }) => [{ height: 44, minWidth: 44, borderRadius: 22, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: bg }, dark && !on && { borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' }, pressed && { transform: [{ scale: 0.94 }] }]}
          >
            <Text style={[{ color: fg, fontSize: Math.round(16 * f.k), lineHeight: Math.round(16 * f.k * 1.35) }, textFontStyle(id) ?? { fontWeight: '700' }]} numberOfLines={1}>{f.name}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
