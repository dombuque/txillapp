import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GeleiraController } from './geleira.controller';
import { GeleiraService } from './geleira.service';

@Module({
  imports: [AuthModule],
  controllers: [GeleiraController],
  providers: [GeleiraService],
})
export class GeleiraModule {}
