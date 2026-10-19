"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendSystemEmail = sendSystemEmail;
exports.receiptEmail = receiptEmail;
exports.readyEmail = readyEmail;
const brand_1 = require("../brand");
const validation_1 = require("../validation");
function html(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
async function sendSystemEmail(to, subject, content, idempotencyKey) {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!to || !to.trim())
        return { sent: false, reason: 'Customer email is missing.' };
    if (!(0, validation_1.isValidEmail)(to))
        return { sent: false, reason: 'Correct the customer email address before sending.' };
    if (!key || !from)
        return { sent: false, reason: 'Email service needs RESEND_API_KEY and EMAIL_FROM.' };
    try {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json',
                'Idempotency-Key': idempotencyKey,
            },
            body: JSON.stringify({ from, to: [to.trim()], subject, html: content }),
            signal: AbortSignal.timeout(12_000),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok)
            return { sent: false, reason: result?.message ?? result?.error ?? `Email provider returned ${response.status}.` };
        if (typeof result?.id !== 'string' || !result.id.trim()) {
            return { sent: false, reason: 'The provider did not confirm whether the email was accepted. Ask an administrator to check the provider before sending again.' };
        }
        return { sent: true, messageId: result.id };
    }
    catch {
        return { sent: false, reason: 'The email request timed out or lost its connection. Sending may have succeeded. Ask an administrator to check the provider before sending again.' };
    }
}
function receiptEmail(sale) {
    const total = Number(sale.price);
    const paid = Number(sale.payment);
    const money = (value) => value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `<div style="font-family:Arial,sans-serif;color:#171717;max-width:620px;margin:auto;padding:28px;border:1px solid #e5e7eb;border-radius:12px"><h1 style="color:#12336b">${html(brand_1.brand.name)}</h1><h2>Official Receipt</h2><p>Thank you for your purchase, ${html(sale.client.clientName)}.</p><table style="width:100%;border-collapse:collapse"><tr><td style="padding:8px;border-bottom:1px solid #ddd">Invoice</td><td style="padding:8px;border-bottom:1px solid #ddd">${html(sale.invoiceId)}</td></tr><tr><td style="padding:8px;border-bottom:1px solid #ddd">Date</td><td style="padding:8px;border-bottom:1px solid #ddd">${html(sale.salesDate.toLocaleDateString('en-PH'))}</td></tr><tr><td style="padding:8px;border-bottom:1px solid #ddd">Service</td><td style="padding:8px;border-bottom:1px solid #ddd">${html(sale.serviceType)}</td></tr><tr><td style="padding:8px;border-bottom:1px solid #ddd">Total Price</td><td style="padding:8px;border-bottom:1px solid #ddd">₱${money(total)}</td></tr><tr><td style="padding:8px;border-bottom:1px solid #ddd">Payment Amount</td><td style="padding:8px;border-bottom:1px solid #ddd">₱${money(paid)}</td></tr><tr><td style="padding:8px">Remaining Balance</td><td style="padding:8px">₱${money(Math.max(0, total - paid))}</td></tr></table><p style="font-size:12px;color:#666">${html(brand_1.brand.receiptFooter)}</p></div>`;
}
function readyEmail(job) {
    return `<div style="font-family:Arial,sans-serif;color:#171717;max-width:620px;margin:auto;padding:28px;border:1px solid #e5e7eb;border-radius:12px"><h1 style="color:#12336b">${html(brand_1.brand.name)}</h1><h2>Your item is ready</h2><p>Hello ${html(job.sales.client.clientName)}, your item for invoice <strong>${html(job.sales.invoiceId)}</strong> is ready for pickup or delivery.</p><p>${html(brand_1.brand.contact)}</p></div>`;
}
