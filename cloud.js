/* Wifey & Hubby cloud connection and device Web Push subscriptions.
   The existing visual app and local-first saving remain unchanged.
   This module stays dormant until the public config values are supplied. */

import './sounds.js';
import './timezones.js';

const cfg = window.WH_CLOUD || {};
const validConfig = /^https:\/\/[^/]+\.supabase\.co\/?$/.test(cfg.url || '') && !!cfg.publishableKey;
const $ = id => document.getElementById(id);
const prefKey = 'wifey-hubby-app-settings-v1';
const managed = k => /^wifey-hubby-[a-z\d-]{1,100}$/.test(k);
const notify = $('set-notifs');
const status = $('set-cloud-status');
const sign = $('set-signin');
let client, currentUser, syncInProgress = false, syncPaused = false;
let deviceReady = false, syncTimer = null, lastPull = 0;
const pending = new Map();
const remoteBaseline = new Map();
const journalKey = 'daily-sweets-unsent-v1';
const blockedSync = new Set();
const originalSet = Storage.prototype.setItem;
const originalRemove = Storage.prototype.removeItem;
const originalClear = Storage.prototype.clear;
function saveJournal(){
  if(!currentUser)return;
  try {
    if(pending.size)originalSet.call(localStorage,journalKey,JSON.stringify({owner:currentUser.id,items:[...pending]}));
    else originalRemove.call(localStorage,journalKey);
  }catch(e){console.warn('Offline changes cannot be journaled',e)}
}
function restoreJournal(){
  try{
    const saved=JSON.parse(localStorage.getItem(journalKey)||'null');
    if(saved?.owner!==currentUser?.id||!Array.isArray(saved.items))return;
    for(const item of saved.items)if(Array.isArray(item)&&managed(item[0])&&
      localStorage.getItem(item[0])===item[1])pending.set(item[0],item[1]);
  }catch(e){console.warn('Failed to restore unsent edits',e)}
}

// Email confirmation must return to this app, not Supabase's localhost default.
const authRedirectUrl = () => new URL('./index.html', window.location.href).href;

