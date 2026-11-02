import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Suggestion } from '../lib/api';
import { canPickContacts, emailsFromFile, hashAll, pickContactEmails } from '../lib/contacts';
import FollowButton from './FollowButton';
import Icon from './Icon';
import { Avatar, Sheet } from './ui';

/**
 * "Amigos nos contactos": a pessoa escolhe os contactos (ou importa um ficheiro) e vê quem já está no Txillapp.
 * Os contactos ficam no telemóvel: só se envia o resumo dos emails, e nada disso fica guardado no servidor.
 */
export default function FindContacts({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [found, setFound] = useState<Suggestion[] | null>(null);
  const [total, setTotal] = useState(0);
  const file = useRef<HTMLInputElement>(null);

  async function run(get: () => Promise<string[]>) {
    setBusy(true);
    setErr('');
    try {
      const emails = await get();
      setTotal(emails.length);
      if (!emails.length) {
        setFound([]);
      } else {
        setFound((await api.matchContacts(await hashAll(emails))) as Suggestion[]);
      }
    } catch (e) {
      // Cancelar o seletor do sistema não é um erro.
      if ((e as Error).name !== 'AbortError' && (e as Error).name !== 'NotAllowedError') setErr((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <Sheet title="Amigos nos contactos" onClose={onClose} layer="z-[70]">
      {found === null ? (
        <div className="space-y-3">
          <p className="text-[15px] text-zinc-700">Vê quem dos teus contactos já está no Txillapp. Os contactos ficam no teu telemóvel: só enviamos um resumo cifrado dos emails, só para comparar, e não guardamos nada.</p>
          {canPickContacts() && (
            <button type="button" disabled={busy} onClick={() => void run(pickContactEmails)} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand font-bold text-white transition active:scale-[0.98] disabled:opacity-50">
              <Icon name="users" size={20} /> {busy ? 'A procurar…' : 'Escolher contactos'}
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => file.current?.click()} className={`flex h-12 w-full items-center justify-center gap-2 rounded-full font-bold transition active:scale-[0.98] disabled:opacity-50 ${canPickContacts() ? 'bg-zinc-100 text-zinc-800' : 'bg-brand text-white'}`}>
            <Icon name="download" size={20} /> {busy ? 'A procurar…' : 'Importar ficheiro de contactos'}
          </button>
          <input ref={file} type="file" accept=".vcf,.csv,text/vcard,text/csv,text/plain" className="hidden" onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void run(() => emailsFromFile(f));
          }} />
          {!canPickContacts() && <p className="text-sm text-zinc-500">No iPhone, exporta os contactos como ficheiro .vcf (na app Contactos, escolhe os contactos e partilha) e importa-o aqui.</p>}
          {err && <p role="alert" className="text-center text-sm text-red-600">{err}</p>}
        </div>
      ) : found.length === 0 ? (
        <div className="py-6 text-center text-zinc-600">
          <p className="font-extrabold">Ninguém por agora</p>
          <p className="mt-1 text-sm">{total ? `Vimos ${total} ${total === 1 ? 'email' : 'emails'} e nenhum está no Txillapp (ou ainda não quer ser encontrado).` : 'Não encontrámos emails nos contactos.'}</p>
          <button type="button" onClick={() => setFound(null)} className="mt-4 h-11 rounded-full bg-zinc-100 px-6 font-semibold active:scale-95">Tentar outra vez</button>
        </div>
      ) : (
        <ul>
          {found.map((p) => (
            <li key={p.username} className="flex items-center gap-3 py-2.5">
              <Link to={`/u/${p.username}`} onClick={onClose} className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar name={p.displayName} username={p.username} size={46} ring={false} presence />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{p.displayName}</span>
                  <span className="block truncate text-sm text-zinc-500">@{p.username} · {p.reason}</span>
                </span>
              </Link>
              <div className="w-[104px] shrink-0"><FollowButton username={p.username} following={false} requested={p.requested} isPrivate={p.isPrivate} /></div>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
