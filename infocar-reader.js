(function(){
'use strict';
window.openInfocarScreenshot=function(src,title){
 if(typeof src!=='string'||!src)return;
 const dialog=document.createElement('dialog');dialog.className='infocar-reader';dialog.setAttribute('aria-label',title);
 const header=document.createElement('header'),label=document.createElement('strong'),tools=document.createElement('div');
 const scroll=document.createElement('div');scroll.className='infocar-scroll';
 const img=document.createElement('img');img.alt=title;img.referrerPolicy='no-referrer';img.src=src;scroll.append(img);
 label.textContent=title;
 const button=(text,action)=>{const b=document.createElement('button');b.type='button';b.className='infocar-link';b.textContent=text;b.onclick=action;return b;};
 const zoom=button('확대',()=>{const on=scroll.classList.toggle('zoom');zoom.textContent=on?'너비 맞춤':'확대';zoom.setAttribute('aria-pressed',String(on));});
 zoom.setAttribute('aria-pressed','false');
 tools.append(zoom,button('닫기',()=>dialog.close()));header.append(label,tools);dialog.append(header,scroll);document.body.append(dialog);
 dialog.addEventListener('close',()=>{img.removeAttribute('src');dialog.remove();},{once:true});
 dialog.showModal();
};
})();
