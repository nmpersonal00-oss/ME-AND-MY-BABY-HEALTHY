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

/* Preserve a last-synced ancestor per phone so independent edits can be merged.
   This key is local-only: it is never included in cloud documents. */
const baselineStoreKey = 'daily-sweets-sync-baselines-v1';
const WH_ABSENT = Symbol('absent');
const WH_CONFLICT = Symbol('conflict');
function rememberBaselines() {
  if (!currentUser) return;
  try {
    originalSet.call(localStorage, baselineStoreKey, JSON.stringify({
      owner: currentUser.id, entries: [...remoteBaseline]
    }));
  } catch (e) { console.warn('Could not persist sync ancestors; retry may require review', e); }
}
function loadBaselines() {
  try {
    const saved = JSON.parse(localStorage.getItem(baselineStoreKey) || 'null');
    if (saved?.owner !== currentUser?.id || !Array.isArray(saved.entries)) return;
    for (const row of saved.entries) {
      if (Array.isArray(row) && managed(row[0]) && typeof row[1]?.value === 'string'
          && typeof row[1]?.updated_at === 'string') remoteBaseline.set(row[0], row[1]);
    }
  } catch (e) { console.warn('Could not read sync ancestors', e); }
}
function setBaseline(key, row) {
  if (row) remoteBaseline.set(key, { value: row.value, updated_at: row.updated_at });
  else remoteBaseline.delete(key);
  rememberBaselines();
}
function whEqual(a, b) {
  return a === b || (a !== WH_ABSENT && b !== WH_ABSENT && JSON.stringify(a) === JSON.stringify(b));
}
function whObject(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
function whMergeArray(base, local, remote, depth) {
  // Items must have stable unique IDs. Never guess how to merge positional arrays.
  const arrays = [local, remote, ...(Array.isArray(base) ? [base] : [])];
  const idField = ['id', 'uuid', 'key', 'taskId', 'habitId', 'choreId'].find(field =>
    arrays.every(items => {
      const ids = items.map(x => whObject(x) && Object.hasOwn(x, field)
        && (typeof x[field] === 'string' || typeof x[field] === 'number') ? JSON.stringify(x[field]) : null);
      return ids.every(id => id !== null) && new Set(ids).size === ids.length;
    }));
  if (!idField) return WH_CONFLICT;
  const makeMap = items => new Map(items.map(x => [JSON.stringify(x[idField]), x]));
  const a = makeMap(local), b = makeMap(remote), ancestor = makeMap(Array.isArray(base) ? base : []);
  const ids = new Set([...a.keys(), ...b.keys(), ...ancestor.keys()]);
  const result = [];
  for (const id of ids) {
    const item = whMergeValue(ancestor.get(id) ?? WH_ABSENT, a.get(id) ?? WH_ABSENT,
      b.get(id) ?? WH_ABSENT, depth + 1);
    if (item === WH_CONFLICT) return WH_CONFLICT;
    if (item !== WH_ABSENT) result.push(item);
  }
  return result;
}
function whMergeValue(base, local, remote, depth = 0) {
  if (depth > 40) return WH_CONFLICT;
  if (whEqual(local, remote)) return local;
  if (whEqual(local, base)) return remote;
  if (whEqual(remote, base)) return local;
  if (local === WH_ABSENT || remote === WH_ABSENT) return WH_CONFLICT;
  if (whObject(local) && whObject(remote) && (base === WH_ABSENT || whObject(base))) {
    const result = {};
    const keys = new Set([...Object.keys(base === WH_ABSENT ? {} : base),
      ...Object.keys(local), ...Object.keys(remote)]);
    for (const key of keys) {
      const value = whMergeValue(Object.hasOwn(base === WH_ABSENT ? {} : base, key) ? base[key] : WH_ABSENT,
        Object.hasOwn(local, key) ? local[key] : WH_ABSENT,
        Object.hasOwn(remote, key) ? remote[key] : WH_ABSENT, depth + 1);
      if (value === WH_CONFLICT) return WH_CONFLICT;
      if (value !== WH_ABSENT) result[key] = value;
    }
    return result;
  }
  if (Array.isArray(local) && Array.isArray(remote)
      && (base === WH_ABSENT || Array.isArray(base)))
    return whMergeArray(base, local, remote, depth);
  return WH_CONFLICT;
}
function mergeCloudDocument(baseRaw, localRaw, remoteRaw) {
  if (localRaw === remoteRaw) return { ok: true, value: localRaw };
  if (baseRaw !== undefined && localRaw === baseRaw) return { ok: true, value: remoteRaw };
  if (baseRaw !== undefined && remoteRaw === baseRaw) return { ok: true, value: localRaw };
  const decode = raw => {
    if (raw == null) return WH_ABSENT;
    try { return JSON.parse(raw); } catch { return raw; }
  };
  const merged = whMergeValue(baseRaw === undefined ? WH_ABSENT : decode(baseRaw),
    decode(localRaw), decode(remoteRaw));
  return merged === WH_CONFLICT ? { ok: false }
    : { ok: true, value: merged === WH_ABSENT ? null : JSON.stringify(merged) };
}
const recoveryKey = 'daily-sweets-sync-recovery-v1';
let recoverySavedThisSession = false;
function snapshotBeforeCloudReplace() {
  if (recoverySavedThisSession) return true;
  try {
    const old = JSON.parse(localStorage.getItem(recoveryKey) || 'null');
    const previous = old?.owner === currentUser?.id && Array.isArray(old.backups)
      ? old.backups : [];
    originalSet.call(localStorage, recoveryKey, JSON.stringify({
      owner: currentUser?.id,
      backups: [{ savedAt: new Date().toISOString(), documents: localDocs() },
        ...previous].slice(0, 3)
    }));
    recoverySavedThisSession = true;
    return true;
  } catch (e) {
    console.warn('Cloud update blocked: local recovery backup could not be stored', e);
    return false;
  }
}
function applyCloudLocal(key, value) {
  // Refuse to replace phone content if an independent recovery copy cannot be kept.
  if (!snapshotBeforeCloudReplace()) return false;
  if (value === null) originalRemove.call(localStorage, key);
  else originalSet.call(localStorage, key, value);
  return true;
}
function cloudConflictNotice() {
  setStatus('Sync Conflict — Review Needed');
  if ($('settings-popup')?.hidden) dialog('Sync Review Needed',
    'Both phones changed the same information. Nothing has been replaced. The copies on each phone and in the cloud are preserved. Save a backup before resolving this conflict.');
}
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
    blockedSync.delete(String(key)); pending.set(String(key), String(value)); saveJournal(); scheduleSync();
  }
};
Storage.prototype.removeItem = function(key) {
  originalRemove.call(this, key);
  if (this === localStorage && managed(String(key)) && currentUser && !syncPaused) {
    // Deletes are distinct from an empty stored value.
    blockedSync.delete(String(key)); pending.set(String(key), null); saveJournal(); scheduleSync();
  }
};
Storage.prototype.clear = function() {
  const keys = this === localStorage ? localDocs().map(x => x.document_key) : [];
  originalClear.call(this);
  if (currentUser && !syncPaused) { keys.forEach(k => { blockedSync.delete(k); pending.set(k, null); }); saveJournal(); scheduleSync(); }
};
async function flushPending() {
  if (!currentUser || !client || syncInProgress || syncPaused || !navigator.onLine || !pending.size) return;
  syncInProgress = true;
  const owner = currentUser.id;
  let failed = false, changedLocal = false;
  try {
    for (const [key, queued] of [...pending.entries()]) {
      if (currentUser?.id !== owner) break;
      if (blockedSync.has(key)) continue;
      try {
        // A newer local change must never be replaced by an older queued write.
        if (localStorage.getItem(key) !== queued) {
          pending.set(key, localStorage.getItem(key)); saveJournal(); continue;
        }
        const { data: remote, error: readError } = await client.from('wh_documents')
          .select('value,updated_at').eq('user_id', owner).eq('document_key', key).maybeSingle();
        if (readError) throw readError;
        if (currentUser?.id !== owner) break;
        let value = queued;
        if (remote?.value === value || (!remote && value === null)) {
          setBaseline(key, remote || null);
          if (pending.get(key) === queued) pending.delete(key);
          saveJournal(); continue;
        }
        const base = remoteBaseline.get(key);
        if ((remote?.value ?? null) !== (base?.value ?? null) || (!!remote !== !!base)) {
          const merged = mergeCloudDocument(base?.value, value, remote?.value ?? null);
          if (!merged.ok) { blockedSync.add(key); continue; }
          if (localStorage.getItem(key) !== queued) continue;
          value = merged.value;
          if (value !== queued) { if (!applyCloudLocal(key, value)) { blockedSync.add(key); continue; } changedLocal = true; }
          pending.set(key, value);
          setBaseline(key, remote || null);
          if ((remote?.value ?? null) === value) {
            pending.delete(key); saveJournal(); continue;
          }
        }
        let query;
        if (remote && value === null) {
          query = client.from('wh_documents').delete().eq('user_id', owner)
            .eq('document_key', key).eq('updated_at', remote.updated_at).select('document_key');
        } else if (remote) {
          query = client.from('wh_documents').update({ value }).eq('user_id', owner)
            .eq('document_key', key).eq('updated_at', remote.updated_at).select('value,updated_at');
        } else {
          query = client.from('wh_documents')
            .insert({ user_id: owner, document_key: key, value }).select('value,updated_at');
        }
        const { data, error } = await query;
        // A competing write is retried and merged at the next attempt.
        if (error && error.code !== '23505') throw error;
        if (error || !data?.length) { failed = true; continue; }
        setBaseline(key, value === null ? null : { value, updated_at: data[0].updated_at });
        if (pending.get(key) === value) pending.delete(key);
        saveJournal();
      } catch (e) { failed = true; console.warn('Sync retry required:', e); }
    }
    if (blockedSync.size) cloudConflictNotice();
    else setStatus(failed || pending.size ? 'Sync Pending' : 'Cloud Connected');
  } finally {
    syncInProgress = false;
    if (pending.size && !blockedSync.size) scheduleSync();
    if (changedLocal && !pending.size && !blockedSync.size) location.reload();
  }
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
  if (!currentUser || syncPaused || syncInProgress) return;
  const owner = currentUser.id;
  syncPaused = true;
  setStatus('Connecting…');
  let changedLocal = false, hasConflict = false;
  try {
    if (!remoteBaseline.size) loadBaselines();
    restoreJournal();
    const { data, error } = await client.from('wh_documents')
      .select('document_key,value,updated_at').eq('user_id', owner);
    if (error) throw error;
    if (currentUser?.id !== owner) return;
    const rows = new Map((data || []).filter(x => managed(x.document_key))
      .map(x => [x.document_key, x]));
    const keys = new Set([...rows.keys(), ...localDocs().map(x => x.document_key),
      ...remoteBaseline.keys(), ...pending.keys()]);
    for (const key of keys) {
      const row = rows.get(key) || null;
      const local = localStorage.getItem(key);
      const remote = row?.value ?? null;
      const baseline = remoteBaseline.get(key);
      if (local === remote) {
        setBaseline(key, row); pending.delete(key); blockedSync.delete(key);
        continue;
      }
      const result = mergeCloudDocument(baseline?.value, local, remote);
      if (!result.ok) {
        blockedSync.add(key); hasConflict = true; continue;
      }
      blockedSync.delete(key);
      // Record the actual cloud ancestor BEFORE uploading a merged result.
      setBaseline(key, row);
      if (result.value !== local) {
        if (!applyCloudLocal(key, result.value)) { blockedSync.add(key); hasConflict = true; continue; } changedLocal = true;
      }
      if (result.value !== remote) pending.set(key, result.value);
      else pending.delete(key);
    }
    saveJournal();
  } catch (e) {
    setStatus('Sync Pending');
    console.warn('Initial cloud sync could not complete:', e);
    return;
  } finally { syncPaused = false; }
  await flushPending();
  if (hasConflict || blockedSync.size) cloudConflictNotice();
  if (changedLocal && !pending.size && !blockedSync.size) location.reload();
  if (notify?.checked && typeof Notification !== 'undefined'
      && Notification.permission === 'granted') await subscribePush(false);
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
    if(currentUser && old!==currentUser.id && (event==='SIGNED_IN'||event==='INITIAL_SESSION'))setTimeout(()=>void initialSync(),0);
    if(event==='SIGNED_OUT'){currentUser=null;pending.clear();remoteBaseline.clear();blockedSync.clear();syncPaused=false;deviceReady=false;setStatus('Not Connected');}
  });
  window.addEventListener('online',()=>{void flushPending();void pollCloud()});
  window.addEventListener('pagehide',()=>void flushPending());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){void flushPending();void pollCloud()}});
  setInterval(()=>{void flushPending();if(!document.hidden)void pollCloud()},30000);
  })();
}else{setStatus('Not Connected')}
async function pollCloud() {
  if (!client || !currentUser || syncPaused || pending.size || syncInProgress
      || Date.now() - lastPull < 15000) return;
  lastPull = Date.now();
  try {
    const { data, error } = await client.from('wh_documents')
      .select('document_key,value,updated_at').eq('user_id', currentUser.id);
    if (error) throw error;
    const rows = (data || []).filter(x => managed(x.document_key));
    const cloudKeys = new Set(rows.map(x => x.document_key));
    const changed = rows.some(x => localStorage.getItem(x.document_key) !== x.value)
      || [...remoteBaseline.keys()].some(k => !cloudKeys.has(k) && localStorage.getItem(k) !== null);
    if (changed) { await initialSync(); return; }
    rows.forEach(x => remoteBaseline.set(x.document_key, {
      value: x.value, updated_at: x.updated_at
    }));
    for (const key of [...remoteBaseline.keys()])
      if (!cloudKeys.has(key)) remoteBaseline.delete(key);
    rememberBaselines();
  } catch (e) { console.warn('Cloud refresh needs retry', e); }
}
// The service worker is registered for installed web push; no page caching or graphics changes.
if ('serviceWorker' in navigator && location.protocol==='https:') navigator.serviceWorker.register('./sw.js').catch(console.warn);
navigator.serviceWorker?.addEventListener('message',e=>{
  if(e.data?.type==='OPEN_CALENDAR')window.CozyApp?.showTab?.('calendar');
});
window.WifeyHubbyCloud=Object.freeze({get connected(){return !!currentUser&&!syncPaused},get subscribed(){return deviceReady},syncNow:flushPending});
