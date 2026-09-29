import { makeIdentity } from '/lib/crypto.mjs';
import { upload, download, share } from '/lib/client.mjs';
const {ethers}=window,$=id=>document.getElementById(id),roles=['Unregistered','Patient','Doctor','Hospital'];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=s=>s.slice(0,8)+'…'+s.slice(-6);
let config,provider,signer,contract,address,profile,identity,profiles=[],events=[];
const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('mediledger-keys-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('keys');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
async function keyStore(key,value){return new Promise((resolve,reject)=>{const t=db.transaction('keys',value?'readwrite':'readonly'),r=value?t.objectStore('keys').put(value,key):t.objectStore('keys').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function notice(text,error=false){$('notice').textContent=text;$('notice').className=error?'error':'';}
async function act(fn){document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();await refresh();}catch(e){notice(e.shortMessage||e.reason||e.message,true);}finally{document.querySelectorAll('button').forEach(b=>b.disabled=false);}}
function openTab(id){document.querySelectorAll('.page').forEach(p=>p.hidden=p.id!==id);document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('selected',b.dataset.tab===id));$('page-title').textContent={records:'Medical history',register:'Registration',audit:'Audit trail',admin:'Administration',metrics:'Performance'}[id];}
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>openTab(b.dataset.tab));
config=await fetch('/api/config').then(r=>r.json());
$('account-select').innerHTML=config.demoAccounts.slice(0,5).map(a=>`<option value="${a.address}">${esc(a.label)}</option>`).join('');
$('chain-info').textContent=`Chain ${config.chainId} · ${config.address}`;
async function connectDemo(){provider=new ethers.JsonRpcProvider(new URL('/rpc',location.href).href,config.chainId,{staticNetwork:true});provider.pollingInterval=40;signer=new ethers.Wallet(config.demoAccounts.find(a=>a.address===$('account-select').value).privateKey,provider);await connected();}
async function connected(){address=await signer.getAddress();contract=new ethers.Contract(config.address,config.abi,signer);identity=await keyStore(config.address+':'+address.toLowerCase());$('record-detail').hidden=true;await refresh();notice('Wallet connected. Choose a task from the menu.');}
$('account-select').onchange=()=>act(connectDemo);
$('wallet-connect').onclick=()=>act(async()=>{if(!window.ethereum)throw new Error('Install a browser wallet and add local chain 31337 at http://127.0.0.1:8545.');provider=new ethers.BrowserProvider(window.ethereum);await provider.send('eth_requestAccounts',[]);if((await provider.getNetwork()).chainId!==31337n)throw new Error('Select local chain 31337 in your wallet.');signer=await provider.getSigner();await connected();});
async function refresh(){
  profile=await contract.profiles(address);const count=Number(await contract.recordCount());
  const logs=await provider.getLogs({address:config.address,fromBlock:config.blockNumber,toBlock:'latest'});
  events=logs.map(log=>({...contract.interface.parseLog(log),blockNumber:log.blockNumber,hash:log.transactionHash}));
  const addresses=[...new Set(events.filter(e=>e.name==='Registered').map(e=>e.args.account))];
  profiles=await Promise.all(addresses.map(async account=>({account,...Object.fromEntries(['role','active','encryptionKey'].map((k,i)=>[k,null])),p:await contract.profiles(account)})));
  $('identity').textContent=`${roles[Number(profile.role)]} · ${address}${Number(profile.role)>1?(profile.active?' · Approved':' · Awaiting approval'):''}${Number(profile.role)>0&&!identity?' · Encryption key missing in this browser':''}`;
  const own=[],accessible=[];
  // Small-demo scan. Production should paginate an event indexer (this is O(n)).
  for(let id=1;id<=count;id++){const r=await contract.records(id);if(r.owner===address)own.push(id);if(await contract.canAccess(id,address))accessible.push({id,r});}
  $('record-stats').innerHTML=[[own.length,'Owned records'],[accessible.length-own.length,'Shared with you'],[events.filter(e=>e.name==='ReadAudit'&&e.args.actor===address).length,'Audited read requests']].map(([n,l])=>`<div class="stat"><strong>${n}</strong><span>${l}</span></div>`).join('');
  $('record-list').innerHTML=accessible.length?accessible.map(({id,r})=>`<div class="record"><div><strong>Medical record #${id}</strong> <span class="badge">${r.owner===address?'Owner':'Shared'}</span><small>${new Date(Number(r.createdAt)*1000).toLocaleString()} · Encrypted</small></div><button data-open="${id}">Open</button></div>`).join(''):'<div class="empty">No accessible records yet.<br>Register as a patient to upload your first file.</div>';
  document.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>act(()=>openRecord(Number(b.dataset.open))));
  $('upload-card').hidden=Number(profile.role)!==1;
  const old=$('recipient').value;
  $('recipient').innerHTML=profiles.filter(p=>Number(p.p.role)>1&&p.p.active).map(p=>`<option value="${p.account}">${roles[Number(p.p.role)]} · ${short(p.account)}</option>`).join('');if(old)$('recipient').value=old;
  $('audit-rows').innerHTML=events.slice(-150).reverse().map(e=>`<tr><td>${e.blockNumber}</td><td>${esc(e.name)}</td><td>${e.args.recordId?'#'+e.args.recordId+' · ':''}${short(e.args.actor||e.args.account||e.args.owner||address)}</td><td>${e.name==='ReadAudit'?(e.args.allowed?'Allowed':'Denied'):e.name==='ProviderStatus'?(e.args.active?'Approved':'Disabled'):'Confirmed'}</td><td class="mono" title="${e.hash}">${short(e.hash)}</td></tr>`).join('');
  $('admin-stats').innerHTML=[[profiles.filter(p=>Number(p.p.role)===1).length,'Patients'],[profiles.filter(p=>Number(p.p.role)===2).length,'Doctors'],[profiles.filter(p=>Number(p.p.role)===3).length,'Hospitals']].map(([n,l])=>`<div class="stat"><strong>${n}</strong><span>${l}</span></div>`).join('');
  const isAdmin=address.toLowerCase()===config.demoAccounts[0].address.toLowerCase();
  $('provider-rows').innerHTML=profiles.filter(p=>Number(p.p.role)>1).map(p=>`<tr><td class="mono">${p.account}</td><td>${roles[Number(p.p.role)]}</td><td><span class="badge ${p.p.active?'':'pending'}">${p.p.active?'Approved':'Pending / disabled'}</span></td><td>${isAdmin?`<button data-provider="${p.account}" data-state="${!p.p.active}">${p.p.active?'Disable':'Approve'}</button>`:'Administrator only'}</td></tr>`).join('');
  document.querySelectorAll('[data-provider]').forEach(b=>b.onclick=()=>act(async()=>{notice('Confirming provider status...');await(await contract.setProviderStatus(b.dataset.provider,b.dataset.state==='true')).wait();notice('Provider status updated.');}));
  const m=await fetch('/api/metrics').then(r=>r.json());
  $('metrics-data').innerHTML='<div class="metrics-grid">'+[['Deployment gas',Number(config.gasUsed).toLocaleString()],['Deployment fee',ethers.formatEther(config.feeWei)+' ETH (local)'],[`App + EVM memory (${m.rssKind})`,(m.rss/1048576).toFixed(1)+' MiB'],['IPFS replicas online',m.storage.filter(x=>!x.offline).length+' / 2'],['Registered records',count],['Confirmed events',events.length]].map(([k,v])=>`<div><span class="muted">${k}</span><br><strong>${v}</strong></div>`).join('')+'</div>';
}
$('register-button').onclick=()=>act(async()=>{
  if(Number(profile.role)!==0)throw new Error('This wallet is already registered.');
  notice('Creating your private encryption identity...');
  if(!identity){identity=await makeIdentity();await keyStore(config.address+':'+address.toLowerCase(),identity);}
  await(await contract.register(Number($('role').value),identity.publicKey)).wait();notice('Registration confirmed on the blockchain.');
});
$('upload').onclick=()=>act(async()=>{
  const file=$('file').files[0];if(!file)throw new Error('Choose a medical file first.');if(!identity)throw new Error('Register in this browser before uploading.');if(file.size>8*1024*1024)throw new Error('Maximum original file size is 8 MiB.');
  notice('Encrypting, pinning two replicas, and confirming ownership...');
  const result=await upload('',signer,contract,identity,new Uint8Array(await file.arrayBuffer()),file.name,file.type);
  $('share-id').value=result.id;notice(`Record #${result.id} encrypted and uploaded. Ownership confirmed.`);$('file').value='';
});
async function openRecord(id){
  if(!identity)throw new Error('Encryption identity is missing. Register or return to the original browser profile.');
  notice('Checking consent and recording your access request...');
  const file=await download('',signer,contract,identity,id),detail=$('record-detail');
  detail.replaceChildren();let h=document.createElement('h2');h.textContent=`Record #${id} · ${file.name}`;detail.append(h);
  const p=document.createElement('p');p.textContent=`Integrity verified · ${file.bytes.length.toLocaleString()} bytes · Decrypted in this browser`;detail.append(p);
  if(file.type.startsWith('text/')||file.name.endsWith('.txt')){let pre=document.createElement('pre');pre.textContent=new TextDecoder().decode(file.bytes).slice(0,12000);detail.append(pre);}
  const button=document.createElement('button');button.textContent='Save decrypted file';button.onclick=()=>{const url=URL.createObjectURL(new Blob([file.bytes],{type:'application/octet-stream'}));const a=document.createElement('a');a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};detail.append(button);detail.hidden=false;
  $('share-id').value=id;notice(`Record #${id} opened. Read request recorded on the blockchain.`);
}
$('lookup').onclick=()=>act(()=>openRecord(Number($('lookup-id').value)));
$('grant').onclick=()=>act(async()=>{if(!identity)throw new Error('Encryption identity missing');const duration=Number($('expires').value);notice('Wrapping the record key and confirming patient consent...');await share('',signer,contract,identity,Number($('share-id').value),$('recipient').value,duration?Math.floor(Date.now()/1000)+duration:0);notice('Access granted. The provider can now decrypt this record.');});
$('revoke').onclick=()=>act(async()=>{notice('Confirming revocation...');await(await contract.revoke(Number($('share-id').value),$('recipient').value)).wait();$('record-detail').hidden=true;notice('Permission revoked. Future application reads are blocked.');});
$('refresh').onclick=()=>act(async()=>{await refresh();notice('Medical history refreshed.');});$('refresh-audit').onclick=$('refresh').onclick;
await connectDemo();
