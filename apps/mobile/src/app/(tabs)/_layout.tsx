import { Tabs } from 'expo-router';
import { TabBar } from '@/components/TabBar';
import { useSwipeTabs } from '@/lib/swipeTabs';

/** Separadores iguais aos do site: Início, Reels, + (nova publicação), Mensagens e Perfil. */
export default function TabsLayout() {
  useSwipeTabs();
  return (
    <Tabs tabBar={(p) => <TabBar {...p} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="reels" />
      <Tabs.Screen name="new" />
      <Tabs.Screen name="messages" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
