import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TabBar } from '@/components/TabBar';
import { useSwipeTabs } from '@/lib/swipeTabs';

/** Separadores iguais aos do site: Início, Reels, + (nova publicação), Mensagens e Perfil. */
export default function TabsLayout() {
  useSwipeTabs();
  const insets = useSafeAreaInsets();
  // A barra de baixo flutua por cima do ecrã; os ecrãs normais acabam acima dela (a Tcheka e a câmara ocupam tudo).
  const bar = 58 + Math.max(insets.bottom, 8) + 8;
  return (
    <Tabs tabBar={(p) => <TabBar {...p} />} screenOptions={{ headerShown: false, sceneStyle: { paddingBottom: bar } }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="reels" options={{ sceneStyle: { paddingBottom: 0 } }} />
      <Tabs.Screen name="new" options={{ sceneStyle: { paddingBottom: 0 } }} />
      <Tabs.Screen name="messages" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
