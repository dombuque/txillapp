#!/usr/bin/env node
/**
 * Dados de DEMONSTRAÇÃO para desenvolvimento local (contas *_dev, conteúdo e imagens gerados).
 * Nunca correr contra produção.
 *
 *   node scripts/seed-demo.mjs            # API em http://localhost:3000
 *   API=http://localhost:3000 node scripts/seed-demo.mjs
 *
 * É idempotente: contas que já existem não são recriadas nem repovoadas.
 */
import { deflateSync } from 'node:zlib';

const API = `${process.env.API ?? 'http://localhost:3000'}/api/v1`;

/** Credenciais de teste SÓ para a base de dados local de desenvolvimento. */
const DEV_PASSWORD = 'dev-only-pass-12345';
const ME = 'dombuque'; // conta de teste principal

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('•', ...a);

/* ───────────── PNG (sem dependências) ───────────── */
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** Imagem em gradiente diagonal com alguns círculos suaves, para as fotos de demonstração. */
function png(w, h, c1, c2, seed = 1) {
  const [a, b] = [hex(c1), hex(c2)];
  const circles = Array.from({ length: 5 }, (_, i) => ({
    x: ((seed * 37 + i * 211) % 100) / 100 * w,
    y: ((seed * 53 + i * 127) % 100) / 100 * h,
    r: (0.08 + ((seed + i) % 5) * 0.04) * w,
  }));
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const t = (x / w + y / h) / 2;
      let px = a.map((v, i) => v + (b[i] - v) * t);
      for (const c of circles) if ((x - c.x) ** 2 + (y - c.y) ** 2 < c.r ** 2) px = px.map((v) => v * 0.82 + 255 * 0.18);
      raw.set(px.map((v) => Math.round(v)), row + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ───────────── HTTP ───────────── */
async function call(method, path, { token, body, key } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'txillapp',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    // O registo/login tem limite de 10/min: espera e repete.
    if (res.status === 429 && attempt < 6) {
      log('limite de pedidos atingido, a esperar 15 s…');
      await sleep(15_000);
      continue;
    }
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }
}

async function upload(token, w, h, c1, c2, seed) {
  const data = png(w, h, c1, c2, seed);
  const r = await call('POST', '/media/uploads', { token, body: { mime: 'image/png', size: data.length } });
  if (r.status !== 201) throw new Error(`upload: ${r.status} ${JSON.stringify(r.body)}`);
  const put = await fetch(`${API.replace('/api/v1', '')}${r.body.uploadUrl}`, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: data });
  if (!put.ok) throw new Error(`PUT: ${put.status}`);
  return r.body.assetId;
}

/* ───────────── dados ───────────── */
const PALETTES = [
  ['#f6d365', '#fda085'], ['#84fab0', '#8fd3f4'], ['#a18cd1', '#fbc2eb'], ['#ff9a9e', '#fad0c4'],
  ['#4facfe', '#00f2fe'], ['#fbc2eb', '#a6c1ee'], ['#fdcbf1', '#e6dee9'], ['#43e97b', '#38f9d7'],
];

const PEOPLE = [
  { u: 'ana_dev', n: 'Ana Teste', bio: 'Praia, música e boa vibe 🌴', stories: ['Sexta é sexta 🍹', 'Pôr do sol 🌅', 'Quem vem? 🎶'], posts: ['Fim de semana na Barra 🌴 quem vem?', 'Café da manhã perfeito ☕'] },
  { u: 'nelio_dev', n: 'Nélio Teste', bio: 'Futebol e churrasco ⚽🔥', stories: ['Jogo de hoje ⚽', 'Churrasco no sábado 🥩'], posts: ['Que golo, malta! ⚽'] },
  { u: 'carla_dev', n: 'Carla Teste', bio: 'Moda e viagens ✈️', stories: ['Nova coleção 👗'], posts: ['Viagem a Inhambane ✈️', 'Look do dia 👟'] },
  { u: 'edson_dev', n: 'Edson Teste', bio: 'Fotografia 📸 Maputo', stories: ['Manhã na cidade 🏙️', 'Luz perfeita ✨', 'Detalhes 📷', 'Fim de tarde 🌇'], posts: ['Maputo vista de cima 🏙️'] },
  { u: 'dalila_dev', n: 'Dalila Teste', bio: 'Comida boa é vida 🍤', stories: ['Hoje há camarão 🍤', 'Sobremesa 🍰'], posts: ['Receita de matapa 🌿'] },
  { u: 'tiago_dev', n: 'Tiago Teste', bio: 'DJ nas horas vagas 🎧', stories: [], posts: ['Set de sábado 🎧'] },
  { u: 'lara_dev', n: 'Lara Teste', bio: 'Arte, cor e café 🎨', stories: [], posts: ['Novo quadro 🎨'] },
  { u: 'yuri_dev', n: 'Yuri Teste', bio: 'Skate e boa onda 🛹', stories: [], posts: ['Manobra nova 🛹'] },
  { u: 'sara_dev', n: 'Sara Teste', bio: 'Conta privada 🔒 só para amigos', stories: ['Só para amigos 🤫'], posts: ['Isto só os seguidores veem 🔒'], private: true },
];

