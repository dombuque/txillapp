import { buildFcmMessage } from '../push/fcm';
import { webPushBody } from '../push/push.service';
import { checkDeclineToken, declineToken, endPush, ringPush, ringRepeatDelays } from './call-push';

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
