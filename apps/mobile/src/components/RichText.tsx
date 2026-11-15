import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { api } from '@/lib/api';
import { createMentionChecker } from '@/lib/mentionExists';
import { colors } from '@/lib/theme';

// As mesmas regras do site e do servidor: o @ ou # não pode vir colado a letras e o ponto final não faz parte do nome.
const TOKEN = /(?<![\p{L}\p{N}_.&#])(?:@([a-zA-Z0-9_.]{3,30})|#([\p{L}\p{N}_]{2,30}))/gu;

/** Um só verificador para a app toda: junta os @ dos textos que aparecem ao mesmo tempo num pedido. */
const checkMentions = createMentionChecker((names) => api.mentionsExist(names));

/** Os @nomes do texto (minúsculas, sem repetidos, ordenados). */
export function mentionNames(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(TOKEN)) if (m[1]) out.add(m[1].replace(/\.+$/, '').toLowerCase());
  return [...out].sort();
}

/**
 * Texto com @menções e #hashtags a coral, em negrito (como no site). `customFont`: o texto vai numa das letras próprias
 * (lib/textLayers): aí as ligações ficam só a coral, sem negrito (no Android a fonte própria com peso sai com negrito inventado).
 */
export function RichText({ text, style, numberOfLines, customFont = false }: { text: string; style?: StyleProp<TextStyle>; /** Corta ao fim de N linhas (ex.: a legenda de uma tcheka antes de expandir). */ numberOfLines?: number; customFont?: boolean }) {
  const router = useRouter();
  // Só os @ de contas que existem são ligação (lib/mentionExists): um @ de alguém que não existe fica texto normal.
  const names = mentionNames(text);
  const exists = useQuery({ queryKey: ['mention-exists', names.join(',')], queryFn: () => checkMentions(names), enabled: names.length > 0, staleTime: 10 * 60_000 });
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const start = m.index!;
    if (start > last) out.push(text.slice(last, start));
    const name = m[1] ? m[1].replace(/\.+$/, '') : m[2];
    const mark = m[1] ? '@' : '#';
    const known = m[1] ? exists.data?.[name.toLowerCase()] : true;
    if (known === false) {
      out.push(`${mark}${name}`);
    } else {
      out.push(
        <Text key={start} onPress={known ? () => router.push((m[1] ? `/u/${name}` : `/t/${encodeURIComponent(name)}`) as never) : undefined} accessibilityRole={known ? 'link' : undefined} style={customFont ? { color: colors.brand } : { color: colors.brand, fontWeight: '600' }}>
          {mark}
          {name}
        </Text>,
      );
    }
    last = start + 1 + name.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <Text style={style} numberOfLines={numberOfLines}>{out}</Text>;
}
