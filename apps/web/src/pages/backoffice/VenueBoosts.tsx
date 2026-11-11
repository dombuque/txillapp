import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type BoBoost } from '../../lib/api';
import { Badge, Empty, btnDanger, btnGhost, td, th, useCan, when } from './bo';

const STATE: Record<BoBoost['state'], [string, 'amber' | 'green' | 'red' | 'zinc']> = {
  scheduled: ['agendada', 'amber'],
  active: ['a bombar', 'green'],
  ended: ['terminada', 'zinc'],
  stopped: ['parada pelo local', 'zinc'],
  suspended: ['suspensa', 'red'],
  pending: ['à espera', 'amber'],
};

/**
 * Bombar (destaques pagos dos locais). As campanhas de locais já aprovados ficam ativas sem esperar pela equipa; aqui a
 * equipa vê-as e pode suspender (com ou sem devolução dos dias que faltam) ou repor. Fica tudo no registo de auditoria.
 */
export function VenueBoosts() {
  const qc = useQueryClient();
  const can = useCan('catalog.manage');
  const [filter, setFilter] = useState<'live' | 'all'>('live');
  const q = useQuery({ queryKey: ['bo-boosts', filter], queryFn: () => api.boBoosts(filter) });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const rows = q.data ?? [];

  async function run(id: string, f: () => Promise<unknown>) {
    setBusy(id);
    setErr('');
    try {
      await f();
    } catch (e) {
      setErr((e as Error).message || 'Não consegui guardar');
    }
    await qc.invalidateQueries({ queryKey: ['bo-boosts'] });
    setBusy(null);
  }
  const suspend = (b: BoBoost, refund: boolean) => {
    const note = window.prompt(refund ? 'Suspender e devolver os dias que faltam. Motivo (o local vê):' : 'Suspender sem devolução. Motivo (o local vê):', '');
    if (note === null) return;
    void run(b.id, () => api.boSuspendBoost(b.id, note.trim(), refund));
  };

  return (
    <div className="mt-10">
      <h2 className="mb-1 text-lg font-bold text-zinc-900">Bombar</h2>
      <p className="mb-3 text-sm text-zinc-600">Destaques pagos com os Txills do local. Ficam ativos logo (o local já foi aprovado); suspende os que violem as regras.</p>
      <div className="mb-4 flex flex-wrap gap-2">
        {([['live', 'A decorrer'], ['all', 'Todas']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} className={`${btnGhost} ${filter === k ? '!bg-zinc-900 !text-white' : ''}`}>{label}</button>
        ))}
      </div>
      {err ? <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{err}</p> : null}
      {q.isLoading && <p className="text-sm text-zinc-500">A carregar…</p>}
      {q.isSuccess && rows.length === 0 && <Empty title={filter === 'live' ? 'Nenhuma campanha a decorrer' : 'Ainda não há campanhas'} />}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-zinc-200/70">
          <table className="w-full">
            <thead><tr><th className={th}>Local</th><th className={th}>Alvo</th><th className={th}>Quando</th><th className={th}>Preço</th><th className={th}>Resultados</th><th className={th}>Estado</th><th className={th} /></tr></thead>
            <tbody>
              {rows.map((b) => {
                const [label, tone] = STATE[b.state] ?? STATE.active;
                const live = b.state === 'active' || b.state === 'scheduled' || b.state === 'pending';
                return (
                  <tr key={b.id} className="border-t border-zinc-100 align-top">
                    <td className={td}><span className="font-semibold">{b.venue.name}</span><span className="block text-xs text-zinc-500">{b.venue.slug}</span></td>
                    <td className={td}>{b.target.kind === 'event' ? 'Evento' : 'Publicação'}: <span className="text-zinc-700">{b.target.title}</span></td>
                    <td className={`${td} text-xs`}>{when(b.startsAt)} → {when(b.stoppedAt ?? b.endsAt)}<span className="block text-zinc-500">{b.radiusKm} km</span></td>
                    <td className={td}>{b.price} Txills{b.refunded ? <span className="block text-xs text-zinc-500">devolvidos {b.refunded}</span> : null}</td>
                    <td className={`${td} text-xs`}>{b.report.impressions} vezes · {b.report.people} pessoas · {b.report.taps} toques</td>
                    <td className={td}><Badge tone={tone}>{label}</Badge>{b.note ? <span className="mt-1 block text-xs text-red-700">{b.note}</span> : null}</td>
                    <td className={`${td} text-right`}>
                      {can ? (
                        <div className="flex flex-wrap justify-end gap-2">
                          {live && <button disabled={busy === b.id} onClick={() => suspend(b, false)} className={btnDanger}>Suspender</button>}
                          {live && <button disabled={busy === b.id} onClick={() => suspend(b, true)} className={btnGhost}>Suspender e devolver</button>}
                          {b.state === 'suspended' && !b.refunded && <button disabled={busy === b.id} onClick={() => void run(b.id, () => api.boReinstateBoost(b.id))} className={btnGhost}>Repor</button>}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
