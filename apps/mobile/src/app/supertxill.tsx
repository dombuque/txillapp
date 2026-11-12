import { useRouter } from 'expo-router';
import { SuperTxillScreen } from '@/components/SuperTxillPanel';

/** O SuperTxill como ecrã: «Voltar» volta para onde estavas (ou para as Mensagens, se entraste direto pela ligação). */
export default function SuperTxillRoute() {
  const router = useRouter();
  return <SuperTxillScreen onClose={() => (router.canGoBack() ? router.back() : router.replace('/messages' as never))} />;
}
