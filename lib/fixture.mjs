import fs from 'node:fs';
import { Contract, ContractFactory, JsonRpcProvider, Wallet, NonceManager } from 'ethers';
import { serve } from './server.mjs';
import { performance } from 'node:perf_hooks';
export async function fixture(port,directory){
  const config=await fetch('http://127.0.0.1:3000/api/config').then(r=>r.json());
  const provider=new JsonRpcProvider(config.rpcUrl,31337,{staticNetwork:true});provider.pollingInterval=20;
  const artifact=JSON.parse(fs.readFileSync('artifacts/HealthcareRecords.json'));
  const wallets=config.demoAccounts.map(a=>new NonceManager(new Wallet(a.privateKey,provider)));
  const auditor=await provider.getSigner(1);
  const deploymentStarted=performance.now();
  const instance=await new ContractFactory(artifact.abi,artifact.evm.bytecode.object,wallets[0]).deploy(await auditor.getAddress());
  const receipt=await instance.deploymentTransaction().wait();
  const deployment={...config,address:await instance.getAddress(),transactionHash:receipt.hash,blockNumber:receipt.blockNumber,gasUsed:receipt.gasUsed.toString(),gasPriceWei:receipt.gasPrice.toString(),feeWei:receipt.fee.toString()};
  const server=await serve({deployment,demoAccounts:config.demoAccounts,storageUrls:['http://127.0.0.1:5001','http://127.0.0.1:5002'],port,auditorSigner:auditor,dataDirectory:directory});
  return {provider,contract:instance,wallets,deployment,receipt,deploymentMs:performance.now()-deploymentStarted,base:`http://127.0.0.1:${port}`,connect:i=>new Contract(deployment.address,artifact.abi,wallets[i]),close:async()=>{await new Promise(r=>server.close(r));provider.destroy();}};
}
