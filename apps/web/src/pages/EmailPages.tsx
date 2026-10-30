import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon';
import { Wordmark } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { AuthCta, AuthField, AuthScreen } from './AuthForm';

/** Abre-se a partir do link do e-mail: confirma a conta. Pode ser noutro aparelho, por isso não exige sessão. */
export function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<'working' | 'ok' | 'bad'>('working');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let alive = true;
    api
      .verifyEmail(token)
      .then(() => alive && setState('ok'))
      .catch((x) => {
        if (!alive) return;
        setMessage(x instanceof ApiError ? x.message : 'Não consegui confirmar agora. Tenta outra vez.');
        setState('bad');
      });
    return () => {
      alive = false;
    };
  }, [token]);

  return (
    <AuthScreen>
      <h1 className="pt-10"><Wordmark className="h-11" /></h1>
      <div className="mt-10">
        {state === 'working' && <p className="text-xl text-zinc-600" role="status">A confirmar o teu e-mail…</p>}
        {state === 'ok' && (
          <>
            <p className="flex items-center gap-2 text-3xl font-extrabold leading-tight"><Icon name="check-circle" size={32} className="text-green-600" /> E-mail confirmado</p>
            <p className="mt-3 text-lg text-zinc-600">Já podes publicar, comentar e conversar.</p>
            <Link to="/" className="mt-8 block rounded-full bg-brand py-4 text-center text-lg font-semibold text-white">Entrar no Txillapp</Link>
          </>
        )}
        {state === 'bad' && (
          <>
            <p className="flex items-center gap-2 text-3xl font-extrabold leading-tight"><Icon name="alert" size={32} className="text-brand" /> Link inválido</p>
            <p className="mt-3 text-lg text-zinc-600">{message}</p>
            <Link to="/" className="mt-8 block rounded-full border-2 border-zinc-300 py-4 text-center text-lg font-semibold">Ir para o Txillapp</Link>
          </>
        )}
      </div>
    </AuthScreen>
  );
}

/** "Esqueci a senha": pede o e-mail e responde sempre o mesmo, exista a conta ou não. */
export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Esse e-mail não parece certo');
    setBusy(true);
    setError('');
    try {
      await api.forgotPassword(email.trim());
      setSent(true);
    } catch (x) {
      setError(x instanceof ApiError ? x.message : 'Não consegui enviar agora. Tenta outra vez.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthScreen footer={<Link to="/login" className="font-semibold text-brand">Voltar a entrar</Link>}>
      <h1 className="pt-10 lg:hidden"><Wordmark className="h-11" /></h1>
      {sent ? (
        <div className="mt-10">
          <p className="flex items-center gap-2 text-3xl font-extrabold leading-tight"><Icon name="mail" size={32} className="text-brand" /> Vê o teu e-mail</p>
          <p className="mt-3 text-lg text-zinc-600">Se existir uma conta com <b>{email.trim()}</b>, enviámos um link para escolheres uma senha nova. Vale 1 hora. Se não chegar, vê também o spam.</p>
        </div>
      ) : (
        <>
          <p className="mt-7 text-[34px] font-extrabold leading-[1.05]">Esqueceste<br />a senha?</p>
          <p className="mt-2 text-lg font-light text-zinc-600">Diz-nos o teu e-mail e enviamos um link para escolheres outra.</p>
          <form onSubmit={submit} className="mt-7 space-y-3" noValidate>
            <AuthField icon={<Icon name="mail" size={22} />} value={email} onChange={setEmail} placeholder="E-mail" type="email" name="email" autoComplete="email" inputMode="email" autoFocus />
            <p role="alert" className="min-h-[1.5rem] text-center text-[15px] text-red-600">{error}</p>
            <button disabled={busy} className={AuthCta}>{busy ? 'A enviar…' : 'Enviar link'}</button>
          </form>
        </>
      )}
    </AuthScreen>
  );
}

/** Abre-se a partir do link do e-mail: escolhe a senha nova. */
export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pass.length < 10) return setError('A senha precisa de pelo menos 10 caracteres');
    if (pass !== again) return setError('As duas senhas não são iguais');
    setBusy(true);
    setError('');
    try {
      await api.resetPassword(token, pass);
      setDone(true);
      setTimeout(() => navigate('/login', { replace: true }), 2500);
    } catch (x) {
      setError(x instanceof ApiError ? x.message : 'Não consegui mudar agora. Tenta outra vez.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthScreen footer={<Link to="/login" className="font-semibold text-brand">Voltar a entrar</Link>}>
      <h1 className="pt-10 lg:hidden"><Wordmark className="h-11" /></h1>
      {done ? (
        <div className="mt-10">
          <p className="flex items-center gap-2 text-3xl font-extrabold leading-tight"><Icon name="check-circle" size={32} className="text-green-600" /> Senha mudada</p>
          <p className="mt-3 text-lg text-zinc-600">Já podes entrar com a senha nova. A levar-te ao login…</p>
        </div>
      ) : (
        <>
          <p className="mt-7 text-[34px] font-extrabold leading-[1.05]">Escolhe uma<br />senha nova</p>
          <p className="mt-2 text-lg font-light text-zinc-600">Mínimo 10 caracteres. Vamos terminar a sessão nos outros aparelhos.</p>
          <form onSubmit={submit} className="mt-7 space-y-3" noValidate>
            <AuthField icon={<Icon name="lock" size={22} />} value={pass} onChange={setPass} placeholder="Senha nova" type="password" name="new-password" autoComplete="new-password" autoFocus />
            <AuthField icon={<Icon name="lock" size={22} />} value={again} onChange={setAgain} placeholder="Repete a senha" type="password" name="new-password-again" autoComplete="new-password" />
            <p role="alert" className="min-h-[1.5rem] text-center text-[15px] text-red-600">{error}</p>
            <button disabled={busy || !token} className={AuthCta}>{busy ? 'A guardar…' : 'Guardar senha'}</button>
          </form>
        </>
      )}
    </AuthScreen>
  );
}
