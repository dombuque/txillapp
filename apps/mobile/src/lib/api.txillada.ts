/**
 * A API da Txillada (docs/txillada-contrato.md, prefixo /api/v1, com sessão). O vídeo vai pelo LiveKit (lib/txilladaRoom);
 * aqui só se pedem os acessos (token + url do LiveKit), o estado, os comentários, os brindes e a moderação.
 */
import { useQuery } from '@tanstack/react-query';
import { post, raw } from '@/lib/api';
import { txilladaEnabled, type TxilladaAudience, type TxilladaComment, type TxilladaDto, type TxilladaGift, type TxilladaGiver } from '@/lib/txillada';
import type { FxPerson, ReactionKind } from '@/lib/txilladaFx';
import type { GuestPending, GuestState, TxilladaGuest } from '@/lib/txilladaGuests';
import type { ScheduleInput, ScheduledTxillada } from '@/lib/txilladaSchedule';

export type { TxilladaAudience, TxilladaComment, TxilladaDto } from '@/lib/txillada';
export type { ScheduleInput, ScheduledTxillada } from '@/lib/txilladaSchedule';

/** O acesso ao LiveKit: o token assinado (com `canPublish` só para o anfitrião) e o endereço do servidor (wss://…). */
export interface TxilladaAccess { token: string; url: string }

const id = (s: string) => encodeURIComponent(s);

/**
 * O que se escolhe ao preparar (0167): o preço de uma privada e a Angariação (meta e motivo). `scheduleId` (0176): começar
 * uma Txillada agendada (a API usa o título, o tipo, o preço e a meta do agendamento).
 */
export interface StartOptions { price?: number | null; goal?: number | null; purpose?: string; scheduleId?: string }
/** A resposta a uma oferta (a mesma chave devolve a mesma oferta, sem cobrar outra vez). */
export interface GiftResult { gift: TxilladaGift; raised: number; goal: number | null; topGivers: TxilladaGiver[]; balance: number }

/** O que o anfitrião vê depois de mexer nos convidados: quem transmite, os pedidos e os convites à espera. */
export interface GuestLists { guests: TxilladaGuest[]; requests: GuestPending[]; invites: GuestPending[] }

