import fs from 'node:fs';
import { spawn } from 'node:child_process';
import ganache from 'ganache';
import { ContractFactory, JsonRpcProvider } from 'ethers';
import { serve } from '../lib/server.mjs';
import http from 'node:http';
await import('./compile.mjs');
const dataRoot=process.env.DEMO_DATA || 'data';
fs.mkdirSync(dataRoot,{recursive:true});
const children=[];
for(const [port,name] of [[5001,'ipfs-a'],[5002,'ipfs-b']]){
  const p=spawn(process.execPath,['lib/storage.mjs',String(port),dataRoot+'/'+name],{stdio:'inherit'});children.push(p);
}
async function ready(url){for(let i=0;i<120;i++){try{const r=await fetch(url);if(r.ok)return r.json();}catch{}await new Promise(r=>setTimeout(r,250));}throw new Error('Service not ready: '+url);}
const chain=ganache.server({wallet:{deterministic:true,totalAccounts:30},chain:{chainId:31337,hardfork:'shanghai'},miner:{blockTime:0.25,defaultGasPrice:2000000000},database:{dbPath:dataRoot+'/chain'},logging:{quiet:true},server:{ws:false}});
await chain.listen(8545,'127.0.0.1');
const provider=new JsonRpcProvider('http://127.0.0.1:8545',31337,{staticNetwork:true});provider.pollingInterval=30;
const labels=['Administrator','Audit relayer','Patient','Doctor','Hospital','Unregistered visitor'];
const demoAccounts=Object.entries(chain.provider.getInitialAccounts()).map(([address,item],i)=>({address,privateKey:item.secretKey,label:labels[i] || `Test account ${i}`}));
const artifact=JSON.parse(fs.readFileSync('artifacts/HealthcareRecords.json'));
let deployment=fs.existsSync(dataRoot+'/deployment.json')?JSON.parse(fs.readFileSync(dataRoot+'/deployment.json')):null;
if(deployment && await provider.getCode(deployment.address)==='0x')throw new Error('Deployment does not match chain database');
if(!deployment){
  const factory=new ContractFactory(artifact.abi,artifact.evm.bytecode.object,await provider.getSigner(0));
  const c=await factory.deploy(demoAccounts[1].address),receipt=await c.deploymentTransaction().wait();
  deployment={address:await c.getAddress(),abi:artifact.abi,transactionHash:receipt.hash,blockNumber:receipt.blockNumber,gasUsed:receipt.gasUsed.toString(),gasPriceWei:receipt.gasPrice.toString(),feeWei:receipt.fee.toString(),compiler:artifact.compiler,chainId:31337};
  fs.writeFileSync(dataRoot+'/deployment.json',JSON.stringify(deployment,null,2));
}
const nodes=await Promise.all([5001,5002].map(port=>ready(`http://127.0.0.1:${port}/health`)));
await fetch('http://127.0.0.1:5001/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({address:nodes[1].addresses[0]})});
const server=await serve({deployment,demoAccounts,storageUrls:['http://127.0.0.1:5001','http://127.0.0.1:5002'],dataDirectory:dataRoot});
if(process.argv.includes('--preview')){
  http.createServer((req,res)=>{
    if(!['terminal.local:4173','localhost:4173','127.0.0.1:4173'].includes(req.headers.host) || (req.headers.origin && req.headers.origin!==`http://${req.headers.host}`)){res.writeHead(403);res.end();return;}
    const headers={...req.headers,host:'localhost:3000'};
    if(headers.origin)headers.origin='http://localhost:3000';
    const out=http.request({hostname:'127.0.0.1',port:3000,path:req.url,method:req.method,headers},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
    out.on('error',()=>{res.writeHead(502);res.end('Local application unavailable');});req.pipe(out);
  }).listen(4173,'0.0.0.0');
}
console.log('Contract deployed:',deployment.address,'Gas:',deployment.gasUsed);
async function stop(exitCode=0){for(const child of children)child.kill('SIGTERM');server.close();await chain.close();process.exit(exitCode);}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
if(process.argv.includes('--evaluate') || process.argv.includes('--benchmark') || process.argv.includes('--demo') || fs.existsSync('data/evaluate.request')){
  fs.mkdirSync('evidence',{recursive:true});
  if(fs.existsSync('data/evaluate.request'))fs.unlinkSync('data/evaluate.request');
  const run=(args,path)=>new Promise(resolve=>{const fd=fs.openSync(path,'w');const child=spawn(process.execPath,args,{stdio:['ignore',fd,fd]});child.on('exit',code=>{fs.closeSync(fd);resolve(code);});});
  const tests=process.argv.includes('--benchmark')||process.argv.includes('--demo')?0:await run(['--test','--test-reporter=tap','--test-concurrency=1','tests/system.test.mjs'],'evidence/tests.tap');
  console.log('Test suite finished:',tests);
  let exitCode=tests;
  if(tests===0){const script=process.argv.includes('--demo')?'demo':'benchmark';exitCode=await run([`scripts/${script}.mjs`],`evidence/${script}.log`);console.log(script+' finished:',exitCode);}
  if(exitCode===0 && process.argv.includes('--evaluate')){exitCode=await run(['scripts/demo.mjs'],'evidence/demo.log');console.log('demo finished:',exitCode);}
  if(!process.argv.includes('--preview'))await stop(exitCode);
}
