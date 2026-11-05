import QRCode from 'qrcode';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, staffSession, type StaffSetupInfo } from '../../lib/api';
import { StaffFrame, field, submit } from './Login';

/**
 * Ligação de convite (uso único): a própria pessoa define a senha e liga a app autenticadora.
 * A senha nunca passa por quem convida.
 */
export default function StaffSetup() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const [data, setData] = useState<StaffSetupInfo | null>(null);
  const [loadErr, setLoadErr] = useState('');
  useEffect(() => {
    if (!token) return;
    let live = true;
    api.staffSetupInfo(token).then((d) => live && setData(d)).catch((e: Error) => live && setLoadErr(e.message || 'Não foi possível abrir a ligação.'));
    return () => { live = false; };
  }, [token]);
  const [qr, setQr] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (data) void QRCode.toDataURL(data.otpauth, { margin: 1, width: 220 }).then(setQr).catch(() => setQr(''));
  }, [data]);

  if (!token || loadErr) {
    return (
      <StaffFrame title="Ligação inválida" text={loadErr || 'Falta a ligação de convite. Pede uma nova à Administração.'}>
        <a href="/backoffice/login" className="text-sm font-semibold underline">Ir para a entrada</a>
      </StaffFrame>
    );
  }
  if (!data) return <StaffFrame title="A preparar…">{null}</StaffFrame>;

  const weak = password.length < 12;
  const mismatch = again.length > 0 && again !== password;
  async function go(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const r = await api.staffSetup(token, password, code.trim());
      staffSession.set(r.token);
      navigate('/backoffice', { replace: true });
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  }

  return (
    <StaffFrame title={`Olá, ${data.name}`} text={`Define a senha da conta ${data.email} e liga os dois passos.`}>
      <form onSubmit={(e) => void go(e)} className="space-y-4">
        <div className="rounded-xl bg-zinc-50 p-4 text-center ring-1 ring-zinc-200">
          <p className="text-sm font-semibold">1. Lê este QR numa app autenticadora</p>
          <p className="text-xs text-zinc-500">Google Authenticator, Authy, 1Password, Microsoft Authenticator…</p>
          {qr && <img src={qr} alt="QR dos dois passos" width={220} height={220} className="mx-auto mt-2 rounded-lg bg-white" />}
          <p className="mt-2 text-xs text-zinc-500">Sem câmara? Escreve esta chave na app:</p>
          <p className="mt-1 break-all font-mono text-sm font-semibold tracking-wider">{data.secret.match(/.{1,4}/g)?.join(' ')}</p>
        </div>
        <label className="block text-sm font-semibold text-zinc-700">2. Escolhe a senha (mínimo 12 caracteres)
          <input type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
        </label>
        <label className="block text-sm font-semibold text-zinc-700">Repete a senha
          <input type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} className={field} />
        </label>
        {mismatch && <p className="text-sm text-red-600">As senhas não são iguais.</p>}
        <label className="block text-sm font-semibold text-zinc-700">3. Código que a app mostra agora
          <input inputMode="numeric" autoComplete="one-time-code" required maxLength={8} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))} className={`${field} tracking-[0.3em]`} />
        </label>
        {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
        <button type="submit" disabled={busy || weak || password !== again || code.replace(/\s/g, '').length < 6} className={submit}>{busy ? 'A guardar…' : 'Guardar e entrar'}</button>
        <p className="text-center text-xs text-zinc-500">Esta ligação só funciona uma vez.</p>
      </form>
    </StaffFrame>
  );
}
