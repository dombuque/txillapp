import { Injectable } from '@nestjs/common';
import { Observable, Subject, filter, map } from 'rxjs';

export interface ChatEvent {
  type: 'message' | 'typing' | 'read' | 'deleted' | 'edited';
  /** @utilizador de quem provocou o evento (o outro lado da conversa); vazio nos grupos. */
  from?: string;
  /** Id do grupo, quando o evento é de um grupo. */
  group?: string;
  /**
   * Eco para os meus outros aparelhos (a mesma conta noutro telemóvel, no computador ou noutra sessão): fui eu que mudei
   * a conversa (enviei, editei, apaguei, reagi, li, abri, aceitei…). `from` é o OUTRO lado da conversa (a chave da
   * conversa na app), `group` o grupo. A app só põe os dados em dia: sem som, sem aviso, sem mexer no "a escrever…".
   * Com `self`, 'read' quer dizer "li eu" (muda só a lista). O 'typing' nunca vem com `self`.
   */
  self?: boolean;
}

/** Evento de chamada (voz ou vídeo) no mesmo canal em tempo real. O formato exato está no topo de calls/calls.service.ts. */
export interface CallEvent {
  type: 'call';
  event: 'ring' | 'accepted' | 'declined' | 'ended' | 'signal';
  callId: string;
  video: boolean;
  /** O outro lado da chamada, visto por quem recebe o evento. */
  from: { username: string; displayName: string; hasAvatar: boolean };
  reason?: 'missed' | 'cancelled' | 'declined' | 'ended' | 'lost';
  signal?: { type: 'offer' | 'answer' | 'ice'; data: unknown };
}

/**
 * TxillGroups: algo mudou no plano, numa sondagem, na lista, nas despesas ou no cofre de um grupo.
 * Vai para todos os membros; os ecrãs abertos voltam a pedir os dados.
 */
export interface GroupEvent {
  type: 'group';
  groupId: string;
  what: 'plan' | 'poll' | 'checklist' | 'expense' | 'pot' | 'info';
}

/**
 * Zás: chegou um Zás novo (ou foi apagado) de alguém que eu posso ver. Vai só para quem o pode ver (as regras do
 * instants.service: amigos próximos, seguidores mútuos se for para "amigos", nunca com bloqueios) e, como eco (`self`),
 * para os outros aparelhos de quem o fez. Sem `from` de propósito: as apps antigas só voltam a pedir a lista das conversas.
 * A app nova volta a pedir a faixa dos Zás (lib/streamEvents → planChatEvent).
 */
export interface ZasEvent {
  type: 'zas';
  what: 'new' | 'gone';
  self?: boolean;
}

export type StreamEvent = ChatEvent | CallEvent | GroupEvent | ZasEvent;

/**
 * Canal em tempo real do chat (Server-Sent Events). Em memória: serve uma instância só.
 * TODO(fase 3): trocar por Redis pub/sub para várias instâncias.
 */
@Injectable()
export class ChatEvents {
  private readonly bus = new Subject<{ to: string; event: StreamEvent }>();
  /** Quantas ligações em tempo real cada pessoa tem abertas (a app aberta = online). */
  private readonly open = new Map<string, number>();

  connect(userId: string) {
    this.open.set(userId, (this.open.get(userId) ?? 0) + 1);
  }
  /** Devolve true se foi a última ligação (a pessoa ficou offline). */
  disconnect(userId: string) {
    const n = (this.open.get(userId) ?? 1) - 1;
    if (n <= 0) this.open.delete(userId);
    else this.open.set(userId, n);
    return n <= 0;
  }
  isOnline(userId: string) {
    return (this.open.get(userId) ?? 0) > 0;
  }

  /** Conversa que cada pessoa tem aberta e à vista (a app avisa de tempos a tempos). Quem está a ver não recebe aviso no telemóvel. */
  private readonly active = new Map<string, { key: string; at: number }>();

  setActive(userId: string, key: string | null) {
    if (key) this.active.set(userId, { key: key.toLowerCase(), at: Date.now() });
    else this.active.delete(userId);
  }
  /** A pessoa está a ver esta conversa agora? ("u:<utilizador>" ou "g:<grupo>"; o sinal vale 45 s.) */
  isActive(userId: string, key: string, now = Date.now()) {
    const a = this.active.get(userId);
    return !!a && a.key === key.toLowerCase() && now - a.at < 45_000;
  }

  emit(to: string, event: StreamEvent) {
    this.bus.next({ to, event });
  }

  /**
   * Eco para os outros aparelhos de quem fez a mudança (ver ChatEvent.self): o aparelho que fez a mudança também o
   * recebe e só volta a pedir os dados. `from` = o outro lado da conversa; nos grupos, `group`.
   */
  echo(me: string, event: Omit<ChatEvent, 'self'>) {
    if (event.type === 'typing') return;
    this.emit(me, { ...event, self: true });
  }

  forUser(userId: string): Observable<StreamEvent> {
    return this.bus.pipe(
      filter((e) => e.to === userId),
      map((e) => e.event),
    );
  }
}
