import { registerSchema, type RegisterInput } from '@txillapp/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode, type Ref, type SVGProps } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Wordmark } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';

/* ───────────── ícones ───────────── */
const svg = (p: SVGProps<SVGSVGElement>) => ({
  width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, ...p,
});
const UserIcon = () => (<svg {...svg({})}><circle cx="12" cy="8" r="4" /><path d="M4 20c1.5-4 4.5-5.5 8-5.5s6.5 1.5 8 5.5" /></svg>);
const AtIcon = () => (<svg {...svg({})}><circle cx="12" cy="12" r="4" /><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" /></svg>);
const MailIcon = () => (<svg {...svg({})}><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" /></svg>);
const LockIcon = () => (<svg {...svg({})}><rect x="5" y="11" width="14" height="9" rx="3" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>);
const EyeIcon = () => (<svg {...svg({})}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>);
const EyeOffIcon = () => (<svg {...svg({})}><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 4-.9" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>);
const BackIcon = () => (<svg {...svg({ width: 30, height: 30, strokeWidth: 2 })}><path d="M20 12H5M11 6l-6 6 6 6" /></svg>);
const CheckIcon = () => (<svg {...svg({ strokeWidth: 2.4 })}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>);
const CrossIcon = () => (<svg {...svg({ strokeWidth: 2.4 })}><path d="M6 6l12 12M18 6 6 18" /></svg>);
const Spinner = () => (<svg {...svg({})} className="animate-spin"><path d="M12 3a9 9 0 1 0 9 9" /></svg>);

/* ───────────── validação (mensagens em português, na hora) ───────────── */
type FieldKey = keyof RegisterInput;

/** Devolve o problema do valor ou null. Corre a cada tecla, sem esperar pelo servidor. */
function problemOf(key: FieldKey, raw: string): string | null {
  const v = key === 'username' ? raw.trim().replace(/^@/, '') : raw.trim();
  if (key === 'displayName') return v.length === 0 ? 'Diz-nos o teu nome 🙂' : v.length > 60 ? 'Nome demasiado comprido 😅' : null;
  if (key === 'username') {
    if (v.length < 3) return 'Mínimo 3 caracteres 🙂';
    if (v.length > 30) return 'Máximo 30 caracteres 😅';
    return registerSchema.shape.username.safeParse(v).success ? null : 'Só letras, números, "_" e "." — sem espaços 🙃';
  }
  if (key === 'email') return registerSchema.shape.email.safeParse(v).success ? null : 'Esse email não parece certo 🤔';
  return raw.length >= 10 ? null : 'Mínimo 10 caracteres 🙃';
}

type Check =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'ok' }
  | { state: 'bad'; message: string; suggestions?: string[]; taken?: boolean }
  | { state: 'error' };

/** Disponibilidade do @ / email em tempo real: validação local imediata + pergunta ao servidor (com pausa de 350 ms). */
function useAvailability(kind: 'username' | 'email', raw: string, enabled = true): Check {
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  useEffect(() => {
    const value = kind === 'username' ? raw.trim().replace(/^@/, '') : raw.trim();
    if (!enabled || !value) return setCheck({ state: 'idle' });
    const local = problemOf(kind, raw);
    if (local) return setCheck({ state: 'bad', message: local });
    setCheck({ state: 'checking' });
    let stale = false;
    const t = setTimeout(async () => {
      try {
        if (kind === 'username') {
          const r = await api.usernameAvailable(value);
          if (stale) return;
          if (r.available) return setCheck({ state: 'ok' });
          setCheck(
            r.reason === 'taken'
              ? { state: 'bad', taken: true, message: `@${value} já tem dono 😬`, suggestions: r.suggestions }
              : { state: 'bad', message: r.reason === 'reserved' ? 'Esse nome está reservado 🚫' : 'Nome de utilizador inválido 🙃' },
          );
        } else {
          const r = await api.emailAvailable(value);
          if (stale) return;
          setCheck(r.available ? { state: 'ok' } : { state: 'bad', taken: r.reason === 'taken', message: r.reason === 'taken' ? 'Este email já tem conta 😅' : 'Esse email não parece certo 🤔' });
        }
      } catch {
        if (!stale) setCheck({ state: 'error' }); // sem rede: deixa continuar, o servidor valida no fim
      }
    }, 350);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [kind, raw, enabled]);
  return check;
}

/* ───────────── componentes base ───────────── */
/** Campo arredondado e preenchido, com ícone, estado (✓ / ✗ / a verificar) e olho para a senha. */
function Field({
  icon, value, onChange, placeholder, type = 'text', autoComplete, autoFocus, name, capitalize, status,
  enterKeyHint, inputMode, inputRef, onEnter,
}: {
  icon: ReactNode; value: string; onChange: (v: string) => void; placeholder: string; type?: string;
  autoComplete?: string; autoFocus?: boolean; name?: string; capitalize?: 'words' | 'none';
  status?: 'ok' | 'bad' | 'checking'; enterKeyHint?: 'next' | 'go' | 'done'; inputMode?: 'text' | 'email';
  inputRef?: Ref<HTMLInputElement>; onEnter?: (e: KeyboardEvent<HTMLInputElement>) => void;
}) {
  const [shown, setShown] = useState(false);
  const isPassword = type === 'password';
  const ring = status === 'ok' ? 'shadow-[0_0_0_2px_#22c55e]' : status === 'bad' ? 'shadow-[0_0_0_2px_#ef4444]' : 'shadow-[0_1px_10px_rgba(0,0,0,0.06)] focus-within:shadow-[0_0_0_2px_#d6334f]';
  return (
    <label className={`flex items-center gap-3 rounded-2xl bg-white px-4 py-4 text-zinc-600 transition ${ring} ${status ? '' : 'focus-within:text-brand'}`}>
      {icon}
      <input
        ref={inputRef}
        name={name}
        autoFocus={autoFocus}
        type={isPassword && shown ? 'text' : type}
        inputMode={inputMode}
        enterKeyHint={enterKeyHint}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onEnter}
        // Com o teclado aberto, traz o campo para o meio do ecrã.
        onFocus={(e) => {
          const el = e.currentTarget;
          setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250);
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        aria-invalid={status === 'bad'}
        autoComplete={autoComplete}
        autoCapitalize={capitalize ?? 'none'}
        autoCorrect="off"
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent text-lg text-zinc-900 outline-none placeholder:text-zinc-600" // 18px: o iOS não faz zoom ao focar
      />
      {status === 'checking' && <span className="text-zinc-600"><Spinner /></span>}
      {status === 'ok' && <span className="text-green-500"><CheckIcon /></span>}
      {status === 'bad' && <span className="text-red-500"><CrossIcon /></span>}
      {isPassword && (
        <button type="button" onClick={() => setShown(!shown)} aria-label={shown ? 'Esconder a senha' : 'Mostrar a senha'} className="-mr-1 p-1 text-zinc-600">
          {shown ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      )}
    </label>
  );
}

const cta =
  'w-full rounded-full bg-gradient-to-r from-brand to-brand-light py-4 text-lg font-semibold text-white shadow-[0_10px_24px_rgba(214,51,79,0.35)] transition active:scale-[0.98] disabled:opacity-50 disabled:shadow-none';

/** Fundo cinzento claro com manchas de cor suaves, como num ecrã de rede social. */
function Screen({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="relative mx-auto flex min-h-dvh max-w-xl flex-col overflow-hidden bg-canvas">
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand/25 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -left-28 top-64 h-64 w-64 rounded-full bg-amber-300/30 blur-3xl" aria-hidden />
      <div className="relative flex flex-1 flex-col px-7 pt-6">{children}</div>
      {footer && <p className="relative border-t border-zinc-200 bg-white/70 py-5 text-center text-lg text-zinc-800 backdrop-blur">{footer}</p>}
    </main>
  );
}

function Alert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" aria-hidden={!children} className="flex min-h-[2.5rem] items-center justify-center text-center text-[15px] text-red-600">
      {children}
    </p>
  );
}

/** Resultado da validação em tempo real, com sugestões livres quando o @ já tem dono. */
function Availability({ check, okText, onPick, children }: { check: Check; okText: string; onPick?: (v: string) => void; children?: ReactNode }) {
  return (
    <div className="mt-3 min-h-[3.25rem] px-1" aria-live="polite">
      {check.state === 'checking' && <p className="text-sm text-zinc-600">A verificar… ⏳</p>}
      {check.state === 'ok' && <p className="text-sm font-medium text-green-600">{okText}</p>}
      {check.state === 'error' && <p className="text-sm text-zinc-600">Sem rede para verificar agora 📡 — confirmamos no fim.</p>}
      {check.state === 'bad' && (
        <>
          <p className="text-sm font-medium text-red-600">{check.message}</p>
          {check.suggestions && check.suggestions.length > 0 && onPick && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-sm text-zinc-600">Experimenta:</span>
              {check.suggestions.map((s) => (
                <button key={s} type="button" onClick={() => onPick(s)} className="rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-brand shadow-sm active:scale-95">
                  @{s}
                </button>
              ))}
            </div>
          )}
          {children}
        </>
      )}
    </div>
  );
}

/* ───────────── login com Google ───────────── */
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (o: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: string }) => void;
          renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
        };
      };
    };
  }
}

