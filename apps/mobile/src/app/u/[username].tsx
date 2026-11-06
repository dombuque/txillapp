import { useLocalSearchParams } from 'expo-router';
import { ProfileView } from '@/components/ProfileView';
import { useAuth } from '@/lib/auth';

/** Perfil de outra pessoa (ou o meu, se for o meu @). */
export default function UserProfile() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const { user } = useAuth();
  if (!username) return null;
  return <ProfileView key={username} username={username} isMe={username === user?.username} />;
}
