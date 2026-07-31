import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { toNum } from '../common/util';
import {
  PORTAL_ACCESS_TTL,
  PORTAL_REFRESH_TTL,
  PORTAL_TOKEN_TYP,
} from './portal.constants';

@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  private normalizeEmail(email: string) {
    return String(email || '')
      .trim()
      .toLowerCase();
  }

  private normalizeHost(raw: string) {
    let h = String(raw || '')
      .trim()
      .toLowerCase();
    h = h.replace(/^https?:\/\//, '').split('/')[0];
    h = h.replace(/:\d+$/, '');
    if (h.startsWith('www.')) h = h.slice(4);
    return h;
  }

  private async resolvePlatform(hostRaw: string) {
    const host = this.normalizeHost(hostRaw);
    if (!host) return { platformId: null as string | null, registeredHost: '' };
    const platform = await this.prisma.platform.findFirst({
      where: { host, active: true },
    });
    return { platformId: platform?.id ?? null, registeredHost: host };
  }

  private signAccess(payload: { sub: string; name: string; email: string }) {
    return this.jwt.signAsync(
      { ...payload, typ: PORTAL_TOKEN_TYP },
      {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: PORTAL_ACCESS_TTL,
      },
    );
  }

  private signRefresh(payload: { sub: string }) {
    return this.jwt.signAsync(
      { ...payload, typ: PORTAL_TOKEN_TYP },
      {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: PORTAL_REFRESH_TTL,
      },
    );
  }

  private serializeClient(c: any) {
    return {
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      phoneCountry: c.phoneCountry || '',
      country: c.country,
      kyc: c.kyc,
      accountType: c.accountType,
      balance: toNum(c.balance),
      equity: toNum(c.equity),
      registeredHost: c.registeredHost || '',
      platform: c.platform
        ? { id: c.platform.id, name: c.platform.name, host: c.platform.host }
        : null,
      createdAt: c.createdAt,
    };
  }

  async register(
    body: {
      name?: string;
      email?: string;
      password?: string;
      phone?: string;
      phoneCountry?: string;
      country?: string;
    },
    hostHint: string,
  ) {
    const name = String(body.name || '').trim();
    const email = this.normalizeEmail(body.email || '');
    const password = String(body.password || '');
    const phone = String(body.phone || '').trim();
    const phoneCountry = String(body.phoneCountry || '')
      .trim()
      .toUpperCase()
      .slice(0, 2);
    const country = String(body.country || '').trim();

    if (!name) throw new BadRequestException('name required');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('valid email required');
    }
    if (password.length < 8) throw new BadRequestException('Password must be at least 8 characters');

    const existing = await this.prisma.client.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, password: { not: null } },
    });
    if (existing) throw new ConflictException('An account with this email already exists');

    const { platformId, registeredHost } = await this.resolvePlatform(hostHint);
    const hash = await bcrypt.hash(password, 10);

    const client = await this.prisma.client.create({
      data: {
        name,
        email,
        password: hash,
        phone,
        phoneCountry,
        country,
        platformId,
        registeredHost,
        kyc: 'PENDING',
        accountType: 'STANDARD',
      },
      include: { platform: { select: { id: true, name: true, host: true } } },
    });

    void this.audit.log({
      action: `Portal registration: ${client.name} (${registeredHost || 'unknown host'})`,
      entity: 'client',
      entityId: client.id,
      meta: { type: 'portal_register', host: registeredHost, platformId },
    });

    const [accessToken, refreshToken] = await Promise.all([
      this.signAccess({ sub: client.id, name: client.name, email: client.email }),
      this.signRefresh({ sub: client.id }),
    ]);

    return {
      accessToken,
      refreshToken,
      client: this.serializeClient(client),
    };
  }

  async login(emailRaw: string, password: string) {
    const email = this.normalizeEmail(emailRaw);
    if (!email || !password) throw new UnauthorizedException('Invalid credentials');

    const client = await this.prisma.client.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, password: { not: null } },
      include: { platform: { select: { id: true, name: true, host: true } } },
    });
    if (!client?.password) throw new UnauthorizedException('Invalid credentials');
    const ok = await bcrypt.compare(password, client.password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    const [accessToken, refreshToken] = await Promise.all([
      this.signAccess({ sub: client.id, name: client.name, email: client.email }),
      this.signRefresh({ sub: client.id }),
    ]);
    return {
      accessToken,
      refreshToken,
      client: this.serializeClient(client),
    };
  }

  async refresh(refreshToken: string | undefined) {
    if (!refreshToken) throw new UnauthorizedException('Missing refresh token');
    let payload: { sub: string; typ?: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    if (payload.typ !== PORTAL_TOKEN_TYP) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const client = await this.prisma.client.findUnique({
      where: { id: payload.sub },
      include: { platform: { select: { id: true, name: true, host: true } } },
    });
    if (!client?.password) throw new UnauthorizedException('Account not found');
    const accessToken = await this.signAccess({
      sub: client.id,
      name: client.name,
      email: client.email,
    });
    return { accessToken, client: this.serializeClient(client) };
  }

  async me(clientId: string) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      include: { platform: { select: { id: true, name: true, host: true } } },
    });
    if (!client?.password) throw new UnauthorizedException('Account not found');
    return this.serializeClient(client);
  }

  async updateMe(
    clientId: string,
    patch: { name?: string; email?: string; phone?: string; phoneCountry?: string; country?: string },
  ) {
    const data: any = {};
    if (patch.name !== undefined) {
      const name = String(patch.name).trim();
      if (!name) throw new BadRequestException('name required');
      data.name = name;
    }
    if (patch.email !== undefined) {
      const email = this.normalizeEmail(patch.email);
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new BadRequestException('valid email required');
      }
      const clash = await this.prisma.client.findFirst({
        where: {
          email: { equals: email, mode: 'insensitive' },
          password: { not: null },
          NOT: { id: clientId },
        },
      });
      if (clash) throw new ConflictException('Email already in use');
      data.email = email;
    }
    if (patch.phone !== undefined) data.phone = String(patch.phone).trim();
    if (patch.phoneCountry !== undefined) {
      data.phoneCountry = String(patch.phoneCountry).trim().toUpperCase().slice(0, 2);
    }
    if (patch.country !== undefined) data.country = String(patch.country).trim();

    const client = await this.prisma.client
      .update({
        where: { id: clientId },
        data,
        include: { platform: { select: { id: true, name: true, host: true } } },
      })
      .catch(() => null);
    if (!client) throw new UnauthorizedException('Account not found');
    return this.serializeClient(client);
  }

  async changePassword(clientId: string, currentPassword: string, newPassword: string) {
    if (!currentPassword || !newPassword) throw new BadRequestException('current and new password required');
    if (newPassword.length < 8) throw new BadRequestException('Password must be at least 8 characters');

    const client = await this.prisma.client.findUnique({ where: { id: clientId } });
    if (!client?.password) throw new UnauthorizedException('Account not found');
    const ok = await bcrypt.compare(currentPassword, client.password);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');

    await this.prisma.client.update({
      where: { id: clientId },
      data: { password: await bcrypt.hash(newPassword, 10) },
    });
    return { ok: true };
  }

  async transactions(clientId: string) {
    const items = await this.prisma.transaction.findMany({
      where: { clientId },
      orderBy: { requestedAt: 'desc' },
      select: {
        id: true,
        kind: true,
        amount: true,
        method: true,
        status: true,
        note: true,
        requestedAt: true,
        decidedAt: true,
      },
    });
    return {
      items: items.map((t) => ({
        ...t,
        amount: toNum(t.amount),
      })),
      total: items.length,
    };
  }

  async geoFromRequest(req: {
    headers: Record<string, string | string[] | undefined>;
    ip?: string;
    socket?: { remoteAddress?: string };
  }) {
    const h = req.headers || {};
    const cf = String(h['cf-ipcountry'] || '').toUpperCase();
    if (cf && cf.length === 2 && cf !== 'XX' && cf !== 'T1') {
      return { countryCode: cf };
    }

    const xff = String(h['x-forwarded-for'] || '').split(',')[0].trim();
    const ip = xff || req.ip || req.socket?.remoteAddress || '';
    const cleanIp = ip.replace(/^::ffff:/, '');
    if (!cleanIp || cleanIp === '127.0.0.1' || cleanIp === '::1') {
      return { countryCode: 'US' };
    }

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2500);
      const res = await fetch(`https://ipapi.co/${encodeURIComponent(cleanIp)}/country_code/`, {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'crmto-api/portal-geo' },
      });
      clearTimeout(timer);
      if (res.ok) {
        const code = (await res.text()).trim().toUpperCase();
        if (/^[A-Z]{2}$/.test(code)) return { countryCode: code };
      }
    } catch {
      /* fall through */
    }
    return { countryCode: 'US' };
  }
}
