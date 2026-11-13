import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GeleiraAdminController } from './geleira-admin.controller';
import { GeleiraAdminService } from './geleira-admin.service';
import { GeleiraLevelService } from './geleira-level.service';
import { GeleiraController } from './geleira.controller';
import { GeleiraService } from './geleira.service';

@Module({
  imports: [AuthModule],
  controllers: [GeleiraController, GeleiraAdminController],
  providers: [GeleiraService, GeleiraAdminService, GeleiraLevelService],
  exports: [GeleiraLevelService],
})
export class GeleiraModule {}
