# Step 2 - Full schema + seed

## 1. Copy files into your project
Replace `prisma/schema.prisma` with the one in this folder.
Add `prisma/seed.ts` next to it.

## 2. Install seed dependencies
```bash
npm install bcryptjs
npm install -D ts-node @types/bcryptjs
```

## 3. Register the seed command
Add to package.json (top level, next to "scripts"):
```json
"prisma": { "seed": "ts-node prisma/seed.ts" }
```

## 4. Migrate + seed
```bash
npx prisma migrate dev --name full_schema
npx prisma db seed
```
The seed prints each affiliate's raw API key ONCE - copy them somewhere.
Only SHA-256 hashes are stored in the DB.

## 5. Browse the data
```bash
npm run prisma:studio
```
Opens a UI at http://localhost:5555 with all tables.

## Design notes (differences from the frontend mock, all intentional)
- One `transactions` table with `kind` = DEPOSIT | WITHDRAWAL (instead of two arrays).
- `assignedTo` / `decidedBy` are real foreign keys to users; the API layer will
  serialize them to the `clientName` / `decidedBy`-name shape the frontend expects.
- Money is `Decimal(18,2)`, never floats.
- Enum values are @map-ped so the DB stores the exact display strings
  ("In Progress", "Bank Wire") your frontend already uses.
- `idempotencyKey` on transactions prevents double-processing on retried requests.
- Affiliate API keys are stored as hashes; `AffiliateLead.rawPayload` keeps the
  original request JSON for compliance.
- `audit_log.actorName` is denormalized so history survives user deletion.