function dialog(title, message) {
  $('settings-popup-heading').textContent = title;
  $('settings-popup-message').textContent = message;
  $('settings-popup').hidden = false;
}
function updateSignInButton() {
  if (!sign) return;
  const label=sign.querySelector('.settings-signin');
  if (!label) return;
  const text=currentUser ? 'Connected' : 'Sign In';
  const textNode=[...label.childNodes].find(n=>n.nodeType===Node.TEXT_NODE);
  if (textNode) textNode.textContent=text+' ';
  else label.prepend(document.createTextNode(text+' '));
  sign.setAttribute('aria-label',currentUser?'Cloud account connected. Manage account.':'Sign in to cloud account');
}
function setStatus(value) {
  if (status) status.textContent = value;
  updateSignInButton();
}
function prefs() { try { return JSON.parse(localStorage.getItem(prefKey) || '{}') || {}; } catch { return {}; } }
function savePrefs(p) { originalSet.call(localStorage, prefKey, JSON.stringify(p)); }
function publicError(e) { return e && e.message ? e.message : 'Please check your network connection and try again.'; }
function localDocs() {
  const out = [];
  for (let i=0; i<localStorage.length; i++) {
    const k = localStorage.key(i);
    if (managed(k)) out.push({ document_key:k, value:localStorage.getItem(k) });
  }
  return out;
}
function scheduleSync() {
  if (syncPaused || !currentUser) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void flushPending(), 1300);
}
// Preserve every existing localStorage write. Only queue the app's own keys for cloud sync.
Storage.prototype.setItem = function(key, value) {
  originalSet.call(this, key, value);
  if (this === localStorage && managed(String(key)) && currentUser && !syncPaused) {
    pending.set(String(key), String(value)); saveJournal(); scheduleSync();
  }
};
Storage.prototype.removeItem = function(key) {
  originalRemove.call(this, key);
  if (this === localStorage && managed(String(key)) && currentUser && !syncPaused) {
    // Deletes are distinct from an empty stored value.
    pending.set(String(key), null); saveJournal(); scheduleSync();
  }
};
Storage.prototype.clear = function() {
  const keys = this === localStorage ? localDocs().map(x => x.document_key) : [];
  originalClear.call(this);
  if (currentUser && !syncPaused) { keys.forEach(k => pending.set(k, null)); saveJournal(); scheduleSync(); }
};
async function flushPending() {
  if(!currentUser||!client||syncInProgress||syncPaused||!navigator.onLine||!pending.size)return;
  syncInProgress=true;let conflicted=false,failed=false;
  const owner=currentUser.id;
  try{
    for(const [key,value] of [...pending.entries()]){
      if(currentUser?.id!==owner)break;
      if(blockedSync.has(key)){conflicted=true;continue}
      try{
        const {data:remote,error:readError}=await client.from('wh_documents')
          .select('value,updated_at').eq('user_id',owner).eq('document_key',key).maybeSingle();
        if(readError)throw readError;
        const base=remoteBaseline.get(key);
        if(remote?.value===value){
          remoteBaseline.set(key,remote);
          if(pending.get(key)===value)pending.delete(key);
          saveJournal();continue;
        }
        if((remote&&(!base||remote.value!==base.value||remote.updated_at!==base.updated_at))||(!remote&&base)){
          conflicted=true;blockedSync.add(key);continue;
        }
        let q;
        if(value===null&&!remote){
          if(pending.get(key)===value)pending.delete(key);
          saveJournal();continue;
        }
        if(value===null)q=client.from('wh_documents').delete().eq('user_id',owner).eq('document_key',key).eq('updated_at',remote.updated_at).select('document_key');
        else if(remote)q=client.from('wh_documents').update({value}).eq('user_id',owner).eq('document_key',key).eq('updated_at',remote.updated_at).select('value,updated_at');
        else q=client.from('wh_documents').insert({user_id:owner,document_key:key,value}).select('value,updated_at');
        const {data,error}=await q;
        if(error&&error.code!=='23505')throw error;
        if(error||!data?.length){conflicted=true;blockedSync.add(key);continue}
        if(value===null)remoteBaseline.delete(key);
        else remoteBaseline.set(key,{value,updated_at:data[0].updated_at});
        if(pending.get(key)===value)pending.delete(key);
        saveJournal();
      }catch(e){failed=true;console.warn('Sync retry required:',e)}
    }
    if(conflicted){
      setStatus('Sync Conflict — Review Needed');
      if($('settings-popup')?.hidden)dialog('Sync Conflict','Both phones changed the same section. The changes on this phone and in cloud are preserved. Export a backup from Settings before resolving; nothing is overwritten automatically.');
    }else setStatus(failed||pending.size?'Sync Pending':'Cloud Connected');
  }finally{syncInProgress=false}
}
function createAuthDialog() {
  const overlay=document.createElement('div');overlay.id='wh-auth-overlay';overlay.hidden=true;
  overlay.innerHTML=`<div class="wh-auth-panel" role="dialog" aria-modal="true" aria-labelledby="wh-auth-title">
    <h2 id="wh-auth-title">Cloud Account</h2>
    <p class="wh-auth-caption">Use the same account on both phones to share your progress.</p>
    <form id="wh-auth-form">
      <label>Email<input type="email" name="email" autocomplete="email" required placeholder="your@email.com"></label>
      <label>Password<input type="password" name="password" autocomplete="current-password" minlength="6" required placeholder="Password"></label>
      <div class="wh-auth-actions"><button type="button" id="wh-auth-cancel">Cancel</button><button type="submit" id="wh-auth-login">Sign In</button></div>
      <button class="wh-auth-alt" type="button" id="wh-auth-signup">Create Account</button>
      <button class="wh-auth-alt" type="button" id="wh-auth-resend">Resend Confirmation Email</button>
      <button class="wh-auth-alt" type="button" id="wh-auth-logout" hidden>Sign Out</button>
      <p id="wh-auth-feedback" role="status"></p>
    </form></div>`;
  const css=document.createElement('style');css.textContent=`
  #wh-auth-overlay[hidden]{display:none!important}#wh-auth-overlay{position:fixed;inset:0;z-index:9999;background:rgba(24,9,17,.77);display:flex;align-items:center;justify-content:center;padding:20px;color:#ffe6df;font-family:var(--handwriting,'Delius',sans-serif)}
  .wh-auth-panel{width:min(100%,390px);max-height:85vh;overflow:auto;background:linear-gradient(145deg,#794457,#4a2935);border:2px solid #ffc2d0;border-radius:27px;padding:22px;box-shadow:0 0 30px #f582a570}
  .wh-auth-panel h2{text-align:center;font-size:27px;font-weight:normal;margin:0 0 6px}.wh-auth-caption{margin:0 0 15px;line-height:1.4;text-align:center}
  .wh-auth-panel form{display:grid;gap:12px}.wh-auth-panel label{display:grid;gap:5px;font-size:16px}
  .wh-auth-panel input{font:inherit;font-size:16px;min-height:45px;box-sizing:border-box;width:100%;border-radius:13px;background:#3d202c;border:1px solid #f5aaba;color:#fff4ec;padding:10px}
  .wh-auth-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}.wh-auth-panel button{font:inherit;border-radius:14px;border:1px solid #ffbfcb;background:#b35d79;color:#fff2eb;padding:12px 6px;cursor:pointer}
  #wh-auth-login{background:linear-gradient(135deg,#f499b5,#d76187)}.wh-auth-alt{background:transparent!important;border:0!important;text-decoration:underline}
  #wh-auth-feedback{font-size:14px;min-height:19px;margin:0;line-height:1.4;text-align:center}`;
  document.head.append(css);document.body.append(overlay);
  const close=()=>{overlay.hidden=true};
  $('wh-auth-cancel').onclick=close;
  overlay.addEventListener('click',e=>{if(e.target===overlay)close()});
  const feedback = text=>$('wh-auth-feedback').textContent=text;
  const form = $('wh-auth-form');
  form.onsubmit=async e=>{
    e.preventDefault(); if(!client)return;
    feedback('Signing in…');
    const fd=new FormData(form);
    const {error}=await client.auth.signInWithPassword({email:String(fd.get('email')),password:String(fd.get('password'))});
    if(error){
      const message=publicError(error);
      feedback(/not confirmed/i.test(message) ? 'Please confirm your email first. Tap Resend Confirmation Email if the link did not work.' : message);
      return;
    }
    feedback('Signed in successfully.');close();
  };
  $('wh-auth-signup').onclick=async()=>{
    if(!form.reportValidity())return;
    const fd=new FormData(form);
    const {error,data}=await client.auth.signUp({
      email:String(fd.get('email')),password:String(fd.get('password')),
      options:{emailRedirectTo:authRedirectUrl()}
    });
    if(error){feedback(publicError(error));return}
    feedback(data.session ? 'Account ready. Cloud is connecting.' : 'Check your email for the confirmation link. When confirmed, open your Wifey & Hubby Home Screen app and sign in.');
  };
  $('wh-auth-resend').onclick=async()=>{
    const email=String(new FormData(form).get('email')||'').trim();
    if(!email || !$('wh-auth-form').elements.email.checkValidity()){
      feedback('Enter a valid email address, then tap Resend Confirmation Email.');return;
    }
    feedback('Sending a fresh confirmation email…');
    const {error}=await client.auth.resend({type:'signup',email,options:{emailRedirectTo:authRedirectUrl()}});
    feedback(error ? publicError(error) : 'Confirmation email requested. Check your inbox, including spam.');
  };
  $('wh-auth-logout').onclick=async()=>{await client.auth.signOut();close()};
  return {open:()=>{form.reset();feedback('');$('wh-auth-logout').hidden=!currentUser;overlay.hidden=false;},close};
}
const authDialog=createAuthDialog();

