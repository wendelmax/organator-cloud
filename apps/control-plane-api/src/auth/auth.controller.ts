import {
  Controller,
  Post,
  Body,
  Get,
  Req,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AllowPasswordChange } from './allow-password-change.decorator';
import { MfaService } from './mfa.service';

@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly mfaService: MfaService,
  ) {}

  @Post('login')
  async login(@Body() body: Record<string, string>) {
    const user = await this.authService.validateUser(body.email, body.password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.authService.login(user);
  }

  @UseGuards(JwtAuthGuard)
  @AllowPasswordChange()
  @Get('me')
  async me(@Req() req: any) {
    return this.authService.me(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @AllowPasswordChange()
  @Post('change-password')
  async changePassword(
    @Req() req: any,
    @Body() body: { currentPassword: string; newPassword: string },
  ) {
    return this.authService.changePassword(
      req.user.userId,
      body.currentPassword,
      body.newPassword,
    );
  }

  // ---- MFA (TOTP app-level) ----

  @UseGuards(JwtAuthGuard)
  @AllowPasswordChange()
  @Get('mfa/status')
  async mfaStatus(@Req() req: any) {
    return this.mfaService.status(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @AllowPasswordChange()
  @Post('mfa/enroll')
  async mfaEnroll(@Req() req: any) {
    return this.mfaService.enroll(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @AllowPasswordChange()
  @Post('mfa/enable')
  async mfaEnable(@Req() req: any, @Body() body: { code: string }) {
    return this.mfaService.enable(req.user.userId, body.code);
  }

  @UseGuards(JwtAuthGuard)
  @AllowPasswordChange()
  @Post('mfa/disable')
  async mfaDisable(@Req() req: any, @Body() body: { code: string }) {
    return this.mfaService.disable(req.user.userId, body.code);
  }
}
