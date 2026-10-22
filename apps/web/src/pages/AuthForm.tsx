import { registerSchema, type RegisterInput } from '@txillapp/shared';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Wordmark, btnPrimary } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';

const underline =
  'w-full border-0 border-b border-zinc-400 bg-transparent py-3 text-xl text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-brand';

function Screen({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col bg-canvas">
      <div className="flex-1 px-7 pt-6">{children}</div>
      {footer && (
        <p className="border-t border-zinc-200 bg-white/60 py-6 text-center text-lg text-zinc-800">{footer}</p>
      )}
    </main>
  );
}

export function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!identifier.trim() || !password) return setError('Por favor preencha as suas credenciais 😌');
    setBusy(true);
    setError('');
    try {
      signIn(await api.login({ identifier: identifier.trim(), password }));
      navigate('/');
    } catch (x) {
      setError(x instanceof ApiError && x.status === 401 ? 'Hmm, essas credenciais não batem 🤨' : (x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen footer={<>Não tem conta? <Link to="/register" className="text-brand">Criar uma</Link></>}>
      <h1 className="pt-24">
        <Wordmark className="h-10" />
      </h1>
      <p className="mt-8 text-[36px] font-extrabold leading-tight">Qual é a Vibe ? 🤪</p>
      <form onSubmit={submit} className="mt-20" noValidate>
        <input
          className={underline}
          placeholder="Usuário"
          autoComplete="username"
          autoCapitalize="none"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          aria-label="Usuário"
        />
        <input
          className={`${underline} mt-6`}
          type="password"
          placeholder="Senha"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-label="Senha"
        />
        <p role="alert" className="mt-8 min-h-6 text-center text-red-600">{error}</p>
        <button disabled={busy} className={`${btnPrimary} mt-12 w-full py-5 text-lg`}>
          Entrar
        </button>
      </form>
    </Screen>
  );
}

type Field = keyof RegisterInput;
const steps: { key: Field; title: string; sub: string; placeholder: string; type?: string; ac: string; cta: string }[] = [
  { key: 'displayName', title: 'Como te chamas? 🤔', sub: 'Identifique-se pelo amor de Deus', placeholder: 'Nome', ac: 'name', cta: 'Próximo' },
  { key: 'username', title: 'Qual vai ser o teu @? 😎', sub: 'É assim que a malta te vai encontrar', placeholder: 'utilizador', ac: 'username', cta: 'Próximo' },
  { key: 'email', title: 'E o teu email? 📬', sub: 'Prometemos não fazer spam', placeholder: 'email@exemplo.com', type: 'email', ac: 'email', cta: 'Próximo' },
  { key: 'password', title: 'Agora uma senha 🔐', sub: 'Mínimo 10 caracteres. Nada de "123456", ok?', placeholder: 'Senha', type: 'password', ac: 'new-password', cta: 'Criar conta' },
];

export function Register() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [i, setI] = useState(0);
  const [data, setData] = useState<Partial<RegisterInput>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const step = steps[i];

  async function next(e: FormEvent) {
    e.preventDefault();
    const check = registerSchema.shape[step.key].safeParse(data[step.key] ?? '');
    if (!check.success) return setError(`${check.error.issues[0].message} 🙃`);
    setError('');
    if (i < steps.length - 1) return setI(i + 1);
    setBusy(true);
    try {
      signIn(await api.register(data));
      navigate('/');
    } catch (x) {
      const taken = x instanceof ApiError && x.status === 409;
      setError(taken ? 'Esse já tem dono 😬 Volta atrás e escolhe outro' : (x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function back() {
    if (i === 0) navigate('/login');
    else {
      setError('');
      setI(i - 1);
    }
  }

  return (
    <Screen>
      <button onClick={back} aria-label="Voltar" className="pt-2 text-brand">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M20 12H5M11 6l-6 6 6 6" />
        </svg>
      </button>
      <form onSubmit={next} className="mt-24" noValidate>
        <h1 className="text-4xl font-light">{step.title}</h1>
        <p className="mt-5 text-xl font-light text-zinc-600">{step.sub}</p>
        <input
          key={step.key}
          autoFocus
          className={`${underline} mt-14`}
          type={step.type ?? 'text'}
          placeholder={step.placeholder}
          autoComplete={step.ac}
          autoCapitalize={step.key === 'displayName' ? 'words' : 'none'}
          value={data[step.key] ?? ''}
          onChange={(e) => setData({ ...data, [step.key]: e.target.value })}
          aria-label={step.placeholder}
        />
        <p role="alert" className="mt-6 min-h-6 text-center text-red-600">{error}</p>
        <button disabled={busy} className={`${btnPrimary} mt-24 w-full py-5 text-lg`}>
          {step.cta}
        </button>
      </form>
    </Screen>
  );
}
