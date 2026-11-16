import { useLocalSearchParams, useRouter } from 'expo-router';
import { ZasRecapView } from '@/components/zas/ZasRecap';

/**
 * O resumo semanal dos Zás (`/zas-resumo?id=<id>`): o destino do push «O teu resumo dos Zás da semana está pronto» e da
 * notificação `zas_recap`. Sem id abre o mais recente; quando já não existe (404), diz «Este resumo já não existe».
 */
export default function ZasResumoScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const close = () => (router.canGoBack() ? router.back() : router.replace('/messages' as never));
  return <ZasRecapView id={typeof id === 'string' && id ? id : undefined} onClose={close} />;
}
