// Explicitly local entry point: cloud DATABASE_URL values in .env are never used.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {Client}=require('pg');
const dotenv=require('dotenv');
const root=path.join(__dirname,'..'),localPath=path.join(root,'.env.local');
const read=p=>fs.existsSync(p)?dotenv.parse(fs.readFileSync(p)):{};
const settings={...read(path.join(root,'.env')),...read(localPath)};
const host=settings.LOCAL_DB_HOST || '127.0.0.1';
if(!['127.0.0.1','localhost','::1'].includes(host)) throw new Error('Local startup only accepts a loopback database host');
const name=settings.LOCAL_DB_NAME || 'retail_repair_shared_local';
if(!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) throw new Error('Invalid LOCAL_DB_NAME');
const config={host,port:Number(settings.LOCAL_DB_PORT || settings.DB_PORT || 5432),user:settings.LOCAL_DB_USER || settings.DB_USER || 'postgres',password:settings.LOCAL_DB_PASSWORD || settings.DB_PASSWORD || '',database:'postgres'};
async function start() {
  const admin=new Client(config); await admin.connect();
  let created=false;
  try {
    if(!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rows.length) {
      await admin.query('CREATE DATABASE "'+name+'"'); created=true;
    }
  } finally {await admin.end();}
  // The reset-capable base schema is used ONLY for the database just created here.
  if(created) {
    const seed=new Client({...config,database:name});await seed.connect();
    try {await seed.query(fs.readFileSync(path.join(root,'seeds','schema.sql'),'utf8'));} finally {await seed.end();}
  }
  const url=new URL('postgresql://127.0.0.1');url.hostname=host;url.port=String(config.port);url.username=config.user;url.password=config.password;url.pathname='/'+name;
  Object.assign(process.env,{DATABASE_URL:url.href,MASTER_DATABASE_URL:url.href,DB_SSL:'false',DB_NAME:name,NODE_ENV:'development'});
  const db=require('../src/config/db');await db.ready;
  const manager=require('../src/config/branchManager');
  const username=settings.LOCAL_ADMIN_USERNAME || 'admin';
  if(!(await manager.masterPool.query('SELECT 1 FROM users WHERE username=$1',[username])).rows.length) {
    const password=settings.LOCAL_ADMIN_PASSWORD || crypto.randomBytes(18).toString('base64url');
    const hash=await require('bcryptjs').hash(password,10);
    const c=await manager.masterPool.connect();
    try {
      await c.query('BEGIN');
      await c.query("INSERT INTO users(id,branch_id,name,role,username,password_hash,status) VALUES ('USR-ADMIN-LOCAL',1,'Local Admin','admin',$1,$2,'Active')",[username,hash]);
      await c.query("INSERT INTO master_staff_identities(branch_id,branch_user_id,normalized_username,role,status,reservation_status) VALUES (1,'USR-ADMIN-LOCAL',$1,'admin','Active','active')",[username]);
      await c.query('COMMIT');
    } catch(error){await c.query('ROLLBACK');throw error;} finally {c.release();}
    if(!settings.LOCAL_ADMIN_PASSWORD) fs.appendFileSync(localPath,'\nLOCAL_ADMIN_USERNAME='+username+'\nLOCAL_ADMIN_PASSWORD='+password+'\n');
    console.log('Local admin credentials: backend/.env.local (LOCAL_ADMIN_USERNAME / LOCAL_ADMIN_PASSWORD).');
  }
  console.log('Local database: '+host+'/'+name+'; existing cloud and local databases were not reset.');
  if(process.argv.includes('--setup-only')) {await manager.masterPool.end();return;}
  require('../src/server');
}
start().catch(async error=>{console.error('[Local startup]',error.message);process.exitCode=1;const cached=require.cache[require.resolve('../src/config/branchManager')];if(cached) await cached.exports.masterPool.end();});
