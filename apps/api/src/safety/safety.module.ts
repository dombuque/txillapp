import { Global, Module } from '@nestjs/common';
import { TextFilter } from './text-filter.service';

/** Global: qualquer serviço pode usar o filtro de texto sem importar este módulo. */
@Global()
@Module({ providers: [TextFilter], exports: [TextFilter] })
export class SafetyModule {}
