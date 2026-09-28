import {_electron} from 'playwright';
import {writeFileSync,appendFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=process.cwd(),output=resolve('.codex-artifacts/library-lag-20260928');
const results={checks:[],errors:[],logs:[],exit:null};
const app=await _electron.launch({args:['.'],cwd:root,env:{...process.env,ELECTRON_RENDERER_URL:'http://127.0.0.1:5194',ECHO_ALLOW_PARALLEL_INSTANCE:'1',ECHO_USER_DATA_PATH_OVERRIDE:resolve(output,'user-data')},timeout:30000});
const child=app.process();child.on('exit',(code,signal)=>{results.exit={code,signal};console.log('EXIT',code,signal);});child.stderr.on('data',b=>{const text=b.toString();appendFileSync(resolve(output,'stderr-full.log'),text);if(/error|SLOW|failed|unresponsive/i.test(text))results.logs.push(text.slice(0,2500));});
let page;
try{
 for(let i=0;i<80&&!page;i++){page=app.windows().find(p=>p.url().startsWith('http://127.0.0.1:5194'));if(!page)await new Promise(r=>setTimeout(r,100));}
 if(!page)throw new Error('main window did not appear');
 page.setDefaultTimeout(8000);page.on('pageerror',e=>results.errors.push(e.message));
 await app.evaluate(({app,BrowserWindow})=>{app.on('before-quit',()=>console.error('QA before-quit',new Error().stack));for(const win of BrowserWindow.getAllWindows()){win.on('close',()=>console.error('QA window-close',win.id,new Error().stack));win.webContents.on('render-process-gone',(_e,d)=>console.error('QA render-process-gone',JSON.stringify(d)));}});await page.bringToFront();await page.locator('.nav-item[aria-label="歌曲"]').waitFor();
 await page.locator('.echo-startup-scene').waitFor({state:'hidden',timeout:12000}).catch(()=>{});await page.getByRole('button',{name:'关闭 Steam 版介绍'}).click({timeout:2500}).catch(()=>{});
 await app.evaluate(()=>{globalThis.__qa={gaps:[],last:performance.now()};globalThis.__qa.timer=setInterval(()=>{const now=performance.now();globalThis.__qa.gaps.push(now-globalThis.__qa.last);globalThis.__qa.last=now;},50);});
 await page.evaluate(()=>{window.__qa={gaps:[],longTasks:[],last:performance.now()};window.__qa.timer=setInterval(()=>{const now=performance.now();window.__qa.gaps.push(now-window.__qa.last);window.__qa.last=now;},50);new PerformanceObserver(l=>window.__qa.longTasks.push(...l.getEntries().map(e=>e.duration))).observe({type:'longtask',buffered:false});});
 async function check(name,run){await app.evaluate(()=>{globalThis.__qa.gaps=[];globalThis.__qa.last=performance.now();});await page.evaluate(()=>{window.__qa.gaps=[];window.__qa.longTasks=[];window.__qa.last=performance.now();});const start=performance.now();await run();const main=await app.evaluate(()=>({maxGapMs:Math.round(Math.max(0,...globalThis.__qa.gaps)),ticks:globalThis.__qa.gaps.length}));const renderer=await page.evaluate(()=>({maxGapMs:Math.round(Math.max(0,...window.__qa.gaps)),longTasks:window.__qa.longTasks}));const r={name,elapsedMs:Math.round(performance.now()-start),main,renderer,preview:(await page.locator('main.page-surface:not([hidden])').innerText()).slice(0,200)};results.checks.push(r);console.log(JSON.stringify(r));}
 const mainHas=async text=>page.waitForFunction(t=>document.querySelector('main.page-surface:not([hidden])')?.innerText.includes(t),text);
 await check('songs initial',async()=>{await page.locator('.nav-item[aria-label="歌曲"]').click();await mainHas('18709 首');});
 await check('english search',async()=>{await page.locator('main.page-surface:not([hidden]) input[type=search]').fill('Roselia');await mainHas('Roselia');await page.waitForFunction(()=>!document.querySelector('main.page-surface:not([hidden])')?.innerText.includes('18709 首'));});
 await check('Chinese search',async()=>{await page.locator('main.page-surface:not([hidden]) input[type=search]').fill('周杰伦');await mainHas('周杰伦');});
 await check('no results',async()=>{await page.locator('main.page-surface:not([hidden]) input[type=search]').fill('echo_qatest_no_match_0928');await mainHas('0 首');});
 await check('rapid query changes',async()=>{for(const text of ['Ro','Rose','Roselia']){await page.locator('main.page-surface:not([hidden]) input[type=search]').fill(text);await new Promise(r=>setTimeout(r,280));}await mainHas('Roselia');});
 await page.screenshot({path:resolve(output,'02-search.png')});
 await check('clear and scroll',async()=>{await page.locator('main.page-surface:not([hidden]) input[type=search]').fill('');await mainHas('18709 首');await page.locator('main.page-surface:not([hidden])').hover();for(let i=0;i<8;i++){await page.mouse.wheel(0,700);await new Promise(r=>setTimeout(r,80));}});
 await check('switch page with search pending',async()=>{await page.locator('main.page-surface:not([hidden]) input[type=search]').fill('Roselia');await page.locator('.nav-item[aria-label="专辑"]').click();await page.locator('main.page-surface:not([hidden]) input[type=search]').waitFor();await page.waitForFunction(()=>document.querySelectorAll('.album-card').length>0);});
 await page.screenshot({path:resolve(output,'03-albums.png')});
 const cdp=await page.context().newCDPSession(page);await cdp.send('Profiler.enable');await cdp.send('Profiler.start');await check('artists',async()=>{await page.locator('.nav-item[aria-label="艺术家"]').click();await page.locator('main.page-surface:not([hidden]) input[type=search]').waitFor();await new Promise(r=>setTimeout(r,1500));});
 await page.screenshot({path:resolve(output,'04-artists.png')});
 await check('return to songs',async()=>{await page.locator('.nav-item[aria-label="歌曲"]').click();await page.locator('main.page-surface:not([hidden]) input[type=search]').fill('Roselia');await mainHas('Roselia');});
 const {profile}=await cdp.send('Profiler.stop');writeFileSync(resolve(output,'renderer-artist-return.cpuprofile'),JSON.stringify(profile));results.domCount=await page.locator('*').count();results.finalButtons=await page.locator('main [role="listitem"]').evaluateAll(es=>es.slice(0,3).map(e=>({text:e.textContent?.slice(0,120),label:e.getAttribute('aria-label')})));


 const waitPlayback=async predicate=>{const deadline=Date.now()+10000;let status;while(Date.now()<deadline){status=await page.evaluate(()=>window.echo.playback.getStatus());if(predicate(status))return status;if(status.state==='error')throw new Error('Playback entered error: '+JSON.stringify(status));await new Promise(r=>setTimeout(r,60));}throw new Error('Playback state timeout: '+JSON.stringify(status));};
 const expectedTracks=await page.evaluate(()=>window.echo.library.getTracks({search:'Roselia',pageSize:100}));const firstId=expectedTracks.items.find(t=>t.title==='Ringing Bloom').id;const secondId=expectedTracks.items.find(t=>t.title==='VIOLET LINE').id;
 await check('play local track',async()=>{await page.locator('main.page-surface:not([hidden]) [role="listitem"][aria-label="Ringing Bloom - Roselia"]').dblclick();await waitPlayback(s=>s.state==='playing'&&s.currentTrackId===firstId&&s.positionMs>250);});
 const firstStatus=await page.evaluate(()=>window.echo.playback.getStatus());results.firstPlayback={state:firstStatus.state,trackId:firstStatus.currentTrackId,positionMs:firstStatus.positionMs};
 await check('browse while playing',async()=>{await page.locator('main.page-surface:not([hidden]) input[type=search]').fill('周杰伦');await mainHas('9 首');await page.locator('.nav-item[aria-label="专辑"]').click();await page.waitForFunction(()=>document.querySelector('main.page-surface:not([hidden])')?.getAttribute('data-route-id')==='albums');await page.locator('.nav-item[aria-label="歌曲"]').click();await page.locator('main.page-surface:not([hidden]) input[type=search]').fill('Roselia');await mainHas('59 首');});
 await check('switch local track',async()=>{await page.locator('main.page-surface:not([hidden]) [role="listitem"][aria-label="VIOLET LINE - Roselia"]').dblclick();await waitPlayback(s=>s.state==='playing'&&s.currentTrackId===secondId&&s.positionMs>250);});

 await check('rapid track changes',async()=>{await page.locator('main.page-surface:not([hidden]) [role="listitem"][aria-label="Ringing Bloom - Roselia"]').dblclick();await page.locator('main.page-surface:not([hidden]) [role="listitem"][aria-label="VIOLET LINE - Roselia"]').dblclick();await waitPlayback(s=>s.state==='playing'&&s.currentTrackId===secondId&&s.positionMs>350);});
 const finalStatus=await page.evaluate(()=>window.echo.playback.getStatus());results.finalPlayback={state:finalStatus.state,trackId:finalStatus.currentTrackId,positionMs:finalStatus.positionMs};
 await page.screenshot({path:resolve(output,'05-playback.png')});
}catch(error){results.failure=String(error);console.error('QA FAILURE',results.failure);if(page&&!page.isClosed())await page.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});}
finally{await app.close().catch(()=>{});writeFileSync(resolve(output,'qa-results.json'),JSON.stringify(results,null,2));}
