import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
import { ComebackReminderService } from './comeback-reminder.service';
import { ComebackController } from './comeback.controller';
import { VerifyReminderService } from './verify-reminder.service';

/** Lembretes automáticos: ativar a conta e voltar ao Txillapp quando se anda afastado. */
@Module({
  imports: [AuthModule, ChatModule],
  controllers: [ComebackController],
  providers: [VerifyReminderService, ComebackReminderService],
  exports: [VerifyReminderService, ComebackReminderService],
})
export class RemindersModule {}
