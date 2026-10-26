import { Injectable } from '@nestjs/common';
import { Observable, Subject, filter, map } from 'rxjs';

export interface ChatEvent {
  type: 'message' | 'typing' | 'read' | 'deleted';
  /** @utilizador de quem provocou o evento (o outro lado da conversa). */
  from: string;
}

/**
 * Canal em tempo real do chat (Server-Sent Events). Em memória: serve uma instância só.
 * TODO(fase 3): trocar por Redis pub/sub para várias instâncias.
 */
@Injectable()
export class ChatEvents {
  private readonly bus = new Subject<{ to: string; event: ChatEvent }>();

  emit(to: string, event: ChatEvent) {
    this.bus.next({ to, event });
  }

  forUser(userId: string): Observable<ChatEvent> {
    return this.bus.pipe(
      filter((e) => e.to === userId),
      map((e) => e.event),
    );
  }
}
