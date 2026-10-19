const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.NEXT_PUBLIC_APP_NAME = 'Demo <Studio> & Co';
process.env.APP_RECEIPT_FOOTER = 'Thank you <friend>';
process.env.APP_CONTACT = 'Call <demo> for collection';
const { receiptEmail, readyEmail } = require('../dist/services/email');

test('receipt and ready emails escape configured branding and customer text', () => {
  const client = { clientName: '<Customer>', email: 'customer@example.com' };
  const receipt = receiptEmail({ invoiceId: 'INV-1', serviceType: 'Repair', price: 1000, payment: 500, salesDate: new Date(), client });
  const ready = readyEmail({ jobCostId: 'JOB-1', sales: { invoiceId: 'INV-1', client } });
  for (const content of [receipt, ready]) {
    assert.match(content, /Demo &lt;Studio&gt; &amp; Co/);
    assert.match(content, /&lt;Customer&gt;/);
    assert.doesNotMatch(content, /Nilo|<Studio>|<Customer>/);
  }
  assert.match(receipt, /Thank you &lt;friend&gt;/);
  assert.match(ready, /Call &lt;demo&gt; for collection/);
});
