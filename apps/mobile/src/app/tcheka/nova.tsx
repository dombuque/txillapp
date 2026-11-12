import { Redirect, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { remixStudioFor } from '@/components/remix/RemixEntry';

/**
 * Nova tcheka (/tcheka/nova). Contrato comum: `?som=<id>` (estúdio, equipa do estúdio), `?dueto=<postId>` e
 * `?resposta=<commentId>` (remix). Ao juntar com o estúdio fica só a primeira linha do corpo, antes do estúdio normal.
 */
export default function NewTcheka() {
  const params = useLocalSearchParams<{ dueto?: string; resposta?: string; som?: string }>();
  const remix = remixStudioFor(params);
  if (remix) return <View style={{ flex: 1, backgroundColor: '#000' }}>{remix}</View>;
  // Sem remix: o estúdio de sempre (o separador Nova, no modo tcheka).
  return <Redirect href={{ pathname: '/new', params: { kind: 'tcheka', ...(params.som ? { som: params.som } : {}) } } as never} />;
}
