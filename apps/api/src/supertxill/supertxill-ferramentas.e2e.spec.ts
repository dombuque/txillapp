import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { getStorageToken } from '@nestjs/throttler';
import request from 'supertest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { uuidv7 } from '../common/uuid7';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { TextFilter } from '../safety/text-filter.service';
import { MSG, systemPrompt } from './constants';
import { OllamaChatRequest, OllamaChatResponse, OllamaError, ollamaClient, visiblePartial } from './ollama';
import { MAX_REPLY, MAX_TOOL_CALLS, NUM_PREDICT, SuperTxillService } from './supertxill.service';
import { SuperTxillTools, TOOLS, guessTools } from './supertxill.tools';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';

interface U { token: string; id: string; username: string }
type Out = Record<string, any>;

/**
 * O SuperTxill com o Ollama e as ferramentas (integração, modelo simulado): o `chat` (o pedido ao Ollama) é trocado por um
 * guião que pede ferramentas; as ferramentas correm a sério contra a base, como a pessoa, e só com o que ela pode ver.
 */
describe('SuperTxill com ferramentas: só o que a pessoa vê, limites, fila, tempo máximo e filtro (integração, Ollama simulado)', () => {
  let app: INestApplication;
  let pool: Pool;
  let bot: SuperTxillService;
  let tools: SuperTxillTools;
  const run = Date.now().toString(36);
  let n = 0;
  const api = () => request(app.getHttpServer());
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });
  // Um sítio ao calhas no meio do Pacífico Sul, para não chocar com dados de outras corridas.
  const C = { lat: Math.round((-55 + Math.random() * 30) * 100) / 100, lng: Math.round((-150 + Math.random() * 40) * 100) / 100 };
  const forYou = (u: string) => bot.forYou(u, 8);
  const tool = (x: U, name: string, args: Record<string, unknown> = {}) => tools.run(x.id, name, args, { forYou }) as Promise<Out>;

  const thread = async (x: U) => (await pool.query('SELECT role, body FROM social.ai_messages WHERE user_id = $1 ORDER BY id', [x.id])).rows as { role: string; body: string }[];
  const waitFor = async (x: U, count: number, tries = 60) => {
    for (let i = 0; i < tries; i++) {
      const t = await thread(x);
      if (t.length >= count) return t;
      await new Promise((r) => setTimeout(r, 100));
    }
    return thread(x);
  };
  const resetThrottle = () => {
    const s = app.get(getStorageToken()) as { storage: Map<string, unknown>; hitExpirations?: Map<string, unknown> };
    s.storage.clear();
    s.hitExpirations?.clear();
  };
  async function signup(name: string, birthDate = '1990-06-15'): Promise<U> {
    const username = `${name}${run}${n++}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').set('X-Forwarded-For', `10.7.0.${(n % 250) + 1}`).send({ email: `${username}@example.com`, username, displayName: `${name} Teste`, password: 'password-bem-longa-1', birthDate, acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const follow = (a: U, b: U) => pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [a.id, b.id]);
  const mutual = async (a: U, b: U) => { await follow(a, b); await follow(b, a); };
  const block = (a: U, b: U) => pool.query('INSERT INTO social.blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [a.id, b.id]);
  /** Aparecer no mapa (como na app: ligar e mandar a posição). */
  async function appear(x: U, dLat: number, visibility: 'mutual' | 'following' = 'mutual') {
    resetThrottle();
    await api().put('/api/v1/nearby/settings').set(auth(x)).send({ visibility }).expect(200);
    await api().post('/api/v1/nearby/presence').set(auth(x)).send({ lat: C.lat + dLat, lng: C.lng }).expect(200);
  }
  async function venue(key: string, dLat: number, owner: U, extra: { review?: string; onMap?: boolean; kind?: string } = {}) {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO content.venues (id, slug, name, kind, lat, lng, owner_id, check_token, review_status, show_on_map) VALUES ($1, $2, $3, $4, $5, $6, $7, 'x', $8, $9)`,
      [id, `sx-${key}-${run}`, `Sítio ${key} ${run}`, extra.kind ?? 'bar', Math.round((C.lat + dLat) * 1000) / 1000, C.lng, owner.id, extra.review ?? 'approved', extra.onMap ?? true],
    );
    return id;
  }
  async function live(host: U, audience: 'everyone' | 'followers' | 'close', title: string) {
    await pool.query(`INSERT INTO content.txilladas (id, host_id, title, audience, room, viewers) VALUES ($1, $2, $3, $4, $5, 3)`, [randomUUID(), host.id, title, audience, `sx-${randomUUID()}`]);
  }
  async function taste(x: U, name: string, favorite = true) {
    const id = randomUUID();
    await pool.query(`INSERT INTO taste.items (id, slug, name, kind, category) VALUES ($1, $2, $3, 'comida', 'prato')`, [id, `sx-${id}`, name]);
    await pool.query('INSERT INTO taste.user_items (user_id, item_id, favorite) VALUES ($1, $2, $3)', [x.id, id, favorite]);
  }

  /** O guião do modelo: pede estas ferramentas (uma de cada vez) e no fim responde. Guarda os pedidos que recebeu. */
  function script(calls: { name: string; args?: Record<string, unknown> }[], final: string | ((req: OllamaChatRequest) => string) = 'Feito.') {
    const seen: OllamaChatRequest[] = [];
    bot.chat = async (req) => {
      seen.push(JSON.parse(JSON.stringify(req)) as OllamaChatRequest);
      const done = req.messages.filter((m) => m.role === 'tool').length;
      if (req.tools && done < calls.length) {
        const c = calls[done];
        return { done: true, message: { role: 'assistant', content: '', tool_calls: [{ function: { name: c.name, arguments: c.args ?? {} } }] } } satisfies OllamaChatResponse;
      }
      return { done: true, message: { role: 'assistant', content: typeof final === 'function' ? final(req) : final, thinking: 'a pensar em segredo' } };
    };
    return seen;
  }
  /** Espera até a última resposta estar pronta (já não `writing`). */
  const waitDone = async (x: U, count: number, tries = 80) => {
    for (let i = 0; i < tries; i++) {
      const t = (await pool.query('SELECT role, body, writing FROM social.ai_messages WHERE user_id = $1 ORDER BY id', [x.id])).rows as { role: string; body: string; writing: boolean }[];
      if (t.length >= count && !t[t.length - 1].writing) return t;
      await new Promise((r) => setTimeout(r, 100));
    }
    return thread(x);
  };

  /**
   * Um Ollama falso a sério (HTTP local): responde a POST /api/chat em stream (NDJSON), aos pedaços, devagar, como o nosso
   * servidor em CPU. `fakePlan(req)` diz o que escrever: pedaços de texto, chamadas de ferramentas, e se no fim acaba, fica
   * pendurado (até o pedido ser cancelado) ou manda um erro a meio.
   */
  type Plan = { pieces?: string[]; toolCalls?: { name: string; args?: Record<string, unknown> }[]; gap?: number; end?: 'done' | 'hang' | 'error' };
  let fakePlan: (req: OllamaChatRequest) => Plan = () => ({ pieces: ['ok'] });
  const fakeSeen: (OllamaChatRequest & { stream?: boolean })[] = [];
  let fake: Server;
  let fakeUrl = '';
  const startFake = () =>
    new Promise<void>((resolve) => {
      fake = createServer((req, res) => {
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', async () => {
          const body = JSON.parse(raw) as OllamaChatRequest & { stream?: boolean };
          fakeSeen.push(body);
          const p = fakePlan(body);
          res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
          let open = true;
          res.on('close', () => (open = false));
          const send = (o: unknown) => open && res.write(`${JSON.stringify(o)}\n`);
          for (const piece of p.pieces ?? []) {
            await new Promise((r) => setTimeout(r, p.gap ?? 150));
            send({ model: body.model, message: { role: 'assistant', content: piece }, done: false });
          }
          if (p.toolCalls?.length) send({ message: { role: 'assistant', content: '', tool_calls: p.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.args ?? {} } })) }, done: false });
          if (p.end === 'hang') return; // fica à espera até o pedido ser cancelado
          if (p.end === 'error') return void (open && res.end(`${JSON.stringify({ error: 'rebentou a meio' })}\n`));
          send({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', eval_count: 9 });
          res.end();
        });
      }).listen(0, '127.0.0.1', () => {
        fakeUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
        resolve();
      });
    });
  /** Pergunta e vai lendo o GET /supertxill (como a app) até a resposta ficar pronta. Devolve o que se viu pelo caminho. */
  const askWatching = async (x: U, text: string) => {
    const before = (await thread(x)).length;
    resetThrottle();
    await api().post('/api/v1/supertxill/ask').set(auth(x)).send({ text }).expect(201);
    const seen: { pending: boolean; last: { role: string; body: string; writing: boolean } }[] = [];
    for (let i = 0; i < 120; i++) {
      resetThrottle();
      const g = (await api().get('/api/v1/supertxill').set(auth(x)).expect(200)).body as { pending: boolean; messages: { role: string; body: string; writing: boolean }[] };
      seen.push({ pending: g.pending, last: g.messages[g.messages.length - 1] });
      if (g.messages.length >= before + 2 && !g.pending) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    return seen;
  };

  const ask = async (x: U, text: string) => {
    const before = (await thread(x)).length;
    resetThrottle();
    await api().post('/api/v1/supertxill/ask').set(auth(x)).send({ text }).expect(201);
    const t = await waitFor(x, before + 2);
    return t[t.length - 1];
  };

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(
      loadConfig({
        DATABASE_URL: DB, JWT_ACCESS_SECRET: 'f'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test',
        OLLAMA_URL: 'http://ollama.invalid:11434', OLLAMA_MODEL: 'modelo-teste', SUPERTXILL_DAILY_LIMIT: '200', SUPERTXILL_TIMEOUT_MS: '1500', SUPERTXILL_CONCURRENCY: '1',
        OLLAMA_THINK: 'on', OLLAMA_NUM_THREAD: '3',
      }),
    );
    await app.init();
    bot = app.get(SuperTxillService);
    tools = app.get(SuperTxillTools);
    await startFake();
  }, 60_000);

  afterAll(async () => {
    fake.closeAllConnections();
    await new Promise((r) => fake.close(r));
    await app.close();
    await pool.end();
  });

  it('quem responde: ollama com OLLAMA_URL; a Anthropic só com SUPERTXILL_PROVIDER=anthropic; senão desligado; SUPERTXILL_PROVIDER manda', () => {
    const make = (env: Record<string, string>) => new SuperTxillService(pool, loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'f'.repeat(40), ...env }), app.get(TextFilter), tools).provider;
    expect(bot.provider).toBe('ollama');
    expect(make({})).toBe('off');
    expect(make({ ANTHROPIC_API_KEY: 'x'.repeat(30) })).toBe('off'); // a Anthropic só de propósito
    expect(make({ ANTHROPIC_API_KEY: 'x'.repeat(30), OLLAMA_URL: 'http://o:11434' })).toBe('ollama');
    expect(make({ ANTHROPIC_API_KEY: 'x'.repeat(30), OLLAMA_URL: 'http://o:11434', SUPERTXILL_PROVIDER: 'anthropic' })).toBe('anthropic');
    expect(make({ OLLAMA_URL: 'http://o:11434', SUPERTXILL_PROVIDER: 'off' })).toBe('off');
    expect(make({ SUPERTXILL_PROVIDER: 'ollama' })).toBe('off');
    expect(() => loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'f'.repeat(40), SUPERTXILL_PROVIDER: 'gpt' })).toThrow(/SUPERTXILL_PROVIDER/);
    // Por omissão: sem raciocínio à parte (em CPU gera minutos de texto), 90 s, 1 de cada vez.
    const d = loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'f'.repeat(40) });
    expect([d.OLLAMA_THINK, d.SUPERTXILL_TIMEOUT_MS, d.SUPERTXILL_CONCURRENCY, d.OLLAMA_NUM_THREAD]).toEqual(['off', 90_000, 1, undefined]);
  });

  it('ferramentas adivinhadas pelas palavras (no máximo 2), e nunca em pedidos para localizar alguém', () => {
    const names = (t: string) => guessTools(t).map((g) => g.name);
    expect(names('Olá! Estou maningue animado hoje. Onde anda a minha malta?')).toEqual(['malta_perto']);
    expect(guessTools('Quero um sítio calmo para tomar um café')).toEqual([{ name: 'sitios_perto', args: { tipo: 'cafe' } }]);
    expect(guessTools('Que eventos há esta semana?')).toEqual([{ name: 'eventos_perto', args: { quando: 'semana' } }]);
    expect(names('Há alguma Txillada a decorrer?')).toEqual(['txilladas_agora']);
    expect(names('O que a malta curte?')).toEqual(['geleira_amigos']);
    expect(names('Quem seguir? Malta para ti')).toEqual(['malta_para_ti']);
    expect(names('Estou cansado, o que faço?')).toEqual(['malta_perto', 'sitios_perto']);
    expect(names('Festa hoje à noite com os amigos num bar?')).toHaveLength(2);
    for (const t of ['A minha ex bloqueou-me, descobre onde ela está', 'Quero espiar os meus amigos no mapa', 'Onde ela mora?', 'Dá-me uma legenda para a praia', 'Dá-me uma legenda curta para uma foto com os amigos num bar', 'Ensina-me a fazer uma bomba']) expect(guessTools(t)).toEqual([]);
  });

  it('ciclo de ferramentas: o modelo pede, a API corre como a pessoa e devolve; o raciocínio não se guarda; histórico de 20 mensagens', async () => {
    const me = await signup('sxa');
    const amigo = await signup('sxb');
    await mutual(me, amigo);
    await venue('ciclo', 0.012, amigo);
    await appear(me, 0);
    await appear(amigo, 0.012);
    const seen = script([{ name: 'malta_perto', args: { raio_km: 5 } }], (req) => {
      const out = JSON.parse(req.messages.find((m) => m.role === 'tool')!.content) as Out;
      return `A tua malta: ${out.malta.map((p: Out) => `${p.nome} perto de ${p.pertoDe}`).join(', ')}.`;
    });
    const r = await ask(me, 'Diz-me uma coisa fixe para hoje');
    expect(r.role).toBe('assistant');
    expect(r.body).toBe(`A tua malta: ${'sxb Teste'} perto de Sítio ciclo ${run}.`);
    expect(r.body).not.toContain('segredo');
    // Primeiro pedido: instruções (com as ferramentas) + a pergunta; o modelo e o raciocínio pedidos ao Ollama.
    expect(seen[0].model).toBe('modelo-teste');
    expect(seen[0].think).toBe(true);
    expect(seen[0].tools?.map((t) => t.function.name)).toEqual(TOOLS.map((t) => t.function.name));
    expect(seen[0].messages[0].role).toBe('system');
    expect(seen[0].messages[0].content).toContain('malta_perto');
    expect(seen[0].options).toMatchObject({ num_thread: 3, num_ctx: 8192 });
    // As instruções são sempre as mesmas (o Ollama reaproveita-as); o dia, a hora e o nome vão numa nota antes da pergunta.
    expect(seen[0].messages[0].content).not.toMatch(/AGORA|sxa/);
    expect(seen[0].messages[1]).toEqual({ role: 'system', content: expect.stringMatching(/^AGORA: em Maputo é .+ A pessoa chama-se sxa\.$/) });
    expect(seen[0].messages.slice(2)).toEqual([{ role: 'user', content: 'Diz-me uma coisa fixe para hoje' }]);
    // Todos os pedidos levam as ferramentas e começam igual.
    expect(seen[1].tools?.length).toBe(TOOLS.length);
    expect(seen[1].messages[0]).toEqual(seen[0].messages[0]);
    // Segundo pedido: a chamada e o resultado da ferramenta, sem coordenadas.
    const toolMsg = seen[1].messages.find((m) => m.role === 'tool')!;
    expect(toolMsg.tool_name).toBe('malta_perto');
    expect(toolMsg.content).not.toMatch(/"lat"|"lng"|cell/);
    // Pergunta que pede de certeza a malta perto: a API corre a ferramenta logo e o modelo responde numa só volta.
    const seenP = script([], (req) => {
      const out = JSON.parse(req.messages.find((m) => m.role === 'tool')!.content) as Out;
      return `Já vi: ${out.malta.map((p: Out) => p.nome).join(', ')}.`;
    });
    expect((await ask(me, 'Estou animado, onde anda a minha malta?')).body).toBe('Já vi: sxb Teste.');
    expect(seenP.length).toBe(1);
    expect(seenP[0].messages.slice(-3)).toEqual([
      { role: 'user', content: 'Estou animado, onde anda a minha malta?' },
      { role: 'assistant', content: '', tool_calls: [{ function: { name: 'malta_perto', arguments: {} } }] },
      { role: 'tool', tool_name: 'malta_perto', content: expect.stringContaining('"malta":[{"nome":"sxb Teste"') },
    ]);
    // Histórico: o modelo lê as últimas 20 mensagens (a começar numa da pessoa).
    for (let g = 1; g <= 30; g++) await pool.query('INSERT INTO social.ai_messages (id, user_id, role, body) VALUES ($1, $2, $3, $4)', [uuidv7(), me.id, g % 2 ? 'user' : 'assistant', `msg ${g}`]);
    const seen2 = script([], 'ok');
    await ask(me, 'e agora?');
    expect(seen2[0].messages.length - 2).toBeLessThanOrEqual(20);
    expect(seen2[0].messages[1].role).toBe('user');
    expect(seen2[0].messages[seen2[0].messages.length - 1]).toEqual({ role: 'user', content: 'e agora?' });
  });

  it('malta perto: só quem aceitou aparecer e me deixa ver; bloqueios, mapa desligado e menores ficam fora; nunca coordenadas', async () => {
    const me = await signup('sxm');
    const ok = await signup('sxok'); // segue de volta, mutual
    const segue = await signup('sxsg'); // segue-me, 'following' (deixa quem ela segue ver, mesmo sem eu seguir)
    const soEu = await signup('sxse'); // eu sigo, não me segue: não me deixa ver
    const off = await signup('sxof'); // mútuo, mas desligou o mapa
    const bloq = await signup('sxbl'); // mútuo, mas bloqueado
    const longe = await signup('sxlg'); // mútuo, a ~22 km
    await mutual(me, ok);
    await follow(segue, me);
    await follow(me, soEu);
    await mutual(me, off);
    await mutual(me, bloq);
    await mutual(me, longe);
    await appear(me, 0);
    await appear(ok, 0.01);
    await appear(segue, 0.02, 'following');
    await appear(soEu, 0.01, 'following');
    await appear(off, 0.01);
    await api().put('/api/v1/nearby/settings').set(auth(off)).send({ visibility: 'off' }).expect(200);
    await appear(bloq, 0.01);
    await block(bloq, me);
    await appear(longe, 0.2);
    const out = await tool(me, 'malta_perto', { raio_km: 10 });
    const names = (out.malta as Out[]).map((p) => p.username);
    expect(names.sort()).toEqual([ok.username, segue.username].sort());
    expect(out.centro).toMatch(/última posição no «À tua volta»/);
    expect(JSON.stringify(out)).not.toMatch(/"lat"|"lng"|\d+\.\d{3,}/);
    expect((out.malta as Out[])[0]).toEqual(expect.objectContaining({ distanciaKm: expect.any(Number), vistoNoMapa: expect.any(String) }));
    // Raio maior apanha quem está longe; o raio fica entre 1 e 30.
    expect(((await tool(me, 'malta_perto', { raio_km: 50 })).malta as Out[]).map((p) => p.username)).toContain(longe.username);
    expect((await tool(me, 'malta_perto', { raio_km: 500 })).raioKm).toBe(30);
    // Menor: não vê ninguém no mapa (as mesmas regras do «À tua volta»).
    const menor = await signup('sxmn', `${new Date().getUTCFullYear() - 16}-01-01`);
    await mutual(menor, ok);
    await pool.query("UPDATE identity.users SET city = 'Maputo' WHERE id = $1", [menor.id]);
    expect((await tool(menor, 'malta_perto')).malta).toEqual([]);
  });

  it('localização: a última do «À tua volta»; senão a cidade do perfil; senão diz que não sabe (nunca pede GPS)', async () => {
    const x = await signup('sxl');
    const owner = await signup('sxlo');
    const semNada = await tool(x, 'sitios_perto');
    expect(semNada.erro).toBe('sem_localizacao');
    expect(semNada.dica).toMatch(/Aparecer no mapa/);
    // Cidade do perfil com locais aprovados: o centro desses locais.
    const cidade = `Vila${run}`;
    const v = await venue('cidade', 0.003, owner);
    await pool.query('UPDATE content.venues SET city = $1 WHERE id = $2', [cidade, v]);
    await pool.query('UPDATE identity.users SET city = $1 WHERE id = $2', [cidade, x.id]);
    const porCidade = await tool(x, 'sitios_perto', { raio_km: 3 });
    expect(porCidade.centro).toBe(`pela cidade do teu perfil (${cidade})`);
    expect((porCidade.locais as Out[]).map((l) => l.nome)).toContain(`Sítio cidade ${run}`);
    // Cidade conhecida de Moçambique, sem locais no mapa: o centro aproximado da cidade.
    await pool.query("UPDATE identity.users SET city = 'Nampula' WHERE id = $1", [x.id]);
    expect((await tool(x, 'eventos_perto')).centro).toBe('pela cidade do teu perfil (Nampula)');
    // A posição partilhada ganha à cidade; quando a pessoa desliga o mapa, volta à cidade.
    await appear(x, 0);
    expect((await tool(x, 'sitios_perto')).centro).toMatch(/última posição/);
    await api().put('/api/v1/nearby/settings').set(auth(x)).send({ visibility: 'off' }).expect(200);
    expect((await tool(x, 'sitios_perto')).centro).toBe('pela cidade do teu perfil (Nampula)');
  });

  it('sítios e eventos perto: só locais aprovados e no mapa, eventos não cancelados; check-ins de hoje; por tipo; procurar por nome', async () => {
    const me = await signup('sxv');
    const dono = await signup('sxvd');
    await appear(me, 0);
    const bar = await venue('bar', 0.01, dono);
    await venue('cafe', 0.015, dono, { kind: 'cafe' });
    await venue('pendente', 0.01, dono, { review: 'pending' });
    await venue('escondido', 0.01, dono, { onMap: false });
    const vv = await signup('sxvc');
    await pool.query('INSERT INTO content.checkins (id, venue_id, user_id) VALUES ($1, $2, $3)', [randomUUID(), bar, vv.id]);
    const out = await tool(me, 'sitios_perto', { raio_km: 5 });
    const mine = (out.locais as Out[]).filter((l) => String(l.nome).endsWith(run));
    const nomes = mine.map((l) => l.nome);
    expect(nomes).toEqual(expect.arrayContaining([`Sítio bar ${run}`, `Sítio cafe ${run}`]));
    expect(nomes).not.toContain(`Sítio pendente ${run}`);
    expect(nomes).not.toContain(`Sítio escondido ${run}`);
    expect(mine.find((l) => l.nome === `Sítio bar ${run}`)!.checkinsHoje).toBe(1);
    expect(JSON.stringify(out)).not.toMatch(/"lat"|"lng"/);
    expect(((await tool(me, 'sitios_perto', { tipo: 'cafe', raio_km: 5 })).locais as Out[]).filter((l) => String(l.nome).endsWith(run)).map((l) => l.nome)).toEqual([`Sítio cafe ${run}`]);
    // Eventos: hoje, a decorrer; o cancelado não aparece.
    await pool.query(`INSERT INTO content.venue_events (id, venue_id, title, starts_at) VALUES ($1, $2, $3, now() - interval '10 minutes')`, [randomUUID(), bar, `Noite ${run}`]);
    await pool.query(`INSERT INTO content.venue_events (id, venue_id, title, starts_at, cancelled_at) VALUES ($1, $2, $3, now(), now())`, [randomUUID(), bar, `Cancelado ${run}`]);
    const ev = await tool(me, 'eventos_perto', { quando: 'agora' });
    const titles = (ev.eventos as Out[]).map((e) => e.titulo);
    expect(titles).toContain(`Noite ${run}`);
    expect(titles).not.toContain(`Cancelado ${run}`);
    expect((ev.eventos as Out[]).find((e) => e.titulo === `Noite ${run}`)).toEqual(expect.objectContaining({ local: `Sítio bar ${run}`, interessados: 0, comeca: expect.any(String) }));
    // Procurar por nome: só os aprovados.
    const found = (await tool(me, 'procurar_local', { nome: `pendente ${run}` })).locais as Out[];
    expect(found).toEqual([]);
    expect(((await tool(me, 'procurar_local', { nome: `bar ${run}` })).locais as Out[]).map((l) => l.nome)).toEqual([`Sítio bar ${run}`]);
    expect((await tool(me, 'procurar_local', { nome: 'x' })).erro).toBe('nome_curto');
  });

  it('Txilladas a decorrer: só as que posso ver (público escolhido, conta privada, amigos próximos, bloqueios)', async () => {
    const me = await signup('sxt');
    const pub = await signup('sxtp');
    const priv = await signup('sxtv');
    const privSigo = await signup('sxtw');
    const close = await signup('sxtc');
    const closeEu = await signup('sxtd');
    const bloq = await signup('sxtb');
    await pool.query('UPDATE identity.users SET is_private = true WHERE id = ANY($1)', [[priv.id, privSigo.id]]);
    await follow(me, privSigo);
    await pool.query('INSERT INTO social.close_friends (owner_id, friend_id) VALUES ($1, $2)', [closeEu.id, me.id]);
    await live(pub, 'everyone', `Pública ${run}`);
    await live(priv, 'everyone', `Privada ${run}`);
    await live(privSigo, 'everyone', `Privada que sigo ${run}`);
    await live(close, 'close', `Próximos ${run}`);
    await live(closeEu, 'close', `Próximos comigo ${run}`);
    await live(bloq, 'everyone', `Bloqueada ${run}`);
    await block(me, bloq);
    const out = await tool(me, 'txilladas_agora');
    const titles = (out.txilladas as Out[]).map((t) => t.titulo).filter((t: string) => t.endsWith(run));
    expect(titles.sort()).toEqual([`Pública ${run}`, `Privada que sigo ${run}`, `Próximos comigo ${run}`].sort());
    expect((out.txilladas as Out[]).find((t) => t.titulo === `Pública ${run}`)).toEqual(expect.objectContaining({ username: pub.username, aVer: 3 }));
  });

  it('geleira: a minha; a de outra pessoa só se ela deixa ver (conta privada, bloqueio, «só eu»); a da malta que sigo', async () => {
    const me = await signup('sxg');
    const aberta = await signup('sxga');
    const priv = await signup('sxgp');
    const soEla = await signup('sxgs');
    const bloq = await signup('sxgb');
    await taste(me, `Matapa ${run}`);
    await taste(aberta, `Xima ${run}`);
    await taste(priv, `Caril ${run}`);
    await taste(soEla, `Badjia ${run}`);
    await taste(bloq, `Rissóis ${run}`);
    await pool.query('UPDATE identity.users SET is_private = true WHERE id = $1', [priv.id]);
    await pool.query("UPDATE identity.users SET geleira_visibility = 'me' WHERE id = $1", [soEla.id]);
    for (const x of [aberta, priv, soEla, bloq]) await follow(me, x);
    await pool.query('DELETE FROM social.follows WHERE follower_id = $1 AND followee_id = $2', [me.id, priv.id]);
    await block(bloq, me);
    expect(((await tool(me, 'geleira')).itens as Out[]).map((i) => i.nome)).toEqual([`Matapa ${run}`]);
    expect(((await tool(me, 'geleira', { username: `@${aberta.username}` })).itens as Out[]).map((i) => i.nome)).toEqual([`Xima ${run}`]);
    expect(await tool(me, 'geleira', { username: priv.username })).toEqual({ erro: 'nao_encontrado' });
    expect(await tool(me, 'geleira', { username: bloq.username })).toEqual({ erro: 'nao_encontrado' });
    expect((await tool(me, 'geleira', { username: soEla.username })).itens).toEqual([]);
    const amigos = (await tool(me, 'geleira_amigos')).malta as Out[];
    expect(amigos.map((a) => a.username)).toEqual([aberta.username]);
    expect(amigos[0].gostos).toEqual([`Xima ${run}`]);
  });

  it('Malta para ti: a mesma lista do «Para ti» (sem bloqueados nem quem não aceita ser sugerido)', async () => {
    const me = await signup('sxp');
    const peer = await signup('sxpp');
    const star = await signup('sxps');
    const hidden = await signup('sxph');
    const common = await signup('sxpc');
    await follow(me, common);
    await follow(peer, common);
    await follow(peer, star);
    await follow(peer, hidden);
    await pool.query('UPDATE identity.users SET suggestable = false WHERE id = $1', [hidden.id]);
    const names = ((await tool(me, 'malta_para_ti')).pessoas as Out[]).map((p) => p.username);
    expect(names).toContain(star.username);
    expect(names).not.toContain(hidden.username);
    await block(me, star);
    expect(((await tool(me, 'malta_para_ti')).pessoas as Out[]).map((p) => p.username)).not.toContain(star.username);
    expect(await tool(me, 'apagar_tudo')).toEqual({ erro: 'ferramenta_desconhecida' });
  });

  it('limites: no máximo 4 chamadas de ferramentas por resposta, e depois responde sem ferramentas; resposta até 1500 caracteres', async () => {
    const me = await signup('sxk');
    const seen: OllamaChatRequest[] = [];
    let executed = 0;
    bot.chat = async (req) => {
      seen.push(req);
      executed = req.messages.filter((m) => m.role === 'tool').length;
      if (req.tools) return { done: true, message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'txilladas_agora', arguments: {} } }, { function: { name: 'geleira', arguments: '{"username":"ninguem"}' } }] } };
      return { done: true, message: { role: 'assistant', content: `${'Frase comprida sobre a malta. '.repeat(100)}` } };
    };
    const r = await ask(me, 'chama tudo');
    expect(executed).toBe(MAX_TOOL_CALLS);
    expect(seen[seen.length - 1].tools).toBeUndefined();
    expect(r.body.length).toBeLessThanOrEqual(MAX_REPLY);
    expect(r.body.endsWith('.')).toBe(true);
    // Limite diário continua: com 1 por dia, a segunda nem chama o modelo.
    const limited = new SuperTxillService(pool, { ...loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'f'.repeat(40), OLLAMA_URL: 'http://o:1' }), SUPERTXILL_DAILY_LIMIT: 1 }, app.get(TextFilter), tools);
    let calls = 0;
    limited.llm = async () => { calls++; return 'ok'; };
    const y = await signup('sxk2');
    await limited.ask(y.id, 'uma');
    await waitFor(y, 2);
    await limited.ask(y.id, 'duas');
    expect((await waitFor(y, 4)).map((m) => m.body)).toEqual(['uma', 'ok', 'duas', MSG.daily]);
    expect(calls).toBe(1);
  });

  it('tempo máximo: passado o tempo, cancela o pedido ao modelo e responde que demorou', async () => {
    const me = await signup('sxtm');
    let aborted = false;
    bot.chat = (_req, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('abortado'));
        });
      });
    const t0 = Date.now();
    const r = await ask(me, 'pensa muito');
    expect(r.body).toBe(MSG.timeout);
    expect(aborted).toBe(true);
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it('fila: uma resposta de cada vez (SUPERTXILL_CONCURRENCY=1), e todas chegam; «a pensar» enquanto espera', async () => {
    const xs = [await signup('sxq1'), await signup('sxq2'), await signup('sxq3')];
    let now = 0;
    let max = 0;
    bot.chat = async () => {
      now++;
      max = Math.max(max, now);
      await new Promise((r) => setTimeout(r, 300));
      now--;
      return { done: true, message: { role: 'assistant', content: 'Na fila, mas cheguei.' } };
    };
    resetThrottle();
    await Promise.all(xs.map((x) => api().post('/api/v1/supertxill/ask').set(auth(x)).send({ text: 'olá' }).expect(201)));
    const pending = (await api().get('/api/v1/supertxill').set(auth(xs[2])).expect(200)).body;
    expect(pending.pending).toBe(true);
    for (const x of xs) expect((await waitFor(x, 2)).map((m) => m.body)).toEqual(['olá', 'Na fila, mas cheguei.']);
    expect(max).toBe(1);
    expect((await api().get('/api/v1/supertxill').set(auth(xs[2])).expect(200)).body.pending).toBe(false);
  });

  it('filtro: resposta ofensiva do modelo é trocada; o raciocínio em <think> não passa; modelo sem «think» continua sem ele', async () => {
    const me = await signup('sxf');
    script([], 'vou matar-te seu filho da puta');
    expect((await ask(me, 'diz algo')).body).toBe(MSG.refused);
    script([], '<think>isto fica escondido</think>Bora ao café? 😊 Nice 🏖️!');
    expect((await ask(me, 'e agora?')).body).toBe('Bora ao café? Nice!');
    // O modelo não suporta raciocínio: o Ollama diz 400 e a API repete sem `think` (e lembra-se).
    const thinks: (boolean | undefined)[] = [];
    bot.chat = async (req) => {
      thinks.push(req.think);
      if (req.think) throw new OllamaError(400, '"modelo-teste" does not support thinking');
      return { done: true, message: { role: 'assistant', content: 'Sem pensar alto.' } };
    };
    expect((await ask(me, 'olá')).body).toBe('Sem pensar alto.');
    expect((await ask(me, 'outra')).body).toBe('Sem pensar alto.');
    expect(thinks).toEqual([true, false, false]);
    // Outros erros do Ollama: mensagem segura.
    bot.chat = async () => { throw new OllamaError(500, 'rebentou'); };
    expect((await ask(me, 'mais')).body).toBe(MSG.error);
  });

  it('o cliente do Ollama: POST /api/chat sem streaming (quando não se pede o texto a meio), com o token no Authorization, e os erros com a mensagem do Ollama', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const real = global.fetch;
    global.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (calls.length === 1) return new Response(JSON.stringify({ done: true, message: { role: 'assistant', content: 'oi' } }), { status: 200 });
      return new Response(JSON.stringify({ error: 'model not found' }), { status: 404 });
    }) as typeof fetch;
    try {
      const c = ollamaClient('https://llm.exemplo.test/', 't'.repeat(32));
      const r = await c({ model: 'm', messages: [{ role: 'user', content: 'olá' }] }, new AbortController().signal);
      expect(r.message.content).toBe('oi');
      expect(calls[0].url).toBe('https://llm.exemplo.test/api/chat');
      expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${'t'.repeat(32)}`);
      expect(JSON.parse(String(calls[0].init.body)).stream).toBe(false);
      await expect(c({ model: 'm', messages: [] }, new AbortController().signal)).rejects.toMatchObject({ status: 404, message: 'model not found' });
    } finally {
      global.fetch = real;
    }
  });

  it('o cliente do Ollama em stream: junta as linhas NDJSON (mesmo partidas a meio), entrega o texto acumulado, as ferramentas e os erros a meio', async () => {
    const real = global.fetch;
    const enc = new TextEncoder();
    const bodies = [
      ['{"message":{"role":"assistant","content":"Ol', 'á"},"done":false}\n{"message":{"role":"assistant","content":" malta"},"done":false}\n', '{"message":{"role":"assistant","content":"","tool_calls":[{"function":{"name":"geleira","arguments":{}}}]},"done":false}\n{"message":{"role":"assistant","content":""},"done":true,"done_reason":"stop"}'],
      ['{"message":{"role":"assistant","content":"Já"},"done":false}\n{"error":"sem memória"}\n'],
    ];
    let k = 0;
    const sent: string[] = [];
    global.fetch = (async (_url: string, init: RequestInit) => {
      sent.push(String(init.body));
      const parts = bodies[k++];
      return new Response(new ReadableStream({ start(c) { for (const p of parts) c.enqueue(enc.encode(p)); c.close(); } }), { status: 200 });
    }) as typeof fetch;
    try {
      const c = ollamaClient('http://ollama.test');
      const got: string[] = [];
      const r = await c({ model: 'm', messages: [] }, new AbortController().signal, (t) => got.push(t));
      expect(JSON.parse(sent[0]).stream).toBe(true);
      expect(got).toEqual(['Olá', 'Olá malta']);
      expect(r.message).toEqual({ role: 'assistant', content: 'Olá malta', tool_calls: [{ function: { name: 'geleira', arguments: {} } }] });
      expect(r.done_reason).toBe('stop');
      await expect(c({ model: 'm', messages: [] }, new AbortController().signal, () => undefined)).rejects.toMatchObject({ message: 'sem memória' });
    } finally {
      global.fetch = real;
    }
    // O que se mostra a meio: nunca o raciocínio, nem um <think> por fechar, nem o início de uma etiqueta cortada.
    expect(visiblePartial('<thi')).toBe('');
    expect(visiblePartial('<think>isto é segredo')).toBe('');
    expect(visiblePartial('<think>segredo</think>Olá malta <th')).toBe('Olá malta');
    expect(visiblePartial('segredo</think>Olá')).toBe('Olá');
    expect(visiblePartial('Bora 😊 ao café')).toBe('Bora ao café');
    expect(visiblePartial('a < b')).toBe('a < b');
  });

  describe('a escrever ao vivo (Ollama falso em stream, devagar)', () => {
    const cfg = () => (bot as unknown as { config: { SUPERTXILL_TIMEOUT_MS: number } }).config;
    let keep = 0;
    beforeEach(() => {
      keep = cfg().SUPERTXILL_TIMEOUT_MS;
      (bot as unknown as { think: boolean }).think = false;
      bot.chat = ollamaClient(fakeUrl);
      fakeSeen.length = 0;
    });
    afterEach(() => {
      cfg().SUPERTXILL_TIMEOUT_MS = keep;
    });
    const writingBodies = (seen: Awaited<ReturnType<typeof askWatching>>) => seen.filter((s) => s.last?.role === 'assistant' && s.last.writing).map((s) => s.last.body);

    it('o texto aparece no GET aos bocados antes do fim, numa só linha que cresce; no fim fica pronto; o pedido vai em stream e curto', async () => {
      cfg().SUPERTXILL_TIMEOUT_MS = 10_000;
      const me = await signup('sxw');
      const final = 'Bora txilar, malta! Hoje há maningue ambiente no Café Acácia, a dois passos de ti. Leva a tua malta e aproveita.';
      fakePlan = () => ({ pieces: `${final} 😊`.split(/(?<= )/), gap: 140 });
      const seen = await askWatching(me, 'Dá-me uma ideia para hoje');
      const partials = writingBodies(seen);
      expect(partials.length).toBeGreaterThan(0);
      for (const p of partials) {
        expect(p.length).toBeGreaterThan(0);
        expect(p.length).toBeLessThanOrEqual(final.length); // igual quando só falta o emoji que se tira no fim
        expect(final.startsWith(p)).toBe(true);
      }
      expect(new Set(partials).size).toBeGreaterThanOrEqual(2); // vai crescendo (de ~1 em ~1 s)
      expect(seen.filter((s) => s.last?.writing).every((s) => s.pending)).toBe(true); // a app continua a perguntar
      expect(seen[seen.length - 1]).toEqual({ pending: false, last: expect.objectContaining({ role: 'assistant', body: final, writing: false }) });
      expect((await thread(me)).map((m) => m.role)).toEqual(['user', 'assistant']); // atualizada, não repetida
      expect(fakeSeen[0].stream).toBe(true);
      expect(fakeSeen[0].options).toMatchObject({ num_predict: NUM_PREDICT });
      expect(NUM_PREDICT).toBeLessThanOrEqual(250);
      expect(fakeSeen[0].messages[0].content).toContain('no máximo 3 frases curtas');
    }, 30_000);

    it('com ferramentas: a volta da ferramenta não mostra nada, e o texto da resposta sai em stream', async () => {
      cfg().SUPERTXILL_TIMEOUT_MS = 10_000;
      const me = await signup('sxwt');
      fakePlan = (req) => (req.messages.some((m) => m.role === 'tool') ? { pieces: ['Não ', 'há ', 'Txilladas ', 'agora, ', 'mas ', 'a ', 'malta ', 'anda ', 'por ', 'aí.'], gap: 250 } : { toolCalls: [{ name: 'geleira' }] });
      const seen = await askWatching(me, 'Diz-me uma coisa');
      expect(fakeSeen.map((r) => r.messages.filter((m) => m.role === 'tool').length)).toEqual([0, 1]);
      expect(writingBodies(seen).length).toBeGreaterThan(0);
      expect(seen[seen.length - 1].last).toMatchObject({ body: 'Não há Txilladas agora, mas a malta anda por aí.', writing: false });
    }, 30_000);

    it('o raciocínio em <think> nunca aparece a meio; o que o filtro não deixa também não; o fim passa pelo filtro', async () => {
      cfg().SUPERTXILL_TIMEOUT_MS = 10_000;
      const me = await signup('sxwk');
      fakePlan = () => ({ pieces: ['<thi', 'nk>isto é ', 'segredo', '</thi', 'nk>', 'Olá ', 'malta. ', 'Tudo ', 'nice?'], gap: 250 });
      const seen = await askWatching(me, 'olá');
      for (const p of writingBodies(seen)) expect(p).not.toMatch(/segredo|</);
      expect(seen[seen.length - 1].last).toMatchObject({ body: 'Olá malta. Tudo nice?', writing: false });
      fakePlan = () => ({ pieces: ['Olá ', 'pessoal. ', 'vou matar-te ', 'seu filho ', 'da puta'], gap: 250 });
      const bad = await askWatching(me, 'diz algo');
      for (const p of writingBodies(bad)) expect(p).not.toMatch(/matar|puta/);
      expect(bad[bad.length - 1].last).toMatchObject({ body: MSG.refused, writing: false });
    }, 30_000);

    it('tempo máximo ou erro a meio: fica o que já estava escrito, com uma nota curta; sem nada, a mensagem de sempre', async () => {
      cfg().SUPERTXILL_TIMEOUT_MS = 1500;
      const me = await signup('sxwc');
      fakePlan = () => ({ pieces: ['Primeiro ', 'bocado.'], gap: 200, end: 'hang' });
      await ask(me, 'pensa muito');
      expect((await waitDone(me, 2)).pop()).toMatchObject({ body: `Primeiro bocado.\n\n(${MSG.cutTimeout})`, writing: false });
      fakePlan = () => ({ pieces: ['Já ia ', 'a meio'], gap: 150, end: 'error' });
      await ask(me, 'outra');
      expect((await waitDone(me, 4)).pop()).toMatchObject({ body: `Já ia a meio\n\n(${MSG.cutError})`, writing: false });
      fakePlan = () => ({ end: 'error' });
      await ask(me, 'mais');
      expect((await waitDone(me, 6)).pop()).toMatchObject({ body: MSG.error });
      expect((await api().get('/api/v1/supertxill').set(auth(me)).expect(200)).body.pending).toBe(false);
    }, 30_000);

    it('apagar a conversa enquanto escreve: a resposta não volta a aparecer', async () => {
      cfg().SUPERTXILL_TIMEOUT_MS = 10_000;
      const me = await signup('sxwd');
      fakePlan = () => ({ pieces: ['Um ', 'dois ', 'três ', 'quatro ', 'cinco.'], gap: 300 });
      resetThrottle();
      await api().post('/api/v1/supertxill/ask').set(auth(me)).send({ text: 'conta' }).expect(201);
      for (let i = 0; i < 40 && (await thread(me)).length < 2; i++) await new Promise((r) => setTimeout(r, 50));
      await api().post('/api/v1/supertxill/clear').set(auth(me)).expect(204);
      await new Promise((r) => setTimeout(r, 2000));
      expect(await thread(me)).toEqual([]);
    }, 30_000);
  });

  // Opcional: contra um Ollama a sério (ex.: OLLAMA_URL=http://localhost:11434 OLLAMA_MODEL=qwen3:4b-instruct). Salta sem OLLAMA_URL.
  // Em CPU o 1.º pedido (carregar o modelo e ler as instruções) pode levar minutos: aquece primeiro, sem tempo máximo.
  (process.env.OLLAMA_URL ? it : it.skip)('Ollama a sério: pede as ferramentas e responde em português com os dados da app', async () => {
    const model = process.env.OLLAMA_MODEL ?? 'qwen3:4b-instruct';
    const real = new SuperTxillService(
      pool,
      loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'f'.repeat(40), OLLAMA_URL: process.env.OLLAMA_URL!, OLLAMA_MODEL: model, SUPERTXILL_TIMEOUT_MS: '300000' }),
      app.get(TextFilter),
      tools,
    );
    // Primeiro só carregar o modelo (um pedido), depois ler as instruções (outro): cada um fica abaixo dos 5 min do fetch.
    await fetch(`${process.env.OLLAMA_URL}/api/generate`, { method: 'POST', body: JSON.stringify({ model, keep_alive: '30m' }) });
    await real.chat({ model, messages: [{ role: 'system', content: systemPrompt({ tools: true }) }, { role: 'user', content: 'olá' }], tools: TOOLS, think: false, keep_alive: '30m', options: { num_ctx: 8192, num_predict: 1 } }, new AbortController().signal);
    const me = await signup('sxr');
    const amigo = await signup('sxra');
    await mutual(me, amigo);
    const v = await venue('real', 0.012, amigo);
    // Nomes como os da malta (os de teste, com letras ao calhas, baralham um modelo pequeno).
    await pool.query("UPDATE content.venues SET name = 'Café Acácia' WHERE id = $1", [v]);
    await pool.query("UPDATE identity.users SET display_name = 'Neyma Cossa' WHERE id = $1", [amigo.id]);
    await appear(me, 0);
    await appear(amigo, 0.012);
    await real.ask(me.id, 'Estou bem animado hoje! Onde anda a minha malta?');
    const t = await waitDone(me, 2, 3300);
    const reply = t[t.length - 1];
    expect(reply.role).toBe('assistant');
    expect([MSG.error, MSG.timeout, MSG.off]).not.toContain(reply.body);
    console.log(`Resposta do modelo: ${reply.body}`);
    expect(reply.body).toMatch(/Neyma|Acácia/i);
  }, 900_000);
});
