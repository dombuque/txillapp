import type { ReactNode } from 'react';
import type { AuditRow } from './mod-api';

/** Nomes legíveis das ações do registo de auditoria e do que vem em cada uma (em vez do JSON cru). */

export const ACTION_LABEL: Record<string, string> = {
  'auth.register': 'Criou a conta', 'auth.google_register': 'Criou a conta com o Google', 'auth.apple_register': 'Criou a conta com a Apple',
  'auth.login': 'Entrou', 'auth.google_login': 'Entrou com o Google', 'auth.apple_login': 'Entrou com a Apple',
  'auth.password_changed': 'Mudou a palavra-passe', 'auth.password_reset': 'Recuperou a palavra-passe', 'auth.refresh_reuse_detected': 'Sessão reutilizada (possível roubo)',
  'account.deleted': 'Eliminou a conta',
  'staff.login': 'Entrou no backoffice', 'staff.login_failed': 'Falhou a entrada no backoffice', 'staff.setup': 'Configurou o acesso de equipa',
  'staff.invite': 'Convidou para a equipa', 'staff.set_teams': 'Mudou as equipas', 'staff.remove': 'Tirou o acesso à equipa', 'staff.activate': 'Reativou o acesso de equipa',
  'staff.deactivate': 'Desativou o acesso de equipa', 'staff.reset_access': 'Repôs o acesso de equipa',
  'backoffice.verify_email': 'Confirmou o email à mão', 'backoffice.suspend': 'Suspendeu a conta', 'backoffice.reactivate': 'Reativou a conta', 'backoffice.note': 'Escreveu uma nota',
  'backoffice.audit_export': 'Exportou a auditoria (CSV)',
  'verification.approve': 'Aprovou um pedido de selo', 'verification.reject': 'Recusou um pedido de selo', 'verification.set_tier': 'Mudou o selo de uma conta', 'verification.remove': 'Tirou o selo a uma conta',
  'moderation.dismiss': 'Arquivou uma queixa', 'moderation.remove': 'Removeu conteúdo denunciado', 'moderation.warn': 'Avisou o autor', 'moderation.suspend': 'Suspendeu a conta (queixa)',
  'moderation.batch': 'Decidiu queixas em lote', 'moderation.content_remove': 'Removeu conteúdo', 'moderation.content_restore': 'Repôs conteúdo', 'moderation.view_media': 'Abriu uma foto assinalada',
  'moderation.venue_approved': 'Aprovou um local', 'moderation.venue_rejected': 'Recusou um local', 'moderation.venue_verified': 'Verificou um local', 'moderation.venue_unverified': 'Tirou a verificação de um local',
  'moderation.boost_suspended': 'Suspendeu um Bombar', 'moderation.boost_reinstated': 'Repôs um Bombar',
  'boost.created': 'Criou um Bombar', 'boost.stopped': 'Parou um Bombar', 'boost.draft_created': 'Criou um Bombar por pagar (loja)', 'boost.iap_suspended': 'Bombar suspenso (compra reembolsada)',
  'verification.approve_paid': 'Aprovou a identidade para a verificação paga',
  'iap.purchase': 'Compra na loja', 'iap.renewal': 'Renovação na loja', 'iap.purchase_recorded': 'Compra na loja registada', 'iap.status_changed': 'Compra na loja mudou de estado',
  'iap.refunded': 'Compra na loja reembolsada', 'iap.revoked': 'Compra na loja revogada', 'iap.boost_linked': 'Compra na loja ligada a um Bombar', 'iap.wrong_user': 'Compra de outra conta recusada',
  'iap.verification_applied': 'Selo pago aplicado', 'iap.verification_removed': 'Selo pago retirado', 'iap.restore': 'Restaurou compras', 'iap.notification': 'Aviso da loja (só registo)',
  'catalog.approve': 'Aprovou um item da Geleira', 'catalog.reject': 'Rejeitou um item da Geleira', 'catalog.edit': 'Editou um item da Geleira', 'catalog.create': 'Criou um item da Geleira',
};
export const actionLabel = (a: string) => ACTION_LABEL[a] ?? a;

export const GROUPS: { prefix: string; label: string }[] = [
  { prefix: 'moderation.', label: 'Moderação' },
  { prefix: 'catalog.', label: 'Catálogo da Geleira' },
  { prefix: 'backoffice.', label: 'Contas (backoffice)' },
  { prefix: 'verification.', label: 'Selos de verificado' },
  { prefix: 'staff.', label: 'Equipa' },
  { prefix: 'auth.', label: 'Entradas e senhas' },
  { prefix: 'account.', label: 'Contas (utilizador)' },
  { prefix: 'boost.', label: 'Bombar' },
  { prefix: 'iap.', label: 'Compras na loja' },
];

