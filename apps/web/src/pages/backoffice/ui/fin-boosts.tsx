import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../lib/api';
import { btnDanger, btnGhost, btnPrimary, useCan, when } from '../bo';
import { finApi, type FinBoost } from './fin-api';
import { HBars, LineChart, SERIES } from './fin-charts';
import { fmt, Kpi, Loading, Panel, pct, Status, Table, tdc, tdn, Txl, type Tone } from './fin-ui';

const STATE: Record<FinBoost['state'], [Tone, string]> = {
  active: ['good', 'a bombar'],
  scheduled: ['info', 'agendada'],
  pending: ['warn', 'à espera'],
  ended: ['neutral', 'terminada'],
  stopped: ['neutral', 'parada pelo local'],
  suspended: ['bad', 'suspensa'],
};

/** Suspender uma campanha: motivo (o local vê) e se devolve os dias que faltam. */
function SuspendDialog({ boost, onClose }: { boost: FinBoost; onClose: (done: boolean) => void }) {
  const [note, setNote] = useState('');
  const [refund, setRefund] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function go() {
    setBusy(true);
    setErr('');
    try {
      await api.boSuspendBoost(boost.id, note.trim(), refund);
      onClose(true);
    } catch (e) {
      setErr((e as Error).message || 'Não consegui suspender');
      setBusy(false);
    }
  }
  return (
    <div role="dialog" aria-modal="true" aria-label="Suspender campanha" data-swipe="off" className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={() => onClose(false)}>
      <div className="w-full max-w-md rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold">Suspender a campanha de {boost.venue.name}</h3>
        <p className="mt-1 text-sm text-zinc-600">{boost.target.kind === 'event' ? 'Evento' : 'Publicação'}: {boost.target.title}. Fica no registo de auditoria.</p>
        <label className="mt-4 block text-sm font-semibold text-zinc-700">Motivo (o local vê)
          <textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={300} className="mt-1 w-full rounded-lg border border-zinc-300 p-2.5 text-sm outline-none focus:border-zinc-900" />
        </label>
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input type="checkbox" checked={refund} onChange={(e) => setRefund(e.target.checked)} className="mt-0.5 h-4 w-4" />
          <span>Devolver os dias que faltam à carteira do local <span className="block text-xs text-zinc-500">Com devolução, a campanha já não se pode repor.</span></span>
        </label>
        {err && <p role="alert" className="mt-2 text-sm text-red-600">{err}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => onClose(false)} className={btnGhost}>Cancelar</button>
          <button type="button" disabled={busy} onClick={() => void go()} className={btnDanger}>{busy ? 'A suspender…' : 'Suspender'}</button>
        </div>
      </div>
    </div>
  );
}

