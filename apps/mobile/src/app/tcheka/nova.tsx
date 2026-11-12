import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * `/tcheka/nova`: abre a câmara já em Tcheka. `?som=<id>` traz um som de outra tcheka (a página do som, «Usar este
 * som»); `?dueto=<postId>` traz o vídeo de referência para o dueto (equipa do remix). O ecrã é o de criar (`/new`).
 */
export default function NovaTcheka() {
  const { som, dueto } = useLocalSearchParams<{ som?: string; dueto?: string }>();
  return <Redirect href={{ pathname: '/new', params: { kind: 'tcheka', t: String(Date.now()), ...(som ? { som } : {}), ...(dueto ? { dueto } : {}) } } as never} />;
}
