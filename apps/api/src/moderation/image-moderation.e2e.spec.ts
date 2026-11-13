import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { migrate } from '../db/migrate';
import { createApp } from '../main';
import { staffLogin } from '../staff/staff-test';
import type { BodyPartDetector, ImageClassifier } from './image-moderation.service';
import type { NudeLabel } from './nudenet';
import { MediaService } from '../media/media.service';
import { UnusedMediaService } from '../media/unused-media.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://txill:txill_dev@localhost:5433/txillapp_test';
const PASSWORD = 'password-bem-longa-1';
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

/**
 * Modelos de mentira (nenhum teste depende dos modelos reais). Os três últimos bytes da imagem dizem o que encontram:
 * [parte, confiança da parte, pontuação do classificador], cada um de 0 a 254 (÷ 254). 0xff no último byte = o classificador
 * falha; 0xfe na parte = o detetor falha.
 */
const PARTS: (NudeLabel | null)[] = [null, 'FEMALE_BREAST_EXPOSED', 'BUTTOCKS_EXPOSED', 'MALE_BREAST_EXPOSED', 'FEMALE_GENITALIA_EXPOSED'];
let detectorCalls = 0;
const fake: ImageClassifier = {
  async nsfwScore(image) {
    const last = image[image.length - 1];
    if (last === 0xff) throw new Error('modelo indisponível');
    return last / 254;
  },
};
const detector: BodyPartDetector = {
  async detect(image) {
    detectorCalls++;
    const code = image[image.length - 3];
    if (code === 0xfe) throw new Error('detetor indisponível');
    const label = PARTS[code];
    return [{ label: 'FACE_FEMALE', score: 0.9, box: [0, 0, 5, 5] }, ...(label ? [{ label, score: image[image.length - 2] / 254, box: [1, 1, 3, 3] as [number, number, number, number] }] : [])];
  },
};
// Cada foto com bytes diferentes (uma foto aprovada num pedido de revisão já não volta a ser recusada).
let nonce = 0;
const img = (score: number, part: NudeLabel | null = null, conf = 0) =>
  Buffer.concat([PNG, Buffer.from(`#${++nonce}#`), Buffer.from([PARTS.indexOf(part), Math.round(conf * 254), Math.round(score * 254)])]);

interface U { token: string; id: string; username: string }

