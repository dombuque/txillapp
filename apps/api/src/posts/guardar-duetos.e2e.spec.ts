import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { execFileSync } from "child_process";
import { existsSync, mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import ffmpegPath from "ffmpeg-static";
import request from "supertest";
import { Pool } from "pg";
import { loadConfig } from "../config";
import { migrate } from "../db/migrate";
import { createApp } from "../main";
import { DOWNLOAD_BLOCKED } from "./post-download.service";

/**
 * Guardar duetos e apagar logo as cópias:
 * - num dueto a cópia leva o vídeo do original, por isso também o autor do original tem de deixar (ou ser ele a pedir);
 *   original apagado: ninguém guarda (nem o autor do dueto);
 * - desligar «Deixar guardar» ou passar a conta a privada tira logo as cópias guardadas (linhas e ficheiros) das publicações
 *   da pessoa e dos duetos de outros com o vídeo dela.
 */
const DB =
  process.env.TEST_DATABASE_URL ??
  "postgres://txill:txill_dev@localhost:5433/txillapp_test";
const PASSWORD = "password-bem-longa-1";
const FF = ffmpegPath as unknown as string;
const MEDIA = "./uploads-test";
const work = mkdtempSync(join(tmpdir(), "txill-gduetos-"));

function clip(name: string): Buffer {
  const file = join(work, `${name}.mp4`);
  execFileSync(
    FF,
    [
      "-y",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=240x426:rate=24:duration=1.5",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1.5",
      "-c:a",
      "aac",
      "-shortest",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      file,
    ],
    { stdio: "ignore" },
  );
  return readFileSync(file);
}

const binary = (
  res: NodeJS.ReadableStream,
  cb: (err: Error | null, body: Buffer) => void,
) => {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
  res.on("error", (e: Error) => cb(e, Buffer.alloc(0)));
};

interface U {
  token: string;
  id: string;
  username: string;
}

describe("guardar duetos e apagar logo as cópias", () => {
  let app: INestApplication;
  let pool: Pool;
  let ana: U, beto: U, caio: U;
  const run = Date.now().toString(36);
  const api = () => request(app.getHttpServer());
  const as = (u: U) => ({ Authorization: `Bearer ${u.token}` });
  const download = (u: U, id: string) =>
    api()
      .get(`/api/v1/posts/${id}/download`)
      .set(as(u))
      .buffer(true)
      .parse(binary as never);
  const can = async (u: U, id: string) =>
    (
      (await api().get(`/api/v1/posts/${id}`).set(as(u)).expect(200)).body as {
        canDownload: boolean;
      }
    ).canDownload;
  const setAllow = (u: U, allow: boolean) =>
    api()
      .put("/api/v1/posts/me/download-settings")
      .set(as(u))
      .send({ allow })
      .expect(200);
  const blocked = async (u: U, id: string) => {
    const r = await download(u, id).expect(403);
    expect(JSON.parse((r.body as Buffer).toString("utf8")).message).toBe(
      DOWNLOAD_BLOCKED,
    );
  };
  /** As cópias guardadas de uma publicação (o ficheiro de cada uma). */
  const copies = async (postId: string) =>
    (
      await pool.query(
        "SELECT media_id FROM content.post_downloads WHERE post_id = $1",
        [postId],
      )
    ).rows.map((r) => r.media_id as string);
  const file = (id: string) => join(resolve(MEDIA), id);
  /** O ficheiro sai em segundo plano: espera um pouco. */
  async function gone(id: string) {
    for (let i = 0; i < 40 && existsSync(file(id)); i++)
      await new Promise((r) => setTimeout(r, 100));
    expect(existsSync(file(id))).toBe(false);
    expect(
      (
        await pool.query(
          "SELECT status FROM content.media_assets WHERE id = $1",
          [id],
        )
      ).rows[0]?.status ?? "deleted",
    ).toBe("deleted");
  }

  async function register(name: string): Promise<U> {
    const username = `${name}${run}`.slice(0, 28);
    const r = await api()
      .post("/api/v1/auth/register")
      .send({
        email: `${username}@example.com`,
        username,
        displayName: `${name} Teste`,
        password: PASSWORD,
        birthDate: "1990-06-15",
        acceptTerms: true,
      })
      .expect(201);
    await pool.query(
      "UPDATE identity.users SET email_verified_at = now() WHERE id = $1",
      [r.body.user.id],
    );
    return { token: r.body.accessToken, id: r.body.user.id, username };
  }
  async function video(u: U): Promise<string> {
    const bytes = clip(
      `${u.username}-${Math.random().toString(36).slice(2, 8)}`,
    );
    const up = await api()
      .post("/api/v1/media/uploads")
      .set(as(u))
      .send({ mime: "video/mp4", size: bytes.length })
      .expect(201);
    await api()
      .put(up.body.uploadUrl)
      .set("Content-Type", "video/mp4")
      .send(bytes)
      .expect(200);
    const id = up.body.assetId as string;
    await api().post(`/api/v1/media/${id}/complete`).set(as(u)).expect(200);
    for (let i = 0; i < 240; i++) {
      const s = (
        await pool.query(
          "SELECT status, processing_error FROM content.media_assets WHERE id = $1",
          [id],
        )
      ).rows[0];
      if (s?.status === "ready") break;
      if (s?.status === "deleted")
        throw new Error(`vídeo recusado: ${s.processing_error}`);
      await new Promise((r) => setTimeout(r, 250));
    }
    return id;
  }
  const tcheka = async (u: U) => {
    const m = await video(u);
    return (
      await api()
        .post("/api/v1/posts")
        .set(as(u))
        .send({ body: "", mediaIds: [m] })
        .expect(201)
    ).body.id as string;
  };
  const duet = async (u: U, of: string) => {
    const m = await video(u);
    return (
      await api()
        .post("/api/v1/posts")
        .set(as(u))
        .send({
          body: "dueto",
          mediaIds: [m],
          remixOf: { postId: of, kind: "duet" },
        })
        .expect(201)
    ).body.id as string;
  };

  beforeAll(async () => {
    await migrate(DB);
    pool = new Pool({ connectionString: DB });
    app = await createApp(
      loadConfig({
        DATABASE_URL: DB,
        JWT_ACCESS_SECRET: "d".repeat(40),
        NODE_ENV: "test",
        MEDIA_DIR: MEDIA,
        IMAGE_MODERATION: "off",
      }),
    );
    await app.init();
    ana = await register("gdana");
    beto = await register("gdbeto");
    caio = await register("gdcaio");
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  let orig = "",
    dueto = "";

  it("dueto: com o original ligado guarda-se; desligado, 403 e canDownload falso para os outros e para o autor do dueto", async () => {
    orig = await tcheka(ana);
    dueto = await duet(beto, orig);
    expect(await can(caio, dueto)).toBe(true);
    await download(caio, dueto).expect(200);
    await download(caio, orig).expect(200);

    // A Ana desliga: as cópias do original e do dueto saem logo (linhas e ficheiros).
    const before = [...(await copies(orig)), ...(await copies(dueto))];
    expect(before).toHaveLength(2);
    for (const id of before) expect(existsSync(file(id))).toBe(true);
    await setAllow(ana, false);
    expect(await copies(orig)).toEqual([]);
    expect(await copies(dueto)).toEqual([]);
    for (const id of before) await gone(id);

    expect(await can(caio, dueto)).toBe(false);
    await blocked(caio, dueto);
    // O autor do dueto também não (o vídeo da Ana vai na cópia).
    expect(await can(beto, dueto)).toBe(false);
    await blocked(beto, dueto);
    // A Ana (autora do original) guarda o dueto: o Beto deixa.
    expect(await can(ana, dueto)).toBe(true);
    await download(ana, dueto).expect(200);

    // O Beto também desliga: a Ana deixa de guardar o dueto (e as cópias do dueto saem).
    const anaCopy = await copies(dueto);
    expect(anaCopy).toHaveLength(1);
    await setAllow(beto, false);
    expect(await copies(dueto)).toEqual([]);
    await gone(anaCopy[0]);
    expect(await can(ana, dueto)).toBe(false);
    await blocked(ana, dueto);

    await setAllow(ana, true);
    await setAllow(beto, true);
    expect(await can(caio, dueto)).toBe(true);
    expect(await can(beto, dueto)).toBe(true);
    await download(caio, dueto).expect(200);
  }, 180_000);

  it("passar a conta a privada apaga logo as cópias (as dela e as dos duetos com o vídeo dela)", async () => {
    const own = await tcheka(ana);
    await download(caio, own).expect(200);
    const before = [...(await copies(own)), ...(await copies(dueto))];
    expect(before).toHaveLength(2);
    // Mudar outra coisa do perfil não toca nas cópias.
    await api()
      .patch("/api/v1/users/me")
      .set(as(ana))
      .send({ bio: "olá" })
      .expect(200);
    expect([...(await copies(own)), ...(await copies(dueto))]).toHaveLength(2);

    await api()
      .patch("/api/v1/users/me")
      .set(as(ana))
      .send({ isPrivate: true })
      .expect(200);
    expect(await copies(own)).toEqual([]);
    expect(await copies(dueto)).toEqual([]);
    for (const id of before) await gone(id);
    await api()
      .patch("/api/v1/users/me")
      .set(as(ana))
      .send({ isPrivate: false })
      .expect(200);
    await download(caio, dueto).expect(200);
  }, 180_000);

  it("original apagado: o dueto não se guarda (nem o autor do dueto)", async () => {
    await api().delete(`/api/v1/posts/${orig}`).set(as(ana)).expect(204);
    expect(await can(caio, dueto)).toBe(false);
    await blocked(caio, dueto);
    expect(await can(beto, dueto)).toBe(false);
    await blocked(beto, dueto);
  }, 120_000);
});