/** quem segue quem (cria "amigos em comum" para as sugestões) */
const FOLLOWS = [
  ['ana_dev', 'tiago_dev'], ['ana_dev', 'lara_dev'], ['nelio_dev', 'tiago_dev'], ['nelio_dev', 'lara_dev'],
  ['carla_dev', 'lara_dev'], ['carla_dev', 'yuri_dev'], ['edson_dev', 'yuri_dev'], ['lara_dev', ME],
];
const ME_FOLLOWS = ['ana_dev', 'nelio_dev', 'carla_dev', 'edson_dev', 'dalila_dev'];

async function session(username, displayName) {
  let r = await call('POST', '/auth/login', { body: { identifier: username, password: DEV_PASSWORD } });
  if (r.status === 200) return { token: r.body.accessToken, created: false };
  if (username === ME) return null;
  r = await call('POST', '/auth/register', { body: { email: `${username}@example.com`, username, displayName, password: DEV_PASSWORD, birthDate: '1990-06-15', acceptTerms: true } });
  if (r.status !== 201) throw new Error(`registo de ${username}: ${r.status} ${JSON.stringify(r.body)}`);
  return { token: r.body.accessToken, created: true };
}

/**
 * Actividade à volta do @dombuque, para ver no ecrã: stories vistos/não vistos (anéis por segmentos),
 * notificações, reposts, um presente recebido e um bloqueio. Idempotente (não repete o que já existe).
 */
async function activity(tokens, meToken) {
  // Stories: a Dalila toda vista (anel cinzento) e 2 dos 4 do Edson (anel parcial).
  for (const [who, howMany] of [['dalila_dev', 99], ['edson_dev', 2]]) {
    const stories = (await call('GET', `/stories/user/${who}`, { token: meToken })).body ?? [];
    for (const s of stories.slice(0, howMany)) await call('POST', `/stories/${s.id}/view`, { token: meToken });
  }

  // Seguidores novos e um pedido: o Edson, o Nélio e a Carla seguem o @dombuque.
  for (const u of ['edson_dev', 'nelio_dev', 'carla_dev']) await call('POST', `/users/${ME}/follow`, { token: tokens[u] });

  // Uma publicação do @dombuque para receber comentário, reposts e brindes.
  const mine = (await call('GET', `/users/${ME}/posts`, { token: meToken })).body?.items ?? [];
  const post = mine.find((p) => p.kind === 'post');
  if (post && post.comments === 0 && post.reposts === 0) {
    const c = await call('POST', `/posts/${post.id}/comments`, { token: tokens.nelio_dev, body: { body: 'Gosto disto! 🔥' } });
    await call('POST', `/posts/${post.id}/comments`, { token: tokens.carla_dev, body: { body: '@dombuque bora marcar?', parentId: c.body?.id } });
    await call('POST', `/posts/${post.id}/repost`, { token: tokens.carla_dev, body: {} });
    await call('POST', `/posts/${post.id}/repost`, { token: tokens.nelio_dev, body: { body: 'Concordo totalmente 👏' } });
    await call('POST', `/posts/${post.id}/cheers`, { token: tokens.edson_dev });
  }

  // Um presente privado do Edson (que segue o @dombuque) e uma reacção ao story.
  const gifts = (await call('GET', '/notifications', { token: meToken })).body?.items ?? [];
  if (!gifts.some((n) => n.kind === 'gift' && n.actor.username === 'edson_dev')) {
    await call('POST', '/gifts', { token: tokens.edson_dev, key: `seed-gift-${Date.now()}`, body: { toUsername: ME, amount: 20, note: 'Pela fotografia 📸', visibility: 'private' } });
  }
  const own = (await call('GET', `/stories/user/${ME}`, { token: meToken })).body ?? [];
  if (own[0] && !gifts.some((n) => n.kind === 'story_reply')) {
    await call('POST', `/stories/${own[0].id}/replies`, { token: tokens.ana_dev, body: { body: '🔥' } });
    await call('POST', `/stories/${own[0].id}/replies`, { token: tokens.nelio_dev, body: { body: 'Que vista! Onde é?' } });
  }

  // Bloqueio ao estilo do X: o Yuri bloqueou o @dombuque (a pessoa é avisada e vê o aviso no perfil).
  await call('PUT', '/blocks/' + ME, { token: tokens.yuri_dev });
  log('actividade criada: stories vistos, notificações, reposts, presente e um bloqueio (@yuri_dev)');
}

