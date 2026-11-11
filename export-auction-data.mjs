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

// Compare matched conditions, not the average of a changing vehicle mix.
export function weeklyPriceSignals(results, calendar, channel='수출', minimum=3){
 const days=[...new Set(calendar)].sort(),groups=new Map(), counts=new Map();
 for(const row of results){const k=joinKey(row);counts.set(k,(counts.get(k)||0)+1);}
 for(const row of results){
  const d=row.data;
  if(d.channel!==channel||!Number.isFinite(d.price)||d.price<=0||!d.grade||!d.fuel||counts.get(joinKey(row))!==1)continue;
  const bucket=Math.floor(d.km/20000);
  const key=JSON.stringify([compact(d.name),d.year,d.fuel,d.gear,d.grade,bucket]);
  if(!groups.has(key))groups.set(key,{key,name:d.name,year:d.year,fuel:d.fuel,gear:d.gear,grade:d.grade,bucket,weeks:new Map()});
  const g=groups.get(key);
  if(!g.weeks.has(row.auction_day))g.weeks.set(row.auction_day,[]);
  g.weeks.get(row.auction_day).push(d.price);
 }
 const out=[];
 for(const g of groups.values()){
  const history=days.map(day=>{const values=g.weeks.get(day)||[];return {day,n:values.length,median:values.length>=minimum?quantile(values,.5):null};});
  const comparisons=history.map((now,i)=>{
   const prev=history[i-1];const gap=prev?(Date.parse(now.day)-Date.parse(prev.day))/86400000:0;
   return prev?.median!=null&&now.median!=null&&gap<=8?{change:now.median-prev.median,rate:(now.median-prev.median)/prev.median*100}:null;
  });
  const latest=history.at(-1),delta=comparisons.at(-1),prior=comparisons.at(-2);
  const repeat=history.filter(x=>x.n>0).length;
  const direction=!delta?'비교 보류':delta.rate<0&&prior?.rate<0?'2회 연속 하락':delta.rate<0?'하락':delta.rate>0?'상승':'보합';
  const candidate=channel==='수출'&&delta!=null&&prior!=null&&delta.rate>=-3&&prior.rate>=-3;
  out.push({...g,history,comparisons,latest,delta,repeat,direction,candidate});
 }
 return out.sort((a,b)=>Number(b.candidate)-Number(a.candidate)||b.repeat-a.repeat||b.latest.n-a.latest.n||a.name.localeCompare(b.name,'ko'));
}

export function trimPriceSignals(cohorts,minimum=3){
 const groups=new Map();
 for(const c of cohorts){const k=compact(c.name);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(c);}
 return [...groups.values()].flatMap(cs=>{
  const history=cs[0].history.map((week,i)=>{
   const prev=cs[0].history[i-1];
   if(!prev||(Date.parse(week.day)-Date.parse(prev.day))/86400000>8)return {day:week.day,n:0,rate:null};
   const rates=[],changes=[];
   for(const c of cs){const a=c.weeks.get(prev.day)||[],b=c.weeks.get(week.day)||[];
    if(!a.length||!b.length)continue;
    const before=quantile(a,.5),after=quantile(b,.5),weight=Math.min(a.length,b.length);
    for(let j=0;j<weight;j++){rates.push((after-before)/before*100);changes.push(after-before);}
   }
   return {day:week.day,n:rates.length,rate:rates.length>=minimum?quantile(rates,.5):null,change:rates.length>=minimum?quantile(changes,.5):null};
  });
  const latest=history.at(-1),prior=history.at(-2);
  if(latest.rate==null)return [];
  return [{name:cs[0].name,latest,prior,history,repeat:cs[0].history.filter((_,i)=>cs.some(c=>c.history[i].n)).length,
   direction:latest.rate<0&&prior?.rate<0?'2회 연속 하락':latest.rate<0?'하락':latest.rate>0?'상승':'보합',
   candidate:prior?.rate!=null&&latest.rate>=-3&&prior.rate>=-3}];
 }).sort((a,b)=>b.latest.n-a.latest.n||a.name.localeCompare(b.name,'ko'));
}

