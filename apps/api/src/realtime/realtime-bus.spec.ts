import Redis from 'ioredis';
import { MemoryRealtimeBus, RealtimeBus, RedisRealtimeBus } from './realtime-bus';

/**
 * O RealtimeBus nas duas versões, com os mesmos testes (docs/escala.md, «Tempo real»).
 * A versão Redis só corre com TEST_REDIS_URL (ex.: redis://localhost:6380 com `docker run -d --name t-redis -p 6380:6379 redis:7-alpine`).
 */
const REDIS = process.env.TEST_REDIS_URL;
const tick = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const uid = () => `u-${Math.random().toString(36).slice(2, 10)}`;

function contract(name: string, make: () => Promise<{ a: RealtimeBus; b: RealtimeBus; done: () => Promise<void> }>, settle: () => Promise<unknown>) {
  describe(name, () => {
    let a: RealtimeBus;
    let b: RealtimeBus;
    let done: () => Promise<void>;
    beforeEach(async () => ({ a, b, done } = await make()));
    afterEach(async () => done());

    it('entrega logo os eventos às ligações da mesma instância (síncrono) e só a quem são', () => {
      const x = uid();
      const got: unknown[] = [];
      const off = a.subscribe(x, (e) => got.push(e));
      a.publish(x, { type: 'message', from: 'ana' });
      a.publish(uid(), { type: 'message', from: 'outro' });
      expect(got).toEqual([{ type: 'message', from: 'ana' }]);
      off();
      a.publish(x, { type: 'read' });
      expect(got).toHaveLength(1);
    });

    it('sinais com dados chegam a quem escuta (também na própria instância)', async () => {
      const got: (string | undefined)[] = [];
      const off = a.onSignal('teste.sinal', (d) => got.push(d));
      a.signal('teste.sinal', 'um');
      await settle();
      expect(got).toEqual(['um']);
      off();
    });

    it('quem está ligado: conta as ligações e diz quando fechou a última desta instância', async () => {
      const x = uid();
      expect(await a.isOnline(x)).toBe(false);
      a.connect(x);
      a.connect(x);
      expect(await a.isOnline(x)).toBe(true);
      expect(a.disconnect(x)).toBe(false);
      expect(await a.isOnline(x)).toBe(true);
      expect(a.disconnect(x)).toBe(true);
      await settle();
      expect(await a.isOnline(x)).toBe(false);
      const y = uid();
      a.connect(y);
      await settle();
      expect([...(await a.onlineAmong([x, y]))]).toEqual([y]);
      a.disconnect(y);
    });

    it('estado curto: valor com validade, «uma vez», trocar e apagar só se ainda for o meu', async () => {
      const k = `t:${uid()}`;
      await a.setFlag(k, 'v1', 60_000);
      expect(await a.getFlag(k)).toBe('v1');
      await a.delFlag(k);
      expect(await a.getFlag(k)).toBeNull();
      await a.setFlag(k, 'curto', 40);
      await tick(120);
      expect(await a.getFlag(k)).toBeNull();

      expect(await a.claimOnce(`${k}:o`, 60_000)).toBe(true);
      expect(await a.claimOnce(`${k}:o`, 60_000)).toBe(false);

      expect(await a.swap(`${k}:s`, 'primeiro', 60_000)).toBeNull();
      expect(await a.swap(`${k}:s`, 'segundo', 60_000)).toBe('primeiro');
      expect(await a.takeIf(`${k}:s`, 'primeiro')).toBe(false);
      expect(await a.takeIf(`${k}:s`, 'segundo')).toBe(true);
      expect(await a.getFlag(`${k}:s`)).toBeNull();
    });

    it('conjuntos com hora: só quem marcou dentro da janela', async () => {
      const s = `t:set:${uid()}`;
      const now = Date.now();
      await a.touch(s, 'ana', 6_000, now - 10_000);
      await a.touch(s, 'rui', 6_000, now - 1_000);
      expect((await a.recent(s, 6_000, now)).sort()).toEqual(['rui']);
      await a.touch(s, 'eva', 6_000, now);
      expect((await a.recent(s, 6_000, now)).sort()).toEqual(['eva', 'rui']);
    });

    if (name.includes('Redis')) {
      it('Redis: um evento publicado numa instância chega às ligações da outra (e não chega duas vezes)', async () => {
        const x = uid();
        const atA: unknown[] = [];
        const atB: unknown[] = [];
        a.subscribe(x, (e) => atA.push(e));
        b.subscribe(x, (e) => atB.push(e));
        a.publish(x, { n: 1 });
        b.publish(x, { n: 2 });
        await settle();
        expect(atA).toEqual([{ n: 1 }, { n: 2 }]);
        expect(atB).toEqual([{ n: 2 }, { n: 1 }]);
      });

      it('Redis: quem está ligado, a conversa à vista e os sinais valem em todas as instâncias', async () => {
        const x = uid();
        b.connect(x);
        await settle();
        expect(await a.isOnline(x)).toBe(true);
        expect([...(await a.onlineAmong([x, uid()]))]).toEqual([x]);
        b.disconnect(x);
        await settle();
        expect(await a.isOnline(x)).toBe(false);

        await b.setFlag(`t:act:${x}`, 'u:ana', 45_000);
        expect(await a.getFlag(`t:act:${x}`)).toBe('u:ana');

        const got: (string | undefined)[] = [];
        b.onSignal('teste.kick', (d) => got.push(d));
        a.signal('teste.kick', 'job-1');
        await settle();
        expect(got).toEqual(['job-1']);
      });

      it('Redis: uma instância que fecha deixa de ter as pessoas dela ligadas', async () => {
        const x = uid();
        b.connect(x);
        await settle();
        expect(await a.isOnline(x)).toBe(true);
        await b.close();
        expect(await a.isOnline(x)).toBe(false);
      });
    }
  });
}

