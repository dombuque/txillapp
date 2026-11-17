import { Text } from 'react-native';
import { mentionParts } from '@/lib/txilladaChat';
import { t } from '@/lib/i18n';

/**
 * O texto de um comentário da Txillada com os @nomes a negrito e tocáveis (abrem o perfil). Vai dentro de um <Text> (o
 * balão): o toque no @ não abre também o menu do comentário (o clique não sobe até ao balão).
 */
export function MentionText({ text, onMention, color = '#fff' }: { text: string; onMention: (username: string) => void; color?: string }) {
  const parts = mentionParts(text);
  return (
    <>
      {parts.map((p, i) => (p.t === 'text' ? p.s : (
        <Text
          key={i}
          style={{ fontWeight: '800', color }}
          suppressHighlighting
          onPress={(e) => {
            (e as unknown as { stopPropagation?: () => void })?.stopPropagation?.();
            onMention(p.u);
          }}
          accessibilityRole="link"
          accessibilityLabel={t('Perfil de {u}', { u: p.u })}
        >
          @{p.u}
        </Text>
      )))}
    </>
  );
}
