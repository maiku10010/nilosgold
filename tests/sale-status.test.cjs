const {test}=require('node:test');
const assert=require('node:assert/strict');
const {updateSaleJobStatus}=require('../dist/saleJobStatus');
test('workshop status changes preserve historical prices and overpayments',async()=>{
  const sale={invoiceId:'S',status:'FINISHED',price:0,payments:[{amount:1000}],job:{jobCostId:'J',status:'IN_PROGRESS'}};
  const writes=[];
  const tx={sales:{findFirst:async()=>sale},job_Cost:{update:async args=>writes.push(args)}};
  for(const status of ['READY_FOR_PICKUP','FINISHED','RELEASED','IN_PROGRESS'])await updateSaleJobStatus(tx,'S',status);
  assert.deepEqual(writes.map(w=>w.data.status),['READY_FOR_PICKUP','FINISHED','RELEASED','IN_PROGRESS']);
  assert.equal(sale.price,0);assert.equal(sale.payments[0].amount,1000);assert.equal(sale.status,'FINISHED');
});
test('partially paid and unpaid workshop invoices can be released without inventing payments',async()=>{
  for(const status of ['PARTIAL','PENDING']){
    const sale={status,price:1000,payments:[],job:{jobCostId:'J',status:'READY_FOR_PICKUP'}};
    let updated;
    const tx={sales:{findFirst:async()=>sale},job_Cost:{update:async args=>{updated=args.data.status;}}};
    await updateSaleJobStatus(tx,'S','RELEASED');assert.equal(updated,'RELEASED');assert.deepEqual(sale.payments,[]);assert.equal(sale.status,status);
  }
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