async function initialSync() {
  if (!currentUser || syncPaused) return;
  syncPaused = true;
  setStatus('Connecting…');
  try {
    const {data,error}=await client.from('wh_documents').select('document_key,value,updated_at').eq('user_id',currentUser.id);
    if(error)throw error;
    const remote=(data || []).filter(x=>managed(x.document_key));
    remoteBaseline.clear();for(const x of remote)remoteBaseline.set(x.document_key,{value:x.value,updated_at:x.updated_at});
    restoreJournal();
    if(!remote.length) {
      // First cloud connection: preserve and upload the existing iPhone's data.
      const items=localDocs();
      for (const x of items) {
        const {data:created,error:err}=await client.from('wh_documents').insert({...x,user_id:currentUser.id}).select('updated_at');
        if(err)throw err;
        remoteBaseline.set(x.document_key,{value:x.value,updated_at:created[0].updated_at});
      }
    } else {
      const changed=remote.filter(x=>!pending.has(x.document_key)&&localStorage.getItem(x.document_key)!==x.value);
      if(changed.length) {
        const fresh=localDocs().length===0;
        const accept = fresh || confirm('Cloud has saved Wifey & Hubby data. Restore the cloud copy to this phone? Cancel leaves this phone unchanged, without overwriting your cloud backup.');
        if(accept) {
          changed.forEach(x=>originalSet.call(localStorage,x.document_key,x.value));
          setStatus('Cloud Connected');
          location.reload();return;
        }
        syncPaused=true;setStatus('Cloud Review Needed');
        dialog('Cloud Data Kept Safe','Your cloud data was not overwritten. To continue syncing, sign out and choose Restore when prompted, or create a backup of this phone first.');
        return;
      }
    }
    syncPaused=false;setStatus('Cloud Connected');
    await flushPending();
    if (notify?.checked && typeof Notification!=='undefined' && Notification.permission==='granted') await subscribePush(false);
  } catch(e) {
    syncPaused=false;setStatus('Sync Pending');
    console.warn('Initial cloud sync could not complete:',e);
  }
}
const vapidBytes=key=>{
  const padding='='.repeat((4-key.length%4)%4);
  const raw=atob((key+padding).replace(/-/g,'+').replace(/_/g,'/'));
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
};
async function subscribePush(requestPermission) {
  if(!currentUser){ dialog('Sign In First','Sign in to your shared cloud account before turning on push notifications.');return false }
  if(!cfg.vapidPublicKey){dialog('Push Setup Required','A Web Push public key must be configured before notifications can be enabled.');return false}
  if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)){
    dialog('Push Unavailable','For iPhone push notifications, open the secure website in Safari, add it to the Home Screen, then open the installed app.');return false;
  }
  if (Notification.permission==='denied') { dialog('Notifications Blocked','Enable notifications for this Home Screen app in iPhone Settings.');return false; }
  if (Notification.permission!=='granted') {
    if(!requestPermission) return false;
    const permission=await Notification.requestPermission();
    if(permission!=='granted'){dialog('Permission Needed','Enable notifications when prompted to receive reminders on your Lock Screen.');return false}
  }
  try{
    const reg=await navigator.serviceWorker.ready;
    const existing=await reg.pushManager.getSubscription();
    const subscription=existing || await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:vapidBytes(cfg.vapidPublicKey)});
    const json=subscription.toJSON();
    const {error}=await client.from('wh_push_subscriptions').upsert({
      user_id:currentUser.id,endpoint:json.endpoint,p256dh:json.keys?.p256dh,auth:json.keys?.auth,
      time_zone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',enabled:true
    },{onConflict:'endpoint'});
    if(error)throw error;
    deviceReady=true;return true;
  }catch(e){console.error('Web Push subscription error',e);dialog('Push Setup Failed',publicError(e));return false}
}
async function disablePush() {
  try {
    const reg=await navigator.serviceWorker.ready;
    const sub=await reg.pushManager.getSubscription();
    if(sub && currentUser) await client.from('wh_push_subscriptions').update({enabled:false}).eq('user_id',currentUser.id).eq('endpoint',sub.endpoint);
    if(sub)await sub.unsubscribe();
  }catch(e){console.warn('Could not unsubscribe from push:',e)}
  deviceReady=false;
}
if (notify) notify.addEventListener('change',async()=>{
  if(!validConfig){ if(notify.checked){notify.checked=false;dialog('Cloud Setup Needed','Cloud credentials are not connected yet. Your current local data remains safe.')}return;}
  if(notify.checked){
    const ok=await subscribePush(true);
    if(!ok){notify.checked=false;const p=prefs();p.notifications=false;savePrefs(p)}
  }else await disablePush();
});
if(sign)sign.onclick=()=>{
  if(!validConfig){dialog('Cloud Setup Needed','The dedicated Wifey & Hubby Supabase project is not configured yet. Your current data is still saved locally.');return}
  authDialog.open();
};
if(validConfig){
  void (async()=>{
    let createClient;
    try { ({createClient}=await import('https://esm.sh/@supabase/supabase-js@2.58.0')); }
    catch(e){setStatus('Connection Unavailable');console.error('Supabase client failed to load',e);return;}
    client=createClient(cfg.url.replace(/\/$/,''),cfg.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  client.auth.onAuthStateChange((event,session)=>{
    const old=currentUser?.id;currentUser=session?.user || null;
    updateSignInButton();
    if(event==='SIGNED_IN'||(event==='INITIAL_SESSION' && currentUser && old!==currentUser.id))setTimeout(()=>void initialSync(),0);
    if(event==='SIGNED_OUT'){currentUser=null;pending.clear();remoteBaseline.clear();blockedSync.clear();syncPaused=false;deviceReady=false;setStatus('Not Connected');}
  });
  window.addEventListener('online',()=>{void flushPending();void pollCloud()});
  window.addEventListener('pagehide',()=>void flushPending());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){void flushPending();void pollCloud()}});
  setInterval(()=>{void flushPending();if(!document.hidden)void pollCloud()},30000);
  })();
}else{setStatus('Not Connected')}
async function pollCloud(){
  if(!client||!currentUser||syncPaused||pending.size||syncInProgress||Date.now()-lastPull<15000)return;
  lastPull=Date.now();
  try{
    const {data,error}=await client.from('wh_documents').select('document_key,value,updated_at').eq('user_id',currentUser.id);
    if(error)throw error;
    const updates=(data||[]).filter(x=>managed(x.document_key)&&localStorage.getItem(x.document_key)!==x.value);
    if(!updates.length){for(const x of data||[])remoteBaseline.set(x.document_key,{value:x.value,updated_at:x.updated_at});return;}
    if(document.hidden){setStatus('Cloud update available');return}
    if(confirm('Your shared Wifey & Hubby account has newer data from another device. Refresh this phone to show it?')){
      updates.forEach(x=>originalSet.call(localStorage,x.document_key,x.value));location.reload();
    }
  }catch(e){console.warn('Cloud refresh needs retry',e)}
}
// The service worker is registered for installed web push; no page caching or graphics changes.
if ('serviceWorker' in navigator && location.protocol==='https:') navigator.serviceWorker.register('./sw.js').catch(console.warn);
navigator.serviceWorker?.addEventListener('message',e=>{
  if(e.data?.type==='OPEN_CALENDAR')window.CozyApp?.showTab?.('calendar');
});
window.WifeyHubbyCloud=Object.freeze({get connected(){return !!currentUser&&!syncPaused},get subscribed(){return deviceReady},syncNow:flushPending});
