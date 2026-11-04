import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { Badge, Card, ReasonDialog, ago, btnDanger, btnGhost, btnPrimary, statusBadge, when } from './bo';

const ACTION: Record<string, string> = {
  'backoffice.verify_email': 'Confirmou o email',
  'backoffice.suspend': 'Suspendeu a conta',
  'backoffice.reactivate': 'Reativou a conta',
  'backoffice.note': 'Deixou uma nota',
  'moderation.remove': 'Removeu conteúdo',
  'moderation.suspend': 'Suspendeu (queixa)',
  'moderation.dismiss': 'Ignorou uma queixa',
  'account.deleted': 'Conta eliminada',
  'auth.register': 'Registo',
};

/** A ficha de uma conta: dados, números, queixas, convites, notas e histórico; com as ações da moderação. */
export default function BackofficeUser() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['bo-user', id], queryFn: () => api.boUser(id), retry: false });
  const [dialog, setDialog] = useState<null | 'verify' | 'suspend' | 'reactivate'>(null);
  const [note, setNote] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);
  const [err, setErr] = useState('');
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['bo-user', id] });
    void qc.invalidateQueries({ queryKey: ['bo-users'] });
    void qc.invalidateQueries({ queryKey: ['bo-overview'] });
  };

  if (q.isLoading) return <p className="text-zinc-500">A carregar…</p>;
  if (q.isError || !q.data) return <p role="alert" className="text-zinc-600">Conta não encontrada. <Link to="/backoffice/users" className="underline">Voltar</Link></p>;
  const { user: u, reportsAgainst, invite, notes, history } = q.data;

  async function addNote() {
    if (!note.trim()) return;
    setNoteBusy(true);
    setErr('');
    try {
      await api.boNote(id, note.trim());
      setNote('');
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
    setNoteBusy(false);
  }

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-4 border-b border-zinc-100 py-2 text-sm last:border-0"><dt className="text-zinc-500">{label}</dt><dd className="text-right font-medium text-zinc-900">{value}</dd></div>
  );

  return (
    <>
      <Link to="/backoffice/users" className="text-sm text-zinc-500 underline">← Utilizadores</Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-extrabold">@{u.username}</h1>
        {statusBadge(u.status)}
        {u.is_admin && <Badge tone="blue">moderação</Badge>}
        {u.email_verified_at ? <Badge tone="green">email confirmado</Badge> : <Badge tone="amber">email por confirmar</Badge>}
      </div>
      <p className="text-zinc-600">{u.display_name}</p>
      {err && <p role="alert" className="mt-2 text-sm text-red-600">{err}</p>}

      <div className="mt-5 flex flex-wrap gap-2">
        {!u.email_verified_at && u.status !== 'deleted' && <button type="button" onClick={() => setDialog('verify')} className={btnPrimary}>Confirmar email à mão</button>}
        {u.status === 'active' && !u.is_admin && <button type="button" onClick={() => setDialog('suspend')} className={btnDanger}>Suspender</button>}
        {u.status === 'suspended' && <button type="button" onClick={() => setDialog('reactivate')} className={btnPrimary}>Reativar</button>}
        <a href={`/u/${u.username}`} target="_blank" rel="noreferrer" className={btnGhost}>Ver o perfil na app</a>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-1">
          <Card title="Dados">
            <dl>
              {row('Email', <span className="break-all">{u.email}</span>)}
              {row('Criada', when(u.created_at))}
              {row('Última entrada', ago(u.last_seen))}
              {row('Sessões ativas', u.sessions)}
              {row('País', u.country ?? '—')}
              {row('Perfil', u.is_private ? 'privado' : 'público')}
              {row('Termos aceites', u.terms_version ?? '—')}
            </dl>
          </Card>
          <Card title="Números">
            <dl>
              {row('Publicações', u.posts)}
              {row('Seguidores / a seguir', `${u.followers} / ${u.following}`)}
              {row('Mensagens enviadas', u.messages)}
              {row('Txills', Number(u.txills).toLocaleString('pt-PT'))}
              {row('Convidou / com prémio', `${invite.invited} / ${invite.paid}`)}
              {invite.came_from && row('Veio por convite de', <>@{invite.came_from.inviter} <Badge tone={invite.came_from.status === 'blocked' ? 'red' : 'zinc'}>{invite.came_from.status}{invite.came_from.reason ? `: ${invite.came_from.reason}` : ''}</Badge></>)}
            </dl>
          </Card>
        </div>

        <div className="space-y-5 lg:col-span-2">
          <Card title={`Queixas contra esta conta (${reportsAgainst.length})`}>
            {reportsAgainst.length === 0 ? <p className="text-sm text-zinc-500">Nenhuma.</p> : (
              <ul className="divide-y divide-zinc-100 text-sm">
                {reportsAgainst.map((r, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 py-2">
                    <Badge>{r.target_type}</Badge><span className="font-semibold">{r.reason}</span>
                    <Badge tone={r.status === 'open' ? 'amber' : r.status === 'actioned' ? 'red' : 'zinc'}>{r.status === 'open' ? 'por decidir' : r.status === 'actioned' ? 'com ação' : 'ignorada'}</Badge>
                    {r.resolution_note && <span className="text-zinc-600">— {r.resolution_note}</span>}
                    <span className="ml-auto text-xs text-zinc-500">{r.reporter ? `por @${r.reporter} · ` : ''}{ago(r.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Notas internas">
            <div className="flex gap-2">
              <input value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void addNote()} maxLength={1000} placeholder="Escreve uma nota (só a equipa vê)" aria-label="Nova nota" className="h-10 flex-1 rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900" />
              <button type="button" disabled={noteBusy || !note.trim()} onClick={() => void addNote()} className={btnPrimary}>Guardar</button>
            </div>
            <ul className="mt-3 space-y-2 text-sm">
              {notes.map((n) => <li key={n.id} className="rounded-lg bg-amber-50 px-3 py-2"><p className="whitespace-pre-wrap break-words">{n.body}</p><p className="mt-1 text-xs text-zinc-500">@{n.author ?? '—'} · {when(n.created_at)}</p></li>)}
              {notes.length === 0 && <li className="text-zinc-500">Sem notas.</li>}
            </ul>
          </Card>

          <Card title="Histórico">
            {history.length === 0 ? <p className="text-sm text-zinc-500">Sem registos.</p> : (
              <ul className="divide-y divide-zinc-100 text-sm">
                {history.map((h, i) => (
                  <li key={i} className="py-2">
                    <span className="font-semibold">{ACTION[h.action] ?? h.action}</span>
                    {h.actor && <span className="text-zinc-600"> · por @{h.actor}</span>}
                    {typeof h.metadata?.reason === 'string' && <span className="text-zinc-600"> — {h.metadata.reason}</span>}
                    {typeof h.metadata?.motivo === 'string' && <span className="text-zinc-600"> — {h.metadata.motivo}</span>}
                    <span className="float-right text-xs text-zinc-500">{when(h.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {dialog === 'verify' && <ReasonDialog title="Confirmar o email à mão" help={`Marca o email ${u.email} como confirmado sem a pessoa clicar na ligação. Usa só se tiveres a certeza de quem é.`} confirm="Confirmar email" onCancel={() => setDialog(null)} onConfirm={async (reason) => { await api.boVerifyEmail(id, reason); setDialog(null); await refresh(); }} />}
      {dialog === 'suspend' && <ReasonDialog title={`Suspender @${u.username}`} help="Perde as sessões e não volta a entrar até ser reativada." confirm="Suspender" danger onCancel={() => setDialog(null)} onConfirm={async (reason) => { await api.boSuspend(id, reason); setDialog(null); await refresh(); }} />}
      {dialog === 'reactivate' && <ReasonDialog title={`Reativar @${u.username}`} confirm="Reativar" onCancel={() => setDialog(null)} onConfirm={async (reason) => { await api.boReactivate(id, reason); setDialog(null); await refresh(); }} />}
    </>
  );
}
