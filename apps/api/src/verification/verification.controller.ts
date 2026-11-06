import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { Needs, StaffGuard } from '../staff/staff.guard';
import { VerificationService } from './verification.service';

type AuthedReq = Request & { userId?: string };

const requestSchema = z.object({
  kind: z.enum(['person', 'business']),
  fullName: z.string().trim().min(2).max(80),
  // A justificação: quem és, onde te podemos confirmar e porque pedes o selo.
  proof: z.string().trim().min(30).max(600),
  // O documento pode ser o BI, o passaporte, a carta de condução, o DIRE ou outro documento oficial com foto.
  docType: z.enum(['id_card', 'passport', 'driver_licence', 'residence', 'other']),
  docMediaId: z.string().uuid(),
  docBackMediaId: z.string().uuid().optional(),
  // A cara lida pela câmara (foto tirada na hora) e a selfie ao lado do documento.
  faceMediaId: z.string().uuid(),
  selfieMediaId: z.string().uuid(),
});
const decideSchema = z.object({ action: z.enum(['approve', 'reject']), reason: z.string().trim().max(300).optional(), tier: z.enum(['verified', 'official']).optional() });

@Controller()
@UseGuards(JwtAuthGuard)
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Get('verification/me')
  me(@Req() req: AuthedReq) {
    return this.verification.status(req.userId!);
  }

  @Post('verification/request')
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  request(@Req() req: AuthedReq, @Body(new ZodPipe(requestSchema)) b: z.infer<typeof requestSchema>) {
    return this.verification.request(req.userId!, b);
  }

  @Delete('verification/request')
  @HttpCode(204)
  withdraw(@Req() req: AuthedReq) {
    return this.verification.withdraw(req.userId!);
  }

  @Get('admin/verifications')
  @UseGuards(StaffGuard)
  @Needs('verification.decide')
  queue(@Query('status') status?: string) {
    return this.verification.queue(status === 'approved' || status === 'rejected' ? status : 'pending');
  }

  @Post('admin/verifications/:id/decide')
  @UseGuards(StaffGuard)
  @Needs('verification.decide')
  @HttpCode(204)
  decide(@Req() req: AuthedReq, @Param('id') id: string, @Body(new ZodPipe(decideSchema)) b: z.infer<typeof decideSchema>) {
    return this.verification.decide(req.userId!, id, b.action, b.reason, b.tier);
  }
}
