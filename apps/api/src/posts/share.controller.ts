import { Controller, Get, Header, Inject, NotFoundException, Param, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { geleiraCardPng } from '../geleira/geleira-card';
import { publicItems, readSnapshot } from '../geleira/geleira-post';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Cartão de pré-visualização dos links partilhados (WhatsApp, Facebook, Telegram, X…).
 * O nginx manda para aqui só os robôs dessas redes; as pessoas recebem a app normal. Só publicações públicas e ativas dão dados
 * (nome, texto e foto ou capa do vídeo); qualquer outra coisa, ou conta privada, dá o cartão genérico (sem revelar que existe).
 */
@Controller('share')
export class ShareController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * A imagem do cartão de um post da geleira (og:image), de publicações ativas e nunca com bebidas alcoólicas. Numa conta
   * privada o cartão vai fechado: só o nome e o frigorífico, sem os gostos (quem não segue não os pode ver). Outra coisa dá 404.
   */
  @Get('card/geleira/:code')
  @SkipThrottle()
  async geleiraCard(@Param('code') code: string, @Res() res: Response) {
    if (!/^[A-Za-z0-9-]{6,36}$/.test(code)) throw new NotFoundException();
    const { rows } = await this.pool.query(
      `SELECT p.geleira, u.display_name, u.is_private FROM content.posts p JOIN identity.users u ON u.id = p.author_id
        WHERE (p.short_code = $1 OR p.id::text = $1) AND p.removed_at IS NULL AND u.status = 'active' AND p.geleira IS NOT NULL`,
      [code],
    );
    const snap = readSnapshot(rows[0]?.geleira);
    if (!snap) throw new NotFoundException();
    const closed = !!rows[0].is_private;
    const png = await geleiraCardPng({ name: rows[0].display_name as string, total: closed ? 0 : snap.totalSoft, level: snap.level, items: closed ? [] : publicItems(snap), closed });
    res.set('Cache-Control', 'public, max-age=600').type('png').send(png);
  }

  @Get(':kind/:code')
  @SkipThrottle()
  @Header('Cache-Control', 'public, max-age=300')
  async page(@Param('kind') kind: string, @Param('code') code: string, @Req() req: Request, @Res() res: Response) {
    const origin = `https://${req.headers.host ?? 'txillapp.com'}`;
    const path = `/${kind === 'r' ? 'r' : 'p'}/${code.replace(/[^A-Za-z0-9-]/g, '')}`;
    let title = 'Txillapp, a rede da malta';
    let description = 'Fotos, vídeos, mimos, tchekas e chat em tempo real com a malta.';
    let image = `${origin}/icon-512.png`;
    let type = 'website';

    if (/^[A-Za-z0-9-]{6,36}$/.test(code)) {
      const { rows } = await this.pool.query(
        `SELECT p.body, p.kind, p.geleira, u.display_name, u.is_private,
                (SELECT json_build_object('id', a.id, 'video', a.mime LIKE 'video/%')
                   FROM content.post_media pm JOIN content.media_assets a ON a.id = pm.media_id
                  WHERE pm.post_id = p.id ORDER BY pm.position LIMIT 1) AS media
           FROM content.posts p JOIN identity.users u ON u.id = p.author_id
          WHERE (p.short_code = $1 OR p.id::text = $1) AND p.removed_at IS NULL AND u.status = 'active' AND p.kind IN ('post', 'repost')`,
        [code],
      );
      const r = rows[0];
      // Conta privada: só o post da geleira tem pré-visualização, e fechada (o nome e o frigorífico, sem a legenda nem os gostos).
      if (r?.is_private && readSnapshot(r.geleira) && !r.media) {
        title = `A geleira de ${r.display_name} no Txillapp`;
        description = 'Conta privada: entra no Txillapp para ver a geleira e brindar.';
        image = `${origin}/api/v1/share/card/geleira/${encodeURIComponent(code)}`;
        type = 'article';
      } else if (r && !r.is_private) {
        const snippet = String(r.body ?? '').replace(/\s+/g, ' ').trim();
        title = `${r.display_name} no Txillapp`;
        description = snippet ? (snippet.length > 160 ? `${snippet.slice(0, 160).trimEnd()}…` : snippet) : 'Vê esta publicação no Txillapp.';
        // Post da geleira (0143): o cartão do frigorífico com os gostos (sem álcool: o cartão é público).
        const snap = readSnapshot(r.geleira);
        if (snap && !r.media) {
          const items = publicItems(snap);
          title = `A geleira de ${r.display_name} no Txillapp`;
          if (!snippet) description = items.length ? `${items.slice(0, 5).map((i) => i.name).join(', ')}${snap.totalSoft > 5 ? ` e mais ${snap.totalSoft - 5}` : ''}. Vem brindar!` : 'Vem ver e brindar a esta geleira.';
          image = `${origin}/api/v1/share/card/geleira/${encodeURIComponent(code)}`;
          type = 'article';
        } else if (r.media) {
          image = `${origin}/api/v1/media/${r.media.id}${r.media.video ? '?poster=1' : '?w=1080'}`;
          type = r.media.video ? 'video.other' : 'article';
        } else type = 'article';
      }
    }

    const url = `${origin}${path}`;
    res
      .type('html')
      .send(
        `<!doctype html><html lang="pt"><head><meta charset="utf-8"><title>${esc(title)}</title>` +
          `<meta name="description" content="${esc(description)}">` +
          `<link rel="canonical" href="${esc(url)}">` +
          `<meta property="og:site_name" content="Txillapp"><meta property="og:type" content="${type}">` +
          `<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">` +
          `<meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(image)}">` +
          `<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}">` +
          `<meta name="twitter:description" content="${esc(description)}"><meta name="twitter:image" content="${esc(image)}">` +
          `</head><body><p><a href="${esc(url)}">Abrir no Txillapp</a></p></body></html>`,
      );
  }
}

