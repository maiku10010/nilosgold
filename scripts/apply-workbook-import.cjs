// Applies a reviewed plan atomically and aborts if affected database rows changed
// after the point-in-time backup.
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({quiet:true});
const {Client}=require('pg');
require('pg').types.setTypeParser(1114,value=>value);
async function main(){
 const dir=process.argv[2];if(!dir)throw Error('Supply the import directory');
 const plan=JSON.parse(fs.readFileSync(path.join(dir,'plan.json')));
 const before=JSON.parse(fs.readFileSync(path.join(dir,'before.json')));
 const db=new Client({connectionString:process.env.DIRECT_URL||process.env.DATABASE_URL});await db.connect();
 try{
  await db.query('BEGIN');
  for(const table of ['clients','sales','sale_payments','job_costs','expenses','inventory']){
   const key={clients:'clientId',sales:'invoiceId',sale_payments:'payment_id',job_costs:'jobCostId',expenses:'expenseId',inventory:'referenceId'}[table];
   const got=(await db.query(`SELECT "${key}" AS id FROM public.${table} ORDER BY "${key}"`)).rows.map(x=>x.id);
   const expected=before[`${table}_ids`]||before[table].map(x=>x[key]).sort();
   if(JSON.stringify(got)!==JSON.stringify(expected))throw Error(`${table} changed since backup; import stopped without applying data.`);
  }
  await db.query('DELETE FROM public.sale_payments');
  await db.query('DELETE FROM public.sales');
  await db.query('DELETE FROM public.job_cost_items');
  await db.query('DELETE FROM public.job_costs');
  for(const c of plan.clients) await db.query(`INSERT INTO public.clients ("clientId","clientName","contactNum",email,"createdAt","updatedAt","deletedAt") VALUES ($1,$2,$3,$4,$5,$6,NULL)`,[c.clientId,c.clientName,c.contactNum,c.email,c.createdAt,c.updatedAt]);
  for(const j of plan.jobs)await db.query(`INSERT INTO public.job_costs ("jobCostId",universal_reference_id,item_name,date,client_id,"goldUsed","goldCostPerG",gold_scrap,"stoneCost","laborCost",labor_charge,other_cost,status,"empId","inquiryId",service_type)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NULL,NULL,$14)`,[j.jobCostId,j.universal_reference_id,j.item_name,j.date,j.client_id,j.goldUsed,j.goldCostPerG,j.gold_scrap,j.stoneCost,j.laborCost,j.labor_charge,j.other_cost,j.status,plan.sales.find(s=>s.jobCostId===j.jobCostId)?.serviceType]);
  for(const s of plan.sales) await db.query(`INSERT INTO public.sales ("invoiceId",universal_reference_id,"serviceType",price,price_confirmed,description,status,date,"clientId","jobCostId")
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[s.invoiceId,s.universal_reference_id,s.serviceType,s.price,s.price_confirmed,s.description,s.status,s.date,s.clientId,s.jobCostId]);
  for(const i of plan.items)await db.query(`INSERT INTO public.job_cost_items (item_id,job_cost_id,description,line_price,gold_grams,gold_cost,stone_cost,labor_cost,labor_charge,other_cost) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[i.item_id,i.job_cost_id,i.description,i.price,i.gold_grams,i.gold_cost,i.stone_cost,i.labor_cost,i.labor_charge,i.other_cost]);
  for(const p of plan.payments)await db.query(`INSERT INTO public.sale_payments (payment_id,invoice_id,amount,paid_at,payment_number,method,notes) VALUES ($1,$2,$3,$4,$5,$6,$7)`,[p.payment_id,p.invoice_id,p.amount,p.paid_at,p.payment_number,p.method,p.notes]);
  for(const e of plan.expenses)await db.query(`INSERT INTO public.expenses ("expenseId",category,amount,description,date,"deletedAt") VALUES ($1,$2,$3,$4,$5,NULL) ON CONFLICT ("expenseId") DO UPDATE SET category=EXCLUDED.category,amount=EXCLUDED.amount,description=EXCLUDED.description,date=EXCLUDED.date,"deletedAt"=NULL`,[e.expenseId,e.category,e.amount,e.description,e.date]);
  for(const id of plan.archiveExpenses)await db.query(`UPDATE public.expenses SET "deletedAt"=now() WHERE "expenseId"=$1`,[id]);
  await db.query(`UPDATE public.inventory SET "deletedAt"=now() WHERE "deletedAt" IS NULL`);
  for(const i of plan.inventory)await db.query(`INSERT INTO public.inventory ("referenceId",universal_reference_id,"itemName",unit,"unitPrice",category,gold_karat,"quantityIn","quantityOut","quantityLoss",date,"deletedAt","jobCostId",source_date)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,NULL,$12)`,[i.referenceId,i.universal_reference_id,i.itemName,i.unit,i.unitPrice,i.category,i.gold_karat,i.quantityIn,i.quantityOut,i.quantityLoss,i.date,i.date]);
  await db.query('DELETE FROM public.workbook_import_issues WHERE source_hash=$1',[plan.sha256]);
  for(let ix=0;ix<plan.issues.length;ix++){const issue=plan.issues[ix];await db.query(`INSERT INTO public.workbook_import_issues (issue_id,source_hash,message,details) VALUES ($1,$2,$3,$4)`,[`workbook-${plan.sha256.slice(0,12)}-${String(ix+1).padStart(4,'0')}`,plan.sha256,issue.message,issue.detail==null?null:JSON.stringify(issue.detail)]);}
  await db.query('COMMIT');console.log(JSON.stringify(plan.summary));
 }catch(e){await db.query('ROLLBACK');throw e;}finally{await db.end();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