// Explicit families only: unrecognized names never become a made-up model family.
const families=[
 ['현대',['그랜드스타렉스','스타렉스','싼타페','아반떼','쏘나타','그랜저','팰리세이드','스타리아','투싼','코나','베뉴','캐스퍼','포터','아이오닉','벨로스터','엑센트','i30','i40']],
 ['기아',['쏘렌토','스포티지','카니발','셀토스','모하비','쏘울','스토닉','니로','봉고','모닝','레이','프라이드','포르테','스팅어','카렌스','카스타','K9','K8','K7','K5','K3','EV9','EV6','EV3']],
 ['제네시스',['GV80','GV70','GV60','G90','G80','G70','EQ900']],
 ['쉐보레',['트레일블레이저','트랙스','말리부','크루즈','스파크','올란도','캡티바','이쿼녹스','임팔라','타호']],
 ['르노',['QM6','QM5','QM3','SM7','SM6','SM5','SM3','XM3']],
 ['쌍용',['코란도','렉스턴','티볼리','토레스','액티언','카이런']],
 ['KG모빌리티',['코란도','렉스턴','티볼리','토레스','액티언']]
];
export function modelFamily(name){
 const text=norm(name);
 for(const [brand,models] of families){
  if(!text.startsWith(norm(brand)+' '))continue;
  const body=text.slice(brand.length+1);
  for(const model of models){
   const token=norm(model);
   if(/^[a-z0-9]+$/.test(token)?new RegExp('(^|[^a-z0-9])'+token+'(?![a-z0-9])').test(body):body.includes(token))return brand+' '+model;
  }
  return '';
 }
 return '';
}
export function focusModels(results){
 const days=[...new Set(results.map(r=>r.auction_day))].sort().slice(-4);
 const recent=results.filter(r=>days.includes(r.auction_day));
 const counts=new Map(),models=new Map();
 for(const r of recent){const k=joinKey(r);counts.set(k,(counts.get(k)||0)+1);}
 for(const r of recent){
  const name=modelFamily(r.data.name);if(!name||r.data.channel!=='수출'||counts.get(joinKey(r))!==1)continue;
  if(!models.has(name))models.set(name,[]);models.get(name).push(r);
 }
 const signals=trimPriceSignals(weeklyPriceSignals(recent,days).flatMap(c=>{
  const name=modelFamily(c.name);return name?[{...c,name}]:[];
 }),5);
 const prices=new Map(signals.map(x=>[x.name,x]));
 return {days,items:[...models].map(([name,rows])=>{
  const weekly=days.map(day=>rows.filter(r=>r.auction_day===day).length);
  const n=weekly.filter(Boolean).length, latest=weekly.at(-1), total=rows.length, trend=prices.get(name);
  const recurring=n>=3&&latest>=2&&total>=8;
  const watch=recurring&&trend&&(trend.latest.rate<=-5||trend.direction==='2회 연속 하락');
  const pockets=new Map();
  for(const r of rows){const key=JSON.stringify([r.data.year,r.data.fuel]);if(!pockets.has(key))pockets.set(key,[]);pockets.get(key).push(r);}
  const pocket=[...pockets].map(([k,v])=>({label:JSON.parse(k).filter(Boolean).join('년 · '),count:v.length,weeks:new Set(v.map(r=>r.auction_day)).size})).filter(x=>x.weeks>=2).sort((a,b)=>b.weeks-a.weeks||b.count-a.count)[0];
  return {name,weekly,n,latest,total,trend,pocket,status:watch?'watch':recurring?'focus':'hold'};
 }).sort((a,b)=>b.n-a.n||b.latest-a.latest||b.total-a.total||a.name.localeCompare(b.name,'ko'))};
}