/**
 * Pré-visualização pública de uma publicação (para quem abre um link partilhado sem ter conta ou sem ter entrado):
 * só leitura, sem ações. Só publicações públicas e ativas; qualquer outra coisa dá 404 (sem revelar que existe).
 */
@Controller('public')
export class PublicPostController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get('posts/:code')
  @SkipThrottle()
  @Header('Cache-Control', 'public, max-age=60')
  async post(@Param('code') code: string) {
    if (!/^[A-Za-z0-9-]{6,36}$/.test(code)) throw new NotFoundException();
    const find = async (key: string) =>
      (
        await this.pool.query(
          `SELECT p.id, p.short_code, p.body, p.kind, p.repost_of, p.geleira, p.location_label, p.created_at, u.username, u.display_name, u.verified, u.verified_tier,
                  (u.avatar_media_id IS NOT NULL) AS has_avatar,
                  (SELECT count(*) FROM content.cheers c WHERE c.post_id = p.id)::int AS cheers,
                  (SELECT count(*) FROM content.comments cm WHERE cm.post_id = p.id)::int AS comments,
                  (SELECT coalesce(json_agg(json_build_object('id', a.id, 'video', a.mime LIKE 'video/%', 'width', a.width, 'height', a.height) ORDER BY pm.position), '[]'::json)
                     FROM content.post_media pm JOIN content.media_assets a ON a.id = pm.media_id WHERE pm.post_id = p.id) AS media
             FROM content.posts p JOIN identity.users u ON u.id = p.author_id
            WHERE (p.short_code = $1 OR p.id::text = $1) AND p.removed_at IS NULL AND u.status = 'active' AND u.is_private = false AND p.kind IN ('post', 'repost', 'gift')`,
          [key],
        )
      ).rows[0];
    let r = await find(code);
    if (!r) throw new NotFoundException();
    // Um repost mostra a publicação original (se também for pública).
    let repostedBy: string | null = null;
    if (r.kind === 'repost' && r.repost_of) {
      const o = await find(r.repost_of as string);
      if (o) {
        repostedBy = r.display_name as string;
        r = o;
      }
    }
    const media = (r.media as { id: string; video: boolean; width: number | null; height: number | null }[]).map((m) => ({
      kind: m.video ? 'video' : 'image',
      url: `/api/v1/media/${m.id}${m.video ? '' : '?w=1080'}`,
      posterUrl: m.video ? `/api/v1/media/${m.id}?poster=1` : null,
      width: m.width,
      height: m.height,
    }));
    return {
      code: r.short_code as string,
      kind: media[0]?.kind === 'video' ? 'reel' : 'post',
      author: { username: r.username as string, displayName: r.display_name as string, hasAvatar: r.has_avatar as boolean, verified: r.verified as boolean, verifiedTier: (r.verified_tier as string | null) ?? null },
      body: (r.body as string) ?? '',
      locationLabel: (r.location_label as string | null) ?? null,
      createdAt: r.created_at as string,
      repostedBy,
      media,
      // Post da geleira: os gostos sem álcool (quem abre o link sem entrar não tem idade confirmada).
      geleira: (() => { const s = readSnapshot(r.geleira); return s ? { level: s.level, total: s.totalSoft, items: publicItems(s).map(({ alcoholic: _a, ...i }) => i) } : null; })(),
      counts: { cheers: r.cheers as number, comments: r.comments as number },
    };
  }
}