let gisLoading: Promise<void> | null = null;
function loadGoogleScript() {
  return (gisLoading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisLoading = null;
      reject(new Error('Não consegui carregar o login com Google'));
    };
    document.head.appendChild(s);
  }));
}

/** Botão oficial "Continuar com Google". Só aparece se o servidor tiver o login com Google configurado. */
function GoogleButton({ mode, onError }: { mode: 'login' | 'register'; onError: (m: string) => void }) {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const holder = useRef<HTMLDivElement>(null);
  const { data } = useQuery({ queryKey: ['auth-config'], queryFn: api.authConfig, staleTime: Infinity, retry: 1 });
  const clientId = data?.googleClientId;

  useEffect(() => {
    if (!clientId || !holder.current) return;
    let alive = true;
    loadGoogleScript()
      .then(() => {
        if (!alive || !holder.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: async ({ credential }) => {
            try {
              const r = await api.googleLogin(credential);
              if ('needsUsername' in r) return navigate('/google-username', { state: r, replace: true });
              signIn(r);
              navigate('/', { replace: true });
            } catch (x) {
              onError(x instanceof ApiError ? x.message : 'Não consegui entrar com a Google 😅');
            }
          },
        });
        holder.current.innerHTML = '';
        window.google.accounts.id.renderButton(holder.current, {
          type: 'standard', theme: 'outline', size: 'large', shape: 'pill',
          text: mode === 'login' ? 'continue_with' : 'signup_with', locale: 'pt-PT',
          width: Math.min(holder.current.clientWidth || 320, 400),
        });
      })
      .catch((x: Error) => onError(x.message));
    return () => {
      alive = false;
    };
  }, [clientId, mode, navigate, signIn, onError]);

  if (!clientId) return null;
  return (
    <div className="mt-5">
      <div className="mb-4 flex items-center gap-3 text-sm text-zinc-600" aria-hidden>
        <span className="h-px flex-1 bg-zinc-300" /> ou <span className="h-px flex-1 bg-zinc-300" />
      </div>
      <div ref={holder} className="flex min-h-[44px] justify-center" />
    </div>
  );
}

