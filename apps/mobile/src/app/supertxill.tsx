import { useLocalSearchParams, useRouter } from 'expo-router';
import { SuperTxillScreen } from '@/components/SuperTxillPanel';

/**
 * O SuperTxill como ecrã: «Voltar» volta para onde estavas (ou para as Mensagens, se entraste direto pela ligação).
 * Abre na conversa; `?tab=malta` abre logo a «Malta para ti» (o botão de sugestões do perfil).
 */
export default function SuperTxillRoute() {
  const router = useRouter();
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  return <SuperTxillScreen initialTab={tab === 'malta' ? 'malta' : 'conversa'} onClose={() => (router.canGoBack() ? router.back() : router.replace('/messages' as never))} />;
}
