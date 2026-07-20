# Crmto API

NestJS + Prisma + PostgreSQL backend for the Crmto brokerage CRM.

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Start local Postgres (requires Docker)
npm run db:up

# 3. Generate Prisma client & create tables
npm run prisma:generate
npm run prisma:migrate   # name it: init

# 4. Run the API
npm run start:dev
```

Check it works: http://localhost:3000/health
-> `{ "status": "ok", "db": "up", ... }`

## Structure

- `src/health/` - health-check route (GET /health, reports DB connectivity)
- `src/prisma/` - global PrismaService (DB access for all future modules)
- `prisma/schema.prisma` - data model (starter: User + Role enum; full CRM schema is the next step)
- `docker-compose.yml` - local Postgres 16 with persistent volume

## Next steps

1. Full Prisma schema (leads, clients, deposits, withdrawals, affiliates, audit log)
2. Auth module (bcrypt + JWT access/refresh)
3. Permission guard from the PERMISSIONS map
4. Resource endpoints (leads, clients, transactions, affiliates)
