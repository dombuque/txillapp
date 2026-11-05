import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { Permission, StaffService } from './staff.service';
import { StaffAuthService } from './staff-auth.service';

export const NEEDS = 'staff.needs';
export const Needs = (...p: Permission[]) => SetMetadata(NEEDS, p);

/**
 * Só a equipa do backoffice, com sessão de equipa (login próprio, separado da rede social) e as permissões certas.
 * Põe em `req.userId` a identidade interna da conta de equipa (para o registo de auditoria) e em `req.staffAccountId` a conta.
 * As rotas de equipa levam `@Needs(...)`: o guard da rede social deixa-as passar para este guard tratar.
 */
@Injectable()
export class StaffGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly staff: StaffService,
    private readonly auth: StaffAuthService,
  ) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<Request & { userId?: string; staffAccountId?: string }>();
    // Dados da equipa nunca ficam em cache do browser.
    ctx.switchToHttp().getResponse<Response>().setHeader('Cache-Control', 'no-store');
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException();
    const s = await this.auth.authenticate(header.slice(7));
    req.userId = s.userId;
    req.staffAccountId = s.accountId;
    const have = await this.staff.permissions(req.userId);
    const need = this.reflector.getAllAndOverride<Permission[]>(NEEDS, [ctx.getHandler(), ctx.getClass()]) ?? [];
    if (have.size === 0 || !need.every((p) => have.has(p))) throw new ForbiddenException();
    return true;
  }
}
