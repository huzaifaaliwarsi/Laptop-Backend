// Read-only audit of the running local API against its loopback PostgreSQL data.
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const root = path.join(__dirname, '..');
const read = name => fs.existsSync(path.join(root, name)) ? dotenv.parse(fs.readFileSync(path.join(root, name))) : {};
const env = read('.env'), settings = {...env, ...read('.env.local')};
const host = settings.LOCAL_DB_HOST || '127.0.0.1';
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('Loopback database required');
const client = new Client({host, port: Number(settings.LOCAL_DB_PORT || settings.DB_PORT || 5432), user: settings.LOCAL_DB_USER || settings.DB_USER || 'postgres', password: settings.LOCAL_DB_PASSWORD || settings.DB_PASSWORD || '', database: settings.LOCAL_DB_NAME || 'retail_repair_shared_local'});
async function main() {
 if(process.argv.includes('--backup')) {
  const target=path.join(root,'..','artifacts','local-before-isolation-'+Date.now()+'.dump');
  const result=require('node:child_process').spawnSync('C:/Program Files/PostgreSQL/18/bin/pg_dump.exe',[
   '-h',host,'-p',String(client.port),'-U',client.user,'-d',client.database,'-Fc','-f',target
  ],{env:{...process.env,PGPASSWORD:client.password},encoding:'utf8'});
  if(result.error || result.status!==0) throw new Error(result.error?.message || result.stderr);
  console.log('Local backup saved:',target);
  return;
 }
 await client.connect();
 const branches = (await client.query("SELECT id FROM master_branches WHERE status='Active' ORDER BY id")).rows;
 const sa = (await client.query("SELECT id FROM master_super_admins WHERE status='Active' LIMIT 1")).rows[0];
 const token = jwt.sign({id: sa.id, role: 'super_admin'}, env.JWT_SECRET || 'retail_repair_jwt_super_secure_secret_key_2026', {expiresIn: '5m'});
 const base = 'http://127.0.0.1:' + (env.PORT || 5000) + '/api';
 console.log('Auditing', base, 'database', client.database);
 let failures = 0;
 async function get(branch, route, cached=false) {
  const r = await fetch(base+route, {headers: {Authorization: 'Bearer '+token, 'X-Branch-Id': String(branch), ...(cached?{}:{'Cache-Control': 'no-cache'})}});
  return {status:r.status, body:await r.json()};
 }
 for (const {id} of branches) {
  for (const table of ['customers','vendors']) {
   const expected=(await client.query(`SELECT id FROM ${table} WHERE branch_id=$1 ORDER BY id`,[id])).rows.map(r=>r.id);
   const r=await get(id,'/'+table);
   const actual=Array.isArray(r.body.data)?r.body.data.map(x=>x.id).sort():[];
   const ok=r.status===200 && JSON.stringify(actual)===JSON.stringify(expected.sort());
   console.log(ok?'PASS':'FAIL', 'branch',id,table,'database',expected.length,'API',actual.length,'HTTP',r.status);
   if(!ok) failures++;
   const cached=await get(id,'/'+table,true);
   if(JSON.stringify(cached.body)!==JSON.stringify(r.body)) {console.log('FAIL cached list differs');failures++;}
   const foreign=(await client.query(`SELECT id FROM ${table} WHERE branch_id<>$1 LIMIT 1`,[id])).rows[0];
   if(foreign) {
    const ledger=await get(id,'/ledger/party/'+(table==='vendors'?'vendor':'customer')+'/'+encodeURIComponent(foreign.id));
    console.log(ledger.status===404?'PASS':'FAIL','branch',id,'foreign',table,'ledger HTTP',ledger.status);
    if(ledger.status!==404) failures++;
   }
  }
  for(const name of ['dashboard','sales','purchases','inventory','expenses','repairs','profit-loss','cash-balance']) {
   const r=await get(id,'/reports/'+name);
   console.log(r.status===200?'PASS':'FAIL','branch',id,'report',name,'HTTP',r.status);
   if(r.status!==200) failures++;
   const table={sales:'invoices',purchases:'invoices',inventory:'products',expenses:'expenses',repairs:'repair_jobs'}[name];
   if(table && Array.isArray(r.body.data)) {
    const allowed=new Set((await client.query(`SELECT id FROM ${table} WHERE branch_id=$1`,[id])).rows.map(x=>x.id));
    const ok=r.body.data.every(x=>allowed.has(x.id));
    console.log(ok?'PASS':'FAIL','branch',id,name,'row ownership; rows',r.body.data.length);
    if(!ok) failures++;
   }
   if(name==='sales' || name==='inventory') {
    const sql=name==='sales'?"SELECT COALESCE(SUM(total),0) AS n FROM invoices WHERE branch_id=$1 AND is_voided=FALSE AND type IN ('Sales Invoice','Exchange Invoice','Custom Sale Invoice')":"SELECT COALESCE(SUM(current_stock*cost_price),0) AS n FROM products WHERE branch_id=$1";
    const expected=Number((await client.query(sql,[id])).rows[0].n);
    const actual=r.body.summary?.[name==='sales'?'grossSales':'totalCostValue'];
    const ok=Math.abs(expected-actual)<0.01;
    console.log(ok?'PASS':'FAIL','branch',id,name,'total database/API',expected,actual);
    if(!ok) failures++;
   }
   if(name==='profit-loss') console.log('branch',id,'revenue',r.body.data?.totalRevenue,'profit',r.body.data?.netProfit);
   if(name==='cash-balance') console.log('branch',id,'cash',r.body.data?.cash?.balance,'online',r.body.data?.online?.balance);
  }
  const cats=await get(id,'/categories');
  for(const [key,table] of Object.entries({productCategories:'product_categories',expenseCategories:'expense_categories',accessoryCategories:'accessory_categories',repairCategories:'repair_categories'})) {
   const expected=(await client.query(`SELECT id FROM ${table} WHERE branch_id=$1`,[id])).rows.map(x=>x.id).sort();
   const actual=(cats.body.data?.[key]||[]).map(x=>x.id).sort();
   const ok=cats.status===200 && JSON.stringify(expected)===JSON.stringify(actual);
   console.log(ok?'PASS':'FAIL','branch',id,key,'database/API',expected.length,actual.length);
   if(!ok) failures++;
  }
  const csv=await fetch(base+'/reports/csv/sales',{headers:{Authorization:'Bearer '+token,'X-Branch-Id':String(id)}});
  const csvText=await csv.text();
  const foreignInvoices=(await client.query('SELECT invoice_no FROM invoices WHERE branch_id<>$1',[id])).rows;
  const ok=csv.status===200 && !foreignInvoices.some(x=>csvText.includes(x.invoice_no));
  console.log(ok?'PASS':'FAIL','branch',id,'CSV excludes foreign invoices');
  if(!ok) failures++;
 }
 console.log('Audit failures:',failures);
 if(failures) process.exitCode=1;
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>client.end());
