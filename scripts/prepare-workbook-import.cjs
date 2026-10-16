// Pure reconciliation: reads source/backup JSON and writes a reviewable plan.
const fs = require('node:fs');
const path = require('node:path');
const clean = v => v == null ? '' : String(v).trim().replace(/\s+/g, ' ');
const norm = v => clean(v).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const descNorm = v => norm(v).replace(/[0-9]/g,'');
const money = n => Math.round((n + Number.EPSILON) * 100) / 100;
function number(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return money(v);
  const s = clean(v).replace(/,/g,'');
  if (/^\d+(\.\d+)?$/.test(s)) return money(Number(s));
  if (/^\d+(\.\d+)?(\+\d+(\.\d+)?)+$/.test(s)) return money(s.split('+').reduce((a,b)=>a+Number(b),0));
  const dp = s.match(/^d\/?p\s*(\d+(\.\d+)?)$/i);
  return dp ? Number(dp[1]) : null;
}
function dateValue(v) {
  let s=clean(v), m=s.match(/^(\d{4})-(\d\d)-(\d\d)/);
  if(m && Number(m[1])>=2000) return `2026-${m[2]}-${m[3]}`;
  s=s.replace(/\./g,'').replace(/\s+/g,'/');
  m=s.match(/^(\d{1,2})\/(\d{1,2})\/?(2026|26)$/) || s.match(/^(\d{2})(\d{2})\/(26)$/);
  if(!m) return null;
  const d=`2026-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  return !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0,10)===d ? d : null;
}
function allocator(existing=[]) {
  const used=new Set(existing);
  return d=>{const prefix=d.split('-').map(Number).join('-')+'-T';let n=1;while(used.has(prefix+String(n).padStart(3,'0')))n++;const id=prefix+String(n).padStart(3,'0');used.add(id);return id;};
}
const sum = (rows,key) => money(rows.reduce((s,r)=>s+(r[key]||0),0));
function delivered(s) {return /\b(done|taken|finished|delivered)\b/i.test(s)&&!/(not|yet|un)[\s\w]{0,12}(done|taken|finished|delivered)/i.test(s);}
function explicitPaid(s) {return /\bpaid\b/i.test(s)&&!/(not|un|partially|partial|fully)[\s\w]{0,8}paid/i.test(s.replace(/fully paid/gi,'paid'));}
function build(source,before) {
 const sheets=source.sheets, issues=[], fixes=[], merges=[], rowMap=new Map(), invoices=[];
 const flag=(sheet,row,message,detail)=>issues.push({sheet,row,message,detail});
 const fix=(sheet,row,message)=>fixes.push({sheet,row,message});
 const dateOverrides={245:'2026-05-27',351:'2026-07-01',680:'2026-09-26',681:'2026-09-26',707:'2026-10-03'};
 let lastDate=null,current=null;
 for(const r of sheets['Daily Sales']) {
  const v=r.values;
  if(r.row<9||(!v[3]&&!v[4]))continue;
  const d=dateOverrides[r.row]||dateValue(v[0])||lastDate;
  if(!d)throw Error(`No date for Daily Sales ${r.row}`);
  if(v[0] && clean(v[0]).slice(0,10)!==d)fix('Daily Sales',r.row,`Date normalized from ${v[0]} to ${d}`);
  if(!v[0]&&v[3])fix('Daily Sales',r.row,`Missing date carried forward: ${d}`);
  if(v[0]||v[3])lastDate=d;
  const continuation=!v[0]&&!v[1]&&!v[3];
  if(!continuation) {
   current={row:r.row,date:d,legacy:v[1]==null?null:clean(v[1]),name:clean(v[3]),contact:v[2],lines:[],payments:[],notes:[],costRows:[],mergedInto:null};
   if(!current.name){current.name=`Unidentified client (Daily Sales row ${r.row})`;flag('Daily Sales',r.row,'Client name missing; kept a separate unidentified client');}
   invoices.push(current);
  }
  if(!current)throw Error(`Unattached continuation ${r.row}`);
  const line={row:r.row,description:clean(v[4]),price:number(v[5]),payment:number(v[6]),balance:number(v[7]),method:clean(v[8]),status:clean(v[9]),extra:typeof v[10]==='string'?clean(v[10]):'',costs:[]};
  current.lines.push(line);rowMap.set(r.row,{invoice:current,line});
  if(line.payment>0)current.payments.push({amount:line.payment,date:d,method:line.method||null,source:`Daily Sales!G${r.row}`});
 }
 // Cost sheet formulas are stronger keys than repeated / shifted invoice numbers.
 for(const r of sheets['Job Costing']) {
  if(r.row<5)continue;
  const f=r.formulas;const refs=['B','L','A'].map(k=>Number((f[k]||'').match(/'Daily Sales'!\$?[A-Z]+\$?(\d+)/)?.[1])).filter(Boolean);
  const targets=[...new Set(refs)].filter(n=>rowMap.has(n));
  if(!targets.length){if(r.values.slice(0,12).some(v=>v))flag('Job Costing',r.row,'Cost row has no traceable sales row',r.values.slice(0,12));continue;}
  let target=targets[0];
  const b=Number((f.B||'').match(/D(\d+)/)?.[1]),l=Number((f.L||'').match(/F(\d+)/)?.[1]);
  if(b&&l&&b!==l)flag('Job Costing',r.row,'Client and price formulas refer to different sales rows',{clientRow:b,priceRow:l});
  if(new Set(refs).size>1)fix('Job Costing',r.row,`Used client/price link Daily Sales!${target}; corrected inconsistent invoice formula`);
  const entry=rowMap.get(target);entry.line.costs.push(r);entry.invoice.costRows.push(r.row);
 }
 for(const inv of invoices) {
  inv.price=sum(inv.lines,'price');inv.priceKnown=inv.lines.every(l=>l.price!==null||(!l.payment&&!l.balance));
  if(inv.lines.every(l=>l.price===null))inv.priceKnown=false;
  inv.description=inv.lines.map(l=>l.description).filter(Boolean).join('\n');
  // Some price cells are blank while the linked costing row carries the invoice total.
  for(const l of inv.lines) if(l.price===null&&l.costs.some(r=>number(r.values[12])>0)) {
   l.price=sum(l.costs.map(r=>({price:number(r.values[12])})).filter(x=>x.price!==null),'price');
   fix('Job Costing',l.costs[0].row,`Filled missing sales price from linked costing total: ${l.price}`);
  }
  inv.price=sum(inv.lines,'price');inv.priceKnown=inv.lines.some(l=>l.price!==null)&&inv.lines.every(l=>l.price!==null||(!l.payment&&!l.balance));
  inv.rawStatus=inv.lines.map(l=>l.status).filter(Boolean).join('; ');
  inv.cancelled=inv.lines.some(l=>/cancel|pull\s*out/i.test(l.status+' '+l.extra));
  inv.delivered=inv.lines.filter(l=>l.price!==null).every(l=>delivered(l.status||inv.lines[0].status));
  if(!inv.lines.some(l=>l.price!==null))inv.delivered=delivered(inv.rawStatus);
 }
 // Collectables is a cumulative schedule, not additional cash receipts.
 for(const r of sheets.Collectables) {
  if(r.row<3||!r.values[1])continue;
  const v=r.values,name=norm(v[1]),desc=norm(v[2]);
  let matches=invoices.filter(i=>norm(i.name)===name&&norm(i.description)===desc);
  if(matches.length!==1)matches=invoices.filter(i=>norm(i.name)===name&&i.date===dateValue(v[0])&&i.lines.some(l=>norm(l.description)===desc));
  if(matches.length!==1){flag('Collectables',r.row,'No unique matching invoice',v.slice(0,11));continue;}
  const inv=matches[0], price=number(v[3]),known=v.slice(4,8).map(number), paid=money(known.reduce((a,b)=>a+(b||0),0)),balance=number(v[8]);
  inv.collectable={row:r.row,price,paid,balance,status:clean(v[9]),paidText:clean(v[8]).toLowerCase()==='paid',payments:known};
  if(!inv.priceKnown&&price!==null){inv.price=price;inv.priceKnown=true;fix('Collectables',r.row,`Established invoice price ${price}`);}
  else if(price!==inv.price){flag('Collectables',r.row,'Invoice total conflicts with Daily Sales',{invoiceRow:inv.row,daily:inv.price,collectables:price});continue;}
  if(paid>inv.price){flag('Collectables',r.row,'Installments exceed invoice price',{price,paid});continue;}
  const numericBalanceValid=balance!==null&&money(price-paid)===balance;
  if(balance!==null&&!numericBalanceValid)flag('Collectables',r.row,'Payment total and balance do not reconcile',{price,paid,balance,computedBalance:money(price-paid)});
  const dailyPaid=sum(inv.payments,'amount');
  // Only add proven cumulative differences. Dates absent in the schedule stay unknown.
  if(paid>dailyPaid && (numericBalanceValid||balance===null)) {
   let covered=dailyPaid;
   for(let ix=0;ix<known.length;ix++) {const amt=known[ix]||0,additional=Math.max(0,amt-covered);covered=Math.max(0,covered-amt);if(additional)inv.payments.push({amount:additional,date:null,method:null,source:`Collectables!${String.fromCharCode(69+ix)}${r.row}`});}
  }
  if(inv.collectable.paidText && sum(inv.payments,'amount')<inv.price) {
   inv.payments.push({amount:money(inv.price-sum(inv.payments,'amount')),date:null,method:null,source:`Collectables!I${r.row}: explicitly marked paid; date not recorded`});
   fix('Collectables',r.row,'Reconciled undated remaining payment from explicit paid status');
  }
  // A later explicit done/taken entry can supersede older unfinished wording.
  if(delivered(clean(v[9])))inv.delivered=true;
 }
 // Match balance-only receipts only when one exact client/item and exact balance match exists.
 for(const later of invoices) {
  const paid=sum(later.payments,'amount');
  if(later.cancelled||paid<=0||paid!==later.price)continue;
  const candidates=invoices.filter(earlier=>earlier.row<later.row&&!earlier.mergedInto&&!earlier.cancelled&&earlier.priceKnown&&norm(earlier.name)===norm(later.name)&&norm(earlier.description)===norm(later.description)&&money(earlier.price-sum(earlier.payments,'amount'))===paid);
  if(candidates.length===1) {
   const earlier=candidates[0];later.mergedInto=earlier.row;earlier.payments.push(...later.payments);earlier.delivered=earlier.delivered||later.delivered;
   earlier.legacy=[earlier.legacy,later.legacy].filter(Boolean).join(',')||null;
   merges.push({invoiceRow:earlier.row,paymentRow:later.row,client:later.name,price:earlier.price,payment:paid,legacy:later.legacy});
  } else if(candidates.length>1)flag('Daily Sales',later.row,'Multiple exact balance-payment candidates; kept separate',candidates.map(i=>i.row));
 }
 for(const inv of invoices) {
  if(inv.mergedInto)continue;
  if(/collect[aei]ble|balance payment|refund/i.test(inv.description))flag('Daily Sales',inv.row,'Possible payment or refund; no exact unambiguous original invoice match. Kept separate.',inv.description);
  const earlier=invoices.filter(i=>i.row<inv.row&&!i.mergedInto&&norm(i.name)===norm(inv.name)&&norm(i.description)===norm(inv.description)&&i.price>sum(i.payments,'amount'));
  if(earlier.length)flag('Daily Sales',inv.row,'Repeated client/item did not reconcile exactly; kept separate',earlier.map(i=>i.row));
  let paid=sum(inv.payments,'amount');
  // Explicit paid text is evidence of settlement, but does not establish a payment date.
  if(inv.priceKnown&&paid<inv.price&&inv.lines.some(l=>explicitPaid(l.status))) {
   inv.payments.push({amount:money(inv.price-paid),date:null,method:null,source:`Daily Sales!J${inv.row}: explicit paid status; payment date unknown`});
   fix('Daily Sales',inv.row,'Added undated settlement supported by explicit paid status');paid=inv.price;
  }
  if(!inv.priceKnown)flag('Daily Sales',inv.row,'Price missing or incomplete; stored known amount and marked price unconfirmed',inv.lines.map(l=>({row:l.row,price:l.price,payment:l.payment,balance:l.balance})));
  if(inv.priceKnown&&paid>inv.price)flag('Daily Sales',inv.row,'Payment exceeds stated price; retained actual cash and flagged excess',{price:inv.price,paid,excess:money(paid-inv.price)});
  if(paid<inv.price&&inv.delivered)flag('Daily Sales',inv.row,'Done/taken but not fully paid; retained outstanding balance',{price:inv.price,paid});
  if(inv.cancelled&&paid)flag('Daily Sales',inv.row,'Cancelled/pulled out with recorded payment; refund or transfer needs review',{paid});
  inv.status=inv.cancelled?'CANCELLED':!inv.priceKnown?'PENDING':paid>=inv.price?(inv.delivered?'FINISHED':'PAID'):paid>0?'PARTIAL':'PENDING';
 }
 const getId=allocator(before.sales.map(s=>s.invoiceId)),getJob=allocator(before.job_costs.map(s=>s.jobCostId)),getItem=allocator(),getPay=allocator(),getClient=allocator(before.clients.map(c=>c.clientId));
 const clients=[],sales=[],jobs=[],items=[],payments=[];
 for(const inv of invoices.filter(i=>!i.mergedInto).sort((a,b)=>a.date.localeCompare(b.date)||a.row-b.row)) {
  let contact=clean(inv.contact).match(/(?:\+?63|0)?(9\d{9})/);contact=contact?'0'+contact[1]:null;
  const matches=[...before.clients,...clients].filter(c=>norm(c.clientName)===norm(inv.name)&&!c.deletedAt);
  let client=matches.length===1?matches[0]:matches.find(c=>contact&&c.contactNum===contact);
  if(!client){client={clientId:getClient(inv.date),clientName:inv.name,contactNum:contact,email:null,createdAt:inv.date+'T00:00:00Z',updatedAt:'2026-10-16T00:00:00Z',deletedAt:null};clients.push(client);}
  inv.id=getId(inv.date);inv.jobId=getJob(inv.date);inv.clientId=client.clientId;
  const job={jobCostId:inv.jobId,universal_reference_id:inv.legacy,item_name:inv.description||null,date:inv.date,client_id:client.clientId,goldUsed:0,goldCostPerG:0,gold_cost:0,gold_scrap:0,stoneCost:0,laborCost:0,labor_charge:0,other_cost:0,status:inv.cancelled?'CANCELLED':inv.delivered?'FINISHED':'IN_PROGRESS'};
  for(const line of inv.lines) {
   const costs=line.costs.length?line.costs:[null];
   for(const r of costs) {
    const v=r?.values||[], val=i=>number(v[i]);let grams=val(2),rate=val(3),gold=val(5);
    if(grams===null&&rate>0&&rate<20&&gold>0){grams=rate;rate=money(gold/grams);fix('Job Costing',r.row,'Moved gram quantity from cost/gram column; derived rate from recorded gold cost');}
    if(gold===null&&grams!==null&&rate!==null)gold=money(grams*rate);
    if(gold!==null&&grams>0)rate=money(gold/grams);
    const item={item_id:getItem(inv.date),job_cost_id:inv.jobId,description:line.description||null,price:line.price,gold_grams:grams,gold_cost:gold,stone_cost:val(6),labor_cost:val(7),labor_charge:val(8),other_cost:val(9),source_sales_row:line.row,source_cost_row:r?.row||null};
    items.push(item);job.goldUsed+=grams||0;job.gold_cost+=gold||0;job.stoneCost+=item.stone_cost||0;job.laborCost+=item.labor_cost||0;job.labor_charge+=item.labor_charge||0;job.other_cost+=item.other_cost||0;
    if(!r)flag('Daily Sales',line.row,'No detailed costing row; unknown costs retained as null in cost items');
    if(r&&v[10]!=null&&number(v[10])!==null&&Math.abs(number(v[10])-sum([item],'gold_cost')-(item.stone_cost||0)-(item.labor_cost||0)-(item.other_cost||0))>.02)fix('Job Costing',r.row,'Recomputed total cost from component amounts');
   }
  }
  for(const k of ['gold_cost','stoneCost','laborCost','labor_charge','other_cost'])job[k]=money(job[k]);
  job.goldUsed=Math.round(job.goldUsed*10000)/10000;job.goldCostPerG=job.goldUsed?money(job.gold_cost/job.goldUsed):0;
  jobs.push(job);
  const desc=inv.description.toLowerCase();const service=/repair|solda|plating|rhodium/.test(desc)?'Repair':/resize|adjust/.test(desc)?'Resize':/clean|polish/.test(desc)?'Cleaning':'Custom';
  sales.push({invoiceId:inv.id,universal_reference_id:inv.legacy,clientId:client.clientId,jobCostId:inv.jobId,serviceType:service,description:inv.description||null,price:inv.priceKnown?inv.price:null,price_confirmed:inv.priceKnown,status:inv.status,date:inv.date});
  inv.payments.forEach((p,n)=>{const sourceRow=Number((p.source.match(/(?:Daily Sales![A-Z]+|Collectables![A-Z]+)(\d+)/)||[])[1])||null;payments.push({payment_id:getPay(p.date||inv.date),invoice_id:inv.id,amount:p.amount,paid_at:p.date,payment_number:n+1,method:p.method,notes:p.source,source_sheet:p.source.startsWith('Collectables!')?'Collectables':'Daily Sales',source_row:sourceRow});});
 }
 // Existing expense IDs are matched by date and description to avoid ID shifts after removing duplicate subtotals.
 const expenses=[],usedExpense=new Set(),expenseIds=allocator(before.expenses.map(e=>e.expenseId));let expenseDate=null;
 for(const r of sheets.Expenses) {
  const v=r.values,d=dateValue(v[0]);if(d)expenseDate=d;
  if(r.row<5)continue;
  if([280,580,776].includes(r.row)){fix('Expenses',r.row,'Subtotal row; not posted twice');continue;}
  let amount=number(v[3]),description=[clean(v[1]),typeof v[2]==='string'?clean(v[2]):''].filter(Boolean).join(' - ');
  if(r.row===278||r.row===279){amount=number(v[4]);description=`Gold ${number(r.row===278?v[5]:v[6])||''} ${r.row===278?'18k':'14k'}`.trim();}
  if(r.row===799){amount=number(v[4]);fix('Expenses',r.row,'Split combined amount into payroll component; separate gold line follows');}
  if(r.row===800){amount=number(v[4]);description=clean(v[3])||'Gold purchase';fix('Expenses',r.row,'Split gold purchase from combined payroll subtotal');}
  if(r.row===665){amount=number(v[4]);fix('Expenses',r.row,'Used amount entered in Total column');}
  if(r.row===774&&typeof v[2]==='number')description=`Gold ${v[2]}k`;
  if(amount===null||!description||!expenseDate)continue;
  const comparable=s=>norm(s).replace(/-/g,'');
  let candidates=before.expenses.filter(e=>!usedExpense.has(e.expenseId)&&e.date.slice(0,10)===expenseDate&&(comparable(e.description)===comparable(description)||descNorm(e.description)===descNorm(description)));
  let existing=candidates.length===1?candidates[0]:candidates.find(e=>Number(e.amount)===amount);
  if(!existing) {
   candidates=before.expenses.filter(e=>!usedExpense.has(e.expenseId)&&e.date.slice(0,10)===expenseDate&&Number(e.amount)===amount);
   if(candidates.length===1)existing=candidates[0];
  }
  if(!existing){const byDate=before.expenses.filter(e=>!usedExpense.has(e.expenseId)&&e.date.slice(0,10)===expenseDate);if(byDate.length===1)existing=byDate[0];}
  const expenseId=existing?.expenseId||expenseIds(expenseDate);usedExpense.add(expenseId);
  let category=existing?.category||'Other';
  if(!existing){const n=description.toLowerCase();category=/gold/.test(n)?'Metal Purchase':/food|lunch|allowance/.test(n)?'Food':/payroll|salary/.test(n)?'Payroll':/tithe/.test(n)?'Tithes':/engrave/.test(n)?'Engraving':/setting/.test(n)?'Stone Setting':/gas|fare|pamasahe/.test(n)?'Transportation':/rent|utilities|pldt|electric/.test(n)?'Rent & Utilities':/load|data/.test(n)?'Communication':'Other';}
  expenses.push({expenseId,date:expenseDate,description,amount,category,sourceRow:r.row});
 }
 const archiveExpenses=before.expenses.filter(e=>!usedExpense.has(e.expenseId)&&!e.deletedAt&&/^2026-\d+-\d+-T\d{3}$/.test(e.expenseId));
 for(const e of archiveExpenses)flag('Expenses',null,'Existing expense absent from the workbook detail; archived with backup',e);
 // GOLD is the canonical movement sheet. Other tabs repeat its opening rows.
 const inventory=[],invIds=allocator(before.inventory.map(i=>i.referenceId));let invDate=null,karat=null;
 const kar=v=>{const n=Number(clean(v).match(/\b(1[0-9]|2[0-4])\s*k?/i)?.[1]);return n||null;};
 function movement(d,label,category,k,qtyIn,qtyOut,price,sourceRow,sheet) {
  inventory.push({referenceId:invIds(d),date:d,itemName:label,category,gold_karat:k,unit:category==='GEMSTONES'?'pcs':'grams',quantityIn:qtyIn,quantityOut:qtyOut,quantityLoss:0,unitPrice:price||0,universal_reference_id:null,sourceSheet:sheet,sourceRow});
 }
 for(const r of sheets.GOLD) {
  if(r.row<2)continue;const v=r.values;invDate=dateValue(v[0])||invDate;karat=kar(v[1])||karat;
  const input=number(v[2])||0,out=number(v[4])||0;
  // E2 is =0.8+6 and duplicates the explicit 0.8/6 lines below.
  if(input)movement(invDate,`${karat||'Unspecified'}k gold`, 'GOLD',karat,input,0,0,r.row,'GOLD');
  if(out&&r.row!==2)movement(invDate,`${kar(v[3])||karat||'Unspecified'}k gold`,'GOLD',kar(v[3])||karat,0,out,0,r.row,'GOLD');
 }
 fix('GOLD',2,'Opening outgoing 6.8g formula duplicates rows 6 and 7; posted detail only');
 for(const sheet of ['Gold Inventory ','Stone Inventory']) {
  let dt=null;
  for(const r of sheets[sheet]) {
   if(r.row<19)continue;const v=r.values;dt=dateValue(v[0])||dt;const qty=number(v[2]);if(!dt||!qty)continue;
   const category=sheet==='Stone Inventory'?'GEMSTONES':/silver/i.test(clean(v[1]))?'SILVER':'GOLD',k=category==='GOLD'?kar(v[1]):null;
   const amount=number(v[5]);const rate=number(v[4]);let unitPrice=amount>0?money(amount/qty):(rate||0);
   // 0.5ct moissanite total uses carat, so preserve explicit cash and flag inconsistent pricing.
   if(amount>0&&rate>0&&Math.abs(amount-qty*rate)>.02)flag(sheet,r.row,'Quantity × rate differs from recorded amount; retained amount paid',{qty,rate,amount});
   if(!amount&&!rate)flag(sheet,r.row,'Acquisition cost missing; quantity imported with zero value',v.slice(0,8));
   const label=category==='GEMSTONES'?`${clean(v[1])} ${clean(v[3])}ct`:category==='SILVER'?'Silver':`${k||'Unspecified'}k gold`;
   movement(dt,label,category,k,qty,0,unitPrice,r.row,sheet);
   if(typeof v[6]==='number'&&v[6]>0)movement(dt,label,category,k,0,v[6],unitPrice,r.row,sheet);
   else if(v[6])flag(sheet,r.row,'Outgoing note has no numeric quantity/date pair; retained for review',v[6]);
  }
 }
 // Inventory costs must not be counted again as purchase expenses by the API.
 for(const i of inventory)i.is_historical=true;
 flag('other ex,',2,'Undated DHL expense note retained for review; no date invented',sheets['other ex,'][0].values);
 fix('Repayment',3,'Nong Boy 2000 payment already appears in Expenses row 614; not duplicated');
 const mappings=invoices.map(i=>({sourceRow:i.row,invoiceId:i.mergedInto?invoices.find(j=>j.row===i.mergedInto).id:i.id,mergedInto:i.mergedInto,originalInvoice:i.legacy,name:i.name,date:i.date}));
 return {sha256:source.sha256,clients,sales,jobs,items,payments,expenses,archiveExpenses:archiveExpenses.map(e=>e.expenseId),inventory,mappings,issues,fixes,merges,summary:{sourceInvoices:invoices.length,invoices:sales.length,jobItems:items.length,payments:payments.length,price:sum(sales,'price'),cash:sum(payments,'amount'),expenses:sum(expenses,'amount'),expenseRows:expenses.length,inventoryMovements:inventory.length,merges:merges.length,issues:issues.length,fixes:fixes.length}};
}
if(require.main===module){const dir=process.argv[2];if(!dir)throw Error('Supply import working directory');const plan=build(JSON.parse(fs.readFileSync(path.join(dir,'source.json'))),JSON.parse(fs.readFileSync(path.join(dir,'before.json'))));fs.writeFileSync(path.join(dir,'plan.json'),JSON.stringify(plan,null,2));console.log(JSON.stringify(plan.summary,null,2));}
module.exports={build,dateValue,number,allocator,delivered,explicitPaid};
