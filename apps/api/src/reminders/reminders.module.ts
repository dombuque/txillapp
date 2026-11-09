import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { VerifyReminderService } from './verify-reminder.service';

/** Lembretes automáticos (hoje: ativar a conta). */
@Module({
  imports: [AuthModule],
  providers: [VerifyReminderService],
  exports: [VerifyReminderService],
})
export class RemindersModule {}
