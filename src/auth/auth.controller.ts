import { Body, Controller, Get, Post, Req, Res, HttpCode } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService, REFRESH_COOKIE } from './auth.service';
import { Public } from './decorators';

const isProd = process.env.NODE_ENV === 'production';
const cookieOpts = {
  httpOnly: true,
  // Cross-site cookies needed when web + API are on different DO domains
  sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
  secure: isProd,
  path: '/auth',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: { username: string; password: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken, user } = await this.auth.login(body.username ?? '', body.password ?? '');
    res.cookie(REFRESH_COOKIE, refreshToken, cookieOpts);
    return { accessToken, user };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request) {
    return this.auth.refresh(req.cookies?.[REFRESH_COOKIE]);
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(REFRESH_COOKIE, { path: '/auth' });
    return { ok: true };
  }

  @Get('me')
  me(@Req() req: Request & { user: { sub: string } }) {
    return this.auth.me(req.user.sub);
  }
}
