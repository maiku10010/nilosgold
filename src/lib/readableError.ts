const labels: Record<string, string> = {
  goldCostPerG: 'gold price per gram', goldPricePerG: 'gold price per gram', goldUsed: 'gold weight used',
  goldScrap: 'gold scrap weight', goldSourceId: 'gold source', goldKarat: 'gold karat',
  stoneCost: 'stone cost', laborCost: 'labor cost', laborCharge: 'labor charge', otherCost: 'other costs',
  sellingPrice: 'selling price', quotedPrice: 'quoted price', isFullyPaid: 'payment status',
  itemName: 'item description', clientName: 'client name', customerName: 'customer name',
  contactNum: 'contact number', contactInfo: 'contact number', empId: 'employee',
  quantityIn: 'stock received', quantityOut: 'stock used', quantityLoss: 'stock lost',
  unitPrice: 'unit price', invoiceId: 'invoice number', jobCostId: 'job number',
  referenceId: 'reference number', inquiryId: 'inquiry number', expenseId: 'expense number',
  clientId: 'client', userName: 'username', deliveryDate: 'delivery date',
  salesDate: 'sale date', inqDate: 'inquiry date', expDate: 'expense date', updatedAt: 'last update',
};
export function fieldLabel(field: string): string {
  return labels[field] ?? field.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();
}
export function readableError(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return 'Something went wrong. Please try again.';
  if (/prisma|\bP\d{4}\b|DATABASE_URL|DIRECT_URL|AUTH_SECRET|SQLSTATE|stack trace|\bat .*:\d+:\d+|Invalid .* invocation/i.test(value))
    return 'We could not complete this request. Please try again. If it keeps happening, ask an administrator for help.';
  if (/failed to fetch|networkerror|load failed/i.test(value)) return 'Could not connect. Check your internet connection and try again.';
  let message = value.replace(/\b[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*\b/g, word => fieldLabel(word))
    .replace(/non-negative/gi, 'zero or greater').replace(/or null when unknown/gi, 'or leave it blank if unknown')
    .replace(/Internal Server Error/gi, 'Something went wrong. Please try again.')
    .replace(/Request origin is not allowed\./g, 'Open the official website and try again.');
  return message.charAt(0).toUpperCase() + message.slice(1);
}
