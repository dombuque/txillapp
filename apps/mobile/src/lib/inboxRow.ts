// A linha de uma conversa na lista de Mensagens: a hora à direita do nome e o contador de por ler.
// Sem dependências (os testes correm em Node: tests/inboxRow.test.mjs).

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const two = (n: number) => String(n).padStart(2, '0');

/** Meia-noite local do dia de `d`. */
function dayStart(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * A hora da lista, como nas apps de mensagens: hoje "11:40", ontem "Ontem", nos últimos 7 dias o dia da semana ("Seg"),
 * antes disso o dia e o mês ("12/11") e, noutro ano, também o ano ("12/11/25"). Hora local; datas no futuro (relógio
 * adiantado) contam como hoje.
 */
export function listTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // Dias de calendário (arredondado: a mudança de hora de verão faz um dia ter 23 ou 25 horas).
  const days = Math.round((dayStart(now) - dayStart(d)) / 86_400_000);
  if (days <= 0) return `${two(d.getHours())}:${two(d.getMinutes())}`;
  if (days === 1) return 'Ontem';
  if (days < 7) return DAYS[d.getDay()];
  const dm = `${two(d.getDate())}/${two(d.getMonth() + 1)}`;
  return d.getFullYear() === now.getFullYear() ? dm : `${dm}/${two(d.getFullYear() % 100)}`;
}

/**
 * O que vai na bolinha de por ler: o número (até "99+"), "" quando está tudo lido, ou "dot" quando a conversa só foi
 * marcada à mão como por ler (não há mensagens novas para contar).
 */
export function unreadBadge(unread: number, marked = false): string {
  if (!(unread > 0)) return '';
  if (marked) return 'dot';
  return unread > 99 ? '99+' : String(Math.floor(unread));
}

/** O que o leitor de ecrã diz da linha: nome, pré-visualização, hora e por ler. */
export function rowLabel(name: string, preview: string, time: string, unread: number, marked = false): string {
  const tail = !(unread > 0) ? '' : marked ? ', marcada como por ler' : `, ${unread === 1 ? '1 mensagem por ler' : `${unread} mensagens por ler`}`;
  return `${name}, ${preview}${time ? `, ${time}` : ''}${tail}`;
}
