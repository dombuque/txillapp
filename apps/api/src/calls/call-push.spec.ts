import { buildFcmMessage } from '../push/fcm';
import { webPushBody } from '../push/push.service';
import { ackToken, checkAckToken, checkDeclineToken, declineToken, endPush, ringPush, ringRepeatDelays } from './call-push';

const SECRET = 'k'.repeat(40);
const caller = { username: 'ana', displayName: 'Ana' };

describe('avisos push de uma chamada', () => {
  it('reenvios do aviso a tocar: de 9 em 9 s, só até 30 s e nunca depois do fim do toque', () => {
    expect(ringRepeatDelays(45)).toEqual([9_000, 18_000, 27_000]);
    expect(ringRepeatDelays(30)).toEqual([9_000, 18_000, 27_000]);
    expect(ringRepeatDelays(20)).toEqual([9_000, 18_000]);
    expect(ringRepeatDelays(9)).toEqual([]);
    expect(ringRepeatDelays(2)).toEqual([]);
    expect(ringRepeatDelays(45, 0)).toEqual([]);
  });

  it('código para recusar: só serve para esta chamada e para quem a recebe', () => {
    const t = declineToken(SECRET, 'call-1', 'user-b');
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(checkDeclineToken(SECRET, 'call-1', 'user-b', t)).toBe(true);
    expect(checkDeclineToken(SECRET, 'call-2', 'user-b', t)).toBe(false);
    expect(checkDeclineToken(SECRET, 'call-1', 'user-a', t)).toBe(false);
    expect(checkDeclineToken('z'.repeat(40), 'call-1', 'user-b', t)).toBe(false);
    expect(checkDeclineToken(SECRET, 'call-1', 'user-b', '')).toBe(false);
    expect(checkDeclineToken(SECRET, 'call-1', 'user-b', undefined as unknown as string)).toBe(false);
  });

  it('código «chegou»: só esta chamada, só quem a recebe, e só até ao prazo', () => {
    const exp = 1_800_000_000;
    const t = ackToken(SECRET, 'call-1', 'user-b', exp);
    expect(t).toMatch(/^1800000000\.[A-Za-z0-9_-]{43}$/);
    expect(checkAckToken(SECRET, 'call-1', 'user-b', t, exp - 10)).toBe(true);
    expect(checkAckToken(SECRET, 'call-1', 'user-b', t, exp)).toBe(true);
    expect(checkAckToken(SECRET, 'call-1', 'user-b', t, exp + 1)).toBe(false); // expirou
    expect(checkAckToken(SECRET, 'call-2', 'user-b', t, exp - 10)).toBe(false);
    expect(checkAckToken(SECRET, 'call-1', 'user-a', t, exp - 10)).toBe(false);
    expect(checkAckToken('z'.repeat(40), 'call-1', 'user-b', t, exp - 10)).toBe(false);
    expect(checkAckToken(SECRET, 'call-1', 'user-b', t.replace('1800000000', '1900000000'), exp - 10)).toBe(false); // prazo mexido
    expect(checkAckToken(SECRET, 'call-1', 'user-b', declineToken(SECRET, 'call-1', 'user-b'), exp - 10)).toBe(false); // o de recusar não serve
    expect(checkAckToken(SECRET, 'call-1', 'user-b', '', exp - 10)).toBe(false);
    expect(checkAckToken(SECRET, 'call-1', 'user-b', undefined as unknown as string, exp - 10)).toBe(false);
  });

  it('o aviso a tocar leva o código «chegou» e o endereço para todos (browser, Android e iPhone)', () => {
    const url = 'https://txillapp.com/api/v1/calls/abc/ringing?ack=1.x';
    const p = ringPush({ id: 'abc', video: false, caller, ttlSeconds: 45, ackToken: '1.x', ackUrl: url });
    expect(p.data).toEqual({ kind: 'call', callId: 'abc', from: 'ana', video: '0', ackToken: '1.x', ackUrl: url });
    expect(JSON.parse(webPushBody(p))).toMatchObject({ ackToken: '1.x', ackUrl: url });
    const fcm = buildFcmMessage('t', p, 'android') as { data: Record<string, string> };
    expect(fcm.data).toMatchObject({ ackToken: '1.x', ackUrl: url, caller: 'ana' });
  });

  it('o aviso a tocar: o código e o reenvio vão só no Web Push; a mensagem da app nativa fica igual', () => {
    const first = ringPush({ id: 'abc', video: true, caller, ttlSeconds: 45, declineToken: 'tok' });
    expect(JSON.parse(webPushBody(first))).toEqual({ kind: 'call', callId: 'abc', from: 'ana', video: '1', declineToken: 'tok', title: 'Ana', body: 'Videochamada', url: '/call/abc?from=ana&video=1', tag: 'call-abc' });
    expect(first.webOnly).toBeUndefined();
    const fcm = buildFcmMessage('t', first, 'android') as { data: Record<string, string> };
    expect(fcm.data.declineToken).toBeUndefined();
    expect(fcm.data).toMatchObject({ kind: 'call', callId: 'abc', title: 'Ana', message: 'Videochamada', channelId: 'calls', tag: 'call-abc' });

    const again = ringPush({ id: 'abc', video: false, caller, ttlSeconds: 35.6, declineToken: 'tok', repeat: true });
    expect(again.webOnly).toBe(true);
    expect(again.ttlSeconds).toBe(36);
    expect(JSON.parse(webPushBody(again))).toMatchObject({ kind: 'call', video: '0', repeat: '1', declineToken: 'tok', body: 'Está a ligar-te', url: '/call/abc?from=ana&video=0' });
  });

  it('atendida ou recusada: aviso só Web Push com a mesma etiqueta, para fechar a notificação', () => {
    const e = endPush('abc', 'declined');
    expect(e.webOnly).toBe(true);
    expect(JSON.parse(webPushBody(e))).toEqual({ kind: 'call_end', callId: 'abc', reason: 'declined', title: 'Txillapp', body: 'Chamada recusada', url: '/calls', tag: 'call-abc' });
    expect(endPush('abc', 'accepted').body).toBe('Chamada atendida');
  });
});
