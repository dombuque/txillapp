import { ProfileView } from '@/components/ProfileView';
import { useAuth } from '@/lib/auth';

/** O meu perfil. */
export default function Profile() {
  const { user } = useAuth();
  if (!user) return null;
  return <ProfileView username={user.username} />;
}
