import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MIN_AGE, birthDateSchema } from '@txillapp/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Gender } from '../lib/api';
import GenderPicker from './GenderPicker';

/**
 * Para contas que ainda não completaram o perfil: pede, uma única vez, o que falta —
 * como se identifica, a data de nascimento (idade mínima) e a aceitação dos termos em vigor.
 * Não se fecha sem completar.
 */
export default function GenderGate() {
  const qc = useQueryClient();
  const privacy = useQuery({ queryKey: ['privacy'], queryFn: api.privacy, staleTime: 60_000 });
  const [gender, setGender] = useState<Gender | null>(null);
  const [birth, setBirth] = useState('');
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const p = privacy.data;
  if (!p) return null;
  const needGender = p.gender === null;
  const needBirth = !p.birthDateSet;
  const needTerms = !p.termsAccepted;
  if (!needGender && !needBirth && !needTerms) return null;

  const birthCheck = birth ? birthDateSchema.safeParse(birth) : null;
  const birthProblem = birthCheck && !birthCheck.success ? (birthCheck.error.issues[0]?.message ?? 'Data inválida') : null;
  const ready = (!needGender || !!gender) && (!needBirth || (!!birth && !birthProblem)) && (!needTerms || terms);

  async function save() {
    if (!ready) return;
    setBusy(true);
    setErr('');
    try {
      let latest = p!;
      if (needGender && gender) latest = await api.setPrivacy({ gender });
      if (needBirth || needTerms) latest = await api.setConsent(needBirth ? birth : '2000-01-01');
      qc.setQueryData(['privacy'], latest);
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 sm:items-center" role="dialog" aria-modal="true" aria-label="Completa o teu perfil">
      <div className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-[28px] bg-white px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-6 sm:rounded-[28px]">
        <h2 className="text-2xl font-extrabold">Só mais um passo</h2>
        <p className="mb-5 mt-1 text-zinc-600">Falta completar o teu perfil. É uma vez só e fica privado.</p>

        {needGender && (
          <>
            <p className="mb-2 font-semibold">Como te identificas?</p>
            <GenderPicker value={gender} onChange={setGender} />
          </>
        )}
        {needBirth && (
          <>
            <p className="mb-2 mt-5 font-semibold">Quando nasceste?</p>
            <input
              type="date"
              value={birth}
              onChange={(e) => setBirth(e.target.value)}
              aria-label="Data de nascimento"
              className="h-14 w-full rounded-2xl border-2 border-zinc-200 px-4 text-lg outline-none focus:border-brand"
            />
            <p className={`mt-1 px-1 text-sm ${birthProblem ? 'font-medium text-red-600' : 'text-zinc-500'}`}>{birthProblem ?? `Para confirmar que tens ${MIN_AGE}+ anos. Ninguém vê esta data.`}</p>
          </>
        )}
        {needTerms && (
          <label className="mt-5 flex cursor-pointer items-start gap-3 px-1 text-[15px] leading-snug text-zinc-700">
            <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[#d6334f]" />
            <span>
              Li e aceito os <Link to="/terms" target="_blank" className="font-semibold text-brand underline">Termos de Uso</Link> e a{' '}
              <Link to="/privacy" target="_blank" className="font-semibold text-brand underline">Política de Privacidade</Link>.
            </span>
          </label>
        )}

        {err && <p role="alert" className="mt-3 text-center text-sm text-red-600">{err}</p>}
        <button disabled={!ready || busy} onClick={save} className="mt-5 h-14 w-full rounded-full bg-brand text-lg font-bold text-white transition active:scale-[0.98] disabled:opacity-40">
          {busy ? 'A guardar…' : 'Continuar'}
        </button>
      </div>
    </div>
  );
}
