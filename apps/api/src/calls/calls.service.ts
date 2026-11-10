/**
 * Chamadas de voz e vídeo 1:1 (WebRTC de pessoa para pessoa). O servidor não toca no áudio nem no vídeo: só faz a
 * sinalização (passa a oferta, a resposta e os candidatos ICE de um lado para o outro), guarda o registo, avisa no
 * telemóvel e dá a configuração dos servidores ICE (STUN e, se existir, TURN com credenciais temporárias).
 *
 * ─────────────────────────────── Eventos em tempo real ───────────────────────────────
 * Chegam no canal do chat (GET /api/v1/chat/stream, Server-Sent Events), cada um numa linha `data:` com este JSON:
 *
 *   {
 *     "type": "call",
 *     "event": "ring" | "accepted" | "declined" | "ended" | "signal",
 *     "callId": "<uuid>",
 *     "video": true | false,
 *     "from": { "username": "ana", "displayName": "Ana", "hasAvatar": true },
 *     "reason": "missed" | "cancelled" | "declined" | "ended" | "lost",      (só em "ended")
 *     "signal": { "type": "offer" | "answer" | "ice", "data": <o que o outro lado enviou, tal e qual> }   (só em "signal")
 *   }
 *
 * `from` é sempre o OUTRO lado da chamada, visto por quem recebe o evento (no "ended" por chamada perdida, que vai para os
 * dois, quem ligou recebe os dados de quem não atendeu e vice-versa).
 *
 *   ring      → para quem recebe a chamada, logo a seguir a POST /calls.
 *   accepted  → para quem ligou, quando o outro atende (POST /calls/:id/accept).
 *   declined  → para quem ligou, quando o outro recusa (POST /calls/:id/decline).
 *   ended     → para o outro lado, quando alguém desliga (POST /calls/:id/end):
 *                 reason "cancelled" (quem ligou desistiu antes de atenderem), "declined" (quem recebe desligou enquanto
 *                 tocava), "ended" (a chamada estava em curso).
 *               Para os dois, quando ninguém atende a tempo (45 s): reason "missed".
 *               Para os dois, quando o servidor dá a chamada por caída: reason "lost" (os dois sem ligação ao canal
 *               há mais de 2 minutos, ou 6 horas de chamada).
 *   signal    → para o outro lado, cada POST /calls/:id/signal (oferta, resposta, candidato ICE).
 *
 * Exemplo (ring):
 *   {"type":"call","event":"ring","callId":"0193...","video":true,"from":{"username":"ana","displayName":"Ana","hasAvatar":true}}
 * Exemplo (signal):
 *   {"type":"call","event":"signal","callId":"0193...","video":false,"from":{"username":"ana","displayName":"Ana","hasAvatar":false},
 *    "signal":{"type":"ice","data":{"candidate":"candidate:...","sdpMid":"0","sdpMLineIndex":0}}}
 *
 * Aviso no telemóvel (quando toca), prioridade alta e validade igual ao tempo de toque:
 *   Android (FCM): SÓ DADOS (sem bloco `notification`), tudo texto:
 *     {title:<nome de quem liga>, message:"Está a ligar-te"|"Videochamada", channelId:'calls', categoryId:'call',
 *      tag:'call-<id>', kind:'call', callId, from:<@>, video:'1'|'0', url:'/call/<id>?from=<@>&video=0|1'}
 *   iOS (FCM para APNs): notificação com aps.category 'call', aps.sound 'ring.wav', aps['interruption-level'] 'time-sensitive'.
 *   Web Push: {kind, callId, from, video, declineToken, title, body, url, tag} ao nível de cima; reenviado (só Web Push,
 *   com repeat '1') de 9 em 9 s enquanto toca, até 30 s. `declineToken` serve para o botão Recusar do service worker
 *   (POST /calls/:id/decline-push, sem sessão). Atendida ou recusada: Web Push {kind:'call_end', callId, reason
 *   'accepted'|'declined', tag 'call-<id>'} para quem recebe, que fecha a notificação nos browsers dele.
 * Chamada perdida: notificação 'missed_call' na lista e push só de dados com kind 'missed_call', a mesma tag
 * 'call-<id>' (substitui a que tocava), title, message/body "Chamada perdida"|"Videochamada perdida", url '/calls'.
 * ──────────────────────────────────────────────────────────────────────────────────────
 */
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { Pool } from 'pg';
import { ChatEvents, type CallEvent } from '../chat/chat.events';
import { ChatService } from '../chat/chat.service';
import { uuidv7 } from '../common/uuid7';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';
import { NotificationsService } from '../notifications/notifications.service';
import { PushService } from '../push/push.service';
import { blockedBetween } from '../social/visibility';
import { checkDeclineToken, declineToken, endPush, ringPush, ringRepeatDelays, type RingInfo } from './call-push';