const TARGET_KIND: Record<string, string> = { user: 'Conta', post: 'Publicação', comment: 'Comentário', story: 'Mimo', message: 'Mensagem', media: 'Foto', venue: 'Local', taste_item: 'Item da Geleira', reports: 'Queixas', staff: 'Equipa', audit: 'Auditoria', iap: 'Compra na loja' };

/** «Publicação 01a1…» ou «Conta @ana». */
export function targetText(r: AuditRow): string {
  if (!r.target) return '—';
  const [kind, ...rest] = r.target.split(':');
  const id = rest.join(':');
  if (r.targetLabel) return `${TARGET_KIND[kind] ?? kind} ${r.targetLabel}`;
  if (!id) return TARGET_KIND[kind] ?? r.target;
  return `${TARGET_KIND[kind] ?? kind} ${id.length > 12 ? `${id.slice(0, 8)}…` : id}`;
}

const KEY_LABEL: Record<string, string> = {
  reason: 'Motivo', note: 'Motivo', motivo: 'Motivo', owner: 'Conta', teams: 'Equipas', notified: 'Autor avisado', batch: 'Em lote com', via: 'Por',
  count: 'Quantas', done: 'Feitas', failed: 'Falharam', action: 'Ação', filters: 'Filtros', rows: 'Linhas', name: 'Nome', kind: 'Tipo', category: 'Grupo',
  changes: 'Alterações', reportsClosed: 'Queixas fechadas', expired: 'Mimo já expirado', purpose: 'Origem', length: 'Tamanho da nota', email: 'Email', ip: 'IP',
};
const ACTION_WORD: Record<string, string> = { dismiss: 'arquivar', remove: 'remover', warn: 'avisar', suspend: 'suspender' };

function value(k: string, v: unknown, r: AuditRow): ReactNode {
  if (k === 'owner') return r.ownerLabel ?? String(v);
  if (k === 'via') return v === 'queue' ? 'fila de queixas' : String(v);
  if (k === 'action') return ACTION_WORD[String(v)] ?? String(v);
  if (k === 'batch') return `${String(v)} queixas`;
  if (typeof v === 'boolean') return v ? 'sim' : 'não';
  if (Array.isArray(v)) return v.join(', ');
  if (k === 'changes' && v && typeof v === 'object') {
    return (
      <span className="flex flex-col">
        {Object.entries(v as Record<string, { from: unknown; to: unknown }>).map(([f, c]) => (
          <span key={f}>{KEY_LABEL[f] ?? f}: <s className="text-zinc-400">{fmt(c?.from)}</s> → {fmt(c?.to)}</span>
        ))}
      </span>
    );
  }
  if (k === 'filters' && v && typeof v === 'object') return Object.entries(v as Record<string, unknown>).map(([a, b]) => `${a}: ${String(b)}`).join(' · ') || 'nenhum';
  if (v && typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
const fmt = (v: unknown) => (v == null ? '—' : Array.isArray(v) ? v.join(', ') || '—' : typeof v === 'boolean' ? (v ? 'sim' : 'não') : String(v));

/** O motivo de uma linha (para a tabela). */
export const reasonOf = (r: AuditRow) => {
  const m = r.metadata;
  const v = m.reason ?? m.note ?? m.motivo;
  return typeof v === 'string' ? v : '';
};

/** O detalhe de uma ação, campo a campo, com nomes em português. */
export function AuditDetail({ r }: { r: AuditRow }) {
  const entries = Object.entries(r.metadata ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return (
    <dl className="grid grid-cols-[minmax(96px,auto)_1fr] gap-x-4 gap-y-1.5 text-sm">
      <dt className="text-zinc-500">Ação</dt><dd className="font-semibold">{actionLabel(r.action)} <span className="ml-1 font-mono text-xs font-normal text-zinc-400">{r.action}</span></dd>
      <dt className="text-zinc-500">Quem</dt><dd>{r.actorName ?? r.actor ?? 'Sistema'}{r.actorStaff ? ' (equipa)' : ''}</dd>
      <dt className="text-zinc-500">Alvo</dt><dd className="break-all">{targetText(r)} {r.target && <span className="ml-1 font-mono text-xs text-zinc-400">{r.target}</span>}</dd>
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-zinc-500">{KEY_LABEL[k] ?? k}</dt>
          <dd className="break-words">{value(k, v, r)}</dd>
        </div>
      ))}
    </dl>
  );
}
