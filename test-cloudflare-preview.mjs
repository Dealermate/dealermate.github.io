import assert from 'node:assert/strict';
import worker from './pages-report-preview/_worker.js';
const token='a'.repeat(32),base='https://test.workers.dev',signed='https://crmeeegayzezeqhgkagx.supabase.co/storage/v1/object/sign/inspection-photos/owner/car.jpg?token=x';
let record={report:{fields:[{label:'차량명',value:'테스트 <img src=x>'},{label:'연식·최초등록',value:'2022년'},{label:'판매가',value:'2,350만원'},{label:'이전비 계좌',value:'PRIVATE_ACCOUNT'}],photos:[{category:'finding',partKey:'hood',url:signed},{category:'vehicle',url:signed}]},expiresAt:new Date(Date.now()+600000).toISOString(),publishedAt:new Date().toISOString()};
let imageCalls=0,rpcCalls=0;
globalThis.fetch=async(url,options)=>{
 assert.notEqual(options.redirect,'error','Workers does not support redirect:error');
 if(url.endsWith('/rest/v1/rpc/read_broker_report')){rpcCalls++;assert.equal(JSON.parse(options.body).p_token,token);return Response.json(record)}
 assert.equal(url,signed);assert.equal(options.redirect,'manual');imageCalls++;return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/jpeg','Content-Length':'3'}});
};
let response=await worker.fetch(new Request(base+'/r/'+encodeURIComponent('12가3456-'+token))),body=await response.text();
assert.equal(response.status,200);assert.match(body,/property="og:image"/);assert.match(body,/property="og:image:secure_url"/);assert.match(body,/\/image\/[a-f0-9]+\.jpg\?v=\d+-2/);assert.match(body,/2022년/);assert.match(body,/2,350만원/);assert.match(body,/테스트 &lt;img src=x&gt;/);assert(!body.includes('<img src=x>'));assert(!body.includes('PRIVATE_ACCOUNT'));assert.match(body,/location.replace\("https:\/\/dealermate.github.io\/v.html#/);assert.equal(response.headers.get('cache-control'),'private, no-store, max-age=0');
response=await worker.fetch(new Request(base+'/image/'+token+'.jpg'));assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/jpeg');assert.equal(imageCalls,1);assert.equal(response.headers.get('content-length'),'3');assert(response.headers.get('content-disposition').startsWith('inline'));
record.report.photos=[{category:'finding',partKey:'hood',url:signed}];body=await(await worker.fetch(new Request(base+'/r/'+token))).text();assert(!body.includes('property="og:image"'));
record.report.photos=[{category:'vehicle',url:'https://attacker.test/private'}];assert.equal((await worker.fetch(new Request(base+'/image/'+token))).status,404);assert.equal(imageCalls,1);
record.expiresAt=new Date(Date.now()-1).toISOString();assert.equal((await worker.fetch(new Request(base+'/r/'+token))).status,410);assert.equal((await worker.fetch(new Request(base+'/image/'+token))).status,410);record=null;assert.equal((await worker.fetch(new Request(base+'/r/'+token))).status,410);
const before=rpcCalls;assert.equal((await worker.fetch(new Request(base+'/r/not-a-token'))).status,404);assert.equal((await worker.fetch(new Request(base+'/r/'+token,{method:'POST'}))).status,405);assert.equal(rpcCalls,before);
globalThis.fetch=async()=>{throw Error('offline')};assert.equal((await worker.fetch(new Request(base+'/r/'+token))).status,503);
console.log('PASS: OG fields, first vehicle photo only, existing viewer redirect, escaped text, no accounts, expired/revoked report protection, image allowlist, invalid tokens/methods, upstream failures.');
