import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { PERMISSIONS } from './permissions';

const ACCESS_TTL = '15m';
const REFRESH_TTL = '7d';
export const REFRESH_COOKIE = 'crmto_refresh';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private signAccess(payload: { sub: string; role: string; name: string }) {
    return this.jwt.signAsync(payload, {
      secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: ACCESS_TTL,
    });
  }

  private signRefresh(payload: { sub: string }) {
    return this.jwt.signAsync(payload, {
      secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: REFRESH_TTL,
    });
  }

  async login(username: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user || !user.active) throw new UnauthorizedException('Invalid credentials');
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    const [accessToken, refreshToken] = await Promise.all([
      this.signAccess({ sub: user.id, role: user.role, name: user.name }),
      this.signRefresh({ sub: user.id }),
    ]);
    return {
      accessToken,
      refreshToken,
      user: { id: user.id, name: user.name, role: user.role },
    };
  }

  async refresh(refreshToken: string | undefined) {
    if (!refreshToken) throw new UnauthorizedException('Missing refresh token');
    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.active) throw new UnauthorizedException('User not found or disabled');
    const accessToken = await this.signAccess({ sub: user.id, role: user.role, name: user.name });
    return { accessToken, user: { id: user.id, name: user.name, role: user.role } };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, name: true, role: true, active: true, createdAt: true },
    });
    if (!user) throw new UnauthorizedException('User not found');
    return { ...user, permissions: PERMISSIONS[user.role] ?? {} };
  }
}
