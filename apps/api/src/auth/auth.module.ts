import { Module } from '@nestjs/common';
import { AuthController, JwtAuthGuard } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleService } from './google.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, GoogleService, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
