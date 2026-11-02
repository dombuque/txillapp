import { Body, Controller, Get, Headers, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { requireIdempotencyKey } from '../wallet/wallet.controller';
import { PaymentsService } from './payments.service';

type AuthedReq = Request & { userId?: string };

const orderSchema = z.object({
  packageId: z.string().regex(/^[a-z0-9-]{2,24}$/),
  provider: z.enum(['sandbox', 'mpesa', 'emola', 'card']),
  phone: z.string().max(20).optional(),
});
const webhookSchema = z.object({ orderId: z.string().uuid(), status: z.enum(['paid', 'failed']), ref: z.string().min(3).max(100) });

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('config')
  @UseGuards(JwtAuthGuard)
  config() {
    return this.payments.config();
  }

  @Post('orders')
  @UseGuards(JwtAuthGuard)
  @HttpCode(201)
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  create(@Req() req: AuthedReq, @Body(new ZodPipe(orderSchema)) b: z.infer<typeof orderSchema>, @Headers('idempotency-key') key?: string) {
    return this.payments.create(req.userId!, b, requireIdempotencyKey(key));
  }

  @Get('orders')
  @UseGuards(JwtAuthGuard)
  list(@Req() req: AuthedReq) {
    return this.payments.list(req.userId!);
  }

  @Get('orders/:id')
  @UseGuards(JwtAuthGuard)
  @SkipThrottle()
  get(@Req() req: AuthedReq, @Param('id') id: string) {
    return this.payments.get(req.userId!, id);
  }

  @Post('orders/:id/cancel')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  cancel(@Req() req: AuthedReq, @Param('id') id: string) {
    return this.payments.cancel(req.userId!, id);
  }

  /** Só no ambiente de teste (PAYMENTS_SANDBOX): confirma o pagamento sem dinheiro. */
  @Post('orders/:id/sandbox-pay')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  sandboxPay(@Req() req: AuthedReq, @Param('id') id: string) {
    return this.payments.sandboxPay(req.userId!, id);
  }

  /** Aviso de pagamento dos fornecedores (assinado). Sem sessão: a assinatura é a prova. */
  @Post('webhook')
  @HttpCode(200)
  @SkipThrottle()
  webhook(@Body(new ZodPipe(webhookSchema)) b: z.infer<typeof webhookSchema>, @Headers('x-signature') signature?: string) {
    return this.payments.webhook(b, signature);
  }
}
