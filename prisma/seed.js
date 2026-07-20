const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { createHash, randomBytes } = require('crypto');

const prisma = new PrismaClient();
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const newApiKey = () => 'ak_' + randomBytes(16).toString('hex');

async function main() {
  console.log('Seeding...');

  const usersData = [
    { username: 'admin',  password: 'admin123', name: 'Sarah Chen',  role: 'RM' },
    { username: 'ragent', password: 'pass123',  name: 'Marcus Webb', role: 'RA' },
    { username: 'cmgr',   password: 'pass123',  name: 'Diana Kovac', role: 'CM' },
    { username: 'cagent', password: 'pass123',  name: 'Leo Tanaka',  role: 'CA' },
  ];
  const users = [];
  for (const u of usersData) {
    users.push(await prisma.user.upsert({
      where: { username: u.username },
      update: {},
      create: { ...u, password: await bcrypt.hash(u.password, 10) },
    }));
  }

  const names = [['James','Smith'],['Olivia','Mueller'],['Liam','Garcia'],['Emma','Rossi'],['Noah','Dubois'],['Ava','Johansson'],['Elena','Kim'],['Kai','Patel'],['Freya','Nakamura'],['Ravi','van Dijk'],['Sophia','Chen'],['Lucas','Webb'],['Mia','Tanaka'],['Elijah','Kovac'],['Yuki','Rivera'],['Aiden','Brown'],['Chloe','Taylor'],['Mason','Lee'],['Lily','Harris'],['Ethan','Clark']];
  const countries = ['Australia','United States','United Kingdom','Germany','France','New Zealand'];
  const sources = ['Website','Referral','LinkedIn','Email Campaign','Google Ads'];
  const leadStatuses = ['NEW', 'IN_PROGRESS', 'CONTACTED'];
  for (let i = 0; i < 25; i++) {
    const [fn, ln] = names[i % names.length];
    await prisma.lead.create({ data: {
      name: `${fn} ${ln}`,
      phone: `+61${String(400000000 + Math.floor(Math.random() * 99999999))}`,
      email: `${fn.toLowerCase()}.${ln.toLowerCase().replace(/\s/g, '')}${i}@example.com`,
      country: countries[i % countries.length],
      source: sources[i % sources.length],
      status: leadStatuses[i % 3],
      assignedToId: users[i % users.length].id,
      createdAt: new Date(Date.now() - Math.random() * 30 * 864e5),
    }});
  }

  const clientRows = [['Daniel','Foster','Australia'],['Ingrid','Larsen','Germany'],['Tom','Whitfield','United Kingdom'],['Aisha','Rahman','United States'],['Pierre','Moreau','France'],['Hana','Sato','New Zealand'],['Viktor','Novak','Germany'],['Grace',"O'Neill",'Australia']];
  const kycs = ['PENDING', 'SUBMITTED', 'VERIFIED', 'REJECTED'];
  const accts = ['STANDARD', 'GOLD', 'VIP', 'ISLAMIC'];
  const clients = [];
  for (let i = 0; i < clientRows.length; i++) {
    const [fn, ln, country] = clientRows[i];
    const balance = Math.round(Math.random() * 45000 + 500);
    clients.push(await prisma.client.create({ data: {
      name: `${fn} ${ln}`,
      email: `${fn.toLowerCase()}.${ln.toLowerCase().replace(/[^a-z]/g, '')}@mail.com`,
      phone: `+49${String(100000000 + Math.floor(Math.random() * 899999999))}`,
      country,
      kyc: kycs[i % 4],
      accountType: accts[i % 4],
      balance,
      equity: Math.round(balance * (0.85 + Math.random() * 0.3)),
      assignedToId: users[i % users.length].id,
    }}));
  }

  const methods = ['BANK_WIRE', 'CREDIT_CARD', 'CRYPTO_BTC', 'CRYPTO_USDT', 'SKRILL', 'NETELLER'];
  for (const kind of ['DEPOSIT', 'WITHDRAWAL']) {
    for (let i = 0; i < 6; i++) {
      const pending = i < 2;
      await prisma.transaction.create({ data: {
        kind,
        clientId: clients[i].id,
        amount: Math.round(Math.random() * (kind === 'DEPOSIT' ? 9000 : 4000) + 100),
        method: methods[i % methods.length],
        status: pending ? 'PENDING' : ['APPROVED', 'REJECTED'][i % 2],
        requestedById: users[i % users.length].id,
        decidedById: pending ? null : users[0].id,
        decidedAt: pending ? null : new Date(Date.now() - Math.random() * 7 * 864e5),
        requestedAt: new Date(Date.now() - Math.random() * 14 * 864e5),
      }});
    }
  }

  const affRows = [
    { name: 'TrafficPro Media', code: 'TPM', commission: 25, active: true },
    { name: 'LeadGen Partners', code: 'LGP', commission: 30, active: true },
    { name: 'FinAds Network',   code: 'FAN', commission: 20, active: false },
  ];
  const affiliates = [];
  for (const a of affRows) {
    const rawKey = newApiKey();
    console.log(`  Affiliate ${a.code} API key: ${rawKey}`);
    affiliates.push(await prisma.affiliate.upsert({
      where: { code: a.code },
      update: {},
      create: { ...a, apiKeyHash: sha256(rawKey) },
    }));
  }

  const affLeadRows = [
    ['Petra','Vogel','Germany','ACCEPTED'],
    ['Ryan','Cole','United States','ACCEPTED'],
    ['Sien','de Boer','Netherlands','ACCEPTED'],
    ['Marco','Bianchi','Italy','DUPLICATE'],
    ['Lucie','Girard','France','INVALID'],
  ];
  for (let i = 0; i < affLeadRows.length; i++) {
    const [fn, ln, country, status] = affLeadRows[i];
    const phone = status === 'INVALID' ? '' : `+49${String(100000000 + Math.floor(Math.random() * 899999999))}`;
    const email = `${fn.toLowerCase()}.${ln.toLowerCase().replace(/\s/g, '')}@mail.com`;
    let leadId = null;
    if (status === 'ACCEPTED') {
      const lead = await prisma.lead.create({ data: {
        name: `${fn} ${ln}`, phone, email, country, source: 'Partner',
        assignedToId: users[i % users.length].id,
      }});
      leadId = lead.id;
    }
    await prisma.affiliateLead.create({ data: {
      affiliateId: affiliates[i % affiliates.length].id,
      name: `${fn} ${ln}`, phone, email, country, status, leadId,
    }});
  }

  await prisma.auditLog.create({ data: { action: 'Database seeded', actorName: 'system', entity: 'system' } });
  console.log('Seed complete.');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());