/** Bombar de todos os locais: totais, resultados por dia, locais que mais gastam e as campanhas (suspender e repor com catalog.manage). */
export function BoostsPanel({ days }: { days: number }) {
  const qc = useQueryClient();
  const canManage = useCan('catalog.manage');
  const [filter, setFilter] = useState<'live' | 'all'>('live');
  const [suspending, setSuspending] = useState<FinBoost | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const q = useQuery({ queryKey: ['fin-boosts', days, filter], queryFn: () => finApi.boosts(days, filter) });
  const b = q.data;
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['fin-boosts'] }), qc.invalidateQueries({ queryKey: ['bo-boosts'] })]);
  async function reinstate(id: string) {
    setBusy(id);
    setErr('');
    try {
      await api.boReinstateBoost(id);
    } catch (e) {
      setErr((e as Error).message || 'Não consegui repor');
    }
    await refresh();
    setBusy(null);
  }
  if (!b) return <Loading error={q.error} />;
  const t = b.totals;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="A bombar agora" value={fmt(t.live)} icon="flame" hint={`${fmt(t.scheduled)} agendadas · ${fmt(t.suspended)} suspensas (${days} dias)`} />
        <Kpi label={`Txills gastos em ${days} dias`} value={<Txl v={t.spent} />} icon="wallet" hint={`${fmt(t.campaigns)} campanhas de ${fmt(t.venues)} locais · devolvidos ${fmt(t.refunded)}`} />
        <Kpi label="Impressões" value={fmt(t.impressions)} icon="eye" hint={`${fmt(t.people)} pessoas diferentes`} />
        <Kpi label="Toques" value={fmt(t.taps)} icon="bolt" hint={`${pct(t.tapRate)} das impressões`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Panel title="Impressões e toques por dia">
          <LineChart title="" height={260} days={b.series.map((s) => s.day)} series={[{ label: 'Impressões', values: b.series.map((s) => s.views), color: SERIES[0] }, { label: 'Toques', values: b.series.map((s) => s.taps), color: SERIES[1] }]} />
        </Panel>
        <Panel title="Locais que mais gastam" help={`Campanhas criadas em ${days} dias.`}>
          {b.topVenues.length === 0 ? <p className="text-sm text-zinc-500">Ainda sem campanhas neste período.</p> : (
            <HBars color={SERIES[1]} unit=" TXL" rows={b.topVenues.map((v) => ({ key: v.slug, label: v.name, value: v.spent, hint: `${v.campaigns} · ${fmt(v.impressions)} imp. · ${fmt(v.taps)} toques` }))} />
          )}
        </Panel>
      </div>

      <Panel title="Campanhas" pad={false} help={canManage ? 'Suspende as que violem as regras (com ou sem devolução) e repõe as suspensas sem devolução.' : 'Só leitura. Suspender e repor é com a equipa de Moderação (gerir o catálogo).'}
        right={
          <div role="radiogroup" aria-label="Campanhas" className="inline-flex gap-1 rounded-lg bg-zinc-200/70 p-1">
            {([['live', 'A decorrer'], ['all', 'Todas']] as const).map(([k, label]) => (
              <button key={k} type="button" role="radio" aria-checked={filter === k} onClick={() => setFilter(k)} className={`h-8 rounded-md px-3 text-sm font-semibold ${filter === k ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-600'}`}>{label}</button>
            ))}
          </div>
        }>
        {err && <p role="alert" className="mx-5 mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{err}</p>}
        <Table label="Campanhas" head={[{ label: 'Local' }, { label: 'Alvo' }, { label: 'Quando' }, { label: 'Txills', right: true }, { label: 'Impressões', right: true }, { label: 'Toques', right: true }, { label: 'Estado' }, ...(canManage ? [{ label: '' }] : [])]}
          empty={b.campaigns.length === 0 ? <p className="px-5 py-10 text-center text-sm text-zinc-500">{filter === 'live' ? 'Nenhuma campanha a decorrer.' : 'Ainda não há campanhas.'}</p> : null}>
          {b.campaigns.map((c) => {
            const [tone, label] = STATE[c.state] ?? STATE.active;
            const live = c.state === 'active' || c.state === 'scheduled' || c.state === 'pending';
            return (
              <tr key={c.id} className="align-top">
                <td className={tdc}><b>{c.venue.name}</b><span className="block text-xs text-zinc-500">{c.venue.slug}</span></td>
                <td className={`${tdc} max-w-[220px]`}><span className="text-xs text-zinc-500">{c.target.kind === 'event' ? 'Evento' : 'Publicação'}</span><span className="block truncate">{c.target.title}</span></td>
                <td className={`${tdc} whitespace-nowrap text-xs`}>{when(c.startsAt)}<span className="block text-zinc-500">até {when(c.stoppedAt ?? c.endsAt)} · {c.radiusKm} km</span></td>
                <td className={tdn}>{fmt(c.price - c.refunded)}{c.refunded ? <span className="block text-xs text-zinc-500">devolvidos {fmt(c.refunded)}</span> : null}</td>
                <td className={tdn}>{fmt(c.report.impressions)}<span className="block text-xs text-zinc-500">{fmt(c.report.people)} pessoas</span></td>
                <td className={tdn}>{fmt(c.report.taps)}<span className="block text-xs text-zinc-500">{pct(c.report.impressions ? Math.round((c.report.taps / c.report.impressions) * 1000) / 10 : null)}</span></td>
                <td className={tdc}><Status tone={tone}>{label}</Status>{c.note && <span className="mt-1 block max-w-[180px] text-xs text-red-700">{c.note}</span>}</td>
                {canManage && (
                  <td className={`${tdc} text-right`}>
                    {live && <button type="button" disabled={busy === c.id} onClick={() => setSuspending(c)} className={btnDanger}>Suspender</button>}
                    {c.state === 'suspended' && !c.refunded && <button type="button" disabled={busy === c.id} onClick={() => void reinstate(c.id)} className={btnPrimary}>Repor</button>}
                  </td>
                )}
              </tr>
            );
          })}
        </Table>
      </Panel>
      {suspending && <SuspendDialog boost={suspending} onClose={(done) => { setSuspending(null); if (done) void refresh(); }} />}
    </div>
  );
}
