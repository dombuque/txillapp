import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Needs, StaffGuard } from '../staff/staff.guard';
import { StaffService } from '../staff/staff.service';
import { FinService } from './fin.service';

type AuthedReq = Request & { userId?: string };

/** Período pedido (7, 30 ou 90 dias; qualquer valor entre 1 e 90). */
const period = (v?: string, def = 30) => Math.min(Math.max(Math.trunc(Number(v)) || def, 1), 90);

/**
 * Backoffice, Finanças e Crescimento (só leitura).
 * - GET /admin/summary                          -> os números do Resumo que esta pessoa pode ver (cada um só com a permissão certa)
 * - GET /admin/fin/overview?days=               -> Txills em circulação, emitidos e resgatados, por tipo e por dia          (wallet.view)
 * - GET /admin/fin/venues?days=                 -> carteiras dos locais: saldo, recebido, gasto no Bombar                   (wallet.view)
 * - GET /admin/fin/ledger?type&account&from&to&cursor -> livro de movimentos, com totais do filtro                          (wallet.view)
 * - GET /admin/fin/ledger/:id                   -> detalhe de um movimento                                                  (wallet.view)
 * - GET /admin/fin/alerts                       -> alertas (livro desequilibrado, presentes fora do normal, compras presas) (wallet.view)
 * - GET /admin/fin/purchases?days=              -> fornecedores, pacotes e pedidos de compra de Txills                      (wallet.view)
 * - GET /admin/fin/boosts?days&filter=live|all  -> Bombar de todos os locais                                                (wallet.view)
 * - GET /admin/growth?days=                     -> convites, quem mais convida, orçamento, série, funil e fontes            (invites.view)
 * Suspender e repor campanhas: PUT /venues/admin/boosts/:id/(suspend|reinstate) (catalog.manage), como já existia.
 */
@Controller('admin')
@UseGuards(StaffGuard)
export class FinController {
  constructor(private readonly fin: FinService, private readonly staff: StaffService) {}

  @Get('summary')
  async summary(@Req() req: AuthedReq) {
    return this.fin.summary(await this.staff.permissions(req.userId!));
  }

  @Get('fin/overview')
  @Needs('wallet.view')
  overview(@Query('days') days?: string) {
    return this.fin.overview(period(days));
  }

  @Get('fin/venues')
  @Needs('wallet.view')
  venues(@Query('days') days?: string) {
    return this.fin.venueWallets(period(days));
  }

  @Get('fin/ledger')
  @Needs('wallet.view')
  ledger(@Query('type') type?: string, @Query('account') account?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.fin.ledger({ type, account: account?.slice(0, 80), from, to, cursor, limit: limit ? Number(limit) || undefined : undefined });
  }

  @Get('fin/ledger/:id')
  @Needs('wallet.view')
  transaction(@Param('id') id: string) {
    return this.fin.transaction(id);
  }

  @Get('fin/alerts')
  @Needs('wallet.view')
  alerts() {
    return this.fin.alerts();
  }

  @Get('fin/purchases')
  @Needs('wallet.view')
  purchases(@Query('days') days?: string) {
    return this.fin.purchases(period(days));
  }

  @Get('fin/boosts')
  @Needs('wallet.view')
  boosts(@Query('days') days?: string, @Query('filter') filter?: string) {
    return this.fin.boostsOverview(period(days), filter === 'all' ? 'all' : 'live');
  }

  @Get('growth')
  @Needs('invites.view')
  growth(@Query('days') days?: string) {
    return this.fin.growth(period(days));
  }
}
