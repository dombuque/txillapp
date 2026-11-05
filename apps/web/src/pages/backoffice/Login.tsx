import { useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Wordmark } from '../../components/ui';
import { api, staffSession } from '../../lib/api';

/** Moldura dos ecrãs de entrada da equipa (sem relação com a rede social). */
export function StaffFrame({ title, text, children }: { title: string; text?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0f1219] p-5 text-zinc-100">
      <div className="w-full max-w-md rounded-2xl bg-white p-7 text-zinc-900 shadow-2xl">
        <Wordmark className="h-9" />
        <p className="mt-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Backoffice</p>
        <h1 className="mt-6 text-2xl font-extrabold tracking-tight">{title}</h1>
        {text && <p className="mt-1 text-sm text-zinc-600">{text}</p>}
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

export const field = 'mt-1 h-11 w-full rounded-lg border border-zinc-300 px-3 text-base outline-none focus:border-zinc-900';
export const submit = 'mt-2 h-11 w-full rounded-lg bg-zinc-900 font-semibold text-white hover:bg-zinc-700 disabled:opacity-40';

/** Entrada da equipa: email, senha e o código de 6 dígitos da app autenticadora. */
export default function StaffLogin() {
  const navigate = useNavigate();
  const here = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (staffSession.has()) return <Navigate to={(here.state as { from?: string } | null)?.from ?? '/backoffice'} replace />;

  async function go(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const r = await api.staffLogin(email.trim(), password, code.trim());
      staffSession.set(r.token);
      navigate((here.state as { from?: string } | null)?.from ?? '/backoffice', { replace: true });
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  }

  return (
    <StaffFrame title="Entrar na equipa" text="Esta conta é só da equipa. Não é a do Txillapp.">
      <form onSubmit={(e) => void go(e)} className="space-y-3">
        <label className="block text-sm font-semibold text-zinc-700">Email
          <input type="email" autoComplete="username" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
        </label>
        <label className="block text-sm font-semibold text-zinc-700">Senha
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
        </label>
        <label className="block text-sm font-semibold text-zinc-700">Código dos dois passos
          <input inputMode="numeric" autoComplete="one-time-code" required maxLength={8} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))} className={`${field} tracking-[0.3em]`} />
        </label>
        {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
        <button type="submit" disabled={busy || !email || !password || code.replace(/\s/g, '').length < 6} className={submit}>{busy ? 'A entrar…' : 'Entrar'}</button>
        <p className="pt-1 text-center text-xs text-zinc-500">Sem acesso, ou perdeste a senha ou o telemóvel? Pede uma ligação nova à Administração.</p>
      </form>
    </StaffFrame>
  );
}