/* ───────────── login ───────────── */
export function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const passRef = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!identifier.trim() || !password) return setError('Por favor preencha as suas credenciais 😌');
    setBusy(true);
    setError('');
    try {
      signIn(await api.login({ identifier: identifier.trim().replace(/^@/, ''), password }));
      navigate('/');
    } catch (x) {
      setError(x instanceof ApiError && x.status === 401 ? 'Hmm, essas credenciais não batem 🤨' : (x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen footer={<>É novo no txillapp? <Link to="/register" className="font-semibold text-brand">Cria a tua conta</Link></>}>
      <h1 className="pt-10">
        <Wordmark className="h-11" />
      </h1>
      <p className="mt-7 text-[38px] font-extrabold leading-[1.05]">Qual é a<br />Vibe ? 🤪</p>
      <p className="mt-2 text-lg font-light text-zinc-600">Entra e vê o que a malta anda a fazer</p>

      <form onSubmit={submit} className="mt-7 space-y-3" noValidate>
        <Field
          icon={<AtIcon />} value={identifier} onChange={setIdentifier} placeholder="Usuário" name="username"
          autoComplete="username" enterKeyHint="next"
          // "Seguinte" no teclado passa para a senha em vez de submeter.
          onEnter={(e) => { if (e.key === 'Enter') { e.preventDefault(); passRef.current?.focus(); } }}
        />
        <Field icon={<LockIcon />} value={password} onChange={setPassword} placeholder="Senha" type="password" name="password" autoComplete="current-password" enterKeyHint="go" inputRef={passRef} />
        <Alert>{error}</Alert>
        <button disabled={busy} className={cta}>{busy ? 'A entrar… 🚀' : 'Entrar'}</button>
      </form>
      <GoogleButton mode="login" onError={setError} />
      <div className="pb-6" />
    </Screen>
  );
}

/* ───────────── registo em passos ───────────── */
const steps: { key: FieldKey; title: string; sub: string; placeholder: string; icon: ReactNode; type?: string; ac: string; cta: string; hint: 'next' | 'go' }[] = [
  { key: 'displayName', title: 'Como te chamas? 🤔', sub: 'Diz-nos o teu nome, não mordemos 😄', placeholder: 'Nome', icon: <UserIcon />, ac: 'name', cta: 'Próximo', hint: 'next' },
  { key: 'username', title: 'Qual vai ser o teu @? 😎', sub: 'É único: só tu o podes ter', placeholder: 'utilizador', icon: <AtIcon />, ac: 'username', cta: 'Próximo', hint: 'next' },
  { key: 'email', title: 'E o teu email? 📬', sub: 'Prometemos não fazer spam', placeholder: 'email@exemplo.com', icon: <MailIcon />, type: 'email', ac: 'email', cta: 'Próximo', hint: 'next' },
  { key: 'password', title: 'Agora uma senha 🔐', sub: 'Mínimo 10 caracteres. Nada de "123456", ok?', placeholder: 'Senha', icon: <LockIcon />, type: 'password', ac: 'new-password', cta: 'Criar conta', hint: 'go' },
];

/** Força da senha, só para dar feedback simpático (a validação a sério é no servidor). */
function strength(p: string) {
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/].filter((r) => r.test(p)).length;
  if (p.length < 10) return { level: 1, label: 'Ainda fraca 😬', color: 'bg-red-400' };
  if (p.length >= 14 || kinds >= 3) return { level: 3, label: 'Forte 💪', color: 'bg-green-500' };
  return { level: 2, label: 'Boa 👍', color: 'bg-amber-400' };
}

