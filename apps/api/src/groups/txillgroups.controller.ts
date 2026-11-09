import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { idemKey } from '../venues/venues.controller';
import { PlanService } from './plan.service';
import { PotService } from './pot.service';

type AuthedReq = Request & { userId?: string };

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD');
const username = z.string().trim().min(1).max(40);
const planSchema = z.object({
  destination: z.string().trim().max(80).nullable().optional(),
  venueSlug: z.string().trim().min(1).max(60).nullable().optional(),
  startsOn: day.nullable().optional(),
  endsOn: day.nullable().optional(),
});
const rsvpSchema = z.object({ status: z.enum(['going', 'maybe', 'not_going']) });
const pollSchema = z.object({
  question: z.string().trim().min(1).max(140),
  options: z.array(z.string().trim().min(1).max(60)).min(2).max(6),
  multiple: z.boolean().optional(),
  closesAt: z.string().datetime({ offset: true }).optional(),
});
const voteSchema = z.object({ optionIds: z.array(z.string().uuid()).max(6) });
const itemSchema = z.object({ text: z.string().trim().min(1).max(120), assignee: username.optional() });
const itemPatchSchema = z.object({ done: z.boolean().optional(), text: z.string().trim().min(1).max(120).optional(), assignee: username.nullable().optional() });
const expenseSchema = z.object({
  description: z.string().trim().min(1).max(120),
  // Meticais, com até 2 casas decimais (ex.: 1250.5). Guardado em cêntimos.
  amountMzn: z.number().positive().max(10_000_000),
  paidBy: username.optional(),
  splitAmong: z.array(username).min(1).max(50).optional(),
});
const potSchema = z.object({ goal: z.number().int().min(1).max(100_000_000).nullable().optional(), venueSlug: z.string().trim().min(1).max(60).nullable().optional() });
const contributeSchema = z.object({ amount: z.number().int().min(10).max(100_000), idempotencyKey: z.string().min(8).max(100).optional() });
const potPaySchema = z.object({
  venueSlug: z.string().trim().min(1).max(60),
  amount: z.number().int().min(1).max(100_000),
  note: z.string().trim().max(120).optional(),
  idempotencyKey: z.string().min(8).max(100).optional(),
});
const refundSchema = z.object({ idempotencyKey: z.string().min(8).max(100).optional() });

/** TxillGroups: o plano, as sondagens, a lista, as despesas, o álbum e o cofre de Txills de cada grupo. Formatos em plan.service.ts e pot.service.ts. */
@Controller('chat/groups/:id')
@UseGuards(JwtAuthGuard)
export class TxillGroupsController {
  constructor(private readonly plan: PlanService, private readonly pot: PotService) {}

  @Get('plan')
  getPlan(@Req() req: AuthedReq, @Param('id') id: string) {
    return this.plan.get(req.userId!, id);
  }

  @Patch('plan')
  patchPlan(@Req() req: AuthedReq, @Param('id') id: string, @Body(new ZodPipe(planSchema)) b: z.infer<typeof planSchema>) {
    return this.plan.update(req.userId!, id, b);
  }

  @Put('plan/rsvp')
  rsvp(@Req() req: AuthedReq, @Param('id') id: string, @Body(new ZodPipe(rsvpSchema)) b: z.infer<typeof rsvpSchema>) {
    return this.plan.rsvp(req.userId!, id, b.status);
  }

  @Post('polls')
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  createPoll(@Req() req: AuthedReq, @Param('id') id: string, @Body(new ZodPipe(pollSchema)) b: z.infer<typeof pollSchema>) {
    return this.plan.createPoll(req.userId!, id, b);
  }

  @Post('polls/:pollId/vote')
  @HttpCode(200)
  vote(@Req() req: AuthedReq, @Param('id') id: string, @Param('pollId') pollId: string, @Body(new ZodPipe(voteSchema)) b: z.infer<typeof voteSchema>) {
    return this.plan.vote(req.userId!, id, pollId, b.optionIds);
  }

  @Post('polls/:pollId/close')
  @HttpCode(200)
  closePoll(@Req() req: AuthedReq, @Param('id') id: string, @Param('pollId') pollId: string) {
    return this.plan.closePoll(req.userId!, id, pollId);
  }

  @Post('checklist')
  addItem(@Req() req: AuthedReq, @Param('id') id: string, @Body(new ZodPipe(itemSchema)) b: z.infer<typeof itemSchema>) {
    return this.plan.addItem(req.userId!, id, b);
  }

  @Patch('checklist/:itemId')
  patchItem(@Req() req: AuthedReq, @Param('id') id: string, @Param('itemId') itemId: string, @Body(new ZodPipe(itemPatchSchema)) b: z.infer<typeof itemPatchSchema>) {
    return this.plan.patchItem(req.userId!, id, itemId, b);
  }

  @Delete('checklist/:itemId')
  @HttpCode(204)
  deleteItem(@Req() req: AuthedReq, @Param('id') id: string, @Param('itemId') itemId: string) {
    return this.plan.deleteItem(req.userId!, id, itemId);
  }

  @Post('expenses')
  addExpense(@Req() req: AuthedReq, @Param('id') id: string, @Body(new ZodPipe(expenseSchema)) b: z.infer<typeof expenseSchema>) {
    return this.plan.addExpense(req.userId!, id, b);
  }

  @Delete('expenses/:expenseId')
  deleteExpense(@Req() req: AuthedReq, @Param('id') id: string, @Param('expenseId') expenseId: string) {
    return this.plan.deleteExpense(req.userId!, id, expenseId);
  }

  @Get('album')
  album(@Req() req: AuthedReq, @Param('id') id: string, @Query('cursor') cursor?: string) {
    return this.plan.album(req.userId!, id, cursor);
  }

  /* ───────────── cofre ───────────── */

  @Get('pot')
  getPot(@Req() req: AuthedReq, @Param('id') id: string) {
    return this.pot.get(req.userId!, id);
  }

  @Patch('pot')
  patchPot(@Req() req: AuthedReq, @Param('id') id: string, @Body(new ZodPipe(potSchema)) b: z.infer<typeof potSchema>) {
    return this.pot.update(req.userId!, id, b);
  }

  @Post('pot/contribute')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  contribute(@Req() req: AuthedReq, @Param('id') id: string, @Body(new ZodPipe(contributeSchema)) b: z.infer<typeof contributeSchema>, @Headers('idempotency-key') key?: string) {
    return this.pot.contribute(req.userId!, id, b.amount, idemKey(b.idempotencyKey, key));
  }

  @Post('pot/pay')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  payFromPot(@Req() req: AuthedReq, @Param('id') id: string, @Body(new ZodPipe(potPaySchema)) b: z.infer<typeof potPaySchema>, @Headers('idempotency-key') key?: string) {
    return this.pot.pay(req.userId!, id, b, idemKey(b.idempotencyKey, key));
  }

  @Post('pot/refund')
  refund(@Req() req: AuthedReq, @Param('id') id: string, @Body(new ZodPipe(refundSchema)) b: z.infer<typeof refundSchema>, @Headers('idempotency-key') key?: string) {
    return this.pot.refund(req.userId!, id, b.idempotencyKey ?? key);
  }
}
