// Independent encrypted-content IPFS node. API and swarm listen on loopback only.
import fs from 'node:fs';
import express from 'express';
import { createHelia } from 'helia';
import { unixfs } from '@helia/unixfs';
import { FsBlockstore } from 'blockstore-fs';
import { FsDatastore } from 'datastore-fs';
import { CID } from 'multiformats/cid';
import { multiaddr } from '@multiformats/multiaddr';
import { resourceSnapshot } from './resources.mjs';

const port=Number(process.argv[2]), directory=process.argv[3];
fs.mkdirSync(directory,{recursive:true});
const node=await createHelia({
  blockstore:new FsBlockstore(directory+'/blocks'),
  datastore:new FsDatastore(directory+'/metadata'),
  libp2p:{addresses:{listen:['/ip4/127.0.0.1/tcp/0']},peerDiscovery:[]},
  routers:[]
});
const files=unixfs(node), app=express();
let received=0, sent=0;
app.use(express.raw({type:'application/octet-stream',limit:'24mb'}));
app.get('/health',(_,res)=>res.json({peerId:node.libp2p.peerId.toString(),addresses:node.libp2p.getMultiaddrs().map(a=>a.toString()),...resourceSnapshot(),received,sent}));
app.post('/connect',express.json(),async(req,res)=>{
  try{await node.libp2p.dial(multiaddr(req.body.address));res.json({connected:true});}catch(e){res.status(500).json({error:e.message});}
});
app.post('/objects',async(req,res)=>{
  try {
    if(!Buffer.isBuffer(req.body) || !req.body.length) throw new Error('Binary payload required');
    received+=req.body.length;
    const cid=await files.addBytes(req.body);
    for await (const _ of node.pins.add(cid)) {}
    res.json({cid:cid.toString()});
  } catch(e){res.status(500).json({error:e.message});}
});
app.get('/objects/:cid',async(req,res)=>{
  try {
    const chunks=[]; let total=0;
    for await (const chunk of files.cat(CID.parse(req.params.cid),{signal:AbortSignal.timeout(10000)})) {total+=chunk.length;if(total>24*1024*1024)throw new Error('Object too large');chunks.push(chunk);}
    sent+=total;res.type('application/octet-stream').send(Buffer.concat(chunks));
  } catch(e){res.status(404).json({error:'Encrypted object unavailable'});}
});
const http=app.listen(port,'127.0.0.1',()=>console.log('IPFS node ready',port));
async function stop(){http.close();await node.stop();process.exit(0);}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
