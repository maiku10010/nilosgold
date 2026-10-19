import 'dotenv/config';

export const brand = {
  name: process.env.NEXT_PUBLIC_APP_NAME?.trim() || 'Goldsmith OS',
  receiptFooter: process.env.APP_RECEIPT_FOOTER?.trim() || 'Thank you for supporting our craft.',
  contact: process.env.APP_CONTACT?.trim() || 'Contact the shop to arrange collection.',
};
