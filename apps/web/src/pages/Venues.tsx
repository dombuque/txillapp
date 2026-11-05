import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';
import StackPage from '../components/StackPage';
import { fieldInput } from '../components/ui';
import { api } from '../lib/api';
import { tr } from '../lib/i18n';
import { KIND_LABEL } from './VenuePage';

const KINDS = ['bar', 'restaurante', 'discoteca', 'cafe', 'hotel', 'evento', 'outro'] as const;

/** Os meus locais (bares, restaurantes, discotecas…) e criar um novo. */
export default function Venues() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const mine = useQuery({ queryKey: ['venues-mine'], queryFn: api.myVenues, retry: false });
  const [name, setName] = useState('');
  const [kind, setKind] = useState<(typeof KINDS)[number]>('bar');
  const [city, setCity] = useState('');
  const [about, setAbout] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const v = await api.createVenue({ name: name.trim(), kind, city: city.trim() || undefined, about: about.trim() || undefined });
      await qc.invalidateQueries({ queryKey: ['venues-mine'] });
      navigate(`/v/${v.slug}`);
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  }

  return (
    <StackPage title={tr('Os meus locais')}>
      <div className="px-4 pb-10 pt-3">
        <p className="text-sm text-zinc-600">{tr('Tens um bar, restaurante, discoteca ou café? Cria a página do local, imprime o QR e a malta faz check-in. A equipa verifica e dá o selo.')}</p>

        {(mine.data ?? []).length > 0 && (
          <ul className="mt-4 space-y-2">
            {mine.data!.map((v) => (
              <li key={v.slug}>
                <Link to={`/v/${v.slug}`} className="flex items-center gap-3 rounded-2xl bg-zinc-50 p-3.5 active:scale-[0.99]">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-900 text-white"><Icon name="map-pin" size={20} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{v.name}</span>
                    <span className="block text-sm text-zinc-600">{tr(KIND_LABEL[v.kind] ?? 'Outro')} · {v.verified ? tr('Verificado') : tr('Em análise')} · {v.checkins} {tr('check-ins')}</span>
                  </span>
                  <span className="text-xl text-zinc-400" aria-hidden>›</span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={create} className="mt-6 space-y-3">
          <h2 className="text-lg font-extrabold">{tr('Criar um local')}</h2>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={tr('Nome do local')} aria-label={tr('Nome do local')} className={fieldInput} />
          <div role="radiogroup" aria-label={tr('Tipo de local')} className="flex flex-wrap gap-2">
            {KINDS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={`h-10 rounded-full px-4 text-[14px] font-semibold transition active:scale-95 ${kind === k ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-800'}`}>{tr(KIND_LABEL[k])}</button>
            ))}
          </div>
          <input value={city} onChange={(e) => setCity(e.target.value)} maxLength={60} placeholder={tr('Cidade')} aria-label={tr('Cidade')} className={fieldInput} />
          <textarea value={about} onChange={(e) => setAbout(e.target.value)} maxLength={300} rows={3} placeholder={tr('Uma frase sobre o local (opcional)')} aria-label={tr('Sobre o local')} className={`${fieldInput} resize-none`} />
          <p role="alert" className="min-h-5 text-center text-sm text-red-600">{err}</p>
          <button disabled={busy || name.trim().length < 2} className="h-12 w-full rounded-full bg-brand font-bold text-white active:scale-[0.98] disabled:opacity-50">{busy ? tr('A criar…') : tr('Criar o local')}</button>
        </form>
      </div>
    </StackPage>
  );
}
