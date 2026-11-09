import { Injectable } from '@nestjs/common';
import { Observable, Subject, filter, map } from 'rxjs';

export interface ChatEvent {
  type: 'message' | 'typing' | 'read' | 'deleted';
  /** @utilizador de quem provocou o evento (o outro lado da conversa); vazio nos grupos. */
  from?: string;
  /** Id do grupo, quando o evento é de um grupo. */
  group?: string;
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

export type StreamEvent = ChatEvent | CallEvent;

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

  forUser(userId: string): Observable<StreamEvent> {
    return this.bus.pipe(
      filter((e) => e.to === userId),
      map((e) => e.event),
    );
  }
}
