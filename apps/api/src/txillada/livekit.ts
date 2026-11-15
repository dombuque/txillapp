import { AccessToken, RoomServiceClient, TrackType, WebhookReceiver, type WebhookEvent } from 'livekit-server-sdk';
import type { AppConfig } from '../config';

/**
 * O LiveKit (o servidor de vídeo da Txillada, à parte): os tokens de entrada, o cliente da sala (tirar uma pessoa, fechar a
 * sala, ver quem publica) e a validação do webhook. Ligado só com LIVEKIT_URL, LIVEKIT_API_KEY e LIVEKIT_API_SECRET.
 */
export const LIVEKIT_ROOMS = Symbol('LIVEKIT_ROOMS');

/** O que a API pede à sala no LiveKit. Injetável (LIVEKIT_ROOMS): os testes trocam-no por um falso. */
export interface LiveKitRooms {
  removeParticipant(room: string, identity: string): Promise<void>;
  deleteRoom(room: string): Promise<void>;
  /** Quem está na sala e quantas faixas de vídeo cada um publica. */
  participants(room: string): Promise<{ identity: string; videoTracks: number }[]>;
  /**
   * Os convidados (0165): passa a poder publicar (câmara e microfone) ou deixa de poder, sem voltar a entrar na sala
   * (RoomService.updateParticipant). Ao tirar a permissão, o LiveKit para as faixas que a pessoa publicava.
   */
  setCanPublish(room: string, identity: string, canPublish: boolean): Promise<void>;
}

export const livekitEnabled = (c: Pick<AppConfig, 'LIVEKIT_URL' | 'LIVEKIT_API_KEY' | 'LIVEKIT_API_SECRET'>) => !!(c.LIVEKIT_URL && c.LIVEKIT_API_KEY && c.LIVEKIT_API_SECRET);

/** O cliente verdadeiro (RoomServiceClient), ou null sem configuração. */
export function livekitRoomsFromConfig(c: AppConfig): LiveKitRooms | null {
  if (!livekitEnabled(c)) return null;
  const svc = new RoomServiceClient(c.LIVEKIT_API_URL ?? c.LIVEKIT_URL!, c.LIVEKIT_API_KEY!, c.LIVEKIT_API_SECRET!);
  return {
    removeParticipant: (room, identity) => svc.removeParticipant(room, identity),
    deleteRoom: (room) => svc.deleteRoom(room),
    participants: async (room) =>
      (await svc.listParticipants(room)).map((p) => ({ identity: p.identity, videoTracks: p.tracks.filter((t) => t.type === TrackType.VIDEO).length })),
    // A permissão vai inteira (a do LiveKit troca-se toda): recebe sempre, nunca manda dados nem muda os seus metadados.
    setCanPublish: async (room, identity, canPublish) =>
      void (await svc.updateParticipant(room, identity, { permission: { canPublish, canSubscribe: true, canPublishData: false, canUpdateMetadata: false } })),
  };
}

/**
 * Um token de entrada na sala: o anfitrião publica (câmara e microfone); os espectadores só recebem. Quem está a ver é
 * visível na sala só pelo identity (o id da conta, como nos comentários); `hidden` esconde-o. O nome e o @ só vão no token
 * do anfitrião: o token de quem vê chega a todos os aparelhos da sala, também aos de quem tem bloqueio com essa pessoa.
 * A app mostra quem está a ver pela API (GET /txilladas/:id/viewers, que filtra os bloqueios), nunca pelo LiveKit.
 */
export async function roomToken(
  c: AppConfig,
  o: {
    room: string; identity: string; host: boolean;
    /** Só para o anfitrião: a quem vê não se põe o nome nem o @ no token. */
    name?: string; username?: string;
    /** Um convidado aceite (0165) que entra (ou volta a entrar) já a poder publicar. Sem nome no token, como quem vê. */
    publish?: boolean;
    /** As futuras Txilladas pagas: quem vê volta a entrar escondido. Por omissão false. */
    hidden?: boolean;
  },
): Promise<string> {
  const at = new AccessToken(c.LIVEKIT_API_KEY!, c.LIVEKIT_API_SECRET!, {
    identity: o.identity,
    ...(o.host ? { name: o.name, metadata: JSON.stringify({ username: o.username }) } : {}),
    // O token só vale para ligar (o LiveKit renova-o sozinho enquanto a ligação dura). A Txillada dura no máximo 4 h.
    ttl: o.host ? '5h' : '2h',
  });
  at.addGrant({
    roomJoin: true,
    room: o.room,
    canPublish: o.host || !!o.publish,
    canSubscribe: true,
    // Os comentários e os brindes passam pela API (com o filtro e os limites), não pelos dados do LiveKit.
    canPublishData: false,
    canUpdateOwnMetadata: false,
    // Quem está a ver é visível (os outros na sala veem o identity, sem nome nem @). Escondido (`hidden`) só quando se pede: as futuras
    // Txilladas pagas, em que quem vê volta a entrar escondido. O webhook avisa sempre quem entra e sai (é assim que se contam).
    ...(!o.host && o.hidden ? { hidden: true } : {}),
  });
  return at.toJwt();
}

/** Valida o webhook (o cabeçalho Authorization é um JWT assinado com o segredo, com o sha256 do corpo) e lê o evento. */
export function webhookReceiver(c: AppConfig): ((body: string, auth: string | undefined) => Promise<WebhookEvent>) | null {
  if (!livekitEnabled(c)) return null;
  const r = new WebhookReceiver(c.LIVEKIT_API_KEY!, c.LIVEKIT_API_SECRET!);
  return (body, auth) => r.receive(body, auth);
}

export { TrackType, type WebhookEvent };
