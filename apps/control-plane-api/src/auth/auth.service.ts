import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async validateUser(email: string, pass: string): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });
    if (!user) return null;

    const isMatch = await bcrypt
      .compare(pass, user.password)
      .catch(() => user.password === pass);
    if (isMatch) {
      const result = { ...user } as any;
      delete result.password;
      return result;
    }
    return null;
  }

  async login(user: any) {
    const payload = {
      email: user.email,
      sub: user.id,
      role: user.role,
      tenantId: user.tenantId,
      mustChangePassword: user.mustChangePassword,
    };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        mustChangePassword: user.mustChangePassword,
        mfaEnabled: user.mfaEnabled,
      },
    };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const safe = { ...user } as any;
    delete safe.password;
    delete safe.mfaSecretEncrypted;
    return safe;
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException(
        'A nova senha deve ter no mínimo 8 caracteres',
      );
    }
    if (currentPassword === newPassword) {
      throw new BadRequestException('A nova senha deve ser diferente da atual');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const isMatch = await bcrypt
      .compare(currentPassword, user.password)
      .catch(() => user.password === currentPassword);
    if (!isMatch) {
      throw new UnauthorizedException('Senha atual incorreta');
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashed, mustChangePassword: false },
    });
    return { success: true, message: 'Senha atualizada com sucesso' };
  }
}
