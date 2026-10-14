"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const client_1 = require("@prisma/client");
const db_1 = require("./db");
const friendlyId_1 = require("./friendlyId");
const desktop = 'C:/Users/mykpa/Desktop';
const fs = require('node:fs');
function parseCsv(text) {
    const rows = [];
    let row = [], field = '', quoted = false;
    const input = text.replace(/^\uFEFF/, '');
    for (let i = 0; i < input.length; i++) {
        const char = input[i];
        if (quoted) {
            if (char === '"' && input[i + 1] === '"') {
                field += '"';
                i++;
            }
            else if (char === '"')
                quoted = false;
            else
                field += char;
        }
        else if (char === '"')
            quoted = true;
        else if (char === ',') {
            row.push(field);
            field = '';
        }
        else if (char === '\n' || char === '\r') {
            if (char === '\r' && input[i + 1] === '\n')
                i++;
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        }
        else
            field += char;
    }
    if (field || row.length) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}
function readCsv(file, headerIndex = 0) {
    const grid = parseCsv(fs.readFileSync(`${desktop}/${file}`, 'utf8'));
    const headers = (grid[headerIndex] ?? []).map(value => value.trim());
    return { headers, rows: grid.slice(headerIndex + 1).map(cells => Object.fromEntries(headers.map((header, index) => [header, (cells[index] ?? '').trim()]))) };
}
function value(row, key) { return String(row[key.trim()] ?? ''); }
function money(raw) {
    const cleaned = raw.replace(/[₱,$\s]/g, '').replace(/,/g, '');
    if (!cleaned || cleaned === '-' || cleaned === '—')
        return 0;
    const parsed = Number(cleaned.replace(/\((.*)\)/, '-$1'));
    return Number.isFinite(parsed) ? parsed : 0;
}
function quantity(raw) { return /[₱$]/.test(raw) ? 0 : money(raw); }
function nameKey(raw) { return raw.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' '); }
function cleanName(raw) {
    return raw.trim().replace(/\s+/g, ' ').split(/(\s+|[-'/])/).map(part => /^[\p{L}]/u.test(part) ? part.charAt(0).toLocaleUpperCase() + part.slice(1).toLocaleLowerCase() : part).join('');
}
function cleanPhone(raw) {
    if (!raw.trim())
        return null;
    let digits = raw.replace(/\D/g, '');
    if (digits.startsWith('63') && digits.length === 12)
        digits = `0${digits.slice(2)}`;
    if (digits.length === 10 && digits.startsWith('9'))
        digits = `0${digits}`;
    return digits || null;
}
function dateParts(raw, order = 'dmy') {
    const match = raw.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (!match)
        return null;
    let first = Number(match[1]), second = Number(match[2]), year = Number(match[3]);
    if (year < 100)
        year += year >= 70 ? 1900 : 2000;
    if (year < 2020 || year > 2026)
        return null;
    let month = order === 'dmy' ? second : first;
    let day = order === 'dmy' ? first : second;
    if (first > 12) {
        day = first;
        month = second;
    }
    else if (second > 12) {
        month = first;
        day = second;
    }
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}
function dailyDate(raw, previous) {
    const dmy = dateParts(raw, 'dmy'), mdy = dateParts(raw, 'mdy');
    const candidates = [dmy, mdy].filter((item) => !!item).filter((item, index, all) => all.findIndex(other => other.getTime() === item.getTime()) === index);
    if (candidates.length < 2 || !previous)
        return candidates[0] ?? null;
    const later = candidates.filter(candidate => candidate.getTime() >= previous.getTime());
    return (later.length ? later : candidates).sort((a, b) => Math.abs(a.getTime() - previous.getTime()) - Math.abs(b.getTime() - previous.getTime()))[0];
}
function headerMap(row) { return Object.fromEntries(Object.entries(row).map(([key, val]) => [key.trim(), val])); }
function mapStatus(raw, paid, price) {
    const status = raw.toLocaleLowerCase();
    if (status.includes('cancel'))
        return 'CANCELLED';
    if (status.includes('taken') || status.includes('finished') || status.includes('already out'))
        return 'FINISHED';
    if ((status.includes('not done') || status.includes('not finished') || status.includes('not taken')) && paid >= price)
        return 'PAID';
    if ((status.includes('not done') || status.includes('not finished') || status.includes('not taken')) && paid > 0)
        return 'PARTIAL';
    if (price > 0 && paid >= price)
        return 'PAID';
    if (paid > 0)
        return 'PARTIAL';
    return 'PENDING';
}
function serviceType(raw) {
    const type = raw.toLocaleLowerCase();
    if (type.includes('repair'))
        return 'Repair';
    if (type.includes('resize'))
        return 'Resize';
    if (type.includes('clean'))
        return 'Cleaning';
    return 'Custom';
}
function asDecimal(value) { return new client_1.Prisma.Decimal(value.toFixed(2)); }
async function main() {
    const report = { sales: 0, payments: 0, jobs: 0, expenses: 0, goldMovements: 0, goldPesoCellsSkipped: 0, duplicateSales: 0, invalidDates: 0, skippedRows: 0, ambiguities: 0 };
    try {
        const [dailyCsv, costCsv, expenseCsv, collectibleCsv, goldCsv] = [
            readCsv('dailysales.csv'), readCsv('jobcosting.csv', 3), readCsv('expenses.csv'), readCsv('collectibles.csv', 1), readCsv('goldinventory.csv'),
        ];
        const dailySales = [];
        let previousDate = null;
        const seenSales = new Map();
        for (const [index, original] of dailyCsv.rows.entries()) {
            const row = headerMap(original);
            const rawDate = value(row, 'Date');
            const invoice = value(row, 'Invoice #');
            const name = cleanName(value(row, 'Client Name'));
            const amount = money(value(row, 'Total Price'));
            if (!rawDate || !name || amount <= 0 || /^table|^week|^total|^transactions/i.test(rawDate)) {
                report.skippedRows++;
                continue;
            }
            const date = dailyDate(rawDate, previousDate);
            if (!date) {
                report.invalidDates++;
                continue;
            }
            if (!previousDate || date.getTime() >= previousDate.getTime() - 86400000)
                previousDate = date;
            const input = { row: index + 2, date, rawDate, invoice, contact: cleanPhone(value(row, 'Contact No.')), name, type: value(row, 'Type'), amount, downpayment: money(value(row, 'Dp Today')), method: value(row, 'Payment Method') || null, status: value(row, 'Status') };
            const key = `${date.toISOString().slice(0, 10)}|${invoice || `row-${input.row}`}|${nameKey(name)}`;
            const previous = seenSales.get(key);
            if (previous) {
                report.duplicateSales++;
                if (!previous.status && input.status)
                    previous.status = input.status;
                continue;
            }
            seenSales.set(key, input);
            dailySales.push(input);
        }
        const collectibles = collectibleCsv.rows.map((original, index) => ({ row: index + 3, ...headerMap(original) })).filter(row => value(row, 'Date') && value(row, 'Client Name'));
        const collectibleDates = new Map();
        for (const row of collectibles) {
            const date = dateParts(value(row, 'Date'));
            if (date)
                collectibleDates.set(row.row, date);
            else
                report.invalidDates++;
        }
        const jobInputs = [];
        for (const [index, original] of costCsv.rows.entries()) {
            const row = headerMap(original);
            const invoice = value(row, 'Invoice #');
            const name = cleanName(value(row, 'Client'));
            if (!/^\d+$/.test(invoice) || !name)
                continue;
            const gold = money(value(row, 'Gold grams'));
            const rate = money(value(row, 'Gold cost/gram'));
            const stone = money(value(row, 'Stone Cost'));
            const staffLabor = money(value(row, 'Labor Cost'));
            const laborCharge = money(value(row, 'Total Labor Cost'));
            const other = money(value(row, 'Other Cost'));
            const notes = [];
            const sopValue = value(row, 'SOP 10%').trim();
            if (sopValue)
                notes.push(`Unmapped SOP 10% source cell: ${sopValue}`);
            const reportedTotalRaw = value(row, 'Total Cost');
            const calculatedCost = gold * rate + stone + staffLabor + other;
            if (!reportedTotalRaw)
                notes.push('Source Total Cost is blank; completeness could not be reconciled.');
            else if (Math.abs(money(reportedTotalRaw) - calculatedCost) > 0.02)
                notes.push(`Source Total Cost ${money(reportedTotalRaw).toFixed(2)} differs from input-derived ${calculatedCost.toFixed(2)}.`);
            jobInputs.push({ row: index + 5, invoice, name, gold, rate, stone, staffLabor, laborCharge, other, complete: notes.length === 0, notes: notes.length ? notes.join(' ') : null });
        }
        for (const job of jobInputs) {
            const candidates = dailySales.filter(sale => sale.invoice === job.invoice && nameKey(sale.name) === nameKey(job.name));
            if (candidates.length === 1)
                job.sale = candidates[0];
            else if (candidates.length > 1)
                report.ambiguities++;
        }
        if (process.argv.includes('--dry-run')) {
            const expenseRows = expenseCsv.rows.filter(row => money(value(row, 'AMOUNT')) > 0 && !!dateParts(value(row, 'DATE'))).length;
            const expenseTotal = expenseCsv.rows.reduce((sum, row) => sum + (dateParts(value(row, 'DATE')) ? money(value(row, 'AMOUNT')) : 0), 0);
            let lastGoldDate = null;
            const goldRows = goldCsv.rows.filter(row => {
                if (value(row, 'Date'))
                    lastGoldDate = dateParts(value(row, 'Date'));
                const moved = quantity(value(row, 'Gold In (g)')) + quantity(value(row, 'Gold Out (g)')) + quantity(value(row, 'Scrap (g)')) > 0;
                return moved && !!lastGoldDate;
            }).length;
            const collectionRecords = collectibles.filter(row => money(value(row, 'Total Amount')) > 0 && !!collectibleDates.get(row.row)).length;
            const dailyPayments = dailySales.reduce((sum, sale) => sum + (sale.downpayment > 0 ? 1 : 0), 0);
            const collectiblePayments = collectibles.reduce((sum, row) => {
                if (!collectibleDates.get(row.row) || money(value(row, 'Total Amount')) <= 0)
                    return sum;
                const amount = money(value(row, 'Total Amount'));
                const name = nameKey(value(row, 'Client Name'));
                const date = collectibleDates.get(row.row).toISOString().slice(0, 10);
                const candidates = dailySales.filter(sale => nameKey(sale.name) === name && Math.abs(sale.amount - amount) < 0.01);
                const matchesDaily = candidates.length === 1 || candidates.filter(sale => sale.date.toISOString().slice(0, 10) === date).length === 1;
                const fields = ['1st payment', '2nd Payment', '3rd Payment', '4th payment'];
                return sum + fields.filter((field, index) => money(value(row, field)) > 0 && !(index === 0 && matchesDaily)).length;
            }, 0);
            const goldTotals = goldCsv.rows.reduce((totals, row) => ({
                incoming: totals.incoming + quantity(value(row, 'Gold In (g)')),
                outgoing: totals.outgoing + quantity(value(row, 'Gold Out (g)')),
                scrap: totals.scrap + quantity(value(row, 'Scrap (g)')),
            }), { incoming: 0, outgoing: 0, scrap: 0 });
            report.goldPesoCellsSkipped = goldCsv.rows.reduce((count, row) => count + ['Gold Out (g)', 'Scrap (g)'].filter(field => /[₱$]/.test(value(row, field))).length, 0);
            Object.assign(report, {
                plannedSales: dailySales.length, dailySalesTotal: dailySales.reduce((sum, sale) => sum + sale.amount, 0),
                plannedPayments: dailyPayments + collectiblePayments, plannedJobCostings: jobInputs.length,
                incompleteJobCostings: jobInputs.filter(job => !job.complete).length, linkedJobCostings: jobInputs.filter(job => !!job.sale).length,
                plannedExpenses: expenseRows, expenseTotal, plannedGoldMovements: goldRows, goldTotals,
                validCollectibles: collectionRecords,
            });
            console.log(JSON.stringify(report));
            return;
        }
        const clients = await db_1.prisma.client.findMany({ where: { deletedAt: null } });
        const clientByKey = new Map();
        for (const client of clients)
            clientByKey.set(`${nameKey(client.clientName)}|${cleanPhone(client.contactNum ?? '') ?? ''}`, client.clientId);
        const clientByName = new Map();
        for (const client of clients)
            if (!clientByName.has(nameKey(client.clientName)))
                clientByName.set(nameKey(client.clientName), client.clientId);
        async function clientId(name, phone) {
            const key = `${nameKey(name)}|${phone ?? ''}`;
            const exact = clientByKey.get(key);
            if (exact)
                return exact;
            if (!phone && clientByName.has(nameKey(name)))
                return clientByName.get(nameKey(name));
            const created = await db_1.prisma.client.create({ data: { clientId: (0, friendlyId_1.friendlyId)(), clientName: name, contactNum: phone } });
            clientByKey.set(key, created.clientId);
            if (!clientByName.has(nameKey(name)))
                clientByName.set(nameKey(name), created.clientId);
            return created.clientId;
        }
        const saleIdByInput = new Map();
        const jobIdByInput = new Map();
        for (const job of jobInputs) {
            const existing = await db_1.prisma.job_Cost.findFirst({ where: { sourceSheet: 'jobcosting.csv', sourceRow: job.row } });
            if (existing) {
                jobIdByInput.set(job, existing.jobCostId);
                continue;
            }
            const jobCostId = `LEGACY-JOB-${job.row}`;
            const foundSale = job.sale ? dailySales.find(sale => sale === job.sale) : undefined;
            const saleId = foundSale ? `LEGACY-SALE-${foundSale.date.toISOString().slice(0, 10).replace(/-/g, '')}-${(foundSale.invoice || `ROW${foundSale.row}`).replace(/[^a-zA-Z0-9]/g, '')}` : null;
            const saleExists = saleId ? await db_1.prisma.sales.findUnique({ where: { invoiceId: saleId } }) : null;
            const connectedSaleId = saleExists ? saleId : null;
            await db_1.prisma.job_Cost.create({ data: {
                    jobCostId, itemName: null, goldUsed: asDecimal(job.gold), goldScrap: 0,
                    goldCostPerG: asDecimal(job.rate), stoneCost: asDecimal(job.stone), laborCost: asDecimal(job.staffLabor),
                    laborCharge: asDecimal(job.laborCharge), otherCost: asDecimal(job.other),
                    sourceDataComplete: job.complete,
                    sourceNotes: job.notes,
                    jobDate: foundSale?.date ?? null, status: 'FINISHED', empId: null,
                    clientId: await clientId(job.name, foundSale?.contact ?? null),
                    sourceSheet: 'jobcosting.csv', sourceRow: job.row,
                    ...(connectedSaleId ? { sales: { connect: { invoiceId: connectedSaleId } } } : {}),
                } });
            jobIdByInput.set(job, jobCostId);
        }
        for (const sale of dailySales) {
            const invoiceId = `LEGACY-SALE-${sale.date.toISOString().slice(0, 10).replace(/-/g, '')}-${(sale.invoice || `ROW${sale.row}`).replace(/[^a-zA-Z0-9]/g, '')}`;
            const existing = await db_1.prisma.sales.findUnique({ where: { invoiceId }, include: { payments: true } });
            if (existing) {
                const matchingJobs = jobInputs.filter(job => job.sale === sale);
                const linkedJob = matchingJobs.length === 1 ? matchingJobs[0] : undefined;
                const jobCostId = linkedJob ? jobIdByInput.get(linkedJob) : undefined;
                if (jobCostId && !existing.jobCostId)
                    await db_1.prisma.sales.update({ where: { invoiceId }, data: { jobCostId } });
                saleIdByInput.set(sale, existing.invoiceId);
                continue;
            }
            const client = await clientId(sale.name, sale.contact);
            const matchingJobs = jobInputs.filter(job => job.sale === sale);
            const linkedJob = matchingJobs.length === 1 ? matchingJobs[0] : undefined;
            const jobCostId = linkedJob ? jobIdByInput.get(linkedJob) : undefined;
            const saleRecord = await db_1.prisma.sales.create({ data: {
                    invoiceId, serviceType: serviceType(sale.type), price: asDecimal(sale.amount), status: mapStatus(sale.status, sale.downpayment, sale.amount),
                    salesDate: sale.date, clientId: client, ...(jobCostId ? { jobCostId } : {}),
                    sourceSheet: 'dailysales.csv', sourceRow: sale.row, sourceInvoiceNumber: sale.invoice || null, sourceDate: sale.rawDate, sourceStatus: sale.status || null, sourceType: sale.type || null,
                } });
            saleIdByInput.set(sale, saleRecord.invoiceId);
            report.sales++;
            if (sale.downpayment > 0) {
                await db_1.prisma.salePayment.create({ data: { paymentId: (0, friendlyId_1.friendlyId)(), invoiceId, amount: asDecimal(sale.downpayment), paidAt: sale.date, paymentNumber: 1, method: sale.method, sourceSheet: 'dailysales.csv', sourceRow: sale.row } });
                report.payments++;
            }
        }
        for (const row of collectibles) {
            const date = collectibleDates.get(row.row);
            const name = cleanName(value(row, 'Client Name'));
            if (!date || !name)
                continue;
            const amount = money(value(row, 'Total Amount'));
            if (amount <= 0) {
                report.skippedRows++;
                continue;
            }
            const collectibleDate = collectibleDates.get(row.row);
            const possible = dailySales.filter(sale => nameKey(sale.name) === nameKey(name) && Math.abs(sale.amount - amount) < 0.01);
            const candidates = possible.filter(sale => sale.date.toISOString().slice(0, 10) === collectibleDate?.toISOString().slice(0, 10));
            const matchedCandidates = candidates.length ? candidates : possible;
            let invoiceId = matchedCandidates.length === 1 ? saleIdByInput.get(matchedCandidates[0]) : undefined;
            if (matchedCandidates.length > 1) {
                report.ambiguities++;
                continue;
            }
            if (!invoiceId) {
                const saleId = `LEGACY-COLL-${date.toISOString().slice(0, 10).replace(/-/g, '')}-${row.row}`;
                const existing = await db_1.prisma.sales.findUnique({ where: { invoiceId: saleId } });
                if (existing)
                    invoiceId = existing.invoiceId;
                else {
                    const client = await clientId(name, null);
                    const status = value(row, 'Status');
                    const sale = await db_1.prisma.sales.create({ data: {
                            invoiceId: saleId, serviceType: serviceType(value(row, 'Type')), price: asDecimal(amount), status: mapStatus(status, 0, amount), salesDate: date,
                            clientId: client, sourceSheet: 'collectibles.csv', sourceRow: row.row, sourceDate: value(row, 'Date'), sourceStatus: status || null, sourceType: value(row, 'Type') || null,
                        } });
                    invoiceId = sale.invoiceId;
                    report.sales++;
                }
            }
            const sale = await db_1.prisma.sales.findUnique({ where: { invoiceId }, include: { payments: true } });
            if (!sale)
                continue;
            const paid = new Map();
            for (const payment of sale.payments)
                if (payment.paymentNumber)
                    paid.set(payment.paymentNumber, (paid.get(payment.paymentNumber) ?? 0) + Number(payment.amount));
            for (const [number, field] of [[1, '1st payment'], [2, '2nd Payment'], [3, '3rd Payment'], [4, '4th payment']]) {
                const installment = money(value(row, field));
                if (installment <= 0)
                    continue;
                if (paid.has(number))
                    continue;
                const sourceRow = row.row;
                const already = await db_1.prisma.salePayment.findFirst({ where: { sourceSheet: 'collectibles.csv', sourceRow, paymentNumber: number } });
                if (already)
                    continue;
                await db_1.prisma.salePayment.create({ data: { paymentId: (0, friendlyId_1.friendlyId)(), invoiceId, amount: asDecimal(installment), paidAt: number === 1 ? date : null, paymentNumber: number, sourceSheet: 'collectibles.csv', sourceRow } });
                report.payments++;
            }
        }
        for (const [index, raw] of expenseCsv.rows.entries()) {
            const row = headerMap(raw);
            const dateRaw = value(row, 'DATE');
            const amount = money(value(row, 'AMOUNT'));
            if (!dateRaw || !amount)
                continue;
            const date = dateParts(dateRaw);
            if (!date) {
                report.invalidDates++;
                continue;
            }
            const sourceRow = index + 2;
            const existing = await db_1.prisma.expenses.findFirst({ where: { sourceSheet: 'expenses.csv', sourceRow } });
            if (existing)
                continue;
            const purpose = value(row, 'PURPOSED');
            const description = value(row, 'DESCRIPTION') || purpose || `Imported expense row ${sourceRow}`;
            await db_1.prisma.expenses.create({ data: { expenseId: `LEGACY-EXP-${sourceRow}`, category: purpose || 'Other', description, amount: asDecimal(amount), expDate: date, sourceSheet: 'expenses.csv', sourceRow } });
            report.expenses++;
        }
        let previousGoldDate = null;
        for (const [index, raw] of (process.argv.includes('--skip-gold') ? [] : goldCsv.rows).entries()) {
            const row = headerMap(raw);
            const sourceRow = index + 2;
            const incoming = quantity(value(row, 'Gold In (g)'));
            const outgoing = quantity(value(row, 'Gold Out (g)'));
            const scrap = quantity(value(row, 'Scrap (g)'));
            report.goldPesoCellsSkipped += ['Gold Out (g)', 'Scrap (g)'].filter(field => /[₱$]/.test(value(row, field))).length;
            if (incoming + outgoing + scrap <= 0)
                continue;
            const dateRaw = value(row, 'Date');
            const parsedDate = dateRaw ? dateParts(dateRaw) : null;
            if (parsedDate)
                previousGoldDate = parsedDate;
            const date = parsedDate ?? (!dateRaw ? previousGoldDate : null);
            if (!date) {
                report.invalidDates++;
                continue;
            }
            const previous = await db_1.prisma.inventory.findFirst({ where: { sourceSheet: 'goldinventory.csv', sourceRow } });
            if (previous)
                continue;
            const reference = value(row, 'Reference'), description = value(row, 'Description');
            const itemName = reference && description ? `${reference} · ${description}` : reference || description || 'Gold inventory';
            await db_1.prisma.inventory.create({ data: {
                    referenceId: `LEGACY-GOLD-${sourceRow}`, itemName, unit: 'grams', category: client_1.InventoryCategory.GOLD,
                    quantityIn: asDecimal(incoming), quantityOut: asDecimal(outgoing), quantityLoss: asDecimal(scrap), unitPrice: 0,
                    updatedAt: date, sourceSheet: 'goldinventory.csv', sourceRow, sourceDate: dateRaw || null,
                } });
            report.goldMovements++;
        }
        console.log(JSON.stringify(report));
    }
    finally {
        await db_1.prisma.$disconnect();
    }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Historical import failed.'); process.exitCode = 1; });