describe('verificação automática de fotos (nudez / conteúdo sexual)', () => {
  let app: INestApplication;
  let pool: Pool;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const u: Record<string, U> = {};
  let staff = '';
  const sauth = () => ({ Authorization: `Bearer ${staff}` });
  const auth = (x: U) => ({ Authorization: `Bearer ${x.token}` });

  async function signup(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api().post('/api/v1/auth/register').send({ email: `${username}@example.com`, username, displayName: name, password: PASSWORD, birthDate: '1990-06-15', acceptTerms: true }).expect(201);
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  const prepare = async (x: U, bytes: Buffer, purpose = 'public') =>
    (await api().post('/api/v1/media/uploads').set(auth(x)).send({ mime: 'image/png', size: bytes.length, purpose }).expect(201)).body as { assetId: string; uploadUrl: string };
  const put = (url: string, bytes: Buffer) => api().put(url).set('Content-Type', 'image/png').send(bytes);

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(
      loadConfig({ DATABASE_URL: DB, JWT_ACCESS_SECRET: 'i'.repeat(40), NODE_ENV: 'test', MEDIA_DIR: './uploads-test', IMAGE_MODERATION: 'local' }),
      { imageClassifier: fake, bodyDetector: detector },
    );
    await app.init();
    for (const n of ['ia', 'ib']) u[n] = await signup(n);
    staff = (await staffLogin(app, 'ib')).token;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  const reportOf = async (id: string) =>
    ((await api().get('/api/v1/admin/reports').set(sauth()).expect(200)).body as { type: string; id: string; imageUrl: string | null; preview: string; owner: { username: string } }[]).find((x) => x.id === id);

  it('foto normal passa sem correr o detetor; o classificador alto sozinho não recusa', async () => {
    const { ia } = u;
    const before = detectorCalls;
    const ok = img(0.05);
    const a = await prepare(ia, ok);
    await put(a.uploadUrl, ok).expect(200);
    await api().get(`/api/v1/media/${a.assetId}`).expect(200);
    expect((await pool.query('SELECT nsfw_score FROM content.media_assets WHERE id = $1', [a.assetId])).rows[0].nsfw_score).toBeLessThan(0.1);
    // Abaixo de NSFW_DETECT_THRESHOLD (0.3) o detetor nem corre (poupa CPU).
    expect(detectorCalls).toBe(before);
    expect(await reportOf(a.assetId)).toBeUndefined();

    // Classificador a 0.7, o detetor não vê nada exposto: passa, e nem vai para a moderação (a foto do top colorido).
    const top = img(0.7);
    const t = await prepare(ia, top);
    await put(t.uploadUrl, top).expect(200);
    expect(detectorCalls).toBe(before + 1);
    await api().get(`/api/v1/media/${t.assetId}`).expect(200);
    expect(await reportOf(t.assetId)).toBeUndefined();

    // Peito masculino exposto (tronco nu na praia) não conta.
    const beach = img(0.75, 'MALE_BREAST_EXPOSED', 0.95);
    const be = await prepare(ia, beach);
    await put(be.uploadUrl, beach).expect(200);
    expect(await reportOf(be.assetId)).toBeUndefined();

    // Classificador a 0.99 sem o detetor confirmar: passa, mas vai para a moderação (antes era recusada).
    const high = img(0.99);
    const h = await prepare(ia, high);
    await put(h.uploadUrl, high).expect(200);
    await api().get(`/api/v1/media/${h.assetId}`).expect(200);
    expect((await reportOf(h.assetId))?.preview).toBe('Verificação automática: classificador 99%, sem partes expostas detetadas');
  });

  it('com prova de nudez (o detetor encontra mamilos femininos expostos), a foto é recusada com o motivo', async () => {
    const { ia } = u;
    const bad = img(0.6, 'FEMALE_BREAST_EXPOSED', 0.78);
    const b = await prepare(ia, bad);
    const res = await put(b.uploadUrl, bad).expect(422);
    expect(res.body).toMatchObject({ message: 'Esta foto parece mostrar nudez e não pode ser publicada. Se achas que nos enganámos, toca em "Pedir revisão".', code: 'nudity_rejected', assetId: b.assetId });
    await api().get(`/api/v1/media/${b.assetId}`).expect(404);
    // e não dá para a usar numa publicação
    await api().post('/api/v1/posts').set(auth(ia)).send({ body: 'tentativa', mediaIds: [b.assetId] }).expect(400);
    // Fica guardada como 'rejected' (para o pedido de revisão), com o motivo; ninguém a vê, nem a equipa sem pedido de revisão.
    const row = (await pool.query('SELECT status, processing_error FROM content.media_assets WHERE id = $1', [b.assetId])).rows[0];
    expect(row).toMatchObject({ status: 'rejected', processing_error: 'Detetado: mamilos femininos expostos (78%)' });
    expect((await api().get(`/api/v1/media/${b.assetId}/status`).set(auth(ia)).expect(200)).body).toMatchObject({ status: 'rejected', appeal: 'available' });
    await api().get(`/api/v1/media/review/${b.assetId}`).set(sauth()).expect(404);
  });

  it('«Pedir revisão»: só o dono, uma vez; a foto vai para a fila e escapa às limpezas; aprovada, fica publicável e o dono é avisado', async () => {
    const { ia, ib } = u;
    const bad = img(0.7, 'FEMALE_BREAST_EXPOSED', 0.8);
    const a = await prepare(ia, bad);
    await put(a.uploadUrl, bad).expect(422);

    await api().post(`/api/v1/media/${a.assetId}/appeal`).set(auth(ib)).expect(404); // não é dono
    await api().post(`/api/v1/media/${a.assetId}/appeal`).expect(401);
    expect((await api().post(`/api/v1/media/${a.assetId}/appeal`).set(auth(ia)).expect(200)).body).toEqual({ status: 'rejected', appeal: 'pending' });
    await api().post(`/api/v1/media/${a.assetId}/appeal`).set(auth(ia)).expect(409); // só uma vez
    expect((await api().get(`/api/v1/media/${a.assetId}/status`).set(auth(ia)).expect(200)).body).toMatchObject({ status: 'rejected', appeal: 'pending' });

    // Na fila da moderação, com o motivo e marcada como pedido de revisão; a equipa vê a foto.
    expect((await reportOf(a.assetId))?.preview).toBe('Pedido de revisão do dono (foto recusada; aprovar = dispensar) · Detetado: mamilos femininos expostos (80%)');
    const desk = (await api().get('/api/v1/admin/mod/queue').set(sauth()).expect(200)).body.items as { id: string; appeal: boolean }[];
    expect(desk.find((x) => x.id === a.assetId)?.appeal).toBe(true);
    await api().get(`/api/v1/media/review/${a.assetId}`).set(sauth()).expect(200);

    // Nem a limpeza das 48 h nem a dos 7 dias a apagam enquanto o pedido estiver por decidir.
    await pool.query(`UPDATE content.media_assets SET created_at = now() - interval '9 days', rejected_at = now() - interval '9 days' WHERE id = $1`, [a.assetId]);
    await app.get(UnusedMediaService).run();
    await app.get(MediaService).sweepDeleted();
    expect((await pool.query('SELECT status FROM content.media_assets WHERE id = $1', [a.assetId])).rows[0].status).toBe('rejected');

    // Aprovada (dispensar a queixa): fica pronta, publicável, e o dono recebe o aviso.
    await api().post('/api/v1/admin/reports/resolve').set(sauth()).send({ type: 'media', id: a.assetId, action: 'dismiss' }).expect(204);
    expect((await api().get(`/api/v1/media/${a.assetId}/status`).set(auth(ia)).expect(200)).body.status).toBe('ready');
    await api().get(`/api/v1/media/${a.assetId}`).expect(200);
    await api().post('/api/v1/posts').set(auth(ia)).send({ body: 'afinal estava tudo bem', mediaIds: [a.assetId] }).expect(201);
    await new Promise((r) => setTimeout(r, 300));
    const note = (await pool.query(`SELECT data FROM social.notifications WHERE user_id = $1 AND kind = 'content_restored' ORDER BY created_at DESC LIMIT 1`, [ia.id])).rows[0];
    expect(note?.data).toMatchObject({ type: 'media' });
    // A mesma foto (os mesmos bytes, o mesmo dono) já não volta a ser recusada: um mimo ou um Zás podem tentar de novo.
    const again = await prepare(ia, bad);
    await put(again.uploadUrl, bad).expect(200);
    // As 48 h da limpeza dos envios por publicar contam a partir da aprovação (a foto aprovada já está numa publicação, aqui).
  });

  it('pedido de revisão recusado pela moderação, prazo de 7 dias e limite por dia', async () => {
    const { ia } = u;
    const one = img(0.9, 'FEMALE_GENITALIA_EXPOSED', 0.9);
    const a = await prepare(ia, one);
    await put(a.uploadUrl, one).expect(422);
    await api().post(`/api/v1/media/${a.assetId}/appeal`).set(auth(ia)).expect(200);
    await api().post('/api/v1/admin/reports/resolve').set(sauth()).send({ type: 'media', id: a.assetId, action: 'remove' }).expect(204);
    expect((await api().get(`/api/v1/media/${a.assetId}/status`).set(auth(ia)).expect(200)).body).toEqual({ status: 'deleted', error: 'A moderação reviu esta foto e manteve a recusa.' });
    await api().get(`/api/v1/media/review/${a.assetId}`).set(sauth()).expect(404);

    // Sem pedido, ao fim de 7 dias: já não se pode pedir revisão, e a limpeza apaga-a.
    const two = img(0.9, 'FEMALE_GENITALIA_EXPOSED', 0.9);
    const b = await prepare(ia, two);
    await put(b.uploadUrl, two).expect(422);
    await pool.query(`UPDATE content.media_assets SET rejected_at = now() - interval '8 days' WHERE id = $1`, [b.assetId]);
    expect((await api().get(`/api/v1/media/${b.assetId}/status`).set(auth(ia)).expect(200)).body.appeal).toBe('expired');
    await api().post(`/api/v1/media/${b.assetId}/appeal`).set(auth(ia)).expect(410);
    await app.get(MediaService).sweepDeleted();
    expect((await pool.query('SELECT status, purged_at FROM content.media_assets WHERE id = $1', [b.assetId])).rows[0]).toMatchObject({ status: 'deleted', purged_at: expect.any(Date) });

    // No máximo 10 pedidos por dia.
    await pool.query(
      `INSERT INTO content.media_assets (id, owner_id, mime, size_bytes, storage_key, purpose, status, appealed_at)
       SELECT gen_random_uuid(), $1, 'image/png', 10, 'x', 'public', 'deleted', now() FROM generate_series(1, 10)`,
      [ia.id],
    );
    const three = img(0.9, 'FEMALE_GENITALIA_EXPOSED', 0.9);
    const c = await prepare(ia, three);
    await put(c.uploadUrl, three).expect(422);
    await api().post(`/api/v1/media/${c.assetId}/appeal`).set(auth(ia)).expect(429);
  });

  it('zona duvidosa (nádegas expostas, ou uma parte exposta com pouca confiança): passa, vai para a moderação com o motivo, e a moderação pode remover', async () => {
    const { ia } = u;
    const weak = img(0.5, 'FEMALE_GENITALIA_EXPOSED', 0.45);
    const w = await prepare(ia, weak);
    await put(w.uploadUrl, weak).expect(200);
    expect((await reportOf(w.assetId))?.preview).toBe('Verificação automática: Detetado: genitais femininos expostos (45%) · classificador 50%');

    const maybe = img(0.65, 'BUTTOCKS_EXPOSED', 0.8);
    const m = await prepare(ia, maybe);
    await put(m.uploadUrl, maybe).expect(200);
    await api().get(`/api/v1/media/${m.assetId}`).expect(200);

    const q = (await reportOf(m.assetId))!;
    expect(q).toMatchObject({ type: 'media', imageUrl: `/api/v1/media/review/${m.assetId}`, owner: { username: ia.username } });
    expect(q.preview).toBe('Verificação automática: Detetado: nádegas expostas (80%) · classificador 65%');
    // A equipa vê a foto assinalada (e fica na auditoria); a rede social não.
    await api().get(`/api/v1/media/review/${m.assetId}`).set(sauth()).expect(200);
    await api().get(`/api/v1/media/review/${m.assetId}`).set(auth(ia)).expect(401);
    expect((await pool.query("SELECT 1 FROM audit.audit_log WHERE action = 'moderation.view_media' AND target = $1", [`media:${m.assetId}`])).rowCount).toBe(1);

    await api().post('/api/v1/admin/reports/resolve').set(sauth()).send({ type: 'media', id: m.assetId, action: 'remove' }).expect(204);
    await api().get(`/api/v1/media/${m.assetId}`).expect(404);
    // as pessoas não conseguem denunciar "media" à mão
    await api().post('/api/v1/reports').set(auth(ia)).send({ type: 'media', id: m.assetId, reason: 'spam' }).expect(400);
  });

  it('fotos no chat também são verificadas; se o classificador falhar, a foto é recusada (falha fechada); se só o detetor falhar, não se recusa', async () => {
    const { ia } = u;
    const bad = img(0.99, 'FEMALE_GENITALIA_EXPOSED', 0.9);
    const c = await prepare(ia, bad, 'chat');
    await put(c.uploadUrl, bad).expect(422);

    const broken = Buffer.concat([PNG, Buffer.from([0, 0, 0xff])]);
    const f = await prepare(ia, broken);
    await put(f.uploadUrl, broken).expect(503);
    await api().get(`/api/v1/media/${f.assetId}`).expect(404);

    const noDetector = Buffer.concat([PNG, Buffer.from([0xfe, 0, Math.round(0.9 * 254)])]);
    const d = await prepare(ia, noDetector);
    await put(d.uploadUrl, noDetector).expect(200);
    expect((await reportOf(d.assetId))?.preview).toBe('Verificação automática: classificador 90% (detetor indisponível)');
  });

  it('gravações de voz não passam pelo classificador de imagens', async () => {
    const { ia } = u;
    const audio = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    const r = await api().post('/api/v1/media/uploads').set(auth(ia)).send({ mime: 'audio/webm', size: audio.length, purpose: 'chat' }).expect(201);
    await api().put(r.body.uploadUrl).set('Content-Type', 'audio/webm').send(audio).expect(200);
  });
});
