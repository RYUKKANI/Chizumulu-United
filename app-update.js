/* A waiting worker is activated only by the user, after pending entries/forms are dealt with. */
if('serviceWorker' in navigator){let requested=false;
 navigator.serviceWorker.addEventListener('controllerchange',()=>{if(requested)location.reload();});
 async function offerUpdate(){const registration=await navigator.serviceWorker.getRegistration();if(!registration?.waiting||document.querySelector('#apply-app-update'))return;
  const button=document.createElement('button');button.id='apply-app-update';button.className='btn';button.textContent=typeof lang!=='undefined'&&lang==='en'?'Apply app update':'새 버전 적용';button.style.cssText='position:fixed;bottom:18px;right:18px;z-index:110';
  button.addEventListener('click',()=>{const counts=typeof syncCounts==='function'?syncCounts():{pending:0,conflicts:0,review:0};if(window.clubLineupDirty?.()||counts.pending||counts.conflicts||counts.review||typeof cloud!=='undefined'&&cloud.draft||document.querySelector('#dialog[open]')){offlineToast('미전송·충돌 기록과 입력 중인 화면을 먼저 정리해 주세요.',true);return;}requested=true;registration.waiting.postMessage({type:'ACTIVATE_UPDATE'});});document.body.append(button);
 }
 navigator.serviceWorker.ready.then(reg=>{offerUpdate();reg.addEventListener('updatefound',()=>{reg.installing?.addEventListener('statechange',offerUpdate);});}).catch(()=>{});
}
