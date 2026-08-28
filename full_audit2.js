const {Pool}=require('pg');
require('dotenv').config();
const pool=new Pool({host:'127.0.0.1',port:5432,database:'retail_repair_db',user:'postgres',password:'admin123'});
const n=(v)=>parseFloat(v||0).toFixed(2);

async function run(){
  let r;
  console.log('\n=== FULL AUDIT ===\n');

  console.log('--- INVENTORY ---');
  r=await pool.query('SELECT COUNT(*) c FROM products');
  console.log('Total products:',r.rows[0].c);
  r=await pool.query('SELECT COALESCE(SUM(current_stock),0) t FROM products');
  console.log('Total stock:',r.rows[0].t);
  r=await pool.query('SELECT COUNT(*) c FROM products WHERE current_stock<=low_stock_alert');
  console.log('Low stock:',r.rows[0].c);
  r=await pool.query('SELECT COUNT(*) c FROM products WHERE current_stock<0');
  console.log('Negative stock:',r.rows[0].c,r.rows[0].c>0?'<-- BUG':'OK');

  console.log('\n--- REPAIRS ---');
  r=await pool.query('SELECT status,COUNT(*) c FROM repair_jobs GROUP BY status ORDER BY status');
  r.rows.forEach(x=>console.log(' ',x.status+':',x.c));

  console.log('\n--- PAYMENTS ---');
  r=await pool.query('SELECT payment_method,direction,COUNT(*) c,COALESCE(SUM(amount),0) t FROM payments GROUP BY payment_method,direction ORDER BY payment_method,direction');
  if(!r.rows.length)console.log('  No payments');
  else r.rows.forEach(x=>console.log(' ',x.payment_method,'|',x.direction,'| cnt:',x.c,'| PKR',n(x.t)));
  r=await pool.query('SELECT COUNT(*) c FROM payments WHERE direction IS NULL');
  console.log('NULL direction payments:',r.rows[0].c,r.rows[0].c>0?'<-- BUG':'OK');

  console.log('\n--- CASH/ONLINE ---');
  r=await pool.query('SELECT opening_cash,opening_online FROM business_settings LIMIT 1');
  const oc=parseFloat(r.rows[0]&&r.rows[0].opening_cash||0);
  const oo=parseFloat(r.rows[0]&&r.rows[0].opening_online||0);
  r=await pool.query("SELECT COALESCE(SUM(amount),0) t FROM payments WHERE payment_method='Cash' AND direction='in'");
  const ci=parseFloat(r.rows[0].t);
  r=await pool.query("SELECT COALESCE(SUM(amount),0) t FROM payments WHERE payment_method='Cash' AND direction='out'");
  const co=parseFloat(r.rows[0].t);
  r=await pool.query("SELECT COALESCE(SUM(amount),0) t FROM payments WHERE payment_method IN ('Online','Bank Transfer') AND direction='in'");
  const oni=parseFloat(r.rows[0].t);
  r=await pool.query("SELECT COALESCE(SUM(amount),0) t FROM payments WHERE payment_method IN ('Online','Bank Transfer') AND direction='out'");
  const ono=parseFloat(r.rows[0].t);
  r=await pool.query("SELECT COALESCE(SUM(amount),0) t FROM expenses WHERE payment_method='Cash'");
  const ce=parseFloat(r.rows[0].t);
  r=await pool.query("SELECT COALESCE(SUM(amount),0) t FROM expenses WHERE payment_method IN ('Online','Bank Transfer')");
  const oe=parseFloat(r.rows[0].t);
  console.log('Cash: Opening='+n(oc)+' +IN='+n(ci)+' -OUT='+n(co)+' -Exp='+n(ce)+' = PKR '+n(oc+ci-co-ce));
  console.log('Online: Opening='+n(oo)+' +IN='+n(oni)+' -OUT='+n(ono)+' -Exp='+n(oe)+' = PKR '+n(oo+oni-ono-oe));

  console.log('\n--- INVOICES ---');
  r=await pool.query('SELECT type,COUNT(*) c,COALESCE(SUM(total),0) t,COALESCE(SUM(paid),0) p,COALESCE(SUM(balance),0) b FROM invoices WHERE is_voided=false GROUP BY type ORDER BY type');
  r.rows.forEach(x=>console.log(' ',x.type,'cnt:',x.c,'Total:',n(x.t),'Paid:',n(x.p),'Bal:',n(x.b)));

  console.log('\n--- P&L ---');
  r=await pool.query("SELECT COALESCE(SUM(ii.quantity*ii.unit_price),0) rev,COALESCE(SUM(ii.quantity*COALESCE(ii.cost_price_snapshot,0)),0) cogs FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id WHERE i.type='Sale' AND i.is_voided=false AND ii.item_type IN ('product','custom_product','stock_product')");
  const pRev=parseFloat(r.rows[0].rev),pCogs=parseFloat(r.rows[0].cogs);
  r=await pool.query("SELECT COALESCE(SUM(ii.quantity*ii.unit_price),0) rev FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id WHERE i.type='Sale' AND i.is_voided=false AND ii.item_type='service'");
  const sRev=parseFloat(r.rows[0].rev);
  r=await pool.query("SELECT COALESCE(SUM(total),0) rev FROM invoices WHERE type IN ('Repair','Diagnosis') AND is_voided=false");
  const rRev=parseFloat(r.rows[0].rev);
  r=await pool.query('SELECT COALESCE(SUM(amount),0) t FROM expenses');
  const exp=parseFloat(r.rows[0].t);
  console.log('Product Sales Rev: PKR',n(pRev));
  console.log('Service Revenue:   PKR',n(sRev));
  console.log('Repair Revenue:    PKR',n(rRev));
  console.log('COGS:              PKR',n(pCogs));
  console.log('Gross Profit:      PKR',n(pRev+sRev+rRev-pCogs));
  console.log('Expenses:          PKR',n(exp));
  console.log('Net Profit:        PKR',n(pRev+sRev+rRev-pCogs-exp));

  console.log('\n--- ACCOUNTS ---');
  r=await pool.query("SELECT type,COUNT(*) c,COALESCE(SUM(remaining),0) rem FROM accounts WHERE status NOT IN ('Settled','Voided') GROUP BY type ORDER BY type");
  if(!r.rows.length)console.log('  No open accounts');
  else r.rows.forEach(x=>console.log(' ',x.type,'open:',x.c,'Rem: PKR',n(x.rem)));
  r=await pool.query("SELECT COUNT(*) c FROM accounts a JOIN invoices i ON i.id=a.invoice_id WHERE a.status NOT IN ('Settled','Voided') AND ABS(a.remaining-i.balance)>0.01");
  console.log('Account/Invoice mismatch:',r.rows[0].c,r.rows[0].c>0?'<-- BUG':'OK');

  console.log('\n--- COGS SNAPSHOT ---');
  r=await pool.query("SELECT COUNT(*) c FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id WHERE i.type='Sale' AND i.is_voided=false AND ii.item_type IN ('product','stock_product') AND (ii.cost_price_snapshot IS NULL OR ii.cost_price_snapshot=0)");
  console.log('Zero/null cost snapshot:',r.rows[0].c,r.rows[0].c>0?'<-- BUG':'OK');

  console.log('\n--- USERS ---');
  r=await pool.query('SELECT role,is_active,COUNT(*) c FROM users GROUP BY role,is_active ORDER BY role');
  r.rows.forEach(x=>console.log('  role:',x.role,'active:',x.is_active,'count:',x.c));
  r=await pool.query("SELECT COUNT(*) c FROM users WHERE password IS NOT NULL AND password NOT LIKE '\\$%' AND password NOT LIKE '\\$%'");
  console.log('Non-bcrypt passwords:',r.rows[0].c,r.rows[0].c>0?'<-- SECURITY BUG':'OK');

  console.log('\n--- SETTINGS ---');
  r=await pool.query('SELECT company_name,phone,ntn,strn,pos_id,opening_cash,opening_online FROM business_settings LIMIT 1');
  if(r.rows[0]){const s=r.rows[0];console.log('Company:',s.company_name||'NOT SET','Phone:',s.phone||'NOT SET','NTN:',s.ntn||'NOT SET');console.log('Opening Cash:',n(s.opening_cash),'Opening Online:',n(s.opening_online));}

  console.log('\n--- VENDOR RETURNS ---');
  r=await pool.query('SELECT COUNT(*) c,COALESCE(SUM(amount),0) t FROM vendor_returns');
  console.log('Returns:',r.rows[0].c,'Amount: PKR',n(r.rows[0].t));

  console.log('\n--- INV MOVEMENTS ---');
  r=await pool.query('SELECT movement_type,COUNT(*) c FROM inventory_movements GROUP BY movement_type ORDER BY movement_type');
  if(!r.rows.length)console.log('  None');
  else r.rows.forEach(x=>console.log(' ',x.movement_type,':',x.c));

  console.log('\n--- RECENT INVOICES ---');
  r=await pool.query('SELECT invoice_no,type,total,paid,balance,payment_status FROM invoices ORDER BY created_at DESC LIMIT 5');
  if(!r.rows.length)console.log('  No invoices - DB freshly reset');
  else r.rows.forEach(x=>console.log(' ',x.invoice_no,x.type,'T:'+n(x.total),'P:'+n(x.paid),'B:'+n(x.balance),x.payment_status));

  console.log('\n=== AUDIT COMPLETE ===');
  pool.end();
}
run().catch(e=>{console.error('ERROR:',e.message,e.stack&&e.stack.split('\n')[1]);pool.end();process.exit(1);});
