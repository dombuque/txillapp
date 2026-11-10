import { useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';
import { NewChatSheet } from '@/components/GroupSheets';
import { colors } from '@/lib/theme';

/**
 * Nova conversa ou grupo: abre a folha por cima de um fundo vazio; ao fechar, volta atrás.
 * Com `?group=1` (o "Novo TxillGroup" do separador TxillGroups) abre logo nos dados do TxillGroup novo.
 */
export default function NewChat() {
  const router = useRouter();
  const { group } = useLocalSearchParams<{ group?: string }>();
  const close = () => (router.canGoBack() ? router.back() : router.replace('/messages' as never));
  return (
    <View style={{ flex: 1, backgroundColor: colors.white }}>
      <NewChatSheet onClose={close} startGroup={group === '1'} />
    </View>
  );
}
