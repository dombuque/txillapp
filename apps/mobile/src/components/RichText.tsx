import { useRouter } from 'expo-router';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { colors } from '@/lib/theme';

// As mesmas regras do site e do servidor: o @ ou # não pode vir colado a letras e o ponto final não faz parte do nome.
const TOKEN = /(?<![\p{L}\p{N}_.&#])(?:@([a-zA-Z0-9_.]{3,30})|#([\p{L}\p{N}_]{2,30}))/gu;

/**
 * Texto com @menções e #hashtags a coral, em negrito (como no site). `customFont`: o texto vai numa das letras próprias
 * (lib/textLayers): aí as ligações ficam só a coral, sem negrito (no Android a fonte própria com peso sai com negrito inventado).
 */
export function RichText({ text, style, numberOfLines, customFont = false }: { text: string; style?: StyleProp<TextStyle>; /** Corta ao fim de N linhas (ex.: a legenda de uma tcheka antes de expandir). */ numberOfLines?: number; customFont?: boolean }) {
  const router = useRouter();
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const start = m.index!;
    if (start > last) out.push(text.slice(last, start));
    const name = m[1] ? m[1].replace(/\.+$/, '') : m[2];
    const mark = m[1] ? '@' : '#';
    out.push(
      <Text key={start} onPress={() => router.push((m[1] ? `/u/${name}` : `/t/${encodeURIComponent(name)}`) as never)} accessibilityRole="link" style={customFont ? { color: colors.brand } : { color: colors.brand, fontWeight: '600' }}>
        {mark}
        {name}
      </Text>,
    );
    last = start + 1 + name.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <Text style={style} numberOfLines={numberOfLines}>{out}</Text>;
}
