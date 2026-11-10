import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
import { CallsController, CallsPushController } from './calls.controller';
import { CallsService } from './calls.service';

@Module({
  imports: [AuthModule, ChatModule],
  controllers: [CallsController, CallsPushController],
  providers: [CallsService],
  exports: [CallsService],
})
export class CallsModule {}
