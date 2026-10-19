// Append the reviewed October CSV without DDL or changes to existing records.
// Source JSON and backups contain customer data and belong in ignored outputs/.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
require('dotenv').config({ quiet: true });
const { Client } = require('pg');
const overrides = {11:31500,23:200,56:13580,211:1500,447:2200,660:0,726:1500};
function cents(value, allowDeposit = false) {
  let s = String(value ?? '').trim().replace(/[₱,\s]/g, '');
  if (!s || s === '-') return null;
  if (allowDeposit) s = s.replace(/^d\/p/i, '');
  // Postgres unconstrained numeric columns return additional trailing zeros.
  if(s.includes('.')) s=s.replace(/0+$/,'').replace(/\.$/,'');
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw Error(`Invalid monetary value: ${value}`);
  const n = Math.round(Number(s) * 100);
  assert(Number.isSafeInteger(n));
  return n;
}
function date(value) {
  const m = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  assert(m, `Invalid source date: ${value}`);
  const s = `${m[3]}-${m[2]}-${m[1]}`;
  assert.equal(new Date(s).toISOString().slice(0,10), s);
  return s;
}
const cash = n => n == null ? null : (n / 100).toFixed(2);
function allocator(used) {
  const ids = new Set(used);
  return d => {
    const prefix = d.split('-').map(Number).join('-') + '-T';
    let n = 1;
    while (ids.has(prefix + String(n).padStart(3,'0'))) n++;
    const id = prefix + String(n).padStart(3,'0'); ids.add(id); return id;
  };
}
function build(source, before) {
  assert.equal(source.original.length,748); assert.equal(source.cleaned.length,748);
  const rows = source.original.map((o,i) => {
    const c = source.cleaned[i];
    return { row:i+1, original:o, cleaned:c, date:date(c.Date),
      price: Object.hasOwn(overrides,i+1) ? overrides[i+1]*100 : cents(o.Total),
      paid:cents(o.Paid,true), description:c.Description };
  });
  assert.equal(rows.reduce((s,r)=>s+(r.price??0),0),355044900);
  assert.equal(source.original.reduce((s,r)=>s+(cents(r.Total)??0),0),354727000);
  const groups=[];
  for (const r of rows) {
    if (r.cleaned.Row_Type === 'Line item (continuation)') {
      const g=groups.at(-1); assert(g);
      assert.equal(g.rows[0].cleaned.Job_ID,r.cleaned.Job_ID);
      assert.equal(g.rows[0].cleaned.Customer,r.cleaned.Customer);
      g.rows.push(r);
    } else groups.push({rows:[r]});
  }
  const clients=[],sales=[],jobs=[],items=[],payments=[];
  const nextClient=allocator(before.clients_ids),nextSale=allocator(before.sales_ids),nextJob=allocator(before.job_costs_ids);
  for (const g of groups) {
    const first=g.rows[0], c=first.cleaned, invoiceId=nextSale(first.date), jobId=nextJob(first.date);
    const phone=c.Phone && !/Placeholder/.test(c.Phone_Status) ? c.Phone : null;
    let client=[...before.clients,...clients].find(x=>!x.deletedAt && x.clientName===c.Customer && (x.contactNum??null)===phone);
    if(!client) {client={clientId:nextClient(first.date),clientName:c.Customer||`Unidentified CSV row ${first.row}`,contactNum:phone}; clients.push(client);}
    const known=g.rows.some(r=>r.price!==null), price=known ? g.rows.reduce((s,r)=>s+(r.price??0),0) : null;
    const paid=g.rows.reduce((s,r)=>s+(r.paid??0),0);
    const done=c.Status==='Done';
    const description=g.rows.map(r=>r.description).filter(Boolean).join('\n');
    const service=/resize|resized|adjust/i.test(description)?'Resize':/repair|solda|plating|rhodium|rodium/i.test(description)?'Repair':/clean/i.test(description)?'Cleaning':'Custom';
    jobs.push({id:jobId,date:first.date,clientId:client.clientId,reference:c.Job_ID||null,description,service,status:done?'FINISHED':'IN_PROGRESS'});
    sales.push({id:invoiceId,jobId,date:first.date,clientId:client.clientId,reference:c.Job_ID||null,description,service,price:cash(price),confirmed:known,
      status:price===null?'PENDING':paid>=price?(done?'FINISHED':'PAID'):paid>0?'PARTIAL':'PENDING'});
    for(const r of g.rows) {
      items.push({id:`csv-20261019-row-${r.row}`,jobId,description:r.description,price:cash(r.price)});
      if(r.paid!==null && r.paid!==0) {
        assert(r.paid>0,'Negative receipts require explicit handling');
        payments.push({id:`csv-20261019-row-${r.row}`,invoiceId,amount:cash(r.paid),date:r.date,method:r.cleaned.Payment_Method||null,
          notes:`Original CSV row ${r.row}; recorded paid: ${r.original.Paid}; original balance: ${r.original.Balance}; ${r.cleaned.Row_Type}; ${r.original.Notes||''}`});
      }
    }
  }
  assert.equal(items.length,748);
  assert.equal(sales.reduce((s,r)=>s+(cents(r.price)??0),0),355044900);
  const differences=rows.filter(r=> {
    const v=String(r.original.Paid).replace(/[₱,\s]/g,'');
    return (!v || v==='-' || /^\d+(\.\d+)?$/.test(v)) && (r.paid??0)!==(cents(r.cleaned.Paid_PHP)??0);
  });
  assert.equal(differences.length,48);
  const report=['# Recorded payment comparison','', 'Original CSV row numbers; original amounts are retained. Blank means not recorded, not a confirmed zero.','', '| Row | Customer | Original paid | Cleaned paid |','|---|---|---:|---:|',
    ...differences.map(r=>`| ${r.row} | ${r.cleaned.Customer.replace(/\|/g,'/')} | ${r.original.Paid.trim()||'Blank'} | ${r.cleaned.Paid_PHP||'Blank'} |`)];
  const summary={sourceRows:rows.length,clients:clients.length,sales:sales.length,jobs:jobs.length,items:items.length,payments:payments.length,
    total:cash(355044900),paid:cash(payments.reduce((s,r)=>s+cents(r.amount),0)),originalPaymentsPreserved:true,priceOverrides:overrides,
    row587Price:cash(rows[586].price),collectionRows:rows.filter(r=>r.cleaned.Row_Type==='Collection / balance payment').length};
  return {clients,sales,jobs,items,payments,summary,report:report.join('\n')+'\n'};
}
async function main(){
  const dir=process.argv[2]; assert(dir,'Supply ignored import directory');
  const source=JSON.parse(fs.readFileSync(path.join(dir,'source.json'),'utf8').replace(/^\uFEFF/,''));
  const before=JSON.parse(fs.readFileSync(path.join(dir,'before.json')));
  const plan=build(source,before);
  fs.writeFileSync(path.join(dir,'plan.json'),JSON.stringify(plan,null,2));
  fs.writeFileSync(path.join(dir,'payment-changes.md'),plan.report);
  if(!process.argv.includes('--apply')) {console.log(JSON.stringify(plan.summary));return;}
  const url=process.env.DIRECT_URL||process.env.DATABASE_URL;
  assert(new URL(url).username.endsWith('.zbckqjrlaeozkzdpvtog'),'Unexpected target project');
  const db=new Client({connectionString:url});await db.connect();
  const insert=async(table,columns,rows)=>{
    for(let start=0;start<rows.length;start+=100){
      const batch=rows.slice(start,start+100),args=[];
      const values=batch.map(row=>'('+row.map(value=>{args.push(value);return '$'+args.length;}).join(',')+')');
      await db.query(`INSERT INTO public.${table} (${columns.map(c=>'"'+c+'"').join(',')}) VALUES ${values.join(',')}`,args);
    }
  };
  const schema=async()=>JSON.stringify((await db.query(`SELECT c.relname, a.attname, a.atttypid, a.atttypmod, a.attnotnull, pg_get_expr(d.adbin,d.adrelid) AS default_expr
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`)).rows);
  try{
    await db.query('BEGIN');
    await db.query('LOCK TABLE public.clients,public.sales,public.sale_payments,public.job_costs,public.job_cost_items IN SHARE ROW EXCLUSIVE MODE');
    const schemaBefore=await schema();
    for(const [table,key] of Object.entries({clients:'clientId',sales:'invoiceId',sale_payments:'payment_id',job_costs:'jobCostId'})) {
      const ids=(await db.query(`SELECT "${key}" AS id FROM public.${table} ORDER BY "${key}"`)).rows.map(r=>r.id);
      assert.deepEqual(ids,before[`${table}_ids`],`${table} changed since backup`);
    }
    await insert('clients',['clientId','clientName','contactNum','updatedAt'],plan.clients.map(c=>[c.clientId,c.clientName,c.contactNum,new Date()]));
    await insert('job_costs',['jobCostId','date','client_id','universal_reference_id','item_name','service_type','status'],plan.jobs.map(j=>[j.id,j.date,j.clientId,j.reference,j.description,j.service,j.status]));
    await insert('sales',['invoiceId','jobCostId','date','clientId','universal_reference_id','description','serviceType','price','price_confirmed','status'],plan.sales.map(s=>[s.id,s.jobId,s.date,s.clientId,s.reference,s.description,s.service,s.price,s.confirmed,s.status]));
    await insert('job_cost_items',['item_id','job_cost_id','description','line_price'],plan.items.map(i=>[i.id,i.jobId,i.description,i.price]));
    await insert('sale_payments',['payment_id','invoice_id','amount','paid_at','method','notes'],plan.payments.map(p=>[p.id,p.invoiceId,p.amount,p.date+'T00:00:00+08:00',p.method,p.notes]));
    const stored=(await db.query('SELECT "invoiceId" AS id, price::text,description FROM public.sales WHERE "invoiceId"=ANY($1::text[]) ORDER BY "invoiceId"',[plan.sales.map(s=>s.id)])).rows;
    assert.equal(stored.length,plan.sales.length);
    const saleMap=new Map(plan.sales.map(s=>[s.id,s]));
    for(const s of stored){assert.equal(cents(s.price),cents(saleMap.get(s.id).price));assert.equal(s.description,saleMap.get(s.id).description);}
    const storedItems=(await db.query("SELECT item_id,description,line_price::text FROM public.job_cost_items WHERE item_id LIKE 'csv-20261019-row-%' ORDER BY item_id")).rows;
    assert.equal(storedItems.length,748);
    const itemMap=new Map(plan.items.map(i=>[i.id,i]));
    for(const i of storedItems){assert.equal(i.description,itemMap.get(i.item_id).description);assert.equal(cents(i.line_price),cents(itemMap.get(i.item_id).price));}
    const storedPayments=(await db.query("SELECT payment_id,amount::text FROM public.sale_payments WHERE payment_id LIKE 'csv-20261019-row-%'")).rows;
    assert.equal(storedPayments.length,plan.payments.length);
    const paymentMap=new Map(plan.payments.map(p=>[p.id,p]));
    for(const p of storedPayments)assert.equal(cents(p.amount),cents(paymentMap.get(p.payment_id).amount));
    assert.equal(await schema(),schemaBefore,'Schema changed');
    await db.query('COMMIT');
    const result={...plan.summary,schemaFingerprint:crypto.createHash('sha256').update(schemaBefore).digest('hex'),committed:true};
    fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }catch(e){await db.query('ROLLBACK');throw e;}finally{await db.end();}
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1});
module.exports={build,cents};
