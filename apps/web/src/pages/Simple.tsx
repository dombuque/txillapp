import { Avatar } from '../components/ui';
import { useAuth } from '../lib/auth';

export function ComingSoon({ title, text }: { title: string; text: string }) {
  return (
    <div className="p-10 text-center">
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="mt-2 text-zinc-500">{text}</p>
    </div>
  );
}

export function Profile() {
  const { user, signOut } = useAuth();
  if (!user) return null;
  return (
    <div className="flex flex-col items-center gap-3 p-8">
      <Avatar name={user.displayName} size={88} />
      <h1 className="text-2xl font-bold">{user.displayName}</h1>
      <p className="text-zinc-500">@{user.username}</p>
      <button onClick={signOut} className="mt-4 rounded-xl border border-zinc-300 bg-white px-6 py-2.5 font-semibold">
        Sair
      </button>
    </div>
  );
}
