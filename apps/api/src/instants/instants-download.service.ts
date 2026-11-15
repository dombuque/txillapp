import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { tierOf } from '../common/badge';
import { PG_POOL } from '../db/db.module';
import { MediaService } from '../media/media.service';
import { type SealTier } from '../media/signature';
import { renderZasCard } from './zas-card';

/**
 * Guardar um Zás: só o próprio dono, e só enquanto o Zás existe (24 h). Sai o Zás com o desenho da app (zas-card.ts): o
 * cartão squircle com a foto, a legenda na curva na letra escolhida, a marca do Zás, a data e a hora, e a assinatura do
 * Txillapp (o logótipo e o @ do dono, com o selo se a conta for verificada) no canto, fora da foto. À parte do
 * InstantsService para não mexer no que lá está.
 */
@Injectable()
export class InstantsDownloadService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly media: MediaService,
  ) {}

  async download(me: string, id: string): Promise<{ mime: string; bytes: Buffer; filename: string }> {
    const { rows } = await this.pool.query(
      `SELECT i.author_id, i.media_id, i.caption, i.caption_font, i.created_at, u.username, u.verified, u.verified_tier
         FROM social.instants i JOIN identity.users u ON u.id = i.author_id JOIN content.media_assets m ON m.id = i.media_id
        WHERE i.id = $1 AND i.expires_at > now() AND m.status = 'ready'`,
      [id],
    );
    const r = rows[0];
    // Apagado, passado das 24 h ou sem a foto: já não existe.
    if (!r) throw new NotFoundException('Zás não encontrado');
    // Como nos mimos: só se guardam os próprios.
    if (r.author_id !== me) throw new ForbiddenException('Só podes guardar os teus Zás');
    const raw = await this.media.chatBytes(r.media_id as string);
    const seal: SealTier | null = tierOf(r.verified, r.verified_tier);
    // A assinatura vai sempre no quadro, fora da foto (a câmara do Zás não assina as fotos).
    const bytes = await renderZasCard({ photo: raw, caption: String(r.caption ?? ''), font: (r.caption_font as string | null) ?? null, username: r.username as string, seal, at: new Date(r.created_at as string) });
    return { mime: 'image/jpeg', bytes, filename: `txillapp-zas-${String(id).slice(0, 8)}.jpg` };
  }
}
