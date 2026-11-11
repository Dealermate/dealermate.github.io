export const norm = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
const compact = value => norm(value).replace(/\s/g,'');
const clean = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g,' ');
const buyer = v => ['내수','수출'].includes(clean(v)) ? clean(v) : '';
export async function sha(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value)),b=>b.toString(16).padStart(2,'0')).join('')}
function date(value){const s=clean(value).replace(/[/.]/g,'-');if(!/^\d{4}-\d{1,2}-\d{1,2}$/.test(s))return '';const parts=s.split('-').map(Number);const d=parts.map((n,i)=>String(n).padStart(i?2:4,'0')).join('-');const t=new Date(d+'T00:00:00Z');return !Number.isNaN(+t)&&t.toISOString().slice(0,10)===d?d:'';}
function int(v){const s=clean(v).replace(/,/g,'');if(!/^\d+$/.test(s))return null;const n=Number(s);return Number.isSafeInteger(n)?n:null}
export async function parseWorkbook(file,XLSX){
 if(file.size>15*1024*1024)throw Error('파일 크기는 15MB 이하로 올려주세요.');
 const bytes=await file.arrayBuffer();
 const wb=XLSX.read(bytes,{type:'array',cellText:false,cellDates:true,sheetRows:15002});
 let kind='', source;
 for(const name of wb.SheetNames){
  const rows=XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,defval:'',blankrows:false});
  const head=rows[0]?.map(clean)||[];
  const listing=['경매일','회차','출품번호','차명','연식','주행거리','시작가(만원)'].every(k=>head.includes(k));
  const result=['경매일','차명','연식','주행거리(km)','내수/수출','낙찰가(만원)','선택사양'].every(k=>head.includes(k));
  if(listing||result){if(source)throw Error('지원하는 데이터 시트가 여러 개입니다. 한 시트씩 저장해 주세요.');kind=listing?'listing':'result';source={head,rows:rows.slice(1)};}
 }
 if(!source?.rows.length||source.rows.length>15000)throw Error('출품·낙찰 원본 양식인지 확인해주세요. 한 파일은 최대 15,000행입니다.');
 const occurrences=new Map(); const keys=new Set();
 const rows=await Promise.all(source.rows.map(async (cells,i)=>{
  const o=Object.fromEntries(source.head.map((key,j)=>[key,cells[j]]));
  const excelDate=v=>v instanceof Date?v.toISOString().slice(0,10):v;
  const day=date(excelDate(o['경매일'])),name=clean(o['차명']),year=int(o['연식']),km=int(o[kind==='listing'?'주행거리':'주행거리(km)']);
  const price=int(o[kind==='listing'?'시작가(만원)':'낙찰가(만원)']),channel=buyer(o[kind==='listing'?'내수/수출구분':'내수/수출']);
  if(!day||!name||year===null||km===null||price===null||(kind==='result'&&!channel))throw Error((i+2)+'행: 경매일·차명·연식·거리·가격·낙찰구분을 확인해주세요.');
  const grade=clean(o['평가등급']).toUpperCase();
  const data={name,year,km,registered:date(excelDate(o['최초등록일'])),fuel:clean(o['연료']),color:clean(o['색상']),gear:clean(o['변속기']),grade,accident:/^[A-Z]{2}$/.test(grade)?grade[0]:'',panel:/^[A-Z]{2}$/.test(grade)?grade[1]:'',channel,price};
  let key;
  if(kind==='listing'){
   data.round=clean(o['회차']);data.lot=clean(o['출품번호']);data.status=clean(o['경매진행상태']);
   if(!data.round||!data.lot)throw Error((i+2)+'행: 회차 또는 출품번호가 없습니다.');
   key=JSON.stringify([day,norm(data.round),norm(data.lot)]);
   if(keys.has(key))throw Error((i+2)+'행: 파일에 동일한 회차·출품번호가 두 번 있습니다.');keys.add(key);
  }else{
   data.options=clean(o['선택사양']);data.sunroof=/(?:선|썬)루프/.test(compact(data.options));
   data.accidentDetail=clean(o['사고상세']);data.history=clean(o['차량경력']);data.note=clean(o['비고']);
   const fingerprint=JSON.stringify([day,data]);const count=(occurrences.get(fingerprint)||0)+1;occurrences.set(fingerprint,count);key=await sha(fingerprint)+'-'+count;
  }
  return {key,day,data};
 }));
 return {kind,rows,hash:await sha(bytes),name:file.name};
}
const joinKey=r=>JSON.stringify([r.auction_day,compact(r.data.name),r.data.year,r.data.registered,r.data.km]);
const supported=r=>r.data.registered&&r.data.name;
const confirmed=r=>['반출증발급','낙찰','후상담낙찰'].includes(r.data.status);
export function reconcile(rows){
 const listing=rows.filter(r=>r.kind==='listing'),results=rows.filter(r=>r.kind==='result'),byLot=new Map(),byResult=new Map(),matched=new Map(),review=[];
 for(const [collection,index] of [[listing,byLot],[results,byResult]])for(const r of collection){const key=joinKey(r);if(!index.has(key))index.set(key,[]);index.get(key).push(r)}
 for(const r of results){
  const key=joinKey(r),l=byLot.get(key)||[];
  const reason=!supported(r)?'최초등록일 누락':!l.length?'출품 원본 또는 일치 차량 없음':l.length!==1||byResult.get(key).length!==1?'복수 후보 또는 결과 정정 확인':l[0].data.status==='낙찰취소'||l[0].data.status==='유찰'||(l[0].data.channel&&l[0].data.channel!==r.data.channel)||['fuel','color','grade','gear'].some(f=>norm(l[0].data[f])!==norm(r.data[f]))?'차량 정보 또는 결과 구분 불일치':'';
  if(reason)review.push({...r,reason});else matched.set(l[0].row_key,r);
 }
 return {listing,results,matched,review};
}
export function outcome(r,matched){return matched.get(r.row_key)?.data.channel||(confirmed(r)?r.data.channel:'')}
export function stats(lots,matched){
 const out={total:lots.length,export:0,domestic:0,unsold:0,unknown:0};
 for(const r of lots){const c=outcome(r,matched);if(c==='수출')out.export++;else if(c==='내수')out.domestic++;else if(['유찰','재출품','낙찰취소'].includes(r.data.status))out.unsold++;else out.unknown++;}
 return out;
}
export const pct=(n,d)=>d? (n/d*100).toFixed(1)+'%':'—';
export function quantile(nums,p){const a=[...nums].sort((x,y)=>x-y);if(!a.length)return null;const pos=(a.length-1)*p,i=Math.floor(pos);return a[i]+(a[Math.min(i+1,a.length-1)]-a[i])*(pos-i);}
