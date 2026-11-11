import {parseWorkbook,reconcile,stats,pct,quantile,norm} from './export-auction-data.mjs';
const el=id=>document.getElementById(id), make=(tag,value)=>{const e=document.createElement(tag);if(value!=null)e.textContent=value;return e;};
const number=n=>n==null?'—':Number(n).toLocaleString('ko-KR',{maximumFractionDigits:1});
const filters=['name','day','year','km','fuel','accident','panel','color'];
let client,user,parsed,busy=false,state=reconcile([]),selection=0,loadId=0;
function table(id,head,rows,size=12){
 const host=el(id);host.replaceChildren();
 if(!rows.length){host.append(make('p','표시할 데이터가 없습니다.'));return;}
 const wrap=make('div');wrap.className='scroll';const t=make('table'),thead=make('thead'),h=make('tr'),b=make('tbody');thead.append(h);t.append(thead,b);
 head.forEach(x=>h.append(make('th',x)));wrap.append(t);host.append(wrap);
 let page=0;const total=Math.ceil(rows.length/size),nav=make('div');nav.className='pager';
 const prev=make('button','이전'),next=make('button','다음'),label=make('span');
 function draw(){b.replaceChildren();for(const values of rows.slice(page*size,(page+1)*size)){const tr=make('tr');b.append(tr);for(const value of values)tr.append(make('td',value));}prev.disabled=page===0;next.disabled=page===total-1;label.textContent=(page+1)+' / '+total+' · '+number(rows.length)+'건';}
 prev.onclick=()=>{page--;draw()};next.onclick=()=>{page++;draw()};nav.append(prev,label,next);if(total>1)host.append(nav);draw();
}
function options(id,values,empty='전체'){const s=el(id),prior=s.value;s.replaceChildren(new Option(empty,''),...values.map(v=>new Option(v,v)));if(values.includes(prior))s.value=prior;}
function matches(row){const d=row.data;return norm(el('name').value).split(' ').every(k=>norm(d.name).includes(k))&&(!el('day').value||row.auction_day===el('day').value)&&['year','fuel','accident','panel','color'].every(k=>!el(k).value||String(d[k])===el(k).value)&&(!el('km').value||Math.min(4,Math.floor(d.km/50000))===Number(el('km').value));}
function group(rows,key){const m=new Map();for(const r of rows){const k=key(r);if(!m.has(k))m.set(k,[]);m.get(k).push(r);}return m;}
function roundCells(s){return [s.total,s.export,s.domestic,s.unsold,s.unknown,pct(s.export,s.total),pct(s.export,s.export+s.domestic)];}
function render(){
 const {matched}=state,lots=state.listing.filter(matches),s=stats(lots,matched),rounds=group(lots,r=>JSON.stringify([r.auction_day,r.data.round]));
 el('metrics').replaceChildren(...[['출품',number(s.total)+'건'],['수출 낙찰',number(s.export)+'건'],['출품 대비 수출',pct(s.export,s.total)],['낙찰 중 수출',pct(s.export,s.export+s.domestic)]].map(([k,v])=>{const d=make('div');d.append(make('small',k),make('strong',v));return d;}));
 table('trend',['경매일 · 회차','출품','수출','내수','유찰·재출품 등','미확정','출품 대비 수출','낙찰 중 수출','연결 수출 중앙가(만원)'],[...rounds.values()].sort((a,b)=>b[0].auction_day.localeCompare(a[0].auction_day)).map(r=>[r[0].data.round,...roundCells(stats(r,matched)),number(quantile(r.map(x=>matched.get(x.row_key)?.data).filter(x=>x?.channel==='수출').map(x=>x.price),.5))]));
 const models=[...group(lots,r=>norm(r.data.name)).values()].map(rs=>{const sub=[...group(rs,r=>JSON.stringify([r.auction_day,r.data.round])).values()].map(x=>stats(x,matched));const total=stats(rs,matched),repeat=sub.filter(x=>x.export).length,low=Math.min(...sub.map(x=>x.export/x.total));return {label:rs[0].data.name,total,repeat,rounds:sub.length,low};});
 models.sort((a,b)=>b.repeat-a.repeat||b.total.export-a.total.export||b.low-a.low);
 table('stability',['차명·트림','수출 발생 / 출품 회차','수출 / 출품','출품 대비 수출','최저 회차 낙찰률','낙찰 중 수출'],models.map(x=>[x.label,x.repeat+' / '+x.rounds,x.total.export+' / '+x.total.total,pct(x.total.export,x.total.total),pct(x.low,1),pct(x.total.export,x.total.export+x.total.domestic)]));
 const peers=lots.flatMap(r=>{const v=matched.get(r.row_key);return v?.data.channel==='수출'?[v]:[];});
 options('comparable',[...new Set(peers.map(r=>r.data.name))].sort(),'차명 선택');
 renderPrices();
 const review=state.review.filter(matches);el('review-count').textContent=number(review.length)+'건';table('review',['경매일','차명','연식','주행거리','구분','낙찰가(만원)','검토 사유'],review.map(r=>[r.auction_day,r.data.name,r.data.year,number(r.data.km),r.data.channel,number(r.data.price),r.reason]));
}
function renderPrices(){
 const name=el('comparable').value,host=el('prices');host.replaceChildren();if(!name){host.append(make('p','차명을 선택해 주세요.'));return;}
 const opt=norm(el('option').value),rs=state.listing.filter(matches).map(r=>state.matched.get(r.row_key)).filter(r=>r?.data.channel==='수출'&&norm(r.data.name)===norm(name)&&norm(r.data.options).includes(opt)).sort((a,b)=>b.auction_day.localeCompare(a.auction_day));
 const ps=rs.map(r=>r.data.price);
 host.append(make('p',ps.length>=5?'표본 '+number(ps.length)+'건 · 중앙값 '+number(quantile(ps,.5))+'만원 · 중간 50% '+number(quantile(ps,.25))+'~'+number(quantile(ps,.75))+'만원':'표본 '+number(ps.length)+'건 · 5건 미만은 개별 사례만 표시합니다.'));
 const cohort=new Set(rs.map(r=>JSON.stringify([r.data.year,Math.floor(r.data.km/50000),r.data.fuel,r.data.grade,r.data.color])));
 if(cohort.size===1){const g=rs.filter(r=>r.data.sunroof),n=rs.filter(r=>!r.data.sunroof);host.append(make('p','선루프: 장착 '+g.length+'건 / 미장착 '+n.length+'건'+(g.length>=5&&n.length>=5?' · 장착 − 미장착 중앙가 차이 '+number(quantile(g.map(r=>r.data.price),.5)-quantile(n.map(r=>r.data.price),.5))+'만원':'')));}
 else host.append(make('small','선루프 가격 차이는 연식·주행거리 구간·연료·등급·색상이 같은 표본에서만 표시합니다.'));
 const d=make('div');d.id='price-table';host.append(d);table(d.id,['경매일','연식','주행거리','평가등급','색상','선루프','낙찰가(만원)','선택사양'],rs.map(r=>[r.auction_day,r.data.year,number(r.data.km),r.data.grade,r.data.color,r.data.sunroof?'있음':'없음',number(r.data.price),r.data.options||'—']));
}
async function load(){
 const seq=++loadId,owner=user.id;let rows=[];
 for(let offset=0;;offset+=500){
  const {data,error}=await client.from('export_auction_rows').select('kind,row_key,auction_day,data').eq('owner_id',owner).order('auction_day').order('kind').order('row_key').range(offset,offset+499);
  if(seq!==loadId)return;if(error)throw error;rows.push(...data);if(data.length<500)break;
 }
 state=reconcile(rows);
 options('day',[...new Set(rows.map(r=>r.auction_day))].sort().reverse());
 for(const k of ['year','fuel','accident','panel','color'])options(k,[...new Set(rows.map(r=>String(r.data[k]??'')).filter(Boolean))].sort());
 render();el('status').textContent=rows.length?'':'아직 등록한 원본이 없습니다. 파일을 선택해 주세요.';
}
el('file').onchange=async()=>{
 const id=++selection;parsed=null;el('import').disabled=true;
 const f=el('file').files[0];if(!f){el('preview').textContent='';return;}
 el('preview').textContent='엑셀 확인 중…';
 try{const p=await parseWorkbook(f,window.XLSX);if(id!==selection)return;parsed=p;const days=[...new Set(p.rows.map(x=>x.day))].sort();el('preview').textContent=(p.kind==='listing'?'출품':'낙찰')+' '+number(p.rows.length)+'건 · '+days.join(', ');el('import').disabled=busy;}
 catch(e){if(id===selection)el('preview').textContent='파일을 읽지 못했습니다. '+e.message;}
};
el('import').onclick=async()=>{
 if(!parsed||busy||!user)return;
 const p=parsed;busy=true;el('import').disabled=true;el('file').disabled=true;el('preview').textContent='등록 중…';
 try{const {data,error}=await client.rpc('export_auction_import',{p_hash:p.hash,p_name:p.name.slice(0,240),p_kind:p.kind,p_rows:p.rows});if(error)throw error;
 el('preview').textContent=data.duplicate?'이미 등록한 파일입니다.':'신규 '+number(data.inserted)+'건 · 동일 '+number(data.unchanged)+'건 · 기존값과 충돌 '+number(data.conflicts)+'건(기존 기록 유지)';
 parsed=null;el('file').value='';
 try{await load();}catch(e){el('status').textContent='등록은 완료됐지만 새로 조회하지 못했어요. 페이지를 새로고침해주세요.';}
 }catch(e){el('preview').textContent='등록하지 못했습니다. '+e.message;}finally{busy=false;el('file').disabled=false;el('import').disabled=!parsed;}
};
filters.forEach(id=>el(id).addEventListener('input',render));['comparable','option'].forEach(id=>el(id).addEventListener('input',renderPrices));
async function start(){
 client=window.supabase.createClient('https://crmeeegayzezeqhgkagx.supabase.co','sb_publishable_6wpAz2ELkD2Eh2ircwzVGw_78QKns9C');
 client.auth.onAuthStateChange((_,session)=>{if(!session&&user){user=null;parsed=null;loadId++;selection++;el('workspace').hidden=true;el('login').hidden=false;el('status').textContent='다시 로그인해 주세요.';}});
 const {data,error}=await client.auth.getSession();if(error)throw error;user=data.session?.user;
 el('status').textContent='';el('login').hidden=!!user;el('workspace').hidden=!user;if(user)await load();
}
window.addEventListener('DOMContentLoaded',()=>start().catch(e=>{el('status').textContent='경매 분석을 불러오지 못했습니다. '+e.message;}));
