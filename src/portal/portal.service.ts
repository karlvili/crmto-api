import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { KycDocType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { toNum } from '../common/util';
import {
  PORTAL_ACCESS_TTL,
  PORTAL_REFRESH_TTL,
  PORTAL_TOKEN_TYP,
} from './portal.constants';

const KYC_DOC_TYPES = new Set<string>(Object.values(KycDocType));
const MAX_KYC_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED_KYC_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/jpg',
  'application/octet-stream', // some browsers/OS leave mime empty/generic
]);

const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  private parseKycDocType(raw: string): KycDocType {
    const v = String(raw || '').trim();
    if (KYC_DOC_TYPES.has(v)) return v as KycDocType;
    const upper = v.toUpperCase().replace(/[\s/-]+/g, '_');
    if (upper === 'ID_PASSPORT' || upper === 'ID' || upper === 'PASSPORT') return KycDocType.ID_PASSPORT;
    if (upper === 'BANK_STATEMENT' || upper === 'BANK_STATEMENTS') return KycDocType.BANK_STATEMENT;
    throw new BadRequestException('type must be ID_PASSPORT or BANK_STATEMENT');
  }

  private serializeKycDoc(d: {
    id: string;
    type: KycDocType;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: d.id,
      type: d.type,
      originalName: d.originalName,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    };
  }

  private async syncKycStatus(clientId: string) {
    const client = await this.prisma.client.findUnique({ where: { id: clientId }, select: { kyc: true } });
    if (!client || client.kyc === 'VERIFIED') return client?.kyc ?? null;

    const docs = await this.prisma.kycDocument.findMany({
      where: { clientId },
      select: { type: true },
    });
    const types = new Set(docs.map((d) => d.type));
    const complete = types.has(KycDocType.ID_PASSPORT) && types.has(KycDocType.BANK_STATEMENT);
    const next = complete ? 'SUBMITTED' : client.kyc === 'REJECTED' ? 'REJECTED' : 'PENDING';
    if (next !== client.kyc) {
      await this.prisma.client.update({ where: { id: clientId }, data: { kyc: next } });
    }
    return next;
  }

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
      kycDocuments: Array.isArray(c.kycDocuments)
        ? c.kycDocuments.map((d: any) => this.serializeKycDoc(d))
        : undefined,
      createdAt: c.createdAt,
    };
  }

  private clientInclude() {
    return {
      platform: { select: { id: true, name: true, host: true } },
      kycDocuments: {
        select: {
          id: true,
          type: true,
          originalName: true,
          mimeType: true,
          sizeBytes: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'asc' as const },
      },
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
      include: this.clientInclude(),
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
      include: this.clientInclude(),
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
      include: this.clientInclude(),
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
      include: this.clientInclude(),
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
        include: this.clientInclude(),
      })
      .catch(() => null);
    if (!client) throw new UnauthorizedException('Account not found');
    return this.serializeClient(client);
  }

  async listKycDocuments(clientId: string) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, password: true, kyc: true },
    });
    if (!client?.password) throw new UnauthorizedException('Account not found');
    const items = await this.prisma.kycDocument.findMany({
      where: { clientId },
      select: {
        id: true,
        type: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    return { kyc: client.kyc, items: items.map((d) => this.serializeKycDoc(d)) };
  }

  async uploadKycDocument(
    clientId: string,
    typeRaw: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number } | undefined,
  ) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, password: true, kyc: true, name: true },
    });
    if (!client?.password) throw new UnauthorizedException('Account not found');
    if (client.kyc === 'VERIFIED') {
      throw new BadRequestException('KYC already verified — contact support to update documents');
    }
    const buffer = file?.buffer;
    if (!buffer?.length) throw new BadRequestException('file required');
    const size = file.size || buffer.length;
    if (size > MAX_KYC_BYTES) throw new BadRequestException('File too large (max 8 MB)');

    const originalName = String(file.originalname || 'document').slice(0, 200);
    const ext = originalName.includes('.') ? originalName.split('.').pop()!.toLowerCase() : '';
    let mime = String(file.mimetype || '').toLowerCase().trim();
    if (!mime || mime === 'application/octet-stream') {
      mime = EXT_MIME[ext] || mime;
    }
    if (!ALLOWED_KYC_MIME.has(mime) && !EXT_MIME[ext]) {
      throw new BadRequestException('Only PDF, JPG, PNG, or WEBP files are allowed');
    }
    if (EXT_MIME[ext]) mime = EXT_MIME[ext];
    const type = this.parseKycDocType(typeRaw);

    const doc = await this.prisma.kycDocument.upsert({
      where: { clientId_type: { clientId, type } },
      create: {
        clientId,
        type,
        originalName,
        mimeType: mime,
        sizeBytes: size,
        data: buffer,
      },
      update: {
        originalName,
        mimeType: mime,
        sizeBytes: size,
        data: buffer,
      },
      select: {
        id: true,
        type: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const kyc = await this.syncKycStatus(clientId);
    void this.audit.log({
      action: `KYC upload: ${client.name} (${type})`,
      entity: 'client',
      entityId: clientId,
      meta: { type: 'kyc_upload', docType: type, kyc },
    });

    return { document: this.serializeKycDoc(doc), kyc };
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
