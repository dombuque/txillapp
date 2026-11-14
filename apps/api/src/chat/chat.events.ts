import { Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';
import { RealtimeBus } from '../realtime/realtime-bus';

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
  event: 'ring' | 'ringing' | 'accepted' | 'declined' | 'ended' | 'signal';
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

/**
 * Mixar (0150, docs/mixar-contrato.md): algo mudou no Mixar `id`. Vai para o outro do par e, como eco (`self`), para os meus
 * outros aparelhos. `what`: 'invite' (convidaram-me), 'accepted', 'reaction' (o outro reagiu), 'pick' (o outro escolheu no
 * desafio, sem dizer qual), 'result' (os dois escolheram: o resultado abriu-se) e 'daily' (a seleção do dia está pronta).
 */
export interface MixarEvent {
  type: 'mixar';
  id: string;
  what: 'invite' | 'accepted' | 'reaction' | 'pick' | 'result' | 'daily';
  self?: boolean;
}

export type StreamEvent = ChatEvent | CallEvent | GroupEvent | ZasEvent | MixarEvent;

/** O sinal «estou a ver esta conversa» vale 45 s (a app repete-o enquanto a conversa está à vista). */
const ACTIVE_MS = 45_000;
const activeKey = (userId: string) => `rt:act:${userId}`;

/**
 * Canal em tempo real do chat (Server-Sent Events), por cima do RealtimeBus (realtime/realtime-bus.ts): com REDIS_URL,
 * um evento publicado numa instância chega às ligações SSE de todas, e quem está ligado e a conversa à vista ficam no
 * Redis (com validade); sem ele, tudo na memória, como numa instância só.
 */
@Injectable()
export class ChatEvents {
  constructor(private readonly bus: RealtimeBus) {}

  /** Uma ligação em tempo real abriu (a app aberta = online). */
  connect(userId: string) {
    this.bus.connect(userId);
  }
  /** Uma ligação fechou. Devolve true se foi a última desta instância (com uma instância só: a pessoa ficou offline). */
  disconnect(userId: string) {
    return this.bus.disconnect(userId);
  }
  /** A pessoa tem a app aberta (o canal ligado a alguma instância)? */
  isOnline(userId: string): Promise<boolean> {
    return this.bus.isOnline(userId);
  }
  /** Dos ids pedidos, os que têm a app aberta. */
  onlineAmong(userIds: string[]): Promise<Set<string>> {
    return this.bus.onlineAmong(userIds);
  }

  /** Conversa que cada pessoa tem aberta e à vista (a app avisa de tempos a tempos). Quem está a ver não recebe aviso no telemóvel. */
  async setActive(userId: string, key: string | null) {
    if (key) await this.bus.setFlag(activeKey(userId), `${Date.now()}|${key.toLowerCase()}`, ACTIVE_MS);
    else await this.bus.delFlag(activeKey(userId));
  }
  /** A pessoa está a ver esta conversa agora? ("u:<utilizador>" ou "g:<grupo>"; o sinal vale 45 s.) */
  async isActive(userId: string, key: string, now = Date.now()) {
    const v = await this.bus.getFlag(activeKey(userId));
    if (!v) return false;
    const i = v.indexOf('|');
    return v.slice(i + 1) === key.toLowerCase() && now - Number(v.slice(0, i)) < ACTIVE_MS;
  }

  emit(to: string, event: StreamEvent) {
    this.bus.publish(to, event);
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
    return new Observable<StreamEvent>((sub) => this.bus.subscribe(userId, (e) => sub.next(e as StreamEvent)));
  }
}
