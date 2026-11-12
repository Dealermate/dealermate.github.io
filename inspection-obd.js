(function(){
'use strict';
const $=id=>document.getElementById(id),field=$('inspectionObd');
if(!field)return;
let pending=null;
const context=()=>JSON.stringify([document.body.dataset.obdKind,(typeof currentCloudUser!=='undefined'&&currentCloudUser?.id)||'',document.body.dataset.obdKind==='broker'?brokerStorage.getItem('activeInspectionRecordId'):localStorage.getItem('activeInspectionRecordId'),$('carNumber')?.value.trim()||'']);
function refresh(){
 const rows=inspectionObdRows();
 $('obdResult').textContent=rows[0]||'아직 조회한 기록이 없어요';
 $('obdTime').textContent=rows[1]||'기기를 연결하고 저장 고장코드를 조회해주세요.';
 $('obdState').dataset.hasResult=String(!!rows.length);
 $('obdRemove').hidden=!rows.length;
}
function setStatus(s){$('obdStatus').textContent=s;}
function stop(){if(pending){clearInterval(pending.timer);pending=null;} $('obdStart').disabled=false;}
window.invalidateInspectionObd=function(){stop();setStatus('');};
window.refreshInspectionObd=refresh;
$('obdStart').onclick=()=>{
 const bridge=window.AndroidObd;
 if(typeof bridge?.openInspection!=='function'||typeof bridge.takeInspection!=='function'){setStatus('딜러메이트 안드로이드 앱을 1.1-obd5 이상으로 업데이트한 뒤 실행해주세요.');return;}
 if(pending)return;
 const token=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
 const request={token,context:context(),until:Date.now()+590000};
 pending=request;$('obdStart').disabled=true;setStatus('OBD 화면에서 조회 후 ‘검차에 결과 적용’을 눌러주세요.');
 const poll=()=>{
  if(pending!==request)return;
  if(context()!==request.context||Date.now()>request.until){stop();setStatus('검차가 바뀌었거나 시간이 지나 결과를 적용하지 않았어요. 다시 조회해주세요.');return;}
  let raw;
  try{raw=bridge.takeInspection(token);}catch(e){stop();setStatus('앱 연결을 확인하고 다시 시도해주세요.');return;}
  if(!raw)return;
  stop();
  if(raw==='cancelled'){setStatus('진단을 취소했어요.');return;}
  if(!inspectionObdRows(raw).length){setStatus('진단 결과를 읽을 수 없어요. 다시 조회해주세요.');return;}
  field.value=raw;saveInput('inspectionObd');refresh();updateAll();
  setStatus('현재 검차에 적용했어요. 상단의 검차 저장을 눌러 기록에 남겨주세요.');
 };
 request.timer=setInterval(poll,800);
 try{bridge.openInspection(token);}catch(e){stop();setStatus('진단 화면을 열 수 없어요. 앱을 다시 실행해주세요.');}
};
$('obdRemove').onclick=()=>{
 if(!confirm('이 검차에서 OBD 조회 기록을 지울까요?'))return;
 window.invalidateInspectionObd();field.value='';saveInput('inspectionObd');refresh();updateAll();setStatus('기록을 지웠어요. 변경사항을 저장해주세요.');
};
refresh();
})();
