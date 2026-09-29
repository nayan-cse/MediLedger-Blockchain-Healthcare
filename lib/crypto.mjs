// Shared by the browser, integration tests and benchmarks. Uses native Web Crypto.
const enc = new TextEncoder();
export const to64 = bytes => {
  let s=''; for (const b of new Uint8Array(bytes)) s+=String.fromCharCode(b);
  return btoa(s);
};
export const from64 = s => Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export const hash = async bytes => '0x'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
export const hashText = s => hash(enc.encode(s));
export async function makeIdentity() {
  if(!crypto.subtle)throw new Error('Encryption requires HTTPS or localhost. Open this application at http://localhost:3000.');
  const pair=await crypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},false,['encrypt','decrypt']);
  return {privateKey:pair.privateKey, publicKey:to64(await crypto.subtle.exportKey('spki',pair.publicKey))};
}
export async function wrap(key, publicKey) {
  const pub=await crypto.subtle.importKey('spki',from64(publicKey),{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
  return to64(await crypto.subtle.encrypt({name:'RSA-OAEP'},pub,key));
}
export async function unwrap(envelope, privateKey) {
  return new Uint8Array(await crypto.subtle.decrypt({name:'RSA-OAEP'},privateKey,from64(envelope)));
}
export async function encryptFile(bytes, name, type, publicKey) {
  const raw=crypto.getRandomValues(new Uint8Array(32));
  const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const plain=enc.encode(JSON.stringify({name,type,data:to64(bytes)}));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode('MediLedger:v1'),tagLength:128},key,plain);
  const payload=JSON.stringify({v:1,iv:to64(iv),ciphertext:to64(ciphertext)});
  const envelope=await wrap(raw,publicKey);
  raw.fill(0);
  return {payload,envelope,digest:await hashText(payload)};
}
export async function decryptFile(payload, envelope, privateKey) {
  const raw=await unwrap(envelope,privateKey);
  const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['decrypt']); raw.fill(0);
  const item=JSON.parse(payload);
  if(item.v!==1) throw new Error('Unsupported ciphertext version');
  const data=await crypto.subtle.decrypt({name:'AES-GCM',iv:from64(item.iv),additionalData:enc.encode('MediLedger:v1'),tagLength:128},key,from64(item.ciphertext));
  const plain=JSON.parse(new TextDecoder().decode(data));
  return {name:plain.name,type:plain.type,bytes:from64(plain.data)};
}
