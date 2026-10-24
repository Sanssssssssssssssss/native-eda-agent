// Explicit opt-in transport. Headers are never written to evidence or errors.
import fs from 'node:fs';
export async function uploadOtlp(file, endpoint, {headers={},timeoutMs=10000}={}) {
  const url=new URL(endpoint);
  if(url.username || url.password || !['http:','https:'].includes(url.protocol)) throw new Error('Use an HTTP(S) endpoint without URL credentials');
  if(url.protocol==='http:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('Remote collectors require HTTPS');
  if(!Number.isInteger(timeoutMs) || timeoutMs<1 || timeoutMs>60000) throw new Error('Invalid upload timeout');
  const payload=fs.readFileSync(file,'utf8');
  if(Buffer.byteLength(payload)>10*1024*1024) throw new Error('Payload exceeds 10 MiB');
  const parsed=JSON.parse(payload);
  if(!Array.isArray(parsed.resourceSpans)) throw new Error('Expected an OTLP trace payload');
  let response;
  try {
    const requestHeaders=new Headers(headers);requestHeaders.set('Content-Type','application/json');
    response=await fetch(url,{method:'POST',headers:requestHeaders,body:payload,redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
  } catch {throw new Error('OTLP transport failed or timed out; no retry was attempted');}
  if(response.status!==200) throw new Error(`OTLP receiver returned HTTP ${response.status}; no retry was attempted`);
  let reply;
  try {reply=await response.json();} catch {throw new Error('OTLP receiver returned invalid JSON acknowledgement');}
  if(!reply || typeof reply!=='object' || Array.isArray(reply)) throw new Error('OTLP acknowledgement must be an object');
  const rejected=Number(reply.partialSuccess?.rejectedSpans ?? 0);
  if(!Number.isSafeInteger(rejected) || rejected<0) throw new Error('Invalid OTLP rejected span count');
  if(rejected>0) throw new Error(`OTLP receiver rejected ${rejected} spans; partial acceptance is not success`);
  return {uploaded:true,rejected_spans:0,receiver_warning:Boolean(reply.partialSuccess?.errorMessage),automatic_retry:false};
}