export function Register() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [i, setI] = useState(0);
  const [data, setData] = useState<Partial<RegisterInput>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const step = steps[i];
  const value = data[step.key] ?? '';
  const kind = step.key === 'username' || step.key === 'email' ? step.key : null;
  const check = useAvailability(kind ?? 'username', value, kind !== null);
  const local = value ? problemOf(step.key, value) : null;
  const blocked = !value.trim() || !!local || (kind !== null && (check.state === 'checking' || check.state === 'bad'));

  async function next(e: FormEvent) {
    e.preventDefault();
    if (blocked) return setError(local ?? (check.state === 'bad' ? check.message : value ? 'Só um segundinho… ⏳' : 'Preenche este campo 🙂'));
    setError('');
    if (i < steps.length - 1) return setI(i + 1);
    setBusy(true);
    try {
      signIn(await api.register({ ...data, username: String(data.username).replace(/^@/, '') }));
      navigate('/');
    } catch (x) {
      const msg = (x as Error).message;
      if (x instanceof ApiError && x.status === 409) {
        // Raro (alguém ficou com ele entretanto): volta ao passo certo e mostra porquê.
        setI(/email/i.test(msg) ? 2 : 1);
        setError(/email/i.test(msg) ? 'Esse email já tem conta 😅' : 'Esse @ acabou de ser escolhido por outra pessoa 😬');
      } else setError(msg);
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

  const s = step.key === 'password' ? strength(value) : null;
  const status = kind ? (check.state === 'ok' ? 'ok' : check.state === 'bad' ? 'bad' : check.state === 'checking' ? 'checking' : undefined) : undefined;
  return (
    <Screen>
      <div className="flex items-center gap-4 pt-2">
        <button onClick={back} aria-label="Voltar" className="-ml-1 text-brand active:scale-90"><BackIcon /></button>
        <div className="flex flex-1 gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={i + 1} aria-label={`Passo ${i + 1} de ${steps.length}`}>
          {steps.map((_, n) => (
            <span key={n} className={`h-1.5 flex-1 rounded-full transition-colors ${n <= i ? 'bg-brand' : 'bg-zinc-300'}`} />
          ))}
        </div>
      </div>

      <form onSubmit={next} className="mt-12 flex flex-1 flex-col" noValidate>
        <h1 className="text-4xl font-light leading-tight">{step.title}</h1>
        <p className="mt-3 text-xl font-light text-zinc-600">{step.sub}</p>
        <div className="mt-8">
          <Field
            key={step.key}
            autoFocus
            icon={step.icon}
            value={value}
            onChange={(v) => {
              setError('');
              setData({ ...data, [step.key]: v });
            }}
            placeholder={step.placeholder}
            type={step.type}
            autoComplete={step.ac}
            capitalize={step.key === 'displayName' ? 'words' : 'none'}
            inputMode={step.key === 'email' ? 'email' : 'text'}
            enterKeyHint={step.hint}
            status={status}
          />
          {step.key === 'username' && (
            <Availability check={check} okText={`@${value.trim().replace(/^@/, '')} está livre 🎉`} onPick={(v) => setData({ ...data, username: v })} />
          )}
          {step.key === 'email' && (
            <Availability check={check} okText="Email livre ✅">
              {check.state === 'bad' && check.taken && (
                <Link to="/login" className="mt-1 inline-block text-sm font-semibold text-brand underline">Já tens conta? Entra aqui</Link>
              )}
            </Availability>
          )}
          {step.key === 'displayName' && value && local && <p className="mt-3 px-1 text-sm font-medium text-red-600">{local}</p>}
          {s && value.length > 0 && (
            <div className="mt-3 flex items-center gap-3 px-1" aria-live="polite">
              <div className="flex flex-1 gap-1.5">
                {[1, 2, 3].map((n) => (
                  <span key={n} className={`h-1.5 flex-1 rounded-full ${n <= s.level ? s.color : 'bg-zinc-300'}`} />
                ))}
              </div>
              <span className="text-sm font-medium text-zinc-600">{s.label}</span>
            </div>
          )}
        </div>
        <Alert>{error}</Alert>
        <div className="mt-auto pb-6 pt-2">
          <button disabled={busy || blocked} className={cta}>{busy ? 'A criar… 🚀' : step.cta}</button>
          {i === 0 && <GoogleButton mode="register" onError={setError} />}
        </div>
      </form>
    </Screen>
  );
}

/* ───────────── depois do Google: escolher o @ ───────────── */
interface GoogleSignup {
  needsUsername: true;
  signupToken: string;
  displayName: string;
  suggestedUsername: string;
}

export function GoogleUsername() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const state = useLocation().state as GoogleSignup | null;
  const [username, setUsername] = useState(state?.suggestedUsername ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const check = useAvailability('username', username);
  if (!state?.signupToken) return <Navigate to="/login" replace />;
  const first = state.displayName.split(' ')[0];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (check.state !== 'ok' && check.state !== 'error') return;
    setBusy(true);
    setError('');
    try {
      signIn(await api.googleComplete(state!.signupToken, username));
      navigate('/', { replace: true });
    } catch (x) {
      setError(x instanceof ApiError && x.status === 401 ? 'O pedido expirou. Volta atrás e entra com a Google outra vez 🔄' : (x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <div className="pt-2">
        <button onClick={() => navigate('/login', { replace: true })} aria-label="Voltar" className="-ml-1 text-brand active:scale-90"><BackIcon /></button>
      </div>
      <form onSubmit={submit} className="mt-12 flex flex-1 flex-col" noValidate>
        <h1 className="text-4xl font-light leading-tight">Quase lá, {first}! 🎉</h1>
        <p className="mt-3 text-xl font-light text-zinc-600">Escolhe o teu @ — é único e é assim que a malta te encontra</p>
        <div className="mt-8">
          <Field
            autoFocus icon={<AtIcon />} value={username} onChange={(v) => { setError(''); setUsername(v); }}
            placeholder="utilizador" autoComplete="username" enterKeyHint="go"
            status={check.state === 'ok' ? 'ok' : check.state === 'bad' ? 'bad' : check.state === 'checking' ? 'checking' : undefined}
          />
          <Availability check={check} okText={`@${username.trim().replace(/^@/, '')} está livre 🎉`} onPick={setUsername} />
        </div>
        <Alert>{error}</Alert>
        <div className="mt-auto pb-6 pt-2">
          <button disabled={busy || (check.state !== 'ok' && check.state !== 'error')} className={cta}>{busy ? 'A criar… 🚀' : 'Continuar'}</button>
        </div>
      </form>
    </Screen>
  );
}
