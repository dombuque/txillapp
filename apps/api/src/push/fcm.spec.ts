import { exportPKCS8, generateKeyPair } from 'jose';
import { buildFcmMessage, FcmSender, fcmData, fcmTokenIsDead } from './fcm';
import { webPushBody } from './push.service';

const callPush = {
  title: 'Ana Teste',
  body: 'Videochamada',
  url: '/call/abc?from=ana&video=1',
  tag: 'call-abc',
  data: { kind: 'call', callId: 'abc', from: 'ana', video: '1' },
  dataOnly: true,
  channel: 'calls',
  actionCategory: 'call',
  ios: { sound: 'ring.wav', interruptionLevel: 'time-sensitive' as const },
  ttlSeconds: 45,
};

describe('mensagens do FCM e do Web Push', () => {
  it('sem opções novas, a mensagem fica exatamente como sempre foi', () => {
    expect(buildFcmMessage('tok', { title: 'Zé', body: 'enviou-te uma mensagem', url: '/messages/ze', tag: 'chat:1' })).toEqual({
      token: 'tok',
      notification: { title: 'Zé', body: 'enviou-te uma mensagem' },
      data: { url: '/messages/ze', tag: 'chat:1' },
      android: { priority: 'HIGH', notification: { channel_id: 'txillapp', tag: 'chat:1' } },
    });
    expect(JSON.parse(webPushBody({ title: 'Zé', body: 'olá', url: '/x', tag: 't' }))).toEqual({ title: 'Zé', body: 'olá', url: '/x', tag: 't' });
  });

  it('chamada no Android: só dados (sem bloco notification), tudo texto, prioridade alta e validade curta', () => {
    const m = buildFcmMessage('tok', callPush, 'android');
    expect(m.notification).toBeUndefined();
    expect(m).toEqual({
      token: 'tok',
      data: { kind: 'call', callId: 'abc', caller: 'ana', video: '1', title: 'Ana Teste', message: 'Videochamada', channelId: 'calls', categoryId: 'call', tag: 'call-abc', url: '/call/abc?from=ana&video=1' },
      android: { priority: 'HIGH', ttl: '45s' },
    });
    expect(Object.values(m.data as Record<string, unknown>).every((v) => typeof v === 'string')).toBe(true);
  });

  it('nenhuma chave reservada do FCM sai em `data` (o FCM recusava a mensagem inteira com "Invalid data payload key: from")', () => {
    const reserved = (k: string) => k === 'from' || k === 'message_type' || k === 'collapse_key' || /^(google|gcm)/i.test(k);
    for (const platform of ['android', 'ios'] as const) {
      for (const push of [callPush, { ...callPush, dataOnly: false }, { title: 'x', body: 'y', url: '/z', data: { from: 'rui', 'google.x': '1', gcm_y: '2', message_type: 't', kind: 'missed_call' } }]) {
        const data = buildFcmMessage('tok', push, platform).data as Record<string, string>;
        expect(Object.keys(data).filter(reserved)).toEqual([]);
      }
    }
    expect(fcmData({ from: 'ana', kind: 'call', 'google.sent_time': '1' })).toEqual({ caller: 'ana', kind: 'call' });
  });

  it('só um código de aparelho morto apaga o aparelho; um erro no conteúdo não', () => {
    expect(fcmTokenIsDead(404, '{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}')).toBe(true);
    expect(fcmTokenIsDead(400, '{"error":{"status":"INVALID_ARGUMENT","message":"The registration token is not a valid FCM registration token"}}')).toBe(true);
    expect(fcmTokenIsDead(400, '{"error":{"code":400,"message":"Invalid data payload key: from","status":"INVALID_ARGUMENT"}}')).toBe(false);
    expect(fcmTokenIsDead(403, '{"error":{"status":"PERMISSION_DENIED"}}')).toBe(false);
  });

  it('chamada no iPhone: notificação com categoria, som de toque e nível time-sensitive', () => {
    const m = buildFcmMessage('tok', callPush, 'ios') as { notification: unknown; apns: { headers: Record<string, string>; payload: { aps: Record<string, string> } } };
    expect(m.notification).toEqual({ title: 'Ana Teste', body: 'Videochamada' });
    expect(m.apns.payload.aps).toEqual({ category: 'call', sound: 'ring.wav', 'interruption-level': 'time-sensitive' });
    expect(m.apns.headers['apns-priority']).toBe('10');
    expect(Number(m.apns.headers['apns-expiration'])).toBeGreaterThan(Date.now() / 1000);
  });

  it('Web Push da chamada: os campos ficam ao nível de cima', () => {
    expect(JSON.parse(webPushBody(callPush))).toEqual({ kind: 'call', callId: 'abc', from: 'ana', video: '1', title: 'Ana Teste', body: 'Videochamada', url: '/call/abc?from=ana&video=1', tag: 'call-abc' });
  });

  it('o envio usa o mesmo formato (com o FCM simulado)', async () => {
    const { privateKey } = await generateKeyPair('RS256', { extractable: true });
    const sender = new FcmSender(JSON.stringify({ project_id: 'p', client_email: 'x@p.iam', private_key: await exportPKCS8(privateKey) }));
    const bodies: unknown[] = [];
    const spy = jest.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      if (String(url).includes('oauth2')) return new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200 });
      bodies.push(JSON.parse(String(init!.body)));
      return new Response('{}', { status: 200 });
    });
    try {
      expect(await sender.send('tok', callPush, 'android')).toBe('ok');
      expect(await sender.send('tok', { title: 'Zé', body: 'olá', url: '/x' })).toBe('ok');
      expect(bodies[0]).toEqual({ message: buildFcmMessage('tok', callPush, 'android') });
      expect((bodies[1] as { message: { notification: unknown } }).message.notification).toEqual({ title: 'Zé', body: 'olá' });
    } finally {
      spy.mockRestore();
    }
  });
});
