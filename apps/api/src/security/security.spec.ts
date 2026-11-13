import { HashGate } from './hash-gate';
import { isDisposableEmail } from './disposable';
import { generatedNameSignals } from './names';
import { canonicalEmail, clientIp, fingerprint, ipParts, isInternalIp, netPrints } from './net';

describe('segurança: peças sem base de dados', () => {
  it('o IP do pedido, a rede (/24 e /48) e os IP internos que não contam', () => {
    expect(clientIp('::ffff:41.220.10.7')).toBe('41.220.10.7');
    expect(clientIp('lixo')).toBeNull();
    expect(ipParts('41.220.10.7')).toEqual({ ip: '41.220.10.7', net: '41.220.10.0/24' });
    expect(ipParts('2c0f:fe38:2001:1a2b:aaaa::1')).toEqual({ ip: '2c0f:fe38:2001:1a2b::/64', net: '2c0f:fe38:2001::/48' });
    expect(ipParts('2001:db8::1').net).toBe('2001:0db8:0000::/48');
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.5', '192.168.1.1', '::1', 'fd00::1']) expect(isInternalIp(ip)).toBe(true);
    for (const ip of ['41.220.10.7', '172.32.0.1', '2c0f:fe38::1']) expect(isInternalIp(ip)).toBe(false);
    // Internos e desconhecidos: sem impressões (não contam para os limites por IP).
    expect(netPrints('sal', '::ffff:127.0.0.1')).toBeNull();
    expect(netPrints('sal', undefined)).toBeNull();
    const a = netPrints('sal', '41.220.10.7')!;
    const b = netPrints('sal', '41.220.10.99')!;
    expect(a.ip).not.toBe(b.ip);
    expect(a.net).toBe(b.net); // a mesma /24
    expect(a.ip).toMatch(/^[0-9a-f]{32}$/);
    expect(a.ip).not.toContain('41.220'); // nunca o IP em si
    expect(fingerprint('outro-sal', 'ip', '41.220.10.7')).not.toBe(a.ip);
  });

  it('o email «canónico»: +qualquercoisa e os pontos do Gmail', () => {
    expect(canonicalEmail('Ana.Maria+txill1@GMail.com')).toBe('anamaria@gmail.com');
    expect(canonicalEmail('a.n.a@googlemail.com')).toBe('ana@gmail.com');
    expect(canonicalEmail('jose.silva+2@empresa.co.mz')).toBe('jose.silva@empresa.co.mz');
  });

  it('emails temporários (lista local), também em subdomínios', () => {
    expect(isDisposableEmail('x@mailinator.com')).toBe(true);
    expect(isDisposableEmail('x@abc.mailinator.com')).toBe(true);
    expect(isDisposableEmail('x@YOPMAIL.com')).toBe(true);
    expect(isDisposableEmail('x@gmail.com')).toBe(false);
    expect(isDisposableEmail('x@tvcabo.co.mz')).toBe(false);
    expect(isDisposableEmail('sem-arroba')).toBe(false);
  });

  it('nomes com cara de gerado valem poucos pontos; nomes normais, nenhum', () => {
    expect(generatedNameSignals('ana_maputo', 'Ana Sitoe', 'ana.sitoe@gmail.com').points).toBe(0);
    expect(generatedNameSignals('dj_tito2009', 'DJ Tito', 'tito@gmail.com').points).toBe(0); // um ano no @ é normal
    expect(generatedNameSignals('user84736251', 'user84736251', 'qx84736251@x.com').points).toBe(20);
    expect(generatedNameSignals('xkqzrtvw', 'Xkqzrtvw', 'a@b.com').points).toBe(20);
    expect(generatedNameSignals('tkrzvbq', 'Joana', 'joana@gmail.com').points).toBe(8);
    expect(generatedNameSignals('a8k2m9p4', 'Joana', 'joana@gmail.com').points).toBe(20); // muitos números e às voltas
  });

  it('semáforo dos hashes: no máximo N ao mesmo tempo; com a fila cheia responde logo 503', async () => {
    const gate = new HashGate(2, 1, 5_000);
    const release: (() => void)[] = [];
    const slow = () => gate.run(() => new Promise<string>((r) => release.push(() => r('ok'))));
    const a = slow();
    const b = slow();
    const c = slow(); // à espera
    await new Promise((r) => setImmediate(r));
    expect(gate.stats).toEqual({ running: 2, waiting: 1 });
    // Fila cheia: o seguinte nem espera (e não corre nada).
    let ran = false;
    await expect(gate.run(async () => { ran = true; })).rejects.toMatchObject({ status: 503 });
    expect(ran).toBe(false);
    release.shift()!();
    await a;
    await new Promise((r) => setImmediate(r));
    expect(gate.stats).toEqual({ running: 2, waiting: 0 }); // o que esperava passou a correr
    release.shift()!();
    release.shift()!();
    await Promise.all([b, c]);
    expect(gate.stats).toEqual({ running: 0, waiting: 0 });
    // Quem espera demais desiste com 503.
    const g2 = new HashGate(1, 5, 30);
    const hold = g2.run(() => new Promise((r) => setTimeout(r, 200)));
    await expect(g2.run(async () => 'x')).rejects.toMatchObject({ status: 503 });
    await hold;
  });
});
