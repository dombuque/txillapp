import { applyDecorators, CanActivate, ExecutionContext, Injectable, SetMetadata, UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { RiskAction, RiskService } from './risk.service';

const RISK_ACTION = 'security.risk_action';

/**
 * Corre depois do guard da sessão (põe-se ACIMA do `@UseGuards(JwtAuthGuard)` do método, ou num controlador que já o tem):
 * conta a ação para as rajadas das contas novas e aplica os limites das contas marcadas como suspeitas.
 * O destinatário vem de `:username`; o texto (para as mensagens iguais), do `body` do pedido.
 */
@Injectable()
export class RiskGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly risk: RiskService) {}

  async canActivate(ctx: ExecutionContext) {
    const action = this.reflector.get<RiskAction | undefined>(RISK_ACTION, ctx.getHandler());
    const req = ctx.switchToHttp().getRequest<Request & { userId?: string }>();
    if (!action || !req.userId) return true;
    const body = (req.body ?? {}) as { body?: unknown; toUsername?: unknown };
    const target = typeof req.params?.username === 'string' ? req.params.username : typeof body.toUsername === 'string' ? body.toUsername : undefined;
    await this.risk.check(req.userId, action, { target, text: typeof body.body === 'string' ? body.body : undefined });
    return true;
  }
}

/** `@RiskCheck('follow')`: ver RiskGuard. */
export const RiskCheck = (action: RiskAction) => applyDecorators(SetMetadata(RISK_ACTION, action), UseGuards(RiskGuard));
