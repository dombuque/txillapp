import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Permission, StaffService } from './staff.service';

const NEEDS = 'staff:needs';
/** Que permissões da equipa a rota exige. Sem argumentos: basta ser da equipa. */
export const Needs = (...p: Permission[]) => SetMetadata(NEEDS, p);

/** Só a equipa, com as permissões certas. Corre depois do JwtAuthGuard. */
@Injectable()
export class StaffGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly staff: StaffService) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<Request & { userId?: string }>();
    if (!req.userId) throw new ForbiddenException();
    const have = await this.staff.permissions(req.userId);
    const need = this.reflector.getAllAndOverride<Permission[]>(NEEDS, [ctx.getHandler(), ctx.getClass()]) ?? [];
    if (have.size === 0 || !need.every((p) => have.has(p))) throw new ForbiddenException();
    return true;
  }
}