export const txilladaApi = {
  /** A Txillada está ligada neste servidor? Um servidor antigo (sem a rota) ou sem resposta: não está. */
  config: async (): Promise<{ enabled: boolean }> => {
    try {
      const r = (await raw('/txilladas/config')) as { enabled?: unknown } | undefined;
      return { enabled: r?.enabled === true };
    } catch {
      return { enabled: false };
    }
  },
  /** Abrir uma Txillada (409 se já tenho uma a decorrer; 403 com a razão se não posso; 503 se não está disponível). */
  start: (title: string, audience: TxilladaAudience, opts: StartOptions = {}): Promise<{ txillada: TxilladaDto } & TxilladaAccess> =>
    raw('/txilladas', post({
      title, audience,
      ...(audience === 'paid' && opts.price != null ? { price: opts.price } : {}),
      ...(opts.goal != null ? { goal: opts.goal, purpose: opts.purpose ?? '' } : {}),
      ...(opts.scheduleId ? { scheduleId: opts.scheduleId } : {}),
    })),

  // Txillada agendada (0176, docs/txillada-agendar.md).
  /** Agendar: 201 com o agendamento; 400 (hora, preço, meta), 403, 409 `too_many` / `too_close`. */
  schedule: (input: ScheduleInput): Promise<ScheduledTxillada> => raw('/txilladas/schedules', post(input)),
  /** Os agendamentos à espera desse anfitrião que eu posso ver, por hora; sem `username`, os meus. */
  schedules: (username?: string): Promise<{ items: ScheduledTxillada[] }> => raw(`/txilladas/schedules${username ? `?username=${id(username)}` : ''}`),
  /** «Em breve»: os das próximas 48 h de quem sigo (máx. 20). */
  upcoming: (): Promise<{ items: ScheduledTxillada[] }> => raw('/txilladas/schedules/upcoming'),
  /** Um agendamento (também começado, cancelado ou expirado, para a ligação partilhada dizer o que aconteceu). */
  getSchedule: (scheduleId: string): Promise<ScheduledTxillada> => raw(`/txilladas/schedules/${id(scheduleId)}`),
  /** Mudar o título e a hora (só o anfitrião; 409 se já não está à espera). */
  editSchedule: (scheduleId: string, b: { title?: string; startsAt?: string }): Promise<ScheduledTxillada> =>
    raw(`/txilladas/schedules/${id(scheduleId)}`, { method: 'PATCH', body: JSON.stringify(b) }),
  /** Cancelar (204); quem pediu lembrete recebe o aviso. */
  cancelSchedule: (scheduleId: string): Promise<void> => raw(`/txilladas/schedules/${id(scheduleId)}`, { method: 'DELETE' }),
  /** «Lembrar-me» (ou tirar o lembrete). O anfitrião não pode (400). */
  remind: (scheduleId: string, on: boolean): Promise<{ reminded: boolean; reminders: number | null }> =>
    raw(`/txilladas/schedules/${id(scheduleId)}/remind`, on ? post({}) : { method: 'DELETE' }),
  /** Pagar a entrada de uma Txillada privada (uma vez só; pagar outra vez não cobra). 422 `insufficient_funds` sem saldo. */
  pay: (txilladaId: string): Promise<{ hasTicket: boolean; charged: boolean; balance: number; txillada: TxilladaDto }> => raw(`/txilladas/${id(txilladaId)}/ticket`, post({})),
  /** Oferecer Txills durante o live (`key`: a mesma ao repetir o pedido). 422 `insufficient_funds` sem saldo; 429 depressa demais. */
  gift: (txilladaId: string, amount: number, key: string): Promise<GiftResult> => raw(`/txilladas/${id(txilladaId)}/gifts`, post({ amount, key })),
  /** O saldo da carteira (os Txills ficam na app; não há compras aqui). */
  balance: async (): Promise<number | null> => {
    try {
      const r = (await raw('/wallet')) as { balance?: unknown } | undefined;
      return typeof r?.balance === 'number' ? r.balance : null;
    } catch {
      return null;
    }
  },
  /** As que estão a decorrer e posso ver (de quem sigo primeiro). */
  live: (): Promise<{ items: TxilladaDto[] }> => raw('/txilladas/live'),
  get: (txilladaId: string): Promise<TxilladaDto> => raw(`/txilladas/${id(txilladaId)}`),
  join: (txilladaId: string): Promise<TxilladaAccess> => raw(`/txilladas/${id(txilladaId)}/join`, post({})),
  end: (txilladaId: string): Promise<TxilladaDto> => raw(`/txilladas/${id(txilladaId)}/end`, post({})),
  /** Reabrir a Angariação (o anfitrião, até 24 h depois de a terminar antes da meta): a mesma Txillada, outra vez ao vivo. */
  reopen: (txilladaId: string): Promise<TxilladaDto> => raw(`/txilladas/${id(txilladaId)}/reopen`, post({})),
  /**
   * Os 50 mais recentes (do mais antigo para o mais recente); com `after`, só os que vieram depois desse; com `before`, os
   * 50 antes desse (para ler para trás). `more`: há mais antigos.
   */
  comments: (txilladaId: string, after?: string | null, before?: string | null): Promise<{ items: TxilladaComment[]; more?: boolean }> =>
    raw(`/txilladas/${id(txilladaId)}/comments${after ? `?after=${id(after)}` : before ? `?before=${id(before)}` : ''}`),
  /** Comentar. `invited`: quem recebeu agora o convite para vir ver, por ter sido mencionado sem estar a ver. */
  comment: (txilladaId: string, body: string): Promise<TxilladaComment & { invited?: string[] }> => raw(`/txilladas/${id(txilladaId)}/comments`, post({ body })),
  removeComment: (txilladaId: string, commentId: string): Promise<void> => raw(`/txilladas/${id(txilladaId)}/comments/${id(commentId)}`, { method: 'DELETE' }),
  /** Brindar um comentário (outra vez tira; no máximo 5 por segundo). A sala recebe `txillada.comment_cheer`. */
  cheerComment: (txilladaId: string, commentId: string): Promise<{ cheered: boolean; cheers: number }> =>
    raw(`/txilladas/${id(txilladaId)}/comments/${id(commentId)}/cheer`, post({})),
  cheer: (txilladaId: string): Promise<{ cheers: number }> => raw(`/txilladas/${id(txilladaId)}/cheer`, post({})),
  ban: (txilladaId: string, username: string): Promise<void> => raw(`/txilladas/${id(txilladaId)}/ban/${id(username)}`, post({})),
  report: (txilladaId: string, reason: string): Promise<void> => raw(`/txilladas/${id(txilladaId)}/report`, post({ reason })),
  /** Denunciar uma Txillada agendada (0176): deixa de aparecer a quem denunciou (o cartão, o perfil e «Em breve»). */
  reportSchedule: (scheduleId: string, reason: string, note?: string): Promise<void> =>
    raw(`/txilladas/schedules/${id(scheduleId)}/report`, post(note ? { reason, note } : { reason })),
  /** Denunciar um comentário (a fila da moderação); deixa de me aparecer. */
  reportComment: (txilladaId: string, commentId: string, reason: string, note?: string): Promise<void> =>
    raw(`/txilladas/${id(txilladaId)}/comments/${id(commentId)}/report`, post(note ? { reason, note } : { reason })),
  /** Fixar um comentário (ou tirar o fixado, com null): só o anfitrião. A sala recebe `txillada.pinned`. */
  pin: (txilladaId: string, commentId: string | null): Promise<{ pinned: TxilladaComment | null }> => raw(`/txilladas/${id(txilladaId)}/pin`, post({ commentId })),
  /**
   * Uma reação rápida (👋 🍻 🔥 😂 ❤️) a quem está na sala, sem se guardar (o 🍻 conta como um brinde e devolve `cheers`).
   * `to`: só o anfitrião, com 👋, a responder a quem entrou.
   */
  react: (txilladaId: string, kind: ReactionKind, to?: string): Promise<{ sent: boolean; cheers?: number }> =>
    raw(`/txilladas/${id(txilladaId)}/react`, post(to ? { kind, to } : { kind })),
  /** Quem está a ver agora (sem quem tem um bloqueio comigo). */
  viewers: (txilladaId: string): Promise<{ items: FxPerson[]; total: number; hidden?: boolean }> => raw(`/txilladas/${id(txilladaId)}/viewers`),

  // Convidados (0165): até 3 a transmitir com o anfitrião.
  /** Pedir para entrar (com um convite à espera, aceita-o: `state: 'guest'`). 403 sem 18 anos; 429 a pedir outra vez cedo de mais. */
  guestRequest: (txilladaId: string): Promise<{ state: GuestState; guests?: TxilladaGuest[] }> => raw(`/txilladas/${id(txilladaId)}/guests/request`, post({})),
  /** Aceitar o convite do anfitrião (passa a transmitir; 409 com 3 a transmitir). */
  guestAccept: (txilladaId: string): Promise<{ state: GuestState; guests: TxilladaGuest[] }> => raw(`/txilladas/${id(txilladaId)}/guests/accept`, post({})),
  guestDecline: (txilladaId: string): Promise<{ state: GuestState }> => raw(`/txilladas/${id(txilladaId)}/guests/decline`, post({})),
  /** Deixar de transmitir (volta a só ver), desistir do pedido ou recusar o convite. */
  guestLeave: (txilladaId: string): Promise<{ state: GuestState }> => raw(`/txilladas/${id(txilladaId)}/guests/leave`, post({})),
  /** O anfitrião: convidar quem está a ver, aceitar e recusar pedidos, tirar alguém (ou retirar um convite). */
  guestInvite: (txilladaId: string, username: string): Promise<GuestLists> => raw(`/txilladas/${id(txilladaId)}/guests/invite`, post({ username })),
  guestAcceptRequest: (txilladaId: string, username: string): Promise<GuestLists> => raw(`/txilladas/${id(txilladaId)}/guests/${id(username)}/accept`, post({})),
  guestDeclineRequest: (txilladaId: string, username: string): Promise<GuestLists> => raw(`/txilladas/${id(txilladaId)}/guests/${id(username)}/decline`, post({})),
  guestRemove: (txilladaId: string, username: string): Promise<GuestLists> => raw(`/txilladas/${id(txilladaId)}/guests/${id(username)}/remove`, post({})),
};

