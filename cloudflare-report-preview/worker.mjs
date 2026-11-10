// Dealer Mate: public link previews for already-published, unexpired reports.
// Uses only the existing public read RPC. Never add a service-role key here.
const PROJECT='https://crmeeegayzezeqhgkagx.supabase.co';
const VIEWER='https://dealermate.github.io/v.html';
const PUBLIC_KEY='sb_publishable_6wpAz2ELkD2Eh2ircwzVGw_78QKns9C';
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const commonHeaders={'Cache-Control':'private, no-store, max-age=0','X-Robots-Tag':'noindex, nofollow, noarchive','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
function html(body,status=200){return new Response(body,{status,headers:{...commonHeaders,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"}})}
function unavailable(status){return html('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>차량리포트 · 딜러메이트</title><h1>리포트를 열 수 없습니다.</h1><p>링크가 만료되었거나 공유가 종료되었습니다. 담당자에게 확인해주세요.</p></html>',status)}
function parseToken(segment){
 let value;try{value=decodeURIComponent(segment)}catch{return ''}
 if(/^(?:[0-9a-f]{32}|[0-9a-f]{64})$/.test(value))return value;
 return /^[0-9가-힣A-Za-z]{1,32}-[0-9a-f]{32}$/.test(value)?value.slice(value.lastIndexOf('-')+1):'';
}
async function readReport(token){
 const response=await fetch(PROJECT+'/rest/v1/rpc/read_broker_report',{method:'POST',headers:{apikey:PUBLIC_KEY,'Content-Type':'application/json'},body:JSON.stringify({p_token:token}),redirect:'error',signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw Error('report service unavailable');
 const data=await response.json(),expires=Date.parse(data?.expiresAt||'');
 if(!data?.report||!Number.isFinite(expires)||expires<=Date.now())return null;
 return data;
}
function firstVehiclePhoto(report){
 return (Array.isArray(report.photos)?report.photos:[]).find(p=>{
  if(!p||p.partKey||p.category&&p.category!=='vehicle')return false;
  if(!p.category&&p.label&&!['차량 전체 사진','차량사진'].includes(p.label))return false;
  try{const url=new URL(p.url);return url.origin===PROJECT&&url.pathname.startsWith('/storage/v1/object/sign/inspection-photos/')&&!url.username&&!url.password}catch{return false}
 });
}
export default {
 async fetch(request){
  const url=new URL(request.url);
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{...commonHeaders,Allow:'GET, HEAD'}});
  if(url.pathname==='/robots.txt')return new Response('User-agent: *\nAllow: /\n',{headers:commonHeaders});
  if(url.pathname==='/')return html('<!doctype html><html lang="ko"><meta charset="utf-8"><title>딜러메이트 공유 미리보기</title><h1>딜러메이트 공유 미리보기 준비 완료</h1><p>전달받은 차량리포트 링크로 접속해주세요.</p></html>');
  const match=url.pathname.match(/^\/(r|image)\/([^/]+)$/),token=match?parseToken(match[2]):'';
  if(!token)return unavailable(404);
  try{
   const data=await readReport(token);if(!data)return unavailable(410);
   const report=data.report,photo=firstVehiclePhoto(report);
   if(match[1]==='image'){
    if(!photo)return new Response(null,{status:404,headers:commonHeaders});
    const image=await fetch(photo.url,{redirect:'error',signal:AbortSignal.timeout(8000)});
    const type=(image.headers.get('content-type')||'').split(';')[0].trim();
    if(!image.ok||!['image/jpeg','image/png','image/webp','image/gif','image/avif'].includes(type))return new Response(null,{status:404,headers:commonHeaders});
    return new Response(request.method==='HEAD'?null:image.body,{headers:{...commonHeaders,'Content-Type':type}});
   }
   const fields=Array.isArray(report.fields)?report.fields:[];
   const value=label=>String(fields.find(f=>f?.label===label)?.value||'').slice(0,200);
   const name=value('차량명'),title=(name&&name!=='미입력'?name:'차량리포트')+' | 딜러메이트';
   const description=['등급','연식·최초등록','주행거리','연료','판매가'].map(value).filter(v=>v&&v!=='미입력').join(' · ')||'차량 상태와 확인 사진을 차량리포트에서 확인하세요.';
   const canonical=new URL('/r/'+match[2],url.origin);const revision=url.searchParams.get('v');if(/^\d{1,17}$/.test(revision||''))canonical.searchParams.set('v',revision);
   const target=VIEWER+'#'+token;
   const image=new URL('/image/'+token,url.origin);const updated=Date.parse(data.updatedAt||data.publishedAt||'');if(Number.isFinite(updated))image.searchParams.set('v',String(updated));
   const body='<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>'+escapeHtml(title)+'</title><meta name="description" content="'+escapeHtml(description)+'"><meta property="og:type" content="website"><meta property="og:site_name" content="딜러메이트"><meta property="og:locale" content="ko_KR"><meta property="og:title" content="'+escapeHtml(title)+'"><meta property="og:description" content="'+escapeHtml(description)+'"><meta property="og:url" content="'+escapeHtml(canonical.href)+'">'+(photo?'<meta property="og:image" content="'+escapeHtml(image.href)+'"><meta property="og:image:alt" content="'+escapeHtml(name+' 차량사진')+'">':'')+'<meta name="twitter:card" content="summary_large_image"></head><body><h1>'+escapeHtml(name||'차량리포트')+'</h1><p>'+escapeHtml(description)+'</p><p><a href="'+escapeHtml(target)+'">차량리포트 열기</a></p><script>location.replace('+JSON.stringify(target)+');</script></body></html>';
   return request.method==='HEAD'?new Response(null,{headers:{...commonHeaders,'Content-Type':'text/html; charset=utf-8'}}):html(body);
  }catch{return new Response('일시적으로 리포트를 불러오지 못했습니다. 잠시 후 다시 접속해주세요.',{status:503,headers:{...commonHeaders,'Content-Type':'text/plain; charset=utf-8','Retry-After':'30'}})}
 }
};
