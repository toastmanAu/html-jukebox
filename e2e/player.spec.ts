import { expect, test } from '@playwright/test';
import * as ccc from '@ckb-ccc/core';
import { JUKEBOX_CONFIG } from '../config/jukebox';
test('verified cached HTML executes in isolation while host controls remain usable', async ({ page }) => {
  const playLoads: string[] = [];
  await page.route('**/api/plays**', async route => {
    if (route.request().method() === 'POST') { playLoads.push(route.request().postDataJSON().loadId); await route.fulfill({ json: { plays: playLoads.length } }); }
    else { const ids = new URL(route.request().url()).searchParams.getAll('id'); await route.fulfill({ json: { counts: Object.fromEntries(ids.map(id => [id, 0])) } }); }
  });
  const outbound:string[]=[]; page.on('request',r=>{if(r.url().includes('sandbox-network.invalid'))outbound.push(r.url());});
  await page.route('https://testnet.ckb.dev/**',route=>route.abort());
  await page.goto('/');
  const screenshotBytes = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90; const context = canvas.getContext('2d')!; context.fillStyle = '#315742'; context.fillRect(0, 0, 160, 90); context.fillStyle = '#e1c885'; context.fillText('SCREENSHOT', 10, 45); return Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), ch => ch.charCodeAt(0)); });
  const screenshotHash = ccc.hashCkb(screenshotBytes), screenshotId = '0x' + 'ee'.repeat(32);
  const source='<!doctype html><h1 id="ready">Waiting</h1><p id="isolation"></p><script>document.getElementById("ready").textContent="Demo script running";try{parent.parent.document.body.innerHTML="escaped"}catch(e){document.getElementById("isolation").textContent="Host access blocked"}fetch("https://sandbox-network.invalid/ping").catch(()=>{});</script>';
  const bytes=Array.from(new TextEncoder().encode(source)), hash=ccc.hashCkb(bytes), typeId='0x'+'ab'.repeat(32), manifestId='0x'+'cd'.repeat(32);
  const manifest={schema:1,revision:1,createdAt:'2026-09-11T00:00:00.000Z',collection:{id:'test',name:'Isolation fixture'},previous:null,items:[{screenshot:{ckbfs:{protocol:'20250821.4ee6689bf7ec',typeId:screenshotId,txHash:screenshotId},contentHash:screenshotHash,filename:'screenshot.png',contentType:'image/png',bytes:screenshotBytes.length,width:160,height:90},id:'sandbox-proof',title:'sandbox-proof',filename:'test.html',bytes:bytes.length,contentType:'text/html',contentHash:hash,ckbfs:{protocol:'20250821.4ee6689bf7ec',typeId},capabilities:{network:false,audio:false,fullscreen:true,pointerLock:false,geolocation:false,clipboard:false}}]};
  const manifestBytes=Array.from(new TextEncoder().encode(JSON.stringify(manifest))), manifestHash=ccc.hashCkb(manifestBytes);
  await page.evaluate(async data=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const req=indexedDB.open('ckbfs-jukebox-v1',1);req.onupgradeneeded=()=>{for(const name of ['manifests','demos','preferences','adminDrafts'])if(!req.result.objectStoreNames.contains(name))req.result.createObjectStore(name);};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});const tx=db.transaction(['manifests','demos','preferences'],'readwrite');tx.objectStore('manifests').put({bytes:new Uint8Array(data.manifestBytes),contentHash:data.manifestHash,txHash:data.manifestId},data.manifestId);tx.objectStore('demos').put({bytes:new Uint8Array(data.screenshotBytes)},'screenshot:'+data.screenshotId+':'+data.screenshotHash);tx.objectStore('demos').put({bytes:new Uint8Array(data.bytes)},data.typeId+':'+data.hash);tx.objectStore('preferences').put({pointer:{typeId:data.manifestId,contentHash:data.manifestHash},registryRevision:'1'},'active-manifest:'+data.registry);await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();},{screenshotBytes,screenshotId,screenshotHash,bytes,hash,typeId,manifestId,manifestBytes,manifestHash,registry:JUKEBOX_CONFIG.registryTypeId});
  await page.reload();
  await expect(page.locator('.screenshot-art img')).toBeVisible();
  await expect.poll(() => page.locator('.screenshot-art img').evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(160);
  await page.getByRole('button',{name:/PLAY THIS DEMO/}).click();
  const demo=page.frameLocator('iframe[title="sandbox-proof"]').frameLocator('#demo');
  await expect(demo.getByText('Demo script running')).toBeVisible();await expect(demo.getByText('Host access blocked')).toBeVisible();
  await expect.poll(() => playLoads.length).toBe(1);
  await expect(page.locator('iframe[title="sandbox-proof"]')).toHaveAttribute('sandbox','allow-scripts');expect(outbound).toEqual([]);
  await page.getByRole('button',{name:'Reload demo'}).click();await expect(page.frameLocator('iframe[title="sandbox-proof"]').frameLocator('#demo').getByText('Demo script running')).toBeVisible();
  await expect.poll(() => playLoads.length).toBe(2);
  expect(new Set(playLoads).size).toBe(2);
  await page.getByRole('button',{name:'Back to Jukebox'}).click();await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.getByLabel('Shared play count')).toHaveText('2 PLAYS');
});
