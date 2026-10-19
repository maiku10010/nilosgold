// Imports the reviewed Expenses CSV JSON into the existing schema atomically.
// Keep source JSON, backups and reports in ignored outputs/ directories.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
require('dotenv').config({quiet:true});
const {Client}=require('pg');
const {cents}=require('./import-reviewed-csv.cjs');
const cash=n=>(n/100).toFixed(2);
function category(description,purpose){
  const s=(description+' '+purpose).toLowerCase();
  if(/payroll|salary/.test(s))return 'Payroll';
  if(/\bgold\b|\bsilver\b/.test(s))return 'Metal purchase';
  if(/\brent\b|utilities|electric bill|water bill/.test(s))return 'Rent & utilities';
  if(/\btax\b|permit|\bbir\b/.test(s))return 'Tax & permits';
  return 'Other';
}
function build(source,normalizeYears){
  const rows=[],issues=[],corrections=[];let lastDate=null;
  for(const r of source){
    let s=String(r.Date||'').trim();
    if(s && /\d/.test(s)){
      s=s.replace(/\s+/g,'/').replace(/\/+/g,'/');
      if(s==='4/252026')s='4/25/2026';
      const m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      assert(m,`Unrecognized date, row ${r.Row}`);
      const year=normalizeYears?'2026':m[3];
      lastDate=`${year}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
      assert.equal(new Date(lastDate).toISOString().slice(0,10),lastDate);
      assert(lastDate<='2026-10-19',`Future date at row ${r.Row}; review required`);
      if(year!==m[3]||s!==r.Date)corrections.push({row:r.Row,original:r.Date,date:lastDate});
    }
    const description=String(r.Description||'').trim(),purpose=String(r.Purpose||'').trim();
    const amount=cents(r.Amount);
    if(r.Row===692){assert.equal(amount,1572500);issues.push({...r,reason:'Excluded subtotal: preceding payroll 13225 + tithes 2500'});continue;}
    if(amount===null){if(description||purpose)issues.push({...r,reason:'Missing amount; not imported'});continue;}
    // An unlabeled accounting-format dash is a spacer, not a recorded expense.
    if(!description&&!purpose&&amount===0){issues.push({...r,reason:'Unlabeled accounting dash; not imported'});continue;}
    assert(lastDate,`Missing date at row ${r.Row}`);assert(amount>=0);
    let text=[description,purpose].filter(Boolean).join(' — ')||`Unspecified expense (CSV row ${r.Row})`;
    if(!r.Date){corrections.push({row:r.Row,original:'',date:lastDate});text+=` [Date carried forward: ${lastDate}]`;}
    else if(corrections.some(c=>c.row===r.Row))text+=` [Source date: ${r.Date}]`;
    rows.push({sourceRow:r.Row,id:`expenses-csv-20261019-row-${r.Row}`,date:lastDate,category:category(description,purpose),description:text,amount:cash(amount)});
  }
  assert.equal(rows.length,599);
  const total=rows.reduce((s,r)=>s+cents(r.amount),0);assert.equal(total,210963400);
  return {rows,issues,corrections,summary:{expenses:rows.length,total:cash(total),missingAmountEntries:issues.filter(i=>i.reason.startsWith('Missing')).length,excludedSubtotal:'15725.00',normalizeYears}};
}
async function main(){
  const dir=process.argv[2];assert(dir,'Supply import directory');
  assert(process.argv.includes('--normalize-years'),'Explicit reviewed date handling required');
  const source=JSON.parse(fs.readFileSync(path.join(dir,'source.json'),'utf8').replace(/^\uFEFF/,''));
  const plan=build(source,true);
  fs.writeFileSync(path.join(dir,'plan.json'),JSON.stringify(plan,null,2));
  fs.writeFileSync(path.join(dir,'review.md'),['# Expenses import review','',JSON.stringify(plan.summary,null,2),'','## Entries excluded','',...plan.issues.map(i=>`- CSV row ${i.Row}: ${i.Description||'(unlabeled)'}; purpose: ${i.Purpose||'(blank)'}; amount: ${i.Amount||'(blank)'}; ${i.reason}`),'','## Date corrections','',...plan.corrections.map(c=>`- CSV row ${c.row}: ${c.original||'(blank)'} → ${c.date}`)].join('\n'));
  if(!process.argv.includes('--apply')){console.log(JSON.stringify(plan.summary));return;}
  const before=JSON.parse(fs.readFileSync(path.join(dir,'before.json')));
  assert.equal(before.expenses.length,0,'Existing expenses require duplicate reconciliation');
  const url=process.env.DIRECT_URL||process.env.DATABASE_URL;
  assert(new URL(url).username.endsWith('.zbckqjrlaeozkzdpvtog'),'Unexpected project');
  const db=new Client({connectionString:url});await db.connect();
  try{
    await db.query('BEGIN');await db.query('LOCK TABLE public.expenses IN SHARE ROW EXCLUSIVE MODE');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.expenses')).rows[0].n,0,'Expenses changed since backup');
    for(let start=0;start<plan.rows.length;start+=100){
      const args=[],values=plan.rows.slice(start,start+100).map(r=>'('+[r.id,r.category,r.amount,r.description,r.date].map(v=>{args.push(v);return '$'+args.length;}).join(',')+')');
      await db.query(`INSERT INTO public.expenses ("expenseId",category,amount,description,date) VALUES ${values.join(',')}`,args);
    }
    const stored=(await db.query('SELECT "expenseId",category,amount::text,description,date::date::text AS date FROM public.expenses')).rows;
    assert.equal(stored.length,599);const expected=new Map(plan.rows.map(r=>[r.id,r]));
    for(const r of stored){const e=expected.get(r.expenseId);assert(e);assert.equal(cents(r.amount),cents(e.amount));assert.equal(r.description,e.description);assert.equal(r.date,e.date);assert.equal(r.category,e.category);}
    assert.equal(stored.reduce((s,r)=>s+cents(r.amount),0),210963400);
    await db.query('COMMIT');
    const result={...plan.summary,committed:true};fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }catch(e){await db.query('ROLLBACK');throw e;}finally{await db.end();}
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1});
module.exports={build};