async function main() {
  const health = await call('GET', '/health').catch(() => null);
  if (!health || health.status !== 200) throw new Error(`API inacessível em ${API}. Arranca-a primeiro (npm run dev:api).`);

  const tokens = {};
  let seed = 3;
  for (const p of PEOPLE) {
    const s = await session(p.u, p.n);
    tokens[p.u] = s.token;
    if (!s.created) {
      log(`${p.u} já existe`);
      continue;
    }
    log(`${p.u} criada`);
    await call('PATCH', '/users/me', { token: s.token, body: { bio: p.bio, isPrivate: !!p.private } });
    for (const text of p.posts) {
      const [c1, c2] = PALETTES[seed % PALETTES.length];
      const mediaIds = [await upload(s.token, 480, 480, c1, c2, seed++)];
      if (seed % 3 === 0) mediaIds.push(await upload(s.token, 480, 480, ...PALETTES[(seed + 3) % PALETTES.length], seed++));
      await call('POST', '/posts', { token: s.token, body: { body: text, mediaIds } });
    }
    for (const caption of p.stories) {
      const [c1, c2] = PALETTES[seed % PALETTES.length];
      const mediaId = await upload(s.token, 360, 640, c1, c2, seed++);
      await call('POST', '/stories', { token: s.token, body: { mediaId, caption } });
    }
  }

  for (const [a, b] of FOLLOWS) if (tokens[a]) await call('POST', `/users/${b}/follow`, { token: tokens[a] });

  const me = await session(ME, 'Dom Buque');
  if (!me) {
    log(`A conta @${ME} não existe ou a senha é outra: salta os passos dela.`);
  } else {
    for (const u of ME_FOLLOWS) await call('POST', `/users/${u}/follow`, { token: me.token });
    await call('POST', '/users/sara_dev/follow', { token: me.token }); // pedido pendente (conta privada)
    log(`@${ME} segue ${ME_FOLLOWS.length} pessoas e pediu para seguir a sara_dev (privada)`);
  }

  if (me) await activity(tokens, me.token);

  // Um pouco de conversa no post da Ana.
  if (tokens.ana_dev && tokens.nelio_dev && tokens.carla_dev) {
    const feed = await call('GET', '/posts?limit=50', { token: tokens.ana_dev });
    const post = feed.body.items.find((p) => p.author.username === 'ana_dev');
    if (post && post.comments === 0) {
      const c = await call('POST', `/posts/${post.id}/comments`, { token: tokens.nelio_dev, body: { body: 'Eu vou! 🙌' } });
      await call('POST', `/posts/${post.id}/comments`, { token: tokens.ana_dev, body: { body: '@nelio_dev bora!', parentId: c.body.id } });
      await call('POST', `/posts/${post.id}/comments`, { token: tokens.carla_dev, body: { body: 'Levo a música 🎶' } });
      await call('POST', `/posts/${post.id}/cheers`, { token: tokens.carla_dev });
      await call('POST', `/posts/${post.id}/cheers`, { token: tokens.nelio_dev });
    }
  }
  log('Pronto. Abre a app e entra com @' + ME + ' (senha: DEV_PASSWORD neste ficheiro).');
}

main().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
