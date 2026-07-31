import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { Public } from '../auth/decorators';
import { PortalService } from './portal.service';
import { PortalAuthGuard, PortalJwtPayload } from './portal-auth.guard';
import { PORTAL_REFRESH_COOKIE } from './portal.constants';

const isProd = process.env.NODE_ENV === 'production';
const cookieOpts = {
  httpOnly: true,
  sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
  secure: isProd,
  path: '/portal/auth',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

type PortalReq = Request & { client: PortalJwtPayload };

@Controller('portal')
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  private hostFrom(req: Request) {
    const header = String(req.headers['x-portal-host'] || '').trim();
    if (header) return header;
    const origin = String(req.headers.origin || '');
    if (origin) {
      try {
        return new URL(origin).host;
      } catch {
        /* ignore */
      }
    }
    return String(req.headers.host || '');
  }

  @Public()
  @Post('register')
  @HttpCode(201)
  async register(
    @Body()
    body: {
      name?: string;
      email?: string;
      password?: string;
      phone?: string;
      phoneCountry?: string;
      country?: string;
    },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken, client } = await this.portal.register(body, this.hostFrom(req));
    res.cookie(PORTAL_REFRESH_COOKIE, refreshToken, cookieOpts);
    return { accessToken, client };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: { email?: string; password?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken, client } = await this.portal.login(body.email ?? '', body.password ?? '');
    res.cookie(PORTAL_REFRESH_COOKIE, refreshToken, cookieOpts);
    return { accessToken, client };
  }

  @Public()
  @Post('auth/refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request) {
    return this.portal.refresh(req.cookies?.[PORTAL_REFRESH_COOKIE]);
  }

  @Public()
  @Post('auth/logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(PORTAL_REFRESH_COOKIE, { path: '/portal/auth' });
    return { ok: true };
  }

  @Public()
  @Get('geo')
  geo(@Req() req: Request) {
    return this.portal.geoFromRequest(req);
  }

  @Public()
  @UseGuards(PortalAuthGuard)
  @Get('me')
  me(@Req() req: PortalReq) {
    return this.portal.me(req.client.sub);
  }

  @Public()
  @UseGuards(PortalAuthGuard)
  @Patch('me')
  updateMe(
    @Req() req: PortalReq,
    @Body() body: { name?: string; email?: string; phone?: string; phoneCountry?: string; country?: string },
  ) {
    return this.portal.updateMe(req.client.sub, body);
  }

  @Public()
  @UseGuards(PortalAuthGuard)
  @Post('me/password')
  @HttpCode(200)
  changePassword(
    @Req() req: PortalReq,
    @Body() body: { currentPassword?: string; newPassword?: string },
  ) {
    return this.portal.changePassword(req.client.sub, body.currentPassword ?? '', body.newPassword ?? '');
  }

  @Public()
  @UseGuards(PortalAuthGuard)
  @Get('transactions')
  transactions(@Req() req: PortalReq) {
    return this.portal.transactions(req.client.sub);
  }
}
