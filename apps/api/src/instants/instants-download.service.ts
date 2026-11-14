import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { tierOf } from '../common/badge';
import { PG_POOL } from '../db/db.module';
import { MediaService } from '../media/media.service';
import { signImage, type SealTier } from '../media/signature';
import { zasCaptionSvg } from './zas-caption';

/**
 * Guardar um Zás: só o próprio dono, e só enquanto o Zás existe (24 h). Sai a foto com a legenda a correr pela curva (como
 * no ecrã) e, por cima, a assinatura do Txillapp (o logótipo e o @ do dono, com o selo se a conta for verificada): a mesma
 * dos mimos (media/signature.ts). À parte do InstantsService para não mexer no que lá está.
 */
@Injectable()
export class InstantsDownloadService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly media: MediaService,
  ) {}

  async download(me: string, id: string): Promise<{ mime: string; bytes: Buffer; filename: string }> {
    const { rows } = await this.pool.query(
      `SELECT i.author_id, i.media_id, i.caption, u.username, u.verified, u.verified_tier, m.signed
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
    const caption = String(r.caption ?? '');
    const seal: SealTier | null = tierOf(r.verified, r.verified_tier);
    // Foto que já vem assinada da câmara (`signed`): não se assina outra vez (o @ ficava a dobrar); a legenda vai na mesma.
    const bytes = await signImage(raw, r.username as string, (W, H) => zasCaptionSvg(W, H, caption), !r.signed, seal);
    return { mime: 'image/jpeg', bytes, filename: `txillapp-zas-${String(id).slice(0, 8)}.jpg` };
  }
}
