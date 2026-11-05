import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StaffModule } from '../staff/staff.module';
import { VenuesController } from './venues.controller';
import { VenuesService } from './venues.service';

@Module({
  imports: [AuthModule, StaffModule],
  controllers: [VenuesController],
  providers: [VenuesService],
})
export class VenuesModule {}
