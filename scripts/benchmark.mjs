import fs from 'node:fs';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { randomBytes } from 'node:crypto';
import { fixture } from '../lib/fixture.mjs';
import { makeIdentity,encryptFile,decryptFile,hashText } from '../lib/crypto.mjs';
import { upload,download,share } from '../lib/client.mjs';
import { resourceSnapshot } from '../lib/resources.mjs';
const f=await fixture(3002,'data/benchmark-run'),raw=[],operations=[],scales=[],files=[];
const identity=await makeIdentity(),doctorIdentity=await makeIdentity();
const patient=f.connect(1),doctor=f.connect(2),doctorAddress=await f.wallets[2].getAddress();
function summarize(values){const a=[...values].sort((x,y)=>x-y);return {n:a.length,mean:a.reduce((s,x)=>s+x,0)/a.length,p50:a[Math.ceil(a.length*.5)-1],p95:a[Math.ceil(a.length*.95)-1],min:a[0],max:a.at(-1)};}
function receiptRow(name,r,ms){const row={operation:name,gasUsed:Number(r.gasUsed),gasPriceWei:r.gasPrice.toString(),feeWei:r.fee.toString(),feeEth:Number(r.fee)/1e18,latencyMs:ms,hash:r.hash,block:r.blockNumber};raw.push(row);return row;}
async function confirmed(transaction){
  const deadline=Date.now()+60000;
  while(Date.now()<deadline){const r=await f.provider.getTransactionReceipt(transaction.hash);if(r){if(r.status!==1)throw new Error('Transaction reverted');return r;}await new Promise(resolve=>setTimeout(resolve,25));}
  throw new Error('Receipt timeout: '+transaction.hash);
}
async function tx(name,fn){const start=performance.now();const r=await confirmed(await fn());receiptRow(name,r,performance.now()-start);console.log('Confirmed',name);return r;}
receiptRow('deployment',f.receipt,f.deploymentMs);
await tx('patient_registration',()=>patient.register(1,identity.publicKey));
await tx('doctor_registration',()=>doctor.register(2,doctorIdentity.publicKey));
await tx('provider_approval',()=>f.contract.setProviderStatus(doctorAddress,true));
await tx('hospital_registration',()=>f.connect(3).register(3,doctorIdentity.publicKey));
for(const size of [1024,102400,1048576]){
  const sample={bytes:size,encryption:[],decryption:[],upload:[],download:[],grant:[],revoke:[],ciphertextBytes:0};
  for(let trial=0;trial<5;trial++){
    const bytes=randomBytes(size);let start=performance.now();
    const encrypted=await encryptFile(bytes,`synthetic-${size}-${trial}.bin`,'application/octet-stream',identity.publicKey);sample.encryption.push(performance.now()-start);sample.ciphertextBytes=Buffer.byteLength(encrypted.payload);
    start=performance.now();await decryptFile(encrypted.payload,encrypted.envelope,identity.privateKey);sample.decryption.push(performance.now()-start);
    start=performance.now();const record=await upload(f.base,f.wallets[1],patient,identity,bytes,`synthetic-${size}-${trial}.bin`,'application/octet-stream');const elapsed=performance.now()-start;sample.upload.push(elapsed);receiptRow('record_upload',record.receipt,elapsed);
    start=performance.now();const receipt=await share(f.base,f.wallets[1],patient,identity,record.id,doctorAddress);const grantMs=performance.now()-start;sample.grant.push(grantMs);receiptRow('permission_grant',receipt,grantMs);
    start=performance.now();const decoded=await download(f.base,f.wallets[2],doctor,doctorIdentity,record.id);sample.download.push(performance.now()-start);if(!Buffer.from(decoded.bytes).equals(bytes))throw new Error('Round trip mismatch');
    start=performance.now();const revoked=await(await patient.revoke(record.id,doctorAddress)).wait();const revokeMs=performance.now()-start;sample.revoke.push(revokeMs);receiptRow('permission_revoke',revoked,revokeMs);
  }
  files.push({bytes:size,ciphertextBytes:sample.ciphertextBytes,...Object.fromEntries(['encryption','decryption','upload','download','grant','revoke'].map(k=>[k,summarize(sample[k])]))});
  console.log('Completed file-size group',size);
  fs.writeFileSync('evidence/benchmark-checkpoint.json',JSON.stringify({files,raw,scales},null,2));
}
// Measure increasing confirmed transaction volumes and client concurrency.
// A separate signer per worker avoids same-wallet nonce collisions.
const workerIndices=[6,7,8,9,10,11,12,13];
for(const i of workerIndices)await tx('worker_registration',()=>f.connect(i).register(1,identity.publicKey));
const template=await encryptFile(new Uint8Array(1024),'load.bin','application/octet-stream',identity.publicKey);
const cid=(await patient.records(1)).cid,digest=(await patient.records(1)).digest,envelopeHash=await hashText(template.envelope);
for(const [count,concurrency] of [[10,1],[50,4],[100,8]]){
  const before=await fetch(f.base+'/api/metrics').then(r=>r.json()),chainBefore=await fetch('http://127.0.0.1:3000/api/metrics').then(r=>r.json()),driverBefore=resourceSnapshot();let index=0,success=0;const latencies=[],gas=[];
  const start=performance.now();
  await Promise.all(workerIndices.slice(0,concurrency).map(async i=>{
    const c=f.connect(i).connect(f.wallets[i].signer);
    let nonce=await f.provider.getTransactionCount(await f.wallets[i].getAddress(),'latest');
    while(index++<count){const t=performance.now();try{
      const sent=await c.createRecord(cid,digest,envelopeHash,{nonce:nonce++,gasLimit:350000,gasPrice:2000000000n});
      const r=await confirmed(sent),latency=performance.now()-t;latencies.push(latency);gas.push(Number(r.gasUsed));receiptRow('load_record',r,latency);success++;
    }catch(e){console.error('Load transaction failed:',e.shortMessage||e.message);}}
  }));
  const seconds=(performance.now()-start)/1000,after=await fetch(f.base+'/api/metrics').then(r=>r.json()),chainAfter=await fetch('http://127.0.0.1:3000/api/metrics').then(r=>r.json()),driverAfter=resourceSnapshot();
  const cpuDelta=(a,b)=>(b.cpu.user+b.cpu.system-a.cpu.user-a.cpu.system)/1e6;
  const cpu=cpuDelta(before,after)+cpuDelta(chainBefore,chainAfter)+before.storage.reduce((s,a,i)=>s+(a.offline||after.storage[i].offline?0:cpuDelta(a,after.storage[i])),0);
  scales.push({attempted:count,concurrency,success,successRate:success/count,seconds,tps:success/seconds,latency:summarize(latencies),gas:summarize(gas),cpuPercentOneCore:100*cpu/seconds,cpuSeconds:cpu,resourceSnapshots:{before,after,chainBefore,chainAfter},memoryMiB:{gatewayAndDriver:after.rss/1048576,chain:chainAfter.rss/1048576,storage:after.storage.map(x=>x.rss/1048576),kind:after.rssKind},cumulativeRecords:Number(await patient.recordCount())});
  console.log('Completed load group',count,concurrency);
  fs.writeFileSync('evidence/benchmark-checkpoint.json',JSON.stringify({files,raw,scales},null,2));
}
// Isolate bandwidth from the transaction-only workload: five 1 MiB complete uploads + downloads.
const b0=await fetch(f.base+'/api/metrics').then(r=>r.json());const netStart=performance.now();
for(let i=0;i<5;i++){const record=await upload(f.base,f.wallets[1],patient,identity,randomBytes(1048576),'network.bin','application/octet-stream');await download(f.base,f.wallets[1],patient,identity,record.id);}
const netSeconds=(performance.now()-netStart)/1000,b1=await fetch(f.base+'/api/metrics').then(r=>r.json());
const storageReceived=b1.storage.reduce((sum,s,i)=>sum+s.received-b0.storage[i].received,0),storageSent=b1.storage.reduce((sum,s,i)=>sum+s.sent-b0.storage[i].sent,0);
const gatewayBytes=b1.bytesIn+b1.bytesOut-b0.bytesIn-b0.bytesOut;
const network={fileBytes:1048576,trials:5,seconds:netSeconds,gatewayBytes,storageReceived,storageSent,gatewayMiBPerSecond:gatewayBytes/1048576/netSeconds,storageMiBPerSecond:(storageReceived+storageSent)/1048576/netSeconds,scope:'Measured HTTP application payload bytes. Excludes headers, TCP/TLS framing, Ethereum RPC bytes and libp2p overhead; not physical-link bandwidth.'};
for(const event of await patient.queryFilter(patient.filters.ReadAudit())){const r=await f.provider.getTransactionReceipt(event.transactionHash);receiptRow('read_audit',r,null);}
for(const name of [...new Set(raw.map(r=>r.operation))]){const rows=raw.filter(r=>r.operation===name),timed=rows.filter(r=>r.latencyMs!==null);operations.push({operation:name,n:rows.length,gas:summarize(rows.map(r=>r.gasUsed)),feeEth:summarize(rows.map(r=>r.feeEth)),latency:timed.length?summarize(timed.map(r=>r.latencyMs)):null});}
const deployment=Object.fromEntries(['address','transactionHash','blockNumber','gasUsed','gasPriceWei','feeWei','chainId','compiler'].map(k=>[k,f.deployment[k]]));
const result={date:new Date().toISOString(),environment:{node:process.version,platform:os.platform(),architecture:os.arch(),cpuModel:(()=>{try{return os.cpus()[0]?.model||'Unavailable in sandbox';}catch{return 'Unavailable in sandbox';}})(),logicalCpus:(()=>{try{return os.availableParallelism();}catch{return null;}})(),chain:'Ganache 7.9.2 / Shanghai / chain 31337 / 0.25-second block interval',solidity:f.deployment.compiler,ipfs:'Helia 5.4.2; two loopback peers, separate persistent stores',notes:'Single-host synthetic benchmark. Ganache uses its JavaScript WebSocket fallback under Node 24. No public testnet, WAN, multi-host consensus, sustained clinical load or browser timing was measured.'},deployment,files,operations,scales,network,raw};
fs.mkdirSync('evidence',{recursive:true});fs.writeFileSync('evidence/benchmark-results.json',JSON.stringify(result,null,2));
fs.writeFileSync('evidence/transactions.csv','operation,gas_used,gas_price_wei,fee_wei,fee_eth,latency_ms,transaction_hash,block\n'+raw.map(r=>[r.operation,r.gasUsed,r.gasPriceWei,r.feeWei,r.feeEth,r.latencyMs,r.hash,r.block].join(',')).join('\n'));
console.log('Saved measured results.');await f.close();
