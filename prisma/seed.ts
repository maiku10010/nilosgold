import 'dotenv/config';
import { PrismaClient, InquiryStatus, JobStatus, SalesStatus, InventoryCategory } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { hash } from 'bcryptjs';

async function main() {
  const url = process.env.DIRECT_URL;
  if (process.env.DEMO_ALLOW_SEED !== 'true' || !url || !process.env.DEMO_DATABASE_HOST || new URL(url).hostname !== process.env.DEMO_DATABASE_HOST) {
    throw new Error('Set DEMO_ALLOW_SEED=true and DEMO_DATABASE_HOST to the dedicated demo DIRECT_URL host.');
  }
  const password = process.env.DEMO_ADMIN_PASSWORD;
  if (!password || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) throw new Error('Set DEMO_ADMIN_PASSWORD to a private 12–72 byte password.');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 1 }) });
  const passwordHash = await hash(password, 12);
  const date = (daysAgo: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - daysAgo); d.setUTCHours(4, 0, 0, 0); return d; };
  try {
    await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('LOCK TABLE clients, employees, inquiries, job_costs, sales, inventory, expenses, system_logs, approval_requests, auth_sessions, sale_payments, job_cost_items, workbook_import_issues IN EXCLUSIVE MODE');
      const counts = await Promise.all([
        tx.client.count(), tx.employee.count(), tx.inquiries.count(), tx.job_Cost.count(), tx.sales.count(),
        tx.inventory.count(), tx.expenses.count(), tx.systemLog.count(), tx.approvalRequest.count(),
        tx.authSession.count(), tx.salePayment.count(), tx.jobCostItem.count(), tx.workbookImportIssue.count(),
      ]);
      if (counts.some(Boolean)) throw new Error('Demo seed requires empty application tables; no existing data was changed.');
      await tx.employee.createMany({ data: [
        { empId: 'DEMO-ADMIN', empName: 'Alex Morgan', empRole: 'ADMIN', rates: 1000, userName: 'demo.admin', password: passwordHash },
        { empId: 'DEMO-STAFF', empName: 'Jamie Rivera', empRole: 'STAFF', rates: 750, userName: 'demo.staff', password: passwordHash },
        { empId: 'DEMO-MAKER', empName: 'Sam Cruz', empRole: 'STAFF', rates: 900, userName: 'demo.maker', password: passwordHash },
      ] });
      const names = ['Mia Santos', 'Noah Reyes', 'Ella Tan', 'Liam Garcia', 'Ava Lim', 'Lucas Mendoza', 'Sofia Ramos', 'Ethan Flores', 'Isla Navarro', 'Leo Diaz', 'Chloe Torres', 'Oliver Lee'];
      for (const [i, clientName] of names.entries()) {
        await tx.client.create({ data: { clientId: `DEMO-C${i}`, clientName, email: `customer${i + 1}@example.com` } });
      }
      const services = ['Custom', 'Repair', 'Resize', 'Cleaning'];
      for (let i = 0; i < 24; i++) {
        const client = i % names.length;
        const service = services[i % services.length]!;
        const hasGold = service !== 'Cleaning';
        const price = hasGold ? 14500 + i * 350 : 1200;
        const reference = `DEMO-REF${i}`;
        const jobStatus: JobStatus = i < 6 ? 'RELEASED' : i < 12 ? 'READY_FOR_PICKUP' : 'IN_PROGRESS';
        const inquiryStatus: InquiryStatus = i < 6 ? 'FINISHED' : i < 18 ? 'APPROVED' : i < 22 ? 'PENDING' : 'REJECTED';
        await tx.inquiries.create({ data: {
          inquiryId: `DEMO-I${i}`, universalReferenceId: reference, clientId: `DEMO-C${client}`,
          customerName: names[client]!, email: `customer${client + 1}@example.com`, category: service,
          goldKarat: hasGold ? 18 : null, quotedPrice: price, details: `${service} service for a ${hasGold ? 'gold ring' : 'silver bracelet'}. Fictional demo request.`,
          status: inquiryStatus, isFullyPaid: i < 6, inqDate: date(30 - i),
        } });
        if (i >= 18) continue;
        await tx.job_Cost.create({ data: {
          jobCostId: `DEMO-J${i}`, universalReferenceId: reference, inquiryId: `DEMO-I${i}`, clientId: `DEMO-C${client}`,
          empId: i % 2 ? 'DEMO-STAFF' : 'DEMO-MAKER', serviceType: service, itemName: hasGold ? '18K gold ring' : 'Silver bracelet',
          goldKarat: hasGold ? 18 : null, goldUsed: hasGold ? 1.5 : null, goldScrap: hasGold ? 0.1 : null,
          goldCostPerG: hasGold ? 5500 : null, stoneCost: service === 'Custom' ? 600 : null,
          laborCost: 450, laborCharge: 900, otherCost: 100, status: jobStatus, jobDate: date(29 - i), deadline: date(10 - i),
          items: { create: { itemId: `DEMO-LINE${i}`, description: `${service} work`, linePrice: price, goldGrams: hasGold ? 1.5 : null, goldCost: hasGold ? 8250 : null, laborCost: 450, laborCharge: 900, otherCost: 100, stoneCost: service === 'Custom' ? 600 : null } },
        } });
        if (hasGold) {
          await tx.inventory.createMany({ data: [
            { referenceId: `DEMO-USE${i}`, itemName: '18K gold', category: 'GOLD', goldKarat: 18, unit: 'grams', unitPrice: 5500, quantityOut: 1.5, jobCostId: `DEMO-J${i}`, universalReferenceId: reference, updatedAt: date(29 - i) },
            { referenceId: `DEMO-SCRAP${i}`, itemName: 'Scrap gold', category: 'SCRAP', goldKarat: 18, unit: 'grams', unitPrice: 5500, quantityIn: 0.1, jobCostId: `DEMO-J${i}`, universalReferenceId: reference, updatedAt: date(29 - i) },
          ] });
        }
        if (i >= 12) continue;
        const status: SalesStatus = i < 6 ? 'PAID' : i < 10 ? 'PARTIAL' : 'PENDING';
        await tx.sales.create({ data: {
          invoiceId: `DEMO-S${i}`, universalReferenceId: reference, jobCostId: `DEMO-J${i}`, clientId: `DEMO-C${client}`, serviceType: service,
          description: `${service}: ${hasGold ? '18K gold ring' : 'silver bracelet'}`, price, status, salesDate: date(i),
          payments: status === 'PENDING' ? undefined : { create: { paymentId: `DEMO-P${i}`, amount: status === 'PAID' ? price : price / 2, paidAt: date(i), paymentNumber: 1, method: i % 2 ? 'Cash' : 'Bank transfer' } },
        } });
      }
      const stock: { name: string; category: InventoryCategory; unit: string; price: number; quantity: number; karat?: number }[] = [
        { name: '18K gold', category: 'GOLD', unit: 'grams', price: 5500, quantity: 100, karat: 18 },
        { name: '24K gold', category: 'GOLD', unit: 'grams', price: 7300, quantity: 25, karat: 24 },
        { name: 'Sterling silver', category: 'SILVER', unit: 'grams', price: 95, quantity: 250 },
        { name: 'Velvet ring box', category: 'BOXES', unit: 'pcs', price: 85, quantity: 60 },
        { name: 'Gift pouch', category: 'PACKAGING', unit: 'pcs', price: 25, quantity: 120 },
        { name: 'Round zircon', category: 'GEMSTONES', unit: 'pcs', price: 300, quantity: 40 },
        { name: 'Silver clasp', category: 'FINDINGS', unit: 'pcs', price: 45, quantity: 50 },
        { name: 'Polishing wheel', category: 'TOOLS', unit: 'pcs', price: 350, quantity: 6 },
      ];
      for (const [i, item] of stock.entries()) await tx.inventory.create({ data: { referenceId: `DEMO-STOCK${i}`, itemName: item.name, category: item.category, goldKarat: item.karat, unit: item.unit, unitPrice: item.price, quantityIn: item.quantity, updatedAt: date(45) } });
      const costs = [['Rent', 18000], ['Utilities', 3400], ['Transport', 450], ['Supplies', 1600]] as const;
      for (let i = 0; i < 16; i++) {
        const [category, amount] = costs[i % costs.length]!;
        await tx.expenses.create({ data: { expenseId: `DEMO-E${i}`, category, amount, description: `${category} — fictional demo expense`, expDate: date(i * 4) } });
      }
      for (let i = 0; i < 24; i++) await tx.systemLog.create({ data: {
        logId: `DEMO-LOG${i}`, actorEmpId: 'DEMO-ADMIN', actorName: 'Alex Morgan', actorRole: 'ADMIN', action: 'POST',
        entityType: 'INQUIRY', entityId: `DEMO-I${i}`, details: { source: 'demo-seed', note: 'Fictional inquiry created' }, createdAt: date(30 - i),
      } });
      await tx.approvalRequest.create({ data: { requestId: 'DEMO-APPROVAL', entityType: 'EXPENSE', entityId: 'DEMO-E0', action: 'PUT', beforeData: { amount: 18000 }, proposedData: { amount: 18500 }, requesterEmpId: 'DEMO-STAFF' } });
    }, { timeout: 120_000 });
    console.log('Demo seed complete: 3 users, 12 clients, 24 inquiries, 18 jobs, 12 sales, stock/movements, 16 expenses, 24 audit logs, 1 approval.');
    console.log('Sign in as demo.admin, demo.staff, or demo.maker using the password supplied in DEMO_ADMIN_PASSWORD.');
  } finally { await prisma.$disconnect(); }
}

main().catch(() => { console.error('Demo seed failed. Check the dedicated demo connection, empty tables, and seed environment variables.'); process.exitCode = 1; });
