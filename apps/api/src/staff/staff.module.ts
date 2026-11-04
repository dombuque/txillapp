import { Global, Module } from '@nestjs/common';
import { StaffGuard } from './staff.guard';
import { StaffService } from './staff.service';

@Global()
@Module({
  providers: [StaffService, StaffGuard],
  exports: [StaffService, StaffGuard],
})
export class StaffModule {}
