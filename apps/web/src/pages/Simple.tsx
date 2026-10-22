import { useQuery } from '@tanstack/react-query';
import { Avatar, btnGhost } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

export function ComingSoon({ emoji, title, text }: { emoji: string; title: string; text: string }) {
  return (
    <div className="mx-6 mt-20 text-center">
      <p className="text-6xl" aria-hidden>{emoji}</p>
      <h1 className="mt-4 text-2xl font-extrabold">{title}</h1>
      <p className="mt-2 text-lg font-light text-zinc-600">{text}</p>
    </div>
  );
}

export function Profile() {
  const { user, signOut } = useAuth();
  const { data } = useQuery({ queryKey: ['wallet'], queryFn: api.wallet });
  if (!user) return null;
  return (
    <div className="flex flex-col items-center px-6 pt-8 text-center">
      <Avatar name={user.displayName} size={96} />
      <h1 className="mt-5 text-3xl font-extrabold">{user.displayName}</h1>
      <p className="text-lg text-zinc-600">@{user.username}</p>
      {data && (
        <p className="mt-5 rounded-full bg-white px-5 py-2 font-semibold shadow-sm">
          👛 {data.balance.toLocaleString('pt-PT')} Txills de brincadeira
        </p>
      )}
      <button onClick={signOut} className={`${btnGhost} mt-10`}>
        Já vais? 😢 Sair
      </button>
    </div>
  );
}
