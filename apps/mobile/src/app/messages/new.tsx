import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { NewChatSheet } from '@/components/GroupSheets';
import { colors } from '@/lib/theme';

/** Nova conversa ou grupo: abre a folha por cima de um fundo vazio; ao fechar, volta atrás. */
export default function NewChat() {
  const router = useRouter();
  const close = () => (router.canGoBack() ? router.back() : router.replace('/messages' as never));
  return (
    <View style={{ flex: 1, backgroundColor: colors.white }}>
      <NewChatSheet onClose={close} />
    </View>
  );
}
