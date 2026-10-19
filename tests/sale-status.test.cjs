const {test}=require('node:test');
const assert=require('node:assert/strict');
const {updateSaleJobStatus}=require('../dist/saleJobStatus');
test('workshop status changes preserve historical prices and overpayments',async()=>{
  const sale={invoiceId:'S',status:'FINISHED',price:0,payments:[{amount:1000}],job:{jobCostId:'J',status:'IN_PROGRESS'}};
  const writes=[];
  const tx={sales:{findFirst:async()=>sale},job_Cost:{update:async args=>writes.push(args)}};
  for(const status of ['READY_FOR_PICKUP','FINISHED','IN_PROGRESS'])await updateSaleJobStatus(tx,'S',status);
  assert.deepEqual(writes.map(w=>w.data.status),['READY_FOR_PICKUP','FINISHED','IN_PROGRESS']);
  assert.equal(sale.price,0);assert.equal(sale.payments[0].amount,1000);assert.equal(sale.status,'FINISHED');
});
test('invalid, archived, and unfinished workflow records cannot be changed',async()=>{
  let sale={status:'PENDING',job:{jobCostId:'J',status:'APPROVED'}};
  const tx={sales:{findFirst:async()=>sale},job_Cost:{update:async()=>assert.fail('Must not write')}};
  await assert.rejects(updateSaleJobStatus(tx,'S','PAID'),e=>e.statusCode===400);
  await assert.rejects(updateSaleJobStatus(tx,'S','FINISHED'),e=>e.statusCode===409);
  sale={status:'FINISHED',job:{deletedAt:new Date(),status:'FINISHED'}};
  await assert.rejects(updateSaleJobStatus(tx,'S','IN_PROGRESS'),e=>e.statusCode===404);
  sale=null;
  await assert.rejects(updateSaleJobStatus(tx,'S','FINISHED'),e=>e.statusCode===404);
});
