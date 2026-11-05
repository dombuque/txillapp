import { Global, Module } from '@nestjs/common';
import { StaffGuard } from './staff.guard';
import { StaffAuthController } from './staff-auth.controller';
import { StaffAuthService } from './staff-auth.service';
import { StaffService } from './staff.service';

@Global()
@Module({
  controllers: [StaffAuthController],
  providers: [StaffService, StaffAuthService, StaffGuard],
  exports: [StaffService, StaffAuthService, StaffGuard],
})
export class StaffModule {}
