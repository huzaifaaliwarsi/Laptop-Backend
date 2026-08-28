const {Pool}=require('pg');
require('dotenv').config();
const pool=new Pool({host:'127.0.0.1',port:5432,database:'retail_repair_db',user:'postgres',password:'admin123'});
const {getAvailableBalance}=require('./src/utils/financialFormulas');
async function run(){
  const cash = await getAvailableBalance('Cash');
  const online = await getAvailableBalance('Online');
  console.log('getAvailableBalance Cash:', cash);
  console.log('getAvailableBalance Online:', online);
  
  // Check what dashboard sends
  let r;
  // Accounts
  r=await pool.query("SELECT type,COALESCE(SUM(remaining),0) rem FROM accounts WHERE status NOT IN ('Settled','Voided') GROUP BY type ORDER BY type");
  console.log('\nOpen accounts:');
  r.rows.forEach(x=>console.log('  ',x.type,': PKR',parseFloat(x.rem).toFixed(2)));
  
  // Sales  
  r=await pool.query("SELECT COALESCE(SUM(total),0) t, COALESCE(SUM(paid),0) p, COALESCE(SUM(balance),0) b FROM invoices WHERE type='Sales Invoice' AND is_voided=FALSE");
  console.log('\nSales: total=',parseFloat(r.rows[0].t).toFixed(2), 'paid=',parseFloat(r.rows[0].p).toFixed(2), 'balance=',parseFloat(r.rows[0].b).toFixed(2));

  // P&L check
  r=await pool.query("SELECT COALESCE(SUM(ii.quantity*ii.unit_price),0) rev FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id WHERE i.type='Sales Invoice' AND i.is_voided=FALSE");
  console.log('Sales revenue from items:', parseFloat(r.rows[0].rev).toFixed(2));
  
  r=await pool.query("SELECT COALESCE(SUM(ii.quantity*COALESCE(ii.cost_price_snapshot,0)),0) cogs FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id WHERE i.type='Sales Invoice' AND i.is_voided=FALSE");
  console.log('COGS from items:', parseFloat(r.rows[0].cogs).toFixed(2));
  
  pool.end();
}
run().catch(e=>{console.error(e.message);pool.end();process.exit(1);});