export type CallStatus = 'ringing' | 'active' | 'declined' | 'cancelled' | 'missed' | 'ended';
export type SignalType = 'offer' | 'answer' | 'ice';
export interface IceServer { urls: string[]; username?: string; credential?: string }
interface Person { id: string; username: string; displayName: string; hasAvatar: boolean }
interface CallRow { id: string; video: boolean; status: CallStatus; caller: Person; callee: Person; startedAt: string | null }

const STUN = ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'];
/** Validade das credenciais TURN. */
const TURN_TTL_S = 6 * 3600;
/** Uma chamada em curso há mais do que isto termina (a mesma validade das credenciais TURN). */
const MAX_ACTIVE_S = 6 * 3600;
/** Em curso, mas os dois sem ligação ao canal em tempo real há mais do que isto: a chamada caiu. */
const LOST_AFTER_S = 120;
/** Tamanho máximo de cada sinal (oferta SDP, resposta ou candidato), em JSON. */
export const MAX_SIGNAL_BYTES = 64 * 1024;
const PAGE = 30;

const publicOf = (p: Person) => ({ username: p.username, displayName: p.displayName, hasAvatar: p.hasAvatar });

@Injectable()
export class CallsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Chamadas');
  /** Um temporizador por chamada a tocar (dá-a por perdida ao fim do tempo). A varredura periódica apanha o resto (ex.: reinício do servidor). */
  private readonly timers = new Map<string, NodeJS.Timeout>();
  /** Reenvios do aviso Web Push enquanto a chamada toca (ver call-push.ts). */
  private readonly repeats = new Map<string, NodeJS.Timeout[]>();
  private sweeper?: NodeJS.Timeout;
  private purger?: NodeJS.Timeout;
  /** Desde quando cada chamada em curso tem os dois lados sem ligação ao canal. */
  private readonly offlineSince = new Map<string, number>();

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly events: ChatEvents,
    private readonly chat: ChatService,
    private readonly push: PushService,
    private readonly notifications: NotificationsService,
  ) {}

  get ringSeconds() {
    return this.config.CALL_RING_SECONDS;
  }

  onModuleInit() {
    if (this.config.NODE_ENV === 'test') return;
    this.sweeper = setInterval(() => void this.sweep().catch((e) => this.log.warn(`falha na varredura: ${(e as Error).message}`)), 15_000);
    this.sweeper.unref();
    // Uma vez por dia (e logo no arranque): apaga as chamadas com mais de 12 meses.
    void this.purgeOld().catch(() => undefined);
    this.purger = setInterval(() => void this.purgeOld().catch((e) => this.log.warn(`falha a limpar chamadas antigas: ${(e as Error).message}`)), 24 * 3_600_000);
    this.purger.unref();
  }

  onModuleDestroy() {
    if (this.sweeper) clearInterval(this.sweeper);
    if (this.purger) clearInterval(this.purger);
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    for (const l of this.repeats.values()) for (const t of l) clearTimeout(t);
    this.repeats.clear();
  }

  /* ───────────── ICE ───────────── */

  /** STUN sempre; TURN (esquema REST do coturn) só com TURN_URLS e TURN_SECRET. */
  iceServers(userId: string, now = Date.now()): IceServer[] {
    const out: IceServer[] = [{ urls: [...STUN] }];
    const urls = (this.config.TURN_URLS ?? '').split(',').map((u) => u.trim()).filter(Boolean);
    if (urls.length && this.config.TURN_SECRET) {
      const username = `${Math.floor(now / 1000) + TURN_TTL_S}:${userId}`;
      const credential = createHmac('sha1', this.config.TURN_SECRET).update(username).digest('base64');
      out.push({ urls, username, credential });
    }
    return out;
  }

  /**
   * Servidores ICE e se esta pessoa quer as chamadas só pelo TURN ("Esconder o meu IP nas chamadas").
   * Sem TURN configurado, `relayOnly` vem sempre falso (senão a chamada nunca ligaria).
   */
  async iceFor(userId: string): Promise<{ iceServers: IceServer[]; relayOnly: boolean }> {
    const iceServers = this.iceServers(userId);
    const hasTurn = iceServers.length > 1;
    const relayOnly = hasTurn && !!(await this.pool.query('SELECT calls_relay_only FROM identity.users WHERE id = $1', [userId])).rows[0]?.calls_relay_only;
    return { iceServers, relayOnly };
  }

  /* ───────────── ligar ───────────── */

  private async person(id: string): Promise<Person> {
    const r = (await this.pool.query('SELECT id, username, display_name, (avatar_media_id IS NOT NULL) AS has_avatar FROM identity.users WHERE id = $1', [id])).rows[0];
    return { id: r.id, username: r.username, displayName: r.display_name, hasAvatar: r.has_avatar };
  }

  async create(me: string, username: string, video: boolean) {
    const u = (
      await this.pool.query(
        `SELECT u.id, u.username, u.display_name, (u.avatar_media_id IS NOT NULL) AS has_avatar, u.status, u.calls_allowed,
                ${blockedBetween('u.id', '$1')} AS blocked,
                EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = u.id AND f.followee_id = $1) AS follows_me,
                EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = $1 AND f.followee_id = u.id) AS i_follow
           FROM identity.users u WHERE lower(u.username) = lower($2)`,
        [me, username],
      )
    ).rows[0];
    if (!u || u.status !== 'active') throw new NotFoundException('Pessoa não encontrada');
    if (u.id === me) throw new BadRequestException('Não podes ligar a ti próprio');
    if (u.blocked) throw new ForbiddenException('Não podes ligar a esta pessoa');
    const rule = u.calls_allowed as 'everyone' | 'following' | 'mutual' | 'off';
    if (rule === 'off') throw new ForbiddenException('Esta pessoa não está a receber chamadas');
    if (rule === 'following' && !u.follows_me) throw new ForbiddenException('Esta pessoa só recebe chamadas de quem ela segue');
    if (rule === 'mutual' && !(u.follows_me && u.i_follow)) throw new ForbiddenException('Só dá para ligar a quem te segue e tu segues de volta');

    const id = uuidv7();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Duas chamadas ao mesmo tempo para as mesmas pessoas: uma espera pela outra (sempre pela mesma ordem, sem bloqueio mútuo).
      for (const x of [me, u.id as string].sort()) await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`call:${x}`]);
      const busy = await client.query(
        `SELECT 1 FROM social.calls WHERE status IN ('ringing', 'active') AND (caller_id = ANY($1::uuid[]) OR callee_id = ANY($1::uuid[])) LIMIT 1`,
        [[me, u.id]],
      );
      if (busy.rowCount) throw new ConflictException('Está noutra chamada');
      await client.query('INSERT INTO social.calls (id, caller_id, callee_id, video) VALUES ($1, $2, $3, $4)', [id, me, u.id, video]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }

    const caller = await this.person(me);
    const callee: Person = { id: u.id, username: u.username, displayName: u.display_name, hasAvatar: u.has_avatar };
    this.emit(callee.id, 'ring', { id, video }, caller);
    const ring = { id, video, caller, declineToken: declineToken(this.config.JWT_ACCESS_SECRET, id, callee.id) };
    void this.push.send(callee.id, ringPush({ ...ring, ttlSeconds: this.ringSeconds }));
    const t = setTimeout(() => void this.expire(id).catch((e) => this.log.warn(`falha a expirar: ${(e as Error).message}`)), this.ringSeconds * 1000);
    t.unref();
    this.timers.set(id, t);
    // Web Push não toca sem parar: o aviso volta a vibrar e a soar de 9 em 9 s enquanto a chamada estiver a tocar.
    const again = ringRepeatDelays(this.ringSeconds).map((ms) => {
      const r = setTimeout(() => void this.ringAgain(callee.id, { ...ring, repeat: true, ttlSeconds: this.ringSeconds - ms / 1000 }).catch(() => undefined), ms);
      r.unref();
      return r;
    });
    if (again.length) this.repeats.set(id, again);
    return { id, video, peer: publicOf(callee), ...(await this.iceFor(me)) };
  }

  /** Reenvio do aviso (só Web Push), apenas se a chamada ainda está a tocar. */
  private async ringAgain(calleeId: string, r: RingInfo) {
    if (!this.repeats.has(r.id)) return;
    const st = (await this.pool.query('SELECT status FROM social.calls WHERE id = $1', [r.id])).rows[0]?.status;
    if (st !== 'ringing' || !this.repeats.has(r.id)) return;
    await this.push.send(calleeId, ringPush(r));
  }

  /** Atendida ou recusada: fecha a notificação a tocar em todos os browsers de quem recebe (Web Push). */
  private closeRing(calleeId: string, callId: string, reason: 'accepted' | 'declined') {
    void this.push.send(calleeId, endPush(callId, reason));
  }

  /** Recusar pelo botão da notificação do browser (sem sessão): só com o código que veio no aviso desta chamada. */
  async declineFromPush(callId: string, token: string) {
    const r = (await this.pool.query('SELECT callee_id FROM social.calls WHERE id = $1', [callId])).rows[0];
    if (!r || !checkDeclineToken(this.config.JWT_ACCESS_SECRET, callId, r.callee_id as string, token)) throw new NotFoundException('Chamada não encontrada');
    return this.decline(r.callee_id as string, callId);
  }

  /* ───────────── atender, recusar, desligar, sinais ───────────── */

  private async load(callId: string, me: string): Promise<CallRow> {
    const r = (
      await this.pool.query(
        `SELECT c.id, c.video, c.status, c.started_at,
                a.id AS a_id, a.username AS a_username, a.display_name AS a_name, (a.avatar_media_id IS NOT NULL) AS a_avatar,
                b.id AS b_id, b.username AS b_username, b.display_name AS b_name, (b.avatar_media_id IS NOT NULL) AS b_avatar
           FROM social.calls c JOIN identity.users a ON a.id = c.caller_id JOIN identity.users b ON b.id = c.callee_id
          WHERE c.id = $1`,
        [callId],
      )
    ).rows[0];
    if (!r || (r.a_id !== me && r.b_id !== me)) throw new NotFoundException('Chamada não encontrada');
    return {
      id: r.id,
      video: r.video,
      status: r.status,
      startedAt: r.started_at,
      caller: { id: r.a_id, username: r.a_username, displayName: r.a_name, hasAvatar: r.a_avatar },
      callee: { id: r.b_id, username: r.b_username, displayName: r.b_name, hasAvatar: r.b_avatar },
    };
  }

  private emit(to: string, event: CallEvent['event'], c: Pick<CallRow, 'id' | 'video'>, from: Person, extra: Pick<CallEvent, 'reason' | 'signal'> = {}) {
    this.events.emit(to, { type: 'call', event, callId: c.id, video: c.video, from: publicOf(from), ...extra });
  }

  private stopTimer(id: string) {
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.delete(id);
    for (const r of this.repeats.get(id) ?? []) clearTimeout(r);
    this.repeats.delete(id);
  }

  async accept(me: string, callId: string) {
    const c = await this.load(callId, me);
    if (c.callee.id !== me) throw new ForbiddenException('Só quem recebe a chamada pode atender');
    const upd = await this.pool.query(`UPDATE social.calls SET status = 'active', started_at = now() WHERE id = $1 AND status = 'ringing'`, [callId]);
    if (!upd.rowCount) throw new ConflictException('Esta chamada já não está a tocar');
    this.stopTimer(callId);
    this.emit(c.caller.id, 'accepted', c, c.callee);
    this.closeRing(c.callee.id, callId, 'accepted');
    return this.iceFor(me);
  }

  /** Recusar; com `message`, vai também uma mensagem normal no chat (respostas rápidas, como "Estou numa reunião, ligo depois"). */
  async decline(me: string, callId: string, message?: string) {
    const c = await this.load(callId, me);
    if (c.callee.id !== me) throw new ForbiddenException('Só quem recebe a chamada pode recusar');
    const upd = await this.pool.query(`UPDATE social.calls SET status = 'declined', ended_at = now() WHERE id = $1 AND status = 'ringing'`, [callId]);
    if (!upd.rowCount) throw new ConflictException('Esta chamada já não está a tocar');
    this.stopTimer(callId);
    this.emit(c.caller.id, 'declined', c, c.callee);
    this.closeRing(c.callee.id, callId, 'declined');
    this.logToChat(c.caller.id, c.callee.id, c.video, 'declined', null);
    let messageSent = false;
    const text = message?.trim();
    if (text) {
      try {
        await this.chat.send(me, c.caller.username, { kind: 'text', body: text });
        messageSent = true;
      } catch (e) {
        // A chamada fica recusada na mesma; a mensagem pode falhar (palavras proibidas, regras do chat).
        this.log.warn(`mensagem da recusa não seguiu: ${(e as Error).message}`);
      }
    }
    return { status: 'declined' as const, messageSent };
  }

  async end(me: string, callId: string): Promise<{ status: CallStatus; durationS: number | null }> {
    const c = await this.load(callId, me);
    const other = c.caller.id === me ? c.callee : c.caller;
    const self = c.caller.id === me ? c.caller : c.callee;
    if (c.status === 'ringing') {
      const status = c.caller.id === me ? 'cancelled' : 'declined';
      const upd = await this.pool.query(`UPDATE social.calls SET status = $2, ended_at = now() WHERE id = $1 AND status = 'ringing'`, [callId, status]);
      if (upd.rowCount) {
        this.stopTimer(callId);
        this.emit(other.id, 'ended', c, self, { reason: status });
        // Quem ligou desistiu: na conversa fica como perdida (como no WhatsApp); quem recebe também recusou → recusada.
        this.logToChat(c.caller.id, c.callee.id, c.video, status === 'cancelled' ? 'missed' : 'declined', null);
        // Quem ligou desistiu antes de atenderem: para quem recebia, é uma chamada perdida.
        // Quem recebe desligou enquanto tocava: fecha-se a notificação nos outros browsers dele.
        if (status === 'declined') this.closeRing(c.callee.id, callId, 'declined');
        if (status === 'cancelled') void this.notifications.notify({ userId: c.callee.id, actorId: c.caller.id, kind: 'missed_call', data: { callId, video: c.video } });
        return { status, durationS: null };
      }
      return this.end(me, callId); // mudou entretanto (foi atendida ou expirou): volta a ver
    }
    if (c.status === 'active') {
      const upd = await this.pool.query(
        `UPDATE social.calls SET status = 'ended', ended_at = now() WHERE id = $1 AND status = 'active' RETURNING EXTRACT(EPOCH FROM (ended_at - started_at)) AS d`,
        [callId],
      );
      if (upd.rows[0]) {
        this.offlineSince.delete(callId);
        this.emit(other.id, 'ended', c, self, { reason: 'ended' });
        const durationS = Math.max(0, Math.round(Number(upd.rows[0].d)));
        this.logToChat(c.caller.id, c.callee.id, c.video, 'ended', durationS);
        return { status: 'ended', durationS };
      }
      return this.end(me, callId);
    }
    // Já tinha terminado: desligar outra vez não faz mal.
    return { status: c.status, durationS: await this.durationOf(callId) };
  }

  /** Deixa a chamada registada na conversa dos dois (nunca falha a ação principal). */
  private logToChat(callerId: string, calleeId: string, video: boolean, status: string, durationS: number | null) {
    void this.chat.logCall(callerId, calleeId, { video, status, durationS }).catch((e) => this.log.warn(`registo da chamada no chat falhou: ${(e as Error).message}`));
  }

  private async durationOf(callId: string): Promise<number | null> {
    const r = (await this.pool.query('SELECT EXTRACT(EPOCH FROM (ended_at - started_at)) AS d FROM social.calls WHERE id = $1', [callId])).rows[0];
    return r?.d == null ? null : Math.max(0, Math.round(Number(r.d)));
  }

  async signal(me: string, callId: string, type: SignalType, data: unknown) {
    const size = Buffer.byteLength(JSON.stringify(data ?? null) ?? 'null');
    if (size > MAX_SIGNAL_BYTES) throw new BadRequestException('Sinal demasiado grande');
    const c = await this.load(callId, me);
    if (c.status !== 'ringing' && c.status !== 'active') throw new ConflictException('Esta chamada já terminou');
    const other = c.caller.id === me ? c.callee : c.caller;
    const self = c.caller.id === me ? c.caller : c.callee;
    this.emit(other.id, 'signal', c, self, { signal: { type, data: data ?? null } });
  }

  /* ───────────── perdidas e caídas ───────────── */

  /** Ninguém atendeu: perdida, avisa os dois e deixa a notificação a quem não atendeu. */
  private async missed(ids: string[]) {
    for (const id of ids) {
      this.stopTimer(id);
      const r = (
        await this.pool.query(
          `SELECT c.id, c.video, c.caller_id, c.callee_id FROM social.calls c WHERE c.id = $1`,
          [id],
        )
      ).rows[0];
      if (!r) continue;
      const [caller, callee] = await Promise.all([this.person(r.caller_id), this.person(r.callee_id)]);
      const c = { id, video: r.video as boolean };
      this.emit(callee.id, 'ended', c, caller, { reason: 'missed' });
      this.emit(caller.id, 'ended', c, callee, { reason: 'missed' });
      this.logToChat(caller.id, callee.id, c.video, 'missed', null);
      await this.notifications.notify({ userId: callee.id, actorId: caller.id, kind: 'missed_call', data: { callId: id, video: c.video } });
    }
  }

  /** O temporizador desta chamada chegou ao fim. */
  async expire(callId: string) {
    this.timers.delete(callId);
    const r = await this.pool.query(`UPDATE social.calls SET status = 'missed', ended_at = now() WHERE id = $1 AND status = 'ringing' RETURNING id`, [callId]);
    await this.missed(r.rows.map((x) => x.id as string));
  }

  /**
   * Varredura: chamadas a tocar há mais do que o tempo de toque ficam perdidas; em curso há 6 horas, ou com os dois
   * sem ligação ao canal há mais de 2 minutos, terminam como caídas ('lost'). Corre de 15 em 15 s (os testes chamam-na à mão).
   */
  async sweep(now = Date.now()) {
    const rung = await this.pool.query(
      `UPDATE social.calls SET status = 'missed', ended_at = now() WHERE status = 'ringing' AND created_at < now() - make_interval(secs => $1) RETURNING id`,
      [this.ringSeconds],
    );
    await this.missed(rung.rows.map((x) => x.id as string));

    const live = (await this.pool.query(`SELECT id, caller_id, callee_id, started_at FROM social.calls WHERE status = 'active'`)).rows;
    const lost: string[] = [];
    for (const r of live) {
      const startedMs = new Date(r.started_at as string).getTime();
      const bothOff = !this.events.isOnline(r.caller_id) && !this.events.isOnline(r.callee_id);
      if (!bothOff) this.offlineSince.delete(r.id);
      else if (!this.offlineSince.has(r.id)) this.offlineSince.set(r.id, now);
      const offFor = bothOff ? now - this.offlineSince.get(r.id)! : 0;
      if (now - startedMs > MAX_ACTIVE_S * 1000 || offFor > LOST_AFTER_S * 1000) lost.push(r.id as string);
    }
    for (const id of lost) {
      this.offlineSince.delete(id);
      const r = (
        await this.pool.query(`UPDATE social.calls SET status = 'ended', ended_at = now() WHERE id = $1 AND status = 'active' RETURNING video, caller_id, callee_id, EXTRACT(EPOCH FROM (ended_at - started_at)) AS d`, [id])
      ).rows[0];
      if (!r) continue;
      const [caller, callee] = await Promise.all([this.person(r.caller_id), this.person(r.callee_id)]);
      this.emit(callee.id, 'ended', { id, video: r.video }, caller, { reason: 'lost' });
      this.emit(caller.id, 'ended', { id, video: r.video }, callee, { reason: 'lost' });
      this.logToChat(caller.id, callee.id, !!r.video, 'ended', Math.max(0, Math.round(Number(r.d ?? 0))));
    }
    return { missed: rung.rowCount ?? 0, lost: lost.length };
  }

  /* ───────────── histórico ───────────── */

  /**
   * As minhas chamadas (feitas e recebidas), das mais recentes para as mais antigas.
   * `startedAt` é quando a chamada foi feita (começou a tocar); `durationS` é o tempo de conversa (só nas atendidas e já terminadas).
   */
  async history(me: string, cursor?: string) {
    if (cursor && !/^[0-9a-f-]{36}$/.test(cursor)) throw new BadRequestException('cursor inválido');
    const { rows } = await this.pool.query(
      `SELECT c.id, c.video, c.status, c.created_at, (c.caller_id = $1) AS outgoing,
              EXTRACT(EPOCH FROM (c.ended_at - c.started_at)) AS d,
              o.username, o.display_name, o.status AS o_status, (o.avatar_media_id IS NOT NULL) AS has_avatar
         FROM social.calls c
         JOIN identity.users o ON o.id = CASE WHEN c.caller_id = $1 THEN c.callee_id ELSE c.caller_id END
        WHERE ((c.caller_id = $1 AND NOT c.hidden_by_caller) OR (c.callee_id = $1 AND NOT c.hidden_by_callee)) AND ($2::uuid IS NULL OR c.id < $2)
        ORDER BY c.id DESC LIMIT $3`,
      [me, cursor ?? null, PAGE + 1],
    );
    const page = rows.slice(0, PAGE);
    return {
      items: page.map((r) => ({
        id: r.id as string,
        video: r.video as boolean,
        direction: (r.outgoing ? 'out' : 'in') as 'in' | 'out',
        status: r.status as CallStatus,
        peer: { username: r.username as string, displayName: r.o_status === 'active' ? (r.display_name as string) : 'Conta eliminada', hasAvatar: r.has_avatar as boolean },
        startedAt: r.created_at as string,
        durationS: r.d == null ? null : Math.max(0, Math.round(Number(r.d))),
      })),
      nextCursor: rows.length > PAGE ? (page[page.length - 1].id as string) : null,
    };
  }

  /** Apaga uma chamada do MEU histórico (a do outro lado fica). Chamadas ainda a decorrer não se apagam. */
  async hide(me: string, id: string) {
    const r = await this.pool.query(
      `UPDATE social.calls SET hidden_by_caller = hidden_by_caller OR caller_id = $1, hidden_by_callee = hidden_by_callee OR callee_id = $1
        WHERE id = $2 AND (caller_id = $1 OR callee_id = $1) AND status NOT IN ('ringing', 'active')`,
      [me, id],
    );
    if (!r.rowCount) throw new NotFoundException('Chamada não encontrada');
    await this.purgeHidden();
    return { ok: true };
  }

  /** Apaga todo o MEU histórico de chamadas. */
  async hideAll(me: string) {
    const r = await this.pool.query(
      `UPDATE social.calls SET hidden_by_caller = hidden_by_caller OR caller_id = $1, hidden_by_callee = hidden_by_callee OR callee_id = $1
        WHERE (caller_id = $1 OR callee_id = $1) AND status NOT IN ('ringing', 'active')`,
      [me],
    );
    await this.purgeHidden();
    return { removed: r.rowCount ?? 0 };
  }

  /** Quando os dois lados apagaram, a chamada deixa de existir de vez. */
  private async purgeHidden() {
    await this.pool.query('DELETE FROM social.calls WHERE hidden_by_caller AND hidden_by_callee');
  }

  /** Chamadas com mais de 12 meses saem do histórico de todos. */
  async purgeOld() {
    const r = await this.pool.query(`DELETE FROM social.calls WHERE created_at < now() - interval '12 months' AND status NOT IN ('ringing', 'active')`);
    return r.rowCount ?? 0;
  }
}
