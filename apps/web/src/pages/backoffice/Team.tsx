import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type BoStaffMember } from '../../lib/api';
import { Badge, Card, PageHeader, ReasonDialog, TEAM_TONE, ago, btnGhost, btnPrimary, td, th, useStaff } from './bo';

/** A equipa do backoffice: contas próprias (não são contas da rede social). Convites, equipas, reposição de acesso. Só a Administração. */
export default function BackofficeTeam() {
  const staff = useStaff();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['bo-staff'], queryFn: api.boStaff });
  const [edit, setEdit] = useState<{ member: BoStaffMember | null } | null>(null);
  const [acting, setActing] = useState<{ member: BoStaffMember; kind: 'reset' | 'off' | 'on' } | null>(null);
  const [link, setLink] = useState<{ title: string; url: string; minutes: number } | null>(null);
  const catalog = staff?.catalog ?? [];
  const nameOf = (id: string) => catalog.find((c) => c.id === id)?.name ?? id;
  const refresh = () => void Promise.all([qc.invalidateQueries({ queryKey: ['bo-staff'] }), qc.invalidateQueries({ queryKey: ['bo-me'] })]);
  const all = list.data ?? [];
  const members = all.filter((m) => m.active);

  return (
    <>
      <PageHeader title="Equipa" description="Contas próprias do backoffice, separadas da rede social: senha própria e dois passos. Cada mudança fica na auditoria." actions={<button type="button" onClick={() => setEdit({ member: null })} className={btnPrimary}>Convidar alguém</button>} />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {catalog.map((t) => (
          <div key={t.id} className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200/70">
            <div className="flex items-center justify-between"><p className="font-bold">{t.name}</p><Badge tone={TEAM_TONE[t.id] ?? 'zinc'}>{members.filter((m) => m.teams.includes(t.id)).length} pessoa(s)</Badge></div>
            <p className="mt-1 text-sm text-zinc-500">{t.description}</p>
          </div>
        ))}
      </div>

      <div className="mt-6">
        <Card title={`Contas de equipa (${all.length})`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead><tr><th className={th}>Conta</th><th className={th}>Equipas</th><th className={th}>Estado</th><th className={th}>Última entrada</th><th className={th} /></tr></thead>
              <tbody className="divide-y divide-zinc-100">
                {all.map((m) => (
                  <tr key={m.id} className={m.active ? '' : 'opacity-60'}>
                    <td className={td}><span className="font-semibold">{m.name}</span><span className="block text-xs text-zinc-500">{m.email}</span></td>
                    <td className={td}><div className="flex flex-wrap gap-1">{m.teams.map((t) => <Badge key={t} tone={TEAM_TONE[t] ?? 'zinc'}>{nameOf(t)}</Badge>)}</div></td>
                    <td className={td}>{!m.active ? <Badge tone="red">sem acesso</Badge> : m.pending ? <Badge tone="amber">convite por abrir</Badge> : <Badge tone="green">ativa</Badge>}</td>
                    <td className={td}>{ago(m.lastLogin)}</td>
                    <td className={`${td} whitespace-nowrap text-right`}>
                      {m.active && <button type="button" onClick={() => setEdit({ member: m })} className={`${btnGhost} mr-2 h-8`}>Equipas</button>}
                      {m.active && <button type="button" onClick={() => setActing({ member: m, kind: 'reset' })} className={`${btnGhost} mr-2 h-8`}>{m.pending ? 'Nova ligação' : 'Repor acesso'}</button>}
                      <button type="button" onClick={() => setActing({ member: m, kind: m.active ? 'off' : 'on' })} className={`${btnGhost} h-8 ${m.active ? 'text-red-700' : ''}`}>{m.active ? 'Tirar acesso' : 'Devolver acesso'}</button>
                    </td>
                  </tr>
                ))}
                {list.isSuccess && all.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-zinc-500">Ninguém ainda.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {edit && <EditDialog member={edit.member} onClose={() => setEdit(null)} onDone={(url, minutes) => { setEdit(null); refresh(); if (url) setLink({ title: 'Convite criado', url, minutes: minutes ?? 60 }); }} />}
      {acting?.kind === 'reset' && (
        <ReasonDialog title={`Repor o acesso de ${acting.member.name}`} help="Apaga a senha e os dois passos, termina as sessões e gera uma ligação nova (60 minutos, uso único)." confirm="Repor acesso" danger onCancel={() => setActing(null)} onConfirm={async (reason) => { const r = await api.boResetAccess(acting.member.id, reason); setActing(null); refresh(); setLink({ title: `Nova ligação para ${acting.member.name}`, url: r.setupUrl, minutes: r.expiresInMinutes }); }} />
      )}
      {acting && acting.kind !== 'reset' && (
        <ReasonDialog title={acting.kind === 'off' ? `Tirar o acesso a ${acting.member.name}` : `Devolver o acesso a ${acting.member.name}`} help={acting.kind === 'off' ? 'Deixa de entrar no backoffice agora mesmo.' : 'Volta a poder entrar com a senha e os dois passos que já tinha.'} confirm={acting.kind === 'off' ? 'Tirar acesso' : 'Devolver acesso'} danger={acting.kind === 'off'} onCancel={() => setActing(null)} onConfirm={async (reason) => { await api.boSetActive(acting.member.id, acting.kind === 'on', reason); setActing(null); refresh(); }} />
      )}
      {link && <LinkDialog {...link} onClose={() => setLink(null)} />}
    </>
  );
}

/** A ligação de uso único: mostra-se uma vez a quem convida, que a envia à pessoa. A senha é a pessoa que a define. */
function LinkDialog({ title, url, minutes, onClose }: { title: string; url: string; minutes: number; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="dialog" aria-modal="true" aria-label={title} data-swipe="off" className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <h3 className="text-lg font-bold">{title}</h3>
        <p className="mt-1 text-sm text-zinc-600">Envia esta ligação só à própria pessoa, por um canal privado. Serve uma vez e caduca em {minutes} minutos. A senha e os dois passos define-os ela. Depois de fechares esta janela, não se vê outra vez (podes gerar uma nova).</p>
        <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="mt-4 h-10 w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 font-mono text-xs" aria-label="Ligação de convite" />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => void navigator.clipboard.writeText(url).then(() => setCopied(true)).catch(() => undefined)} className={btnGhost}>{copied ? 'Copiada' : 'Copiar ligação'}</button>
          <button type="button" onClick={onClose} className={btnPrimary}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

function EditDialog({ member, onClose, onDone }: { member: BoStaffMember | null; onClose: () => void; onDone: (url?: string, minutes?: number) => void }) {
  const staff = useStaff();
  const [email, setEmail] = useState(member?.email ?? '');
  const [name, setName] = useState(member?.name ?? '');
  const [teams, setTeams] = useState<string[]>(member?.teams ?? []);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const toggle = (id: string) => setTeams((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  async function save() {
    setBusy(true);
    setErr('');
    try {
      if (member) {
        await api.boSetTeams(member.id, teams, reason.trim());
        onDone();
      } else {
        const r = await api.boInvite(email.trim(), name.trim(), teams);
        onDone(r.setupUrl, r.expiresInMinutes);
      }
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div role="dialog" aria-modal="true" aria-label="Equipas" data-swipe="off" className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold">{member ? `Equipas de ${member.name}` : 'Convidar alguém para a equipa'}</h3>
        {!member && (
          <>
            <label className="mt-4 block text-sm font-semibold text-zinc-700">Nome
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="mt-1 h-10 w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900" />
            </label>
            <label className="mt-3 block text-sm font-semibold text-zinc-700">Email da conta de equipa
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900" />
            </label>
          </>
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
        {member && (
          <label className="mt-4 block text-sm font-semibold text-zinc-700">Motivo (fica no registo)
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} className="mt-1 w-full rounded-lg border border-zinc-300 p-2.5 text-sm outline-none focus:border-zinc-900" />
          </label>
        )}
        {err && <p role="alert" className="mt-2 text-sm text-red-600">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnGhost}>Cancelar</button>
          <button type="button" disabled={busy || teams.length === 0 || (member ? reason.trim().length < 3 : !name.trim() || !email.includes('@'))} onClick={() => void save()} className={btnPrimary}>{busy ? 'A guardar…' : member ? 'Guardar' : 'Criar convite'}</button>
        </div>
      </div>
    </div>
  );
}
