const db = require('../config/db');
const branchContext = require('../middleware/branchContext');

function branchIdFor(client, explicitBranchId) {
  const id = Number(client.branchId || branchContext.getBranchStore()?.branchId || explicitBranchId || 1);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid branch ID');
  return id;
}

// One atomic UPSERT reserves the number. MAX+1 alone races with another request.
async function reserveNumber(client, branchId, key, floor) {
  const result = await client.query(`
    INSERT INTO branch_counters(branch_id,key,value) VALUES ($1,$2,$3)
    ON CONFLICT(branch_id,key) DO UPDATE
      SET value=GREATEST(branch_counters.value+1,EXCLUDED.value)
    RETURNING value`, [branchId,key,floor.toString()]);
  return BigInt(result.rows[0].value);
}

async function nextBusinessCode(client, branchId, table, column, prefix, width, floor = 1n) {
  // Identifiers come only from fixed callers below, never from request data.
  const existing = await client.query(`SELECT ${column} AS code FROM ${table} WHERE branch_id=$1`,[branchId]);
  for (const row of existing.rows) {
    const value=String(row.code);
    if (!value.startsWith(prefix+'-')) continue;
    const suffix=value.slice(prefix.length+1);
    if (/^\d+$/.test(suffix)) floor = floor > BigInt(suffix) ? floor : BigInt(suffix)+1n;
  }
  const n=await reserveNumber(client,branchId,table+':'+prefix,floor);
  return prefix+'-'+n.toString().padStart(width,'0');
}

async function getNextProductCode(categoryId, client = db, explicitBranchId = null) {
  const branchId=branchIdFor(client,explicitBranchId);
  let prefix='PRD';
  if(categoryId) {
    const result=await client.query('SELECT code_prefix,name FROM product_categories WHERE id=$1',[categoryId]);
    if(result.rows.length) prefix=result.rows[0].code_prefix || String(result.rows[0].name).replace(/[^A-Za-z]/g,'').slice(0,3).toUpperCase() || 'PRD';
  }
  return nextBusinessCode(client,branchId,'products','code',prefix,4);
}

async function getNextInvoiceNo(typeKey, client = db, explicitBranchId = null) {
  const prefixes={sale:'SAL',vendor_purchase:'VPU',customer_purchase:'CPU',exchange:'EXC',repair:'RPR',diagnosis:'DIA'};
  return nextBusinessCode(client,branchIdFor(client,explicitBranchId),'invoices','invoice_no',prefixes[typeKey] || 'INV',5);
}

async function getNextTrackingId(client = db, explicitBranchId = null) {
  const branchId=branchIdFor(client,explicitBranchId);
  return nextBusinessCode(client,branchId,'repair_jobs','tracking_id','RPR',5,BigInt(branchId)*10000n+1n);
}

async function getNextEntityId(table, idColumn, prefix, padLength = 4, client = db) {
  // Reserve atomically across branches; MAX+1 repeats IDs during concurrent saves.
  const res = await client.query(
    'SELECT public.retail_next_entity_id($1,$2,$3,$4) AS id',
    [table,idColumn,prefix,padLength]
  );
  return res.rows[0].id;
}

module.exports={getNextProductCode,getNextInvoiceNo,getNextTrackingId,getNextEntityId};
