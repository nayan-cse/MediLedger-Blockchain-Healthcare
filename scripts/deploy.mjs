// Optional external EVM deployment. Explicitly run by the student with a funded test wallet.
import fs from 'node:fs';
import { ContractFactory, JsonRpcProvider, Wallet } from 'ethers';
await import('./compile.mjs');
const {RPC_URL,DEPLOYER_PRIVATE_KEY,AUDITOR_ADDRESS}=process.env;
if(!RPC_URL||!DEPLOYER_PRIVATE_KEY||!AUDITOR_ADDRESS)throw new Error('Set RPC_URL, DEPLOYER_PRIVATE_KEY, AUDITOR_ADDRESS. Never use demo keys on a public network.');
const artifact=JSON.parse(fs.readFileSync('artifacts/HealthcareRecords.json'));
const provider=new JsonRpcProvider(RPC_URL),wallet=new Wallet(DEPLOYER_PRIVATE_KEY,provider);
const c=await new ContractFactory(artifact.abi,artifact.evm.bytecode.object,wallet).deploy(AUDITOR_ADDRESS);
const receipt=await c.deploymentTransaction().wait();
const result={address:await c.getAddress(),transactionHash:receipt.hash,gasUsed:receipt.gasUsed.toString(),gasPriceWei:receipt.gasPrice.toString(),feeWei:receipt.fee.toString(),chainId:(await provider.getNetwork()).chainId.toString()};
fs.mkdirSync('evidence',{recursive:true});fs.writeFileSync('evidence/external-deployment.json',JSON.stringify(result,null,2));console.log(result);
