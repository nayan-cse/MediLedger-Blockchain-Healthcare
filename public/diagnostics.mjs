const calls=['eth_blockNumber','txpool_content'];
const result={};
for(const method of calls){result[method]=await fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:[]})}).then(r=>r.json());}
document.getElementById('result').textContent=JSON.stringify(result,null,2);