/** A chave da configuração no React Query (o mesmo valor serve Criar e o resto da app). */
export const TXILLADA_CONFIG_KEY = ['txillada-config'] as const;
export const txilladaKey = (txilladaId: string) => ['txillada', txilladaId] as const;
/** As chaves dos agendamentos: um, os de um anfitrião (sem `username`, os meus) e a fila «Em breve». */
export const scheduleKey = (scheduleId: string) => ['txillada-schedule', scheduleId] as const;
export const schedulesKey = (username?: string | null) => ['txillada-schedules', username ?? ''] as const;
export const UPCOMING_KEY = ['txillada-upcoming'] as const;

/** A Txillada está ligada? (GET /txilladas/config, guardado 5 min.) Desligada, nada da Txillada aparece. */
export function useTxilladaEnabled(): boolean {
  const q = useQuery({ queryKey: TXILLADA_CONFIG_KEY, queryFn: txilladaApi.config, staleTime: 5 * 60_000, retry: false });
  return txilladaEnabled(q.data);
}
/** A configuração já chegou (ou falhou)? Até lá não se sabe se a Txillada está desligada: não se sai do modo escolhido. */
export function useTxilladaConfigKnown(): boolean {
  const q = useQuery({ queryKey: TXILLADA_CONFIG_KEY, queryFn: txilladaApi.config, staleTime: 5 * 60_000, retry: false });
  return q.data !== undefined || q.isError;
}
