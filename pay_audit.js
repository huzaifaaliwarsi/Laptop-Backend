const {Pool}=require('pg');
require('dotenv').config();
const pool=new Pool({host:'127.0.0.1',port:5432,database:'retail_repair_db',user:'postgres',password:'admin123'});
async function run(){
  let r;
  r=await pool.query('SELECT payment_method,direction,affects_money,amount,party_name FROM payments ORDER BY created_at');
  console.log('All payments:');
  r.rows.forEach(x=>console.log('  '+x.payment_method+' | '+x.direction+' | affects_money:'+x.affects_money+' | PKR '+x.amount+' | '+x.party_name));

  r=await pool.query('SELECT COALESCE(SUM(CASE WHEN direction=\'Received\' THEN amount WHEN direction=\'Paid\' THEN -amount ELSE 0 END),0) as net FROM payments WHERE payment_method=\'Cash\' AND affects_money=TRUE');
  console.log('\nCash net (affects_money=true):', r.rows[0].net);

  r=await pool.query('SELECT COALESCE(SUM(CASE WHEN direction=\'Received\' THEN amount WHEN direction=\'Paid\' THEN -amount ELSE 0 END),0) as net FROM payments WHERE payment_method=\'Cash\'');
  console.log('Cash net (all):', r.rows[0].net);

  r=await pool.query('SELECT opening_cash,opening_online FROM business_settings LIMIT 1');
  console.log('Opening cash:', r.rows[0].opening_cash, '| Opening online:', r.rows[0].opening_online);
  pool.end();
}
run().catch(e=>{console.error(e.message);pool.end();process.exit(1);});
