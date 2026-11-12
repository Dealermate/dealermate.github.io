(function(){
'use strict';
const key='__infocar_diag',$=id=>document.getElementById(id),box=$('infocarAttachments'),input=$('infocarFiles'),status=$('infocarStatus'),launch=$('infocarOpen');
if(!box||!input||!status||!launch)return;
const context=()=>JSON.stringify([document.body.dataset.infocarKind==='broker'?brokerStorage.getItem('activeInspectionRecordId'):localStorage.getItem('activeInspectionRecordId'),$('carNumber')?.value.trim()||'',(typeof currentCloudUser!=='undefined'&&currentCloudUser?.id)||'']);
function button(label,callback){const b=document.createElement('button');b.type='button';b.className='infocar-link';b.textContent=label;b.onclick=callback;return b;}
function view(photo,i){const url=photo.dataUrl||photo.url;if(url)window.openInfocarScreenshot(url,'인포카 상세진단 '+i);else status.textContent='사진 주소를 불러오지 못했어요. 검차를 다시 열어주세요.';}
window.renderInfocarAttachments=function(){
 box.replaceChildren();
 const list=currentInspectionPhotos.map((photo,index)=>({photo,index})).filter(x=>x.photo.partKey===key);
 if(!list.length){const text=document.createElement('p');text.className='infocar-intro';text.textContent='첨부한 결과 사진이 없어요.';box.append(text);}
 list.forEach(({photo,index},i)=>{
  const item=document.createElement('div');item.append(button('결과 '+(i+1)+' 보기',()=>view(photo,i+1)),button('삭제',()=>{const at=currentInspectionPhotos.indexOf(photo);if(at>=0)removeInspectionPhoto(at);}));box.append(item);
 });
};
launch.onclick=()=>{
 if(typeof window.AndroidExternal?.openInfocar==='function'){window.AndroidExternal.openInfocar();return;}
 status.textContent='앱에서 바로 열려면 딜러메이트 1.1.8 이상으로 업데이트해주세요. 인포카를 직접 열어 진단한 뒤 사진을 첨부할 수도 있어요.';
};
const read=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('이미지를 읽을 수 없습니다.'));reader.readAsDataURL(file);});
input.onchange=async()=>{
 const files=[...input.files];input.value='';if(!files.length||window.infocarPhotoBusy)return;
 if(files.reduce((sum,file)=>sum+file.size,0)>24*1024*1024){status.textContent='한 번에 최대 24MB까지 첨부할 수 있어요. 나눠서 선택해주세요.';return;}
 const ref=currentInspectionPhotos,identity=context();
 if(files.length+ref.length>60){status.textContent='검차 사진은 모두 합쳐 최대 60장까지 저장할 수 있어요.';return;}
 window.infocarPhotoBusy=true;input.disabled=true;status.textContent='스크린샷을 읽고 있어요…';
 try{
  const photos=[];
  for(const file of files){
   if(!file.size||file.size>8*1024*1024)throw Error('스크린샷은 한 장당 8MB 이하로 선택해주세요.');
   const bytes=new Uint8Array(await file.slice(0,8).arrayBuffer());
   const png=bytes.length===8&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);
   const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
   if(!png&&!jpeg)throw Error('PNG 또는 JPG 스크린샷을 선택해주세요.');
   const type=png?'image/png':'image/jpeg',dataUrl=await read(new Blob([file],{type}));
   photos.push({partKey:key,name:'인포카 상세진단.'+(png?'png':'jpg'),type,dataUrl});
  }
  if(currentInspectionPhotos!==ref||context()!==identity)throw Error('검차가 바뀌었어요. 현재 차량에서 다시 첨부해주세요.');
  if(ref.length+photos.length>60)throw Error('검차 사진은 최대 60장까지 저장할 수 있어요.');
  ref.push(...photos);renderInspectionPhotos();
  status.textContent=photos.length+'장 첨부했어요. 검차 저장을 눌러 기록에 남겨주세요.';
 }catch(e){status.textContent=e.message||'사진을 읽지 못했어요.';}
 finally{window.infocarPhotoBusy=false;input.disabled=false;}
};
document.addEventListener('click',event=>{
 const b=event.target.closest?.('[data-infocar-index]');if(!b)return;
 const list=currentInspectionPhotos.filter(p=>p.partKey===key),i=Number(b.dataset.infocarIndex);
 if(list[i])view(list[i],i+1);
});
window.renderInfocarAttachments();
})();
