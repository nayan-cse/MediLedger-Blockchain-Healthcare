import { hashText, encryptFile, decryptFile, unwrap, wrap } from './crypto.mjs';

export async function authenticated(base, signer, path, body={}) {
  const address=await signer.getAddress();
  const bodyText=JSON.stringify(body);
  const challenge=await fetch(base+'/api/challenge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({address,path,bodyHash:await hashText(bodyText)})}).then(r=>r.json());
  if(!challenge.message) throw new Error(challenge.error || 'Challenge failed');
  const signature=await signer.signMessage(challenge.message);
  const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','X-Nonce':challenge.nonce,'X-Signature':signature},body:bodyText});
  const result=await response.json();
  if(!response.ok) throw new Error(result.error || 'Request failed');
  return result;
}
export async function upload(base, signer, contract, identity, bytes, name, type) {
  const encrypted=await encryptFile(bytes,name,type,identity.publicKey);
  const stored=await authenticated(base,signer,'/api/store',{payload:encrypted.payload});
  const tx=await contract.createRecord(stored.cid,encrypted.digest,await hashText(encrypted.envelope));
  const receipt=await tx.wait();
  const event=receipt.logs.map(l=>{try{return contract.interface.parseLog(l)}catch{return null}}).find(e=>e?.name==='RecordCreated');
  const id=Number(event.args.recordId);
  await authenticated(base,signer,'/api/envelope',{id,recipient:await signer.getAddress(),envelope:encrypted.envelope});
  return {id,receipt,cid:stored.cid};
}
export async function download(base, signer, contract, identity, id) {
  const result=await authenticated(base,signer,'/api/read',{id});
  const record=await contract.records(id);
  if(await hashText(result.payload)!==record.digest) throw new Error('Ciphertext integrity mismatch');
  const permission=await contract.permissions(id,await signer.getAddress());
  if(await hashText(result.envelope)!==permission.envelopeHash) throw new Error('Key envelope integrity mismatch');
  return decryptFile(result.payload,result.envelope,identity.privateKey);
}
export async function share(base, signer, contract, identity, id, recipient, expiresAt=0) {
  const own=await authenticated(base,signer,'/api/read',{id});
  const existing=await contract.permissions(id,await signer.getAddress());
  if(await hashText(own.envelope)!==existing.envelopeHash) throw new Error('Key envelope integrity mismatch');
  const recipientProfile=await contract.profiles(recipient);
  const raw=await unwrap(own.envelope,identity.privateKey);
  const envelope=await wrap(raw,recipientProfile.encryptionKey); raw.fill(0);
  const receipt=await (await contract.grant(id,recipient,expiresAt,await hashText(envelope))).wait();
  await authenticated(base,signer,'/api/envelope',{id,recipient,envelope});
  return receipt;
}
