import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Post, Req } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { RequirePermission } from '../auth/decorators';
import { PERMISSIONS } from '../auth/permissions';

const SAFE_SELECT = { id: true, username: true, name: true, role: true, active: true, createdAt: true };

@Controller('users')
@RequirePermission('manageUsers')
export class UsersController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /* Lightweight list for assignment dropdowns & shuffle.
     Handler-level permission overrides the class-level manageUsers,
     so RA/CM (editLeads) can call it too. */
  @Get('agents')
  @RequirePermission('editLeads')
  agents() {
    return this.prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    });
  }

  @Get()
  findAll() {
    return this.prisma.user.findMany({ select: SAFE_SELECT, orderBy: { createdAt: 'asc' } });
  }

  @Post()
  async create(@Req() req: any, @Body() body: { name: string; username: string; password: string; role: string }) {
    if (!body?.name || !body?.username || !body?.password) throw new BadRequestException('name, username, password required');
    if (body.password.length < 8) throw new BadRequestException('Password must be at least 8 characters');
    if (!PERMISSIONS[body.role]) throw new BadRequestException('Invalid role');
    const exists = await this.prisma.user.findUnique({ where: { username: body.username } });
    if (exists) throw new BadRequestException('Username already taken');
    const user = await this.prisma.user.create({
      data: { name: body.name, username: body.username, password: await bcrypt.hash(body.password, 10), role: body.role as any },
      select: SAFE_SELECT,
    });
    void this.audit.log({ action: `Created user ${user.username}`, actorId: req.user.sub, actorName: req.user.name, entity: 'user', entityId: user.id });
    return user;
  }

  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    if (id === req.user.sub) throw new ForbiddenException('Cannot remove your own account');
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new BadRequestException('User not found');
    if (target.username === 'admin') throw new ForbiddenException('Cannot remove primary admin');
    await this.prisma.user.update({ where: { id }, data: { active: false } });
    void this.audit.log({ action: `Deactivated user ${target.username}`, actorId: req.user.sub, actorName: req.user.name, entity: 'user', entityId: id });
    return { id, deactivated: true };
  }
}