contract(
  'RealtimeBus em memória',
  async () => {
    const a = new MemoryRealtimeBus();
    return { a, b: a, done: async () => a.close() };
  },
  () => tick(0),
);

(REDIS ? contract : (n: string) => describe.skip(n, () => it('precisa de TEST_REDIS_URL', () => undefined)))(
  'RealtimeBus no Redis',
  async () => {
    const conns = [new Redis(REDIS!), new Redis(REDIS!), new Redis(REDIS!), new Redis(REDIS!)];
    const a = new RedisRealtimeBus(conns[0], conns[1]);
    const b = new RedisRealtimeBus(conns[2], conns[3]);
    await tick(200); // as duas subscrições ficam prontas
    return {
      a,
      b,
      done: async () => {
        await a.close();
        await b.close();
        for (const c of conns) await c.quit().catch(() => c.disconnect());
      },
    };
  },
  () => tick(150),
);

describe('RealtimeBus no Redis, com o Redis em baixo', () => {
  it('não falha: cai para a memória desta instância (eventos locais, estado local)', async () => {
    // Uma porta onde não há Redis: os comandos falham logo (sem fila de espera).
    const cmd = new Redis('redis://127.0.0.1:1', { enableOfflineQueue: false, maxRetriesPerRequest: 0, retryStrategy: () => null, lazyConnect: true });
    const sub = new Redis('redis://127.0.0.1:1', { maxRetriesPerRequest: 0, retryStrategy: () => null, lazyConnect: true });
    cmd.on('error', () => undefined);
    sub.on('error', () => undefined);
    const bus = new RedisRealtimeBus(cmd, sub);
    const x = uid();
    const got: unknown[] = [];
    bus.subscribe(x, (e) => got.push(e));
    bus.publish(x, { ok: true });
    expect(got).toEqual([{ ok: true }]);
    bus.connect(x);
    expect(await bus.isOnline(x)).toBe(true);
    await bus.setFlag('k', 'v', 10_000);
    expect(await bus.getFlag('k')).toBe('v');
    expect(await bus.claimOnce('o', 10_000)).toBe(true);
    expect(await bus.claimOnce('o', 10_000)).toBe(false);
    await bus.touch('s', 'ana', 6_000);
    expect(await bus.recent('s', 6_000)).toEqual(['ana']);
    bus.disconnect(x);
    await bus.close();
    cmd.disconnect();
    sub.disconnect();
  });
});
