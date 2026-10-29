const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const credentials=require('dotenv').parse(fs.readFileSync(path.join(root,'.env.local')));
const port=51987;
const child=spawn(process.execPath,[path.join(__dirname,'start-local.cjs')],{cwd:root,env:{...process.env,PORT:String(port)},windowsHide:true,stdio:['ignore','pipe','pipe']});
async function run() {
 await new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(new Error('Local server startup timed out')),30000);
   child.stdout.on('data',chunk=>{if(chunk.toString().includes('Listening on port')){clearTimeout(timeout);resolve();}});
   child.stderr.on('data',chunk=>process.stderr.write(chunk));
   child.once('exit',code=>{clearTimeout(timeout);reject(new Error('Local server exited: '+code));});
 });
 const base='http://127.0.0.1:'+port;
 const health=await fetch(base+'/api/health');assert.equal(health.status,200);
 const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:credentials.LOCAL_ADMIN_USERNAME,password:credentials.LOCAL_ADMIN_PASSWORD,portal:'admin'})});
 const data=await login.json();assert.equal(login.status,200,JSON.stringify(data));
 const settings=await fetch(base+'/api/settings/company',{headers:{Authorization:'Bearer '+data.data.token}});assert.equal(settings.status,200);
 const pdf=await fetch(base+'/api/invoices/unknown/pdf');assert.equal(pdf.status,401);
 console.log('PASS local server startup, health, admin login, settings and unauthenticated PDF denial');
}
run().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>child.kill());
