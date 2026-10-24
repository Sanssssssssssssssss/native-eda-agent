import { uploadOtlp } from '../src/otlp-upload.mjs';
const [file,flag,endpoint]=process.argv.slice(2);
if(!file || flag!=='--endpoint' || !endpoint || process.argv.length!==5) throw new Error('Usage: node scripts/upload-traces.mjs FILE.json --endpoint URL');
// EDA_OTLP_HEADERS_JSON may contain credentials. Neither content nor endpoint is logged.
let headers={};
try {headers=JSON.parse(process.env.EDA_OTLP_HEADERS_JSON || '{}');} catch {throw new Error('Invalid EDA_OTLP_HEADERS_JSON');}
if(!headers || typeof headers!=='object' || Array.isArray(headers) || Object.values(headers).some(v=>typeof v!=='string')) throw new Error('Headers must be a JSON object of strings');
console.log(JSON.stringify(await uploadOtlp(file,endpoint,{headers})));
