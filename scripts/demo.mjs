// Generates a reproducible demonstration transcript from actual local execution.
import fs from 'node:fs';
import {fixture} from '../lib/fixture.mjs';
import {makeIdentity} from '../lib/crypto.mjs';
import {upload,download,share} from '../lib/client.mjs';
const f=await fixture(3003,'data/demo-run'),steps=[];
const keys=await Promise.all([makeIdentity(),makeIdentity(),makeIdentity()]);
const p=f.connect(1),d=f.connect(2),h=f.connect(3),da=await f.wallets[2].getAddress(),ha=await f.wallets[3].getAddress();
function step(title,output){steps.push({title,output});console.log('\n'+title+'\n'+JSON.stringify(output,null,2));}
step('01 - Deployed smart contract',{network:'Ganache, chain 31337',address:f.deployment.address,transaction:f.deployment.transactionHash,gasUsed:f.deployment.gasUsed});
for(const [name,c,role,key] of [['Patient',p,1,keys[0]],['Doctor',d,2,keys[1]],['Hospital',h,3,keys[2]]]){const r=await(await c.register(role,key.publicKey)).wait();step('02 - Register '+name,{role,transaction:r.hash,gasUsed:r.gasUsed.toString(),active:role===1});}
for(const a of [da,ha])await(await f.contract.setProviderStatus(a,true)).wait();
step('03 - Administrator approves providers',{doctor:da,hospital:ha,doctorApproved:(await p.profiles(da)).active,hospitalApproved:(await p.profiles(ha)).active});
const bytes=fs.readFileSync('samples/synthetic-medical-record.txt');
const record=await upload(f.base,f.wallets[1],p,keys[0],bytes,'synthetic-medical-record.txt','text/plain');
step('04 - Patient uploads an encrypted record',{recordId:record.id,cid:record.cid,owner:await f.wallets[1].getAddress(),transaction:record.receipt.hash,originalBytes:bytes.length,storageReplicas:2});
try{await download(f.base,f.wallets[2],d,keys[1],record.id);}catch(e){step('05 - Doctor is denied before sharing',{allowed:false,message:e.message});}
const grant=await share(f.base,f.wallets[1],p,keys[0],record.id,da);
step('06 - Patient grants doctor access',{recordId:record.id,recipient:da,transaction:grant.hash,allowed:await p.canAccess(record.id,da)});
const opened=await download(f.base,f.wallets[2],d,keys[1],record.id);
step('07 - Doctor decrypts the original record',{filename:opened.name,bytesMatch:Buffer.from(opened.bytes).equals(bytes),plaintext:new TextDecoder().decode(opened.bytes)});
await share(f.base,f.wallets[1],p,keys[0],record.id,ha);
step('08 - Hospital receives a separate wrapped key',{allowed:await p.canAccess(record.id,ha),bytesMatch:Buffer.from((await download(f.base,f.wallets[3],h,keys[2],record.id)).bytes).equals(bytes)});
const revoked=await(await p.revoke(record.id,da)).wait();
step('09 - Patient revokes doctor access',{transaction:revoked.hash,doctorAllowed:await p.canAccess(record.id,da),hospitalStillAllowed:await p.canAccess(record.id,ha)});
try{await download(f.base,f.wallets[2],d,keys[1],record.id);}catch(e){step('10 - Doctor denied after revocation',{allowed:false,message:e.message});}
const logs=await f.provider.getLogs({address:f.deployment.address,fromBlock:f.deployment.blockNumber,toBlock:'latest'});
const audit=logs.map(log=>{const e=p.interface.parseLog(log);return {event:e.name,block:log.blockNumber,transaction:log.transactionHash,...(e.name==='ReadAudit'?{actor:e.args.actor,allowed:e.args.allowed}:{})};});
step('11 - Medical history and audit trail',{recordCount:Number(await p.recordCount()),events:audit});
fs.mkdirSync('evidence',{recursive:true});fs.writeFileSync('evidence/demo-results.json',JSON.stringify({date:new Date().toISOString(),note:'Actual local execution, synthetic data, no public deployment',steps},null,2));
await f.close();
