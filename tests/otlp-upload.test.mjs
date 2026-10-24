import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { uploadOtlp } from '../src/otlp-upload.mjs';
test('OTLP loopback receiver accepts JSON; partial rejection, redirects and invalid acknowledgements fail',async()=>{
  const dir=fs.mkdtempSync(path.resolve(import.meta.dirname,'../artifacts/otlp-contract-'));
  const file=path.join(dir,'payload.json');fs.writeFileSync(file,JSON.stringify({resourceSpans:[]}));
  let mode='ok',seen;
  const server=http.createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    seen={type:req.headers['content-type'],auth:req.headers.authorization,body:JSON.parse(body)};
    if(mode==='redirect'){res.writeHead(307,{Location:'/other'});res.end();return;}
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(mode==='partial'?JSON.stringify({partialSuccess:{rejectedSpans:'1',errorMessage:'PRIVATE_SERVER_MESSAGE'}}):mode==='bad'?'invalid':'{}');
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const endpoint=`http://127.0.0.1:${server.address().port}/v1/traces`;
  try {
    assert.equal((await uploadOtlp(file,endpoint,{headers:{Authorization:'synthetic-only'}})).uploaded,true);
    assert.equal(seen.type,'application/json');assert.equal(seen.auth,'synthetic-only');assert.deepEqual(seen.body,{resourceSpans:[]});
    mode='partial';await assert.rejects(uploadOtlp(file,endpoint),/rejected 1 spans/);
    mode='redirect';await assert.rejects(uploadOtlp(file,endpoint),/transport failed/);
    mode='bad';await assert.rejects(uploadOtlp(file,endpoint),/invalid JSON/);
    await assert.rejects(uploadOtlp(file,'http://example.invalid/v1/traces'),/require HTTPS/);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
