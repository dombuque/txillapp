import { Tabs } from 'expo-router';
import { Compass, House, MessageCircle, User } from 'lucide-react-native';
import { colors } from '@/lib/theme';

/** Separadores da app: Início, Explorar, Mensagens e Perfil. */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        tabBarShowLabel: false,
        tabBarStyle: { backgroundColor: colors.white, borderTopColor: colors.line },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Início', tabBarIcon: ({ color }) => <House size={26} color={color} /> }} />
      <Tabs.Screen name="explore" options={{ title: 'Explorar', tabBarIcon: ({ color }) => <Compass size={26} color={color} /> }} />
      <Tabs.Screen name="messages" options={{ title: 'Mensagens', tabBarIcon: ({ color }) => <MessageCircle size={26} color={color} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Perfil', tabBarIcon: ({ color }) => <User size={26} color={color} /> }} />
    </Tabs>
  );
}
