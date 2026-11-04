import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type BoStaffMember } from '../../lib/api';
import { Badge, Card, PageHeader, ReasonDialog, TEAM_TONE, ago, btnDanger, btnGhost, btnPrimary, td, th, useStaff } from './bo';

/** A equipa do backoffice: quem tem acesso e a que equipas pertence. Só a Administração. */
export default function BackofficeTeam() {
  const staff = useStaff();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['bo-staff'], queryFn: api.boStaff });
  const [edit, setEdit] = useState<{ username: string; teams: string[]; isNew: boolean } | null>(null);
  const [removing, setRemoving] = useState<BoStaffMember | null>(null);
  const catalog = staff?.catalog ?? [];
  const nameOf = (id: string) => catalog.find((c) => c.id === id)?.name ?? id;
  const refresh = () => void Promise.all([qc.invalidateQueries({ queryKey: ['bo-staff'] }), qc.invalidateQueries({ queryKey: ['bo-me'] })]);
  const members = (list.data ?? []).filter((m) => m.active);

  return (
    <>
      <PageHeader title="Equipa" description="Quem tem acesso ao backoffice e o que cada equipa pode fazer. Cada mudança fica na auditoria." actions={<button type="button" onClick={() => setEdit({ username: '', teams: [], isNew: true })} className={btnPrimary}>Dar acesso a alguém</button>} />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {catalog.map((t) => (
          <div key={t.id} className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200/70">
            <div className="flex items-center justify-between"><p className="font-bold">{t.name}</p><Badge tone={TEAM_TONE[t.id] ?? 'zinc'}>{members.filter((m) => m.teams.includes(t.id)).length} pessoa(s)</Badge></div>
            <p className="mt-1 text-sm text-zinc-500">{t.description}</p>
          </div>
        ))}
      </div>

      <div className="mt-6">
        <Card title={`Pessoas com acesso (${members.length})`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead><tr><th className={th}>Conta</th><th className={th}>Equipas</th><th className={th}>Última entrada</th><th className={th} /></tr></thead>
              <tbody className="divide-y divide-zinc-100">
                {members.map((m) => (
                  <tr key={m.id}>
                    <td className={td}><span className="font-semibold">@{m.username}</span><span className="block text-xs text-zinc-500">{m.displayName} · {m.email}</span></td>
                    <td className={td}><div className="flex flex-wrap gap-1">{m.teams.map((t) => <Badge key={t} tone={TEAM_TONE[t] ?? 'zinc'}>{nameOf(t)}</Badge>)}</div></td>
                    <td className={td}>{ago(m.lastSeen)}</td>
                    <td className={`${td} text-right`}>
                      <button type="button" onClick={() => setEdit({ username: m.username, teams: m.teams, isNew: false })} className={`${btnGhost} mr-2 h-8`}>Mudar equipas</button>
                      <button type="button" onClick={() => setRemoving(m)} className={`${btnGhost} h-8 text-red-700`}>Tirar acesso</button>
                    </td>
                  </tr>
                ))}
                {list.isSuccess && members.length === 0 && <tr><td colSpan={4} className="px-3 py-8 text-center text-zinc-500">Ninguém ainda.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {edit && <EditDialog start={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); refresh(); }} />}
      {removing && <ReasonDialog title={`Tirar o acesso a @${removing.username}`} help="Deixa de entrar no backoffice. A conta normal continua." confirm="Tirar acesso" danger onCancel={() => setRemoving(null)} onConfirm={async (reason) => { await api.boRemoveStaff(removing.id, reason); setRemoving(null); refresh(); }} />}
    </>
  );
}

function EditDialog({ start, onClose, onSaved }: { start: { username: string; teams: string[]; isNew: boolean }; onClose: () => void; onSaved: () => void }) {
  const staff = useStaff();
  const [username, setUsername] = useState(start.username);
  const [teams, setTeams] = useState<string[]>(start.teams);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const toggle = (id: string) => setTeams((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  async function save() {
    setBusy(true);
    setErr('');
    try {
      await api.boSetTeams(username.trim().replace(/^@/, ''), teams, reason.trim());
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div role="dialog" aria-modal="true" aria-label="Equipas" data-swipe="off" className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold">{start.isNew ? 'Dar acesso a alguém' : `Equipas de @${start.username}`}</h3>
        {start.isNew && (
          <label className="mt-4 block text-sm font-semibold text-zinc-700">Conta (@utilizador)
            <input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900" />
          </label>
        )}
        <fieldset className="mt-4">
          <legend className="text-sm font-semibold text-zinc-700">Equipas</legend>
          <div className="mt-2 space-y-2">
            {(staff?.catalog ?? []).map((t) => (
              <label key={t.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-200 p-3 hover:bg-zinc-50">
                <input type="checkbox" checked={teams.includes(t.id)} onChange={() => toggle(t.id)} className="mt-1 h-4 w-4" />
                <span><span className="block text-sm font-semibold">{t.name}</span><span className="block text-xs text-zinc-500">{t.description}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="mt-4 block text-sm font-semibold text-zinc-700">Motivo (fica no registo)
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} className="mt-1 w-full rounded-lg border border-zinc-300 p-2.5 text-sm outline-none focus:border-zinc-900" />
        </label>
        {err && <p role="alert" className="mt-2 text-sm text-red-600">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnGhost}>Cancelar</button>
          <button type="button" disabled={busy || !username.trim() || teams.length === 0 || reason.trim().length < 3} onClick={() => void save()} className={btnPrimary}>{busy ? 'A guardar…' : 'Guardar'}</button>
        </div>
      </div>
    </div>
  );
}
void btnDanger;
