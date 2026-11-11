import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GifsController } from './gifs.controller';
import { GifsService } from './gifs.service';

@Module({
  imports: [AuthModule],
  controllers: [GifsController],
  providers: [GifsService],
})
export class GifsModule {}
