import { Module } from '@nestjs/common';
import { AuthController, JwtAuthGuard } from './auth.controller';
import { AuthService } from './auth.service';
import { AppleService } from './apple.service';
import { GoogleService } from './google.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, GoogleService, AppleService, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
