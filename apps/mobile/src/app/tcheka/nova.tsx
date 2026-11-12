import { Redirect, useLocalSearchParams } from 'expo-router';
import { remixStudioFor } from '@/components/remix/RemixEntry';

/**
 * `/tcheka/nova`: abre a câmara já em Tcheka. `?som=<id>` traz um som de outra tcheka (a página do som, «Usar este
 * som»); `?dueto=<postId>` e `?resposta=<commentId>` abrem o estúdio do remix (components/remix). Sem remix, o ecrã é o de
 * criar (`/new`).
 */
export default function NovaTcheka() {
  const remix = remixStudioFor(useLocalSearchParams());
  if (remix) return remix;
  return <NovaTchekaRedirect />;
}

function NovaTchekaRedirect() {
  const { som } = useLocalSearchParams<{ som?: string }>();
  return <Redirect href={{ pathname: '/new', params: { kind: 'tcheka', t: String(Date.now()), ...(som ? { som } : {}) } } as never} />;
}
