/* Versioned shell only. Auth/API responses, medical information and private photos are never cached here. */
const VERSION='chizumulu-shell-4.0.1-mobile-1';
const SHELL=['index.html','config.js','vendor/supabase.js','operations-model.js','operations.js','operations.css','membership.js','membership.css','club-workspace-model.js','club-workspace.js','club-workspace.css','administration-model.js','administration.js','administration.css','lineup-model.js','lineup.js','lineup.css','offline-model.js','offline-client.js','offline-ui.js','offline-media.js','offline-admin.js','app-update.js','mobile-workflow.js','mobile-workflow.css','offline.css','fonts/noto-kr.css','favicon.svg','manifest.webmanifest'];
self.addEventListener('install',event=>event.waitUntil(caches.open(VERSION).then(c=>c.addAll(SHELL))));
// No skipWaiting: an open form or offline queue is never interrupted by automatic reload.
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('chizumulu-shell-')&&key!==VERSION)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE_UPDATE')self.skipWaiting();});
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
 const relative=url.pathname.slice(new URL(self.registration.scope).pathname.length);
 if(!(['','index.html'].includes(relative)&&event.request.mode==='navigate')&&!SHELL.includes(relative)&&!relative.startsWith('fonts/noto-kr-'))return;
 event.respondWith((async()=>{const cache=await caches.open(VERSION),key=url.origin+url.pathname;
  if(event.request.mode==='navigate'||['localhost','127.0.0.1'].includes(url.hostname)){try{const response=await fetch(event.request,{signal:AbortSignal.timeout(4000)});if(!response.ok)throw Error('Unavailable');if(response.ok)await cache.put(key,response.clone());return response;}catch{return await cache.match(event.request.mode==='navigate'?'index.html':key);}}
  const old=await cache.match(key);if(old)return old;const response=await fetch(event.request);if(response.ok){await cache.put(key,response.clone());if(relative.startsWith('fonts/')){const entries=(await cache.keys()).filter(r=>new URL(r.url).pathname.endsWith('.woff2'));for(const r of entries.slice(0,Math.max(0,entries.length-40)))await cache.delete(r);}}return response;
 })());});
