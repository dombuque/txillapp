import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InsightsController } from './insights.controller';
import { InsightsService } from './insights.service';

/** Global: o perfil regista as visitas sem importar este módulo. */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [InsightsController],
  providers: [InsightsService],
  exports: [InsightsService],
})
export class InsightsModule {}
