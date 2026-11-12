import { Body, Controller, Get, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { Needs, StaffGuard } from '../staff/staff.guard';
import { IapService } from './iap.service';

type AuthedReq = Request & { userId?: string };

const platformSchema = z.object({ platform: z.enum(['ios', 'android']) });
const appleVerifySchema = z.object({ signedTransaction: z.string().min(20).max(64_000), campaignId: z.string().uuid().optional() });
const googleVerifySchema = z.object({ productId: z.string().trim().min(1).max(150), purchaseToken: z.string().min(10).max(4096), campaignId: z.string().uuid().optional() });
const appleNotificationSchema = z.object({ signedPayload: z.string().min(20).max(200_000) });
const rtdnSchema = z.object({
  message: z.object({ data: z.string().max(100_000).optional(), messageId: z.string().max(200).optional(), message_id: z.string().max(200).optional() }).passthrough(),
  subscription: z.string().max(500).optional(),
}).passthrough();
const restoreSchema = z.object({
  platform: z.enum(['ios', 'android']),
  signedTransactions: z.array(z.string().min(20).max(64_000)).max(50).optional(),
  purchases: z.array(z.object({ productId: z.string().trim().min(1).max(150), purchaseToken: z.string().min(10).max(4096) })).max(50).optional(),
});

/**
 * Compras pela loja (só a verificação paga e o Bombar). Ver docs/lojas/iap.md.
 * - GET  /iap/catalog?platform=ios|android  -> { enabled, verification: { products, eligible, active }, boost: { products } }
 * - POST /iap/apple/verify    { signedTransaction, campaignId? }          -> { ok: true, entitlement }
 * - POST /iap/google/verify   { productId, purchaseToken, campaignId? }   -> { ok: true, entitlement }
 * - POST /iap/restore         { platform, signedTransactions?, purchases? } -> { ok: true, restored, failed, entitlements }
 * - POST /iap/apple/notifications  { signedPayload }       (sem sessão: App Store Server Notifications V2, assinadas pela Apple)
 * - POST /iap/google/rtdn?token=…  { message: { data } }  (sem sessão: push do Pub/Sub, com o segredo IAP_GOOGLE_RTDN_TOKEN no URL)
 * Com IAP_ENABLED=false (por omissão) ou sem a configuração da loja: `enabled: false` e verify/restore respondem 503.
 */
@Controller('iap')
export class IapController {
  constructor(private readonly iap: IapService) {}

  @Get('catalog')
  @UseGuards(JwtAuthGuard)
  catalog(@Req() req: AuthedReq, @Query(new ZodPipe(platformSchema)) q: z.infer<typeof platformSchema>) {
    return this.iap.catalog(req.userId!, q.platform);
  }

  @Post('apple/verify')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 3_600_000 } })
  appleVerify(@Req() req: AuthedReq, @Body(new ZodPipe(appleVerifySchema)) b: z.infer<typeof appleVerifySchema>) {
    return this.iap.appleVerify(req.userId!, b.signedTransaction, b.campaignId);
  }

  @Post('google/verify')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 3_600_000 } })
  googleVerify(@Req() req: AuthedReq, @Body(new ZodPipe(googleVerifySchema)) b: z.infer<typeof googleVerifySchema>) {
    return this.iap.googleVerify(req.userId!, b.productId, b.purchaseToken, b.campaignId);
  }

  @Post('restore')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  restore(@Req() req: AuthedReq, @Body(new ZodPipe(restoreSchema)) b: z.infer<typeof restoreSchema>) {
    return this.iap.restore(req.userId!, b);
  }

  @Post('apple/notifications')
  @HttpCode(200)
  @SkipThrottle()
  appleNotifications(@Body(new ZodPipe(appleNotificationSchema)) b: z.infer<typeof appleNotificationSchema>) {
    return this.iap.appleNotification(b.signedPayload);
  }

  @Post('google/rtdn')
  @HttpCode(200)
  @SkipThrottle()
  googleRtdn(@Query('token') token: string | undefined, @Body(new ZodPipe(rtdnSchema)) b: z.infer<typeof rtdnSchema>) {
    return this.iap.googleRtdn(token, b);
  }
}

/** Backoffice → Finanças → Compras pela loja (só leitura; wallet.view). */
@Controller('admin/fin/store-purchases')
@UseGuards(StaffGuard)
export class IapAdminController {
  constructor(private readonly iap: IapService) {}

  @Get()
  @Needs('wallet.view')
  list(
    @Query('store') store?: string, @Query('status') status?: string, @Query('kind') kind?: string, @Query('product') product?: string, @Query('env') env?: string,
    @Query('user') user?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string,
  ) {
    return this.iap.adminList({ store, status, kind, product, env, user: user?.slice(0, 60), from, to, cursor, limit: limit ? Number(limit) || undefined : undefined });
  }
}
