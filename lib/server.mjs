import fs from 'node:fs';
import express from 'express';
import { randomBytes,createHash } from 'node:crypto';
import { Contract, JsonRpcProvider, Wallet, NonceManager, verifyMessage, getAddress } from 'ethers';
import { resourceSnapshot } from './resources.mjs';

const digest=s=>'0x'+createHash('sha256').update(s).digest('hex');
export async function serve({deployment,demoAccounts,storageUrls,port=3000,auditorSigner,dataDirectory='data'}) {
  const app=express(),provider=new JsonRpcProvider('http://127.0.0.1:8545',31337,{staticNetwork:true});provider.pollingInterval=30;
  const auditor=auditorSigner || new NonceManager(new Wallet(demoAccounts[1].privateKey,provider));
  const contract=new Contract(deployment.address,deployment.abi,auditor);
  const nonceStore=new Map(); let bytesIn=0,bytesOut=0,auditSequence=Promise.resolve();
  fs.mkdirSync(dataDirectory,{recursive:true});
  const envelopeFile=dataDirectory+'/envelopes.json',logFile=dataDirectory+'/gateway-audit.jsonl';
  let envelopes=fs.existsSync(envelopeFile)?JSON.parse(fs.readFileSync(envelopeFile)):{};
  let previous='0x'+'0'.repeat(64);
  if(fs.existsSync(logFile)){const lines=fs.readFileSync(logFile,'utf8').trim().split('\n'); if(lines[0])previous=JSON.parse(lines.at(-1)).hash;}
  function audit(entry){const row={time:new Date().toISOString(),...entry,previous};row.hash=digest(JSON.stringify(row));previous=row.hash;fs.appendFileSync(logFile,JSON.stringify(row)+'\n');}
  app.disable('x-powered-by');
  app.use((req,res,next)=>{
    // The local demo deliberately has no cross-origin access to its unlocked wallets.
    if(req.headers.origin && req.headers.origin!==`http://localhost:${port}` && req.headers.origin!==`http://127.0.0.1:${port}`)return res.status(403).end();
    const allowedHosts=[`localhost:${port}`,`127.0.0.1:${port}`];
    if(!allowedHosts.includes(req.headers.host))return res.status(403).end();
    res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' http://127.0.0.1:8545 http://localhost:8545; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'"});
    const original=res.json.bind(res);res.json=obj=>{bytesOut+=Buffer.byteLength(JSON.stringify(obj));return original(obj);};
    if(req.path.startsWith('/api/') && !['/api/challenge','/api/metrics','/api/config'].includes(req.path))res.on('finish',()=>audit({path:req.path,actor:req.actor || null,status:res.statusCode}));
    next();
  });
  app.use(express.json({limit:'24mb',verify:(req,res,buf)=>{req.rawBody=buf;bytesIn+=buf.length;}}));
  app.post('/rpc',async(req,res)=>{
    try{const result=await fetch('http://127.0.0.1:8545',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(req.body)});res.json(await result.json());}catch{res.status(502).json({error:'Local blockchain unavailable'});}
  });
  app.get('/api/config',(_,res)=>res.json({...deployment,rpcUrl:'http://127.0.0.1:8545',chainId:31337,demoAccounts:demoAccounts.filter((_,i)=>i!==1),mode:'LOCAL_SYNTHETIC_DEMO'}));
  app.get('/api/metrics',async(_,res)=>res.json({...resourceSnapshot(),bytesIn,bytesOut,storage:await Promise.all(storageUrls.map(async url=>{try{return await fetch(url+'/health',{signal:AbortSignal.timeout(1500)}).then(r=>r.json());}catch{return {offline:true};}}))}));
  app.post('/api/challenge',(req,res)=>{
    for(const [key,value] of nonceStore)if(value.expires<Date.now())nonceStore.delete(key);
    if(nonceStore.size>=5000)return res.status(429).json({error:'Too many pending requests'});
    try{
      const address=getAddress(req.body.address),path=req.body.path,bodyHash=req.body.bodyHash;
      if(!['/api/store','/api/envelope','/api/read'].includes(path)||!/^0x[0-9a-f]{64}$/.test(bodyHash))throw new Error('Invalid challenge scope');
      const nonce=randomBytes(24).toString('hex'),expires=Date.now()+60000;
      const message=`MediLedger signed request\nChain: 31337\nContract: ${deployment.address}\nAddress: ${address}\nMethod: POST\nPath: ${path}\nBody SHA-256: ${bodyHash}\nNonce: ${nonce}\nExpires: ${expires}`;
      nonceStore.set(nonce,{address,path,bodyHash,expires,message});res.json({nonce,message});
    }catch(e){res.status(400).json({error:e.message});}
  });
  function auth(req,res,next){
    try{
      const nonce=req.get('X-Nonce'),item=nonceStore.get(nonce);nonceStore.delete(nonce);
      if(!item || item.expires<Date.now() || item.path!==req.path || item.bodyHash!==digest(req.rawBody))throw new Error('Expired or invalid signed request');
      if(verifyMessage(item.message,req.get('X-Signature'))!==item.address)throw new Error('Invalid wallet signature');
      req.actor=item.address;next();
    }catch(e){res.status(401).json({error:e.message});}
  }
  app.post('/api/store',auth,async(req,res)=>{
    try{
      if(Number((await contract.profiles(req.actor)).role)!==1)return res.status(403).json({error:'Registered patient required'});
      const payload=req.body.payload; if(typeof payload!=='string'||Buffer.byteLength(payload)>20*1024*1024)throw new Error('File exceeds encrypted payload limit');
      const p=JSON.parse(payload);
      if(p.v!==1||typeof p.iv!=='string'||Buffer.from(p.iv,'base64').length!==12||typeof p.ciphertext!=='string'||Buffer.from(p.ciphertext,'base64').length<16)throw new Error('AES-GCM ciphertext envelope required');
      const results=await Promise.all(storageUrls.map(async url=>{
        const response=await fetch(url+'/objects',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:payload,signal:AbortSignal.timeout(30000)});
        if(!response.ok)throw new Error('IPFS pin failed');return response.json();
      }));
      if(results.some(r=>r.cid!==results[0].cid))throw new Error('IPFS replication CID mismatch');
      res.json({cid:results[0].cid,replicas:results.length});
    }catch(e){res.status(503).json({error:e.message});}
  });
  app.post('/api/envelope',auth,async(req,res)=>{
    try{
      const {id,recipient,envelope}=req.body,record=await contract.records(id),target=getAddress(recipient);
      if(record.owner!==req.actor)return res.status(403).json({error:'Patient owner only'});
      if(typeof envelope!=='string'||envelope.length>1024)throw new Error('Invalid key envelope');
      const permission=await contract.permissions(id,target);
      if(!(await contract.canAccess(id,target)) || permission.envelopeHash!==digest(envelope))return res.status(403).json({error:'No matching on-chain permission'});
      envelopes[`${id}:${target.toLowerCase()}`]=envelope;
      fs.writeFileSync(envelopeFile+'.tmp',JSON.stringify(envelopes));fs.renameSync(envelopeFile+'.tmp',envelopeFile);
      res.json({saved:true});
    }catch(e){res.status(400).json({error:e.message});}
  });
  app.post('/api/read',auth,async(req,res)=>{
    try{
      const id=Number(req.body.id);if(!Number.isSafeInteger(id)||id<1)throw new Error('Invalid record ID');
      // A queue prevents auditor nonce races. No key or object is released until receipt.
      const work=auditSequence.catch(()=>{}).then(async()=>{
        const receipt=await (await contract.logRead(id,req.actor,digest(req.rawBody))).wait();
        const event=receipt.logs.map(l=>{try{return contract.interface.parseLog(l)}catch{return null}}).find(e=>e?.name==='ReadAudit');
        return {receipt,allowed:event?.args.allowed};
      });auditSequence=work;
      const {receipt,allowed}=await work;
      if(!allowed || !(await contract.canAccess(id,req.actor)))return res.status(403).json({error:'Access denied: permission missing, expired, or revoked',auditTransaction:receipt.hash});
      const envelope=envelopes[`${id}:${req.actor.toLowerCase()}`];
      if(!envelope)return res.status(409).json({error:'Permission exists but key delivery is incomplete; ask patient to share again'});
      const record=await contract.records(id);let payload;
      for(const url of storageUrls){
        try{const response=await fetch(url+'/objects/'+encodeURIComponent(record.cid),{signal:AbortSignal.timeout(12000)});if(response.ok){const value=await response.text();if(digest(value)===record.digest){payload=value;break;}}}catch{}
      }
      if(!payload)throw new Error('Encrypted file unavailable or corrupt on all replicas');
      // Check again after the storage fetch, narrowing the revocation race.
      if(!(await contract.canAccess(id,req.actor)))return res.status(403).json({error:'Permission revoked during download'});
      res.json({payload,envelope,auditTransaction:receipt.hash});
    }catch(e){res.status(503).json({error:e.message});}
  });
  app.use('/vendor',express.static('node_modules/ethers/dist'));
  app.get('/lib/:file',(req,res)=>{
    if(!['crypto.mjs','client.mjs'].includes(req.params.file))return res.status(404).end();
    res.sendFile(req.params.file,{root:process.cwd()+'/lib'});
  });
  app.use(express.static('public'));
  app.use((err,req,res,next)=>res.status(400).json({error:'Malformed or oversized request'}));
  return app.listen(port,'127.0.0.1',()=>console.log(`MediLedger ready at http://localhost:${port}`));
}
