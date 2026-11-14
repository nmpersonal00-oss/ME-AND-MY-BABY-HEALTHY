// Sakinah Study — separate research interface, never modifies the main app.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/+esm';
import { calendarDate, summarize, exportPersonalCSV } from './stats.mjs';

const cfg = window.WH_CLOUD || {};
const $ = id => document.getElementById(id);
const uidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const client = /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(cfg.url || '') && cfg.publishableKey
  ? createClient(cfg.url, cfg.publishableKey, {
      auth: { storageKey: 'rb-research-separate-auth-v1', persistSession: true, autoRefreshToken: true }
    })
  : null;
let user = null, study = null, members = [], rows = [], studies = [], busy = false, lastInvite = '';

function alertMessage(message, error = false) {
  const box = $('alert');
  box.textContent = message;
  box.className = 'notice' + (error ? ' error' : '');
  box.hidden = !message;
  box.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
}
function report(error) {
  console.error('[Research app]', error);
  const message = String(error?.message || error || 'Unexpected error');
  alertMessage(message, true);
}
function formData(id) { return $(id)?.value?.trim() || ''; }
function escapedCsvDownload(csv, name) {
  const blob = new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function setBusy(next) {
  busy = next;
  document.querySelectorAll('button').forEach(b => {
    // Don't disable sign-out while waiting.
    if (b.id !== 'signOut') b.disabled = next || b.dataset.locked === '1';
  });
}
function requireActive() {
  if (!user || !study || study.status !== 'active' || !!members.find(m => m.user_id === user.id)?.withdrawn_at)
    throw new Error('You must be an active participant in an active study.');
}
function setFormLocked(locked) {
  for (const control of $('checkinForm').querySelectorAll('input,select,textarea')) {
    control.disabled = locked;
  }
  $('saveCheckin').dataset.locked = locked ? '1' : '0';
  $('saveCheckin').disabled = locked;
  $('deleteCheckin').dataset.locked = locked ? '1' : '0';
  $('deleteCheckin').disabled = locked;
}
function dateForStudy(date = new Date()) { return calendarDate(date, study?.timezone || 'America/Los_Angeles'); }
function clearForm() {
  for (const id of ['calm','tension','anger','happiness','connectedness','outside_stress','communication_quality','sleep_hours','together_minutes','notes']) $(id).value = '';
  $('disagreement_episodes').value = '0';
  $('tension_episodes').value = '0';
  $('anger_episodes').value = '0';
  $('revisionNote').textContent = 'New entry (nothing saved yet)';
  $('deleteCheckin').hidden = true;
}
function loadDateIntoForm() {
  clearForm();
  const data = rows.find(r => r.local_date === formData('localDate'));
  if (!data) return;
  for (const key of ['calm','tension','anger','happiness','connectedness','disagreement_episodes','tension_episodes','anger_episodes',
    'outside_stress','communication_quality','sleep_hours','together_minutes','notes']) {
    $(key).value = data[key] == null ? '' : String(data[key]);
  }
  $('revisionNote').textContent = 'Existing entry · changes are recorded in a private audit history';
  $('deleteCheckin').hidden = study.status !== 'active';
}
async function fetchAllEntries(studyId) {
  // Pagination avoids Supabase's default 1000-row return cap.
  const collected = [];
  for (let start = 0; start < 100000; start += 500) {
    const { data, error } = await client.from('rb_checkins')
      .select('*').eq('study_id', studyId).eq('author_id', user.id)
      .order('local_date', { ascending: true }).range(start, start + 499);
    if (error) throw error;
    collected.push(...(data || []));
    if (!data || data.length < 500) break;
  }
  return collected;
}
async function refreshStudies(preferredId = null) {
  if (!user) return;
  const { data: membership, error: memberError } = await client.from('rb_members')
    .select('study_id,user_id,role,nickname,withdrawn_at')
    .eq('user_id', user.id);
  if (memberError) throw memberError;
  const ids = (membership || []).map(m => m.study_id);
  if (!ids.length) {
    studies = []; study = null; rows = [];
    renderPicker(); $('studyArea').hidden = true;
    return;
  }
  const { data: studyData, error } = await client.from('rb_studies').select('*')
    .in('id', ids).order('created_at', { ascending: false });
  if (error) throw error;
  studies = studyData || [];
  renderPicker();
  const activeId = preferredId || study?.id || formData('studyPicker') || studies[0]?.id;
  if (studies.some(s => s.id === activeId)) await openStudy(activeId);
  else await openStudy(studies[0].id);
}
function renderPicker() {
  const select = $('studyPicker'), old = select.value;
  select.replaceChildren(new Option('Choose a study',''));
  for (const s of studies) select.add(new Option(
    (s.title || 'Untitled study') + ' · ' + (s.status === 'active' ? 'Active' : 'Stopped'), s.id
  ));
  if (studies.some(s => s.id === old)) select.value = old;
}
async function openStudy(studyId) {
  if (!uidRe.test(studyId)) throw new Error('Invalid study identifier.');
  const source = studies.find(s => s.id === studyId);
  if (!source) throw new Error('You do not have access to that study.');
  study = source;
  $('studyPicker').value = study.id;
  const [memberResult, stopResult, savedRows] = await Promise.all([
    client.from('rb_members').select('user_id,role,nickname,withdrawn_at')
      .eq('study_id', study.id),
    client.from('rb_stops').select('reason,boundary_code,stopped_at')
      .eq('study_id',study.id).maybeSingle(),
    fetchAllEntries(study.id)
  ]);
  if (memberResult.error) throw memberResult.error;
  if (stopResult.error) throw stopResult.error;
  members = memberResult.data || [];
  rows = savedRows;
  $('studyArea').hidden = false;
  $('studyStatus').hidden = false;
  $('studyStatus').className = 'pill' + (study.status === 'stopped' ? ' stopped' : '');
  $('studyStatus').textContent = study.status === 'stopped' ? 'Study ended' : 'Observing';
  $('membersLabel').textContent = members.length + ' of 2 participants joined' +
    (members.some(m=>m.withdrawn_at) ? ' · one withdrew' : '');
  $('timezoneLabel').textContent = study.timezone;
  $('studyIdLabel').textContent = study.id;
  $('inviteButton').hidden = study.status !== 'active' || study.owner_id !== user.id ||
    members.length >= 2 || !!members.find(m => m.user_id === user.id)?.withdrawn_at;
  $('invitation').hidden = true;
  const today = dateForStudy();
  const stopDate = study.ended_at ? dateForStudy(study.ended_at) : today;
  $('localDate').min = study.start_on;
  $('localDate').max = stopDate < today ? stopDate : today;
  $('localDate').value = $('localDate').max < study.start_on ? '' : $('localDate').max;
  const activeMember = members.find(m => m.user_id === user.id && !m.withdrawn_at);
  setFormLocked(study.status !== 'active' || !activeMember);
  $('stoppingPanel').hidden = study.status !== 'active';
  if (study.status === 'stopped') {
    const reason = stopResult.data?.boundary_code
      ? 'Boundary: ' + stopResult.data.boundary_code.replaceAll('_', ' ')
      : stopResult.data?.reason || study.stop_reason;
    $('revisionNote').textContent = 'Observation ended · new check-ins are disabled. ' +
      'Stopping reason: ' + reason + '.';
  }
  loadDateIntoForm();
  renderAnalysis();
  if (study.status === 'stopped') $('revisionNote').textContent =
    'Study ended · historical entries remain readable. New check-ins are disabled.';
}
function initScales() {
  for (const id of ['calm','tension','anger','happiness','connectedness','outside_stress','communication_quality']) {
    const optional = ['outside_stress','communication_quality'].includes(id);
    $(id).replaceChildren(new Option(optional ? 'Not recorded' : 'Select rating', ''));
    for (let i = 0; i <= 10; i++) $(id).add(new Option(String(i), String(i)));
  }
}
function numberOrNull(id) {
  const v = formData(id);
  return v === '' ? null : Number(v);
}
function requiredNumber(id) {
  const x = numberOrNull(id);
  if (x === null || !Number.isFinite(x)) throw new Error('Please fill all required measurements.');
  return x;
}
function checkinPayload() {
  requireActive();
  const date = formData('localDate'), today = dateForStudy();
  if (date < study.start_on || date > today || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new Error('Select a date within your active observation window.');
  const payload = {
    study_id: study.id, author_id: user.id, local_date: date,
    calm: requiredNumber('calm'), tension: requiredNumber('tension'),
    anger: requiredNumber('anger'), happiness: requiredNumber('happiness'),
    connectedness: requiredNumber('connectedness'),
    disagreement_episodes: requiredNumber('disagreement_episodes'),
    tension_episodes: requiredNumber('tension_episodes'),
    anger_episodes: requiredNumber('anger_episodes'),
    outside_stress: numberOrNull('outside_stress'),
    communication_quality: numberOrNull('communication_quality'),
    sleep_hours: numberOrNull('sleep_hours'),
    together_minutes: numberOrNull('together_minutes'),
    notes: formData('notes') || null
  };
  for (const k of ['calm','tension','anger','happiness','connectedness','outside_stress','communication_quality']) {
    if (payload[k] !== null && (!Number.isInteger(payload[k]) || payload[k] < 0 || payload[k] > 10))
      throw new Error(k + ' must be a whole number from 0–10.');
  }
  for (const k of ['disagreement_episodes','tension_episodes','anger_episodes']) {
    if (!Number.isInteger(payload[k]) || payload[k] < 0 || payload[k] > 30)
      throw new Error(k + ' must be a whole number between 0 and 30.');
  }
  if (payload.sleep_hours !== null && (payload.sleep_hours < 0 || payload.sleep_hours > 24))
    throw new Error('Sleep hours must be between 0 and 24.');
  if (payload.together_minutes !== null && (!Number.isInteger(payload.together_minutes) ||
    payload.together_minutes < 0 || payload.together_minutes > 1440))
    throw new Error('Time together must be a whole number between 0 and 1,440 minutes.');
  return payload;
}
function fmt(v, digits = 1) { return v == null ? '—' : Number(v).toFixed(digits); }
function renderAnalysis() {
  if (!study) return;
  const s = summarize(study, rows);
  const stats = [
    ['Recorded days', s.recordedDays + ' / ' + s.expectedDays],
    ['Average calm', fmt(s.meanCalm)],
    ['Average tension', fmt(s.meanTension)],
    ['Average anger', fmt(s.meanAnger)],
    ['Total disagreements', String(s.totalEpisodes)],
    ['Tension episodes', String(s.tensionEpisodeTotal)],
    ['Anger episodes', String(s.angerEpisodeTotal)],
    ['Avg disagreements / recorded day', fmt(s.meanEpisodesPerRecordedDay, 2)],
    ['Average happiness', fmt(s.meanHappiness)],
    ['Coverage', s.coveragePct == null ? '—' : fmt(s.coveragePct, 0) + '%']
  ];
  const metricBox = $('metrics');
  metricBox.replaceChildren();
  stats.forEach(([label, value]) => {
    const block = document.createElement('div'); block.className = 'metric';
    const n = document.createElement('strong'); n.textContent = value;
    const l = document.createElement('span'); l.textContent = label;
    block.append(n, l); metricBox.append(block);
  });
  $('missingness').textContent = s.missingDays + ' unrecorded day(s). ' +
    'This dashboard shows only your own entries; your partner’s self-reports stay private. ' +
    'No score is calculated from days without an entry.';
  const tbody = $('entries'); tbody.replaceChildren();
  for (const r of [...rows].sort((a,b) => b.local_date.localeCompare(a.local_date))) {
    const tr = document.createElement('tr');
    for (const field of ['local_date','calm','tension','anger','disagreement_episodes','tension_episodes','anger_episodes']) {
      const td = document.createElement('td'); td.textContent = String(r[field] ?? '—'); tr.append(td);
    }
    const btn = document.createElement('button'); btn.type = 'button';
    btn.className = 'small secondary'; btn.textContent = 'View';
    btn.addEventListener('click', () => {
      $('localDate').value = r.local_date; loadDateIntoForm();
      $('checkinForm').scrollIntoView({ behavior:'smooth',block:'start' });
    });
    const td = document.createElement('td'); td.append(btn); tr.append(td);
    tbody.append(tr);
  }
  if (!rows.length) {
    const tr = document.createElement('tr'), td = document.createElement('td');
    td.colSpan=8; td.textContent='No observations yet. Add your first daily check-in.';
    tr.append(td); tbody.append(tr);
  }
  drawChart(rows);
}
function drawChart(records) {
  const svg = $('trendChart'), NS = 'http://www.w3.org/2000/svg';
  svg.replaceChildren();
  const width=700,height=250,left=38,right=20,top=15,bottom=34;
  const xMax=width-right, yMax=height-bottom;
  function el(tag, attrs={}, content='') {
    const node=document.createElementNS(NS,tag);
    for (const [key,value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (content) node.textContent=content;
    svg.append(node); return node;
  }
  for (let value=0; value<=10; value+=2) {
    const y=yMax-(value/10)*(yMax-top);
    el('line',{x1:left,y1:y,x2:xMax,y2:y,stroke:'#e6ede7','stroke-width':1});
    el('text',{x:27,y:y+4,'text-anchor':'end',fill:'#647b6d','font-size':11},String(value));
  }
  if (!records.length) {
    el('text',{x:width/2,y:height/2,'text-anchor':'middle',fill:'#748b7a','font-size':14},
      'Your daily trend appears after the first check-in.');
    return;
  }
  const sorted=[...records].sort((a,b)=>a.local_date.localeCompare(b.local_date));
  // Calendar days determine horizontal spacing, preserving gaps for missed days.
  const start=Date.parse(sorted[0].local_date+'T00:00:00Z');
  const last=Date.parse(sorted.at(-1).local_date+'T00:00:00Z');
  const d=(r) => Date.parse(r.local_date+'T00:00:00Z');
  const x=(r)=>left+(last===start?0.5:(d(r)-start)/(last-start))*(xMax-left);
  const y=(v)=>yMax-(v/10)*(yMax-top);
  for (const [field,color] of [['calm','#24856b'],['tension','#d7a04a'],['anger','#b75d5d']]) {
    if (sorted.length>1) {
      el('polyline',{
        points:sorted.map(r=>x(r).toFixed(1)+','+y(r[field]).toFixed(1)).join(' '),
        fill:'none',stroke:color,'stroke-width':2.5,'stroke-linecap':'round','stroke-linejoin':'round'
      });
    }
    sorted.forEach(r=>el('circle',{cx:x(r),cy:y(r[field]),r:3.8,fill:color}));
  }
  el('text',{x:left,y:height-9,fill:'#667b6d','font-size':11},sorted[0].local_date);
  el('text',{x:xMax,y:height-9,'text-anchor':'end',fill:'#667b6d','font-size':11},
    sorted.at(-1).local_date);
}
async function login(email,password) {
  if (!client) throw new Error('Cloud configuration not found. Open this file inside the Wifey & Hubby website.');
  const { error }=await client.auth.signInWithPassword({email,password});
  if(error) throw error;
  await refreshAuth();
}
async function refreshAuth() {
  if(!client) return;
  const {data,error}=await client.auth.getUser();
  if(error && error.name !== 'AuthSessionMissingError') throw error;
  user=data?.user || null;
  $('authScreen').hidden=!!user;
  $('workspace').hidden=!user;
  $('userBadge').hidden=!user;
  $('signOut').hidden=!user;
  $('userBadge').textContent=user?.email || '';
  if(!user) {
    $('studyArea').hidden = true; study=null; rows=[]; studies=[];
    return;
  }
  await refreshStudies();
  const params = new URLSearchParams(location.hash.replace(/^#/,''));
  if(params.has('study') && params.has('code')) {
    $('joinId').value=params.get('study') || '';
    $('joinCode').value=params.get('code') || '';
    history.replaceState(null,'',location.pathname+location.search);
    alertMessage('Invitation loaded. Review the voluntary consent box, then choose Join study.');
  }
}
async function handle(ev,work) {
  ev?.preventDefault?.();
  if(busy) return;
  setBusy(true);
  try{ await work(); }catch(e){ report(e); }
  finally{ setBusy(false); }
}
async function init() {
  initScales();
  if(!client) {
    alertMessage('The shared cloud-config.js file is missing or invalid. This research page requires the existing Wifey & Hubby Supabase public configuration.',true);
    return;
  }
  $('authForm').addEventListener('submit', e => handle(e,async()=>{
    await login(formData('email'),formData('password'));
    alertMessage('Signed in. Your research workspace is ready.');
  }));
  $('signupButton').addEventListener('click',e=>handle(e,async()=>{
    const email=formData('email'),password=formData('password');
    if(!email || password.length<8) throw new Error('Enter a valid email and password of at least 8 characters.');
    const {data,error}=await client.auth.signUp({
      email,password,options:{emailRedirectTo:location.origin+location.pathname}
    });
    if(error) throw error;
    if(data?.session) { await refreshAuth(); alertMessage('Account created and signed in.'); }
    else alertMessage('Check your email for the confirmation link, then return here to sign in.');
  }));
  $('signOut').addEventListener('click',e=>handle(e,async()=>{
    const {error}=await client.auth.signOut();
    if(error)throw error;
    user=null;await refreshAuth();alertMessage('Signed out of the research notebook.');
  }));
  $('studyPicker').addEventListener('change',e=>handle(e,async()=>{
    if(formData('studyPicker'))await openStudy(formData('studyPicker'));
  }));
  $('createStudy').addEventListener('submit',e=>handle(e,async()=>{
    if(!user)throw new Error('Sign in first.');
    const title=formData('studyTitle')||'Personal observational study';
    const {data,error}=await client.from('rb_studies').insert({
      title,start_on:'2026-11-13',timezone:formData('studyTimezone')
    }).select('id').single();
    if(error)throw error;
    await refreshStudies(data.id);
    alertMessage('Study created. Record your own check-ins and generate an invitation for your partner.');
  }));
  $('joinStudy').addEventListener('submit',e=>handle(e,async()=>{
    if(!user)throw new Error('Sign in first.');
    if(!$('consent').checked)throw new Error('Voluntary consent is required.');
    const study_id=formData('joinId'),invite_token=formData('joinCode');
    if(!uidRe.test(study_id) || invite_token.length < 40)throw new Error('Invalid study ID or invitation code.');
    const {error}=await client.from('rb_join_requests').insert({
      study_id, user_id:user.id,invite_token
    });
    if(error)throw error;
    $('joinCode').value='';$('consent').checked=false;
    await refreshStudies(study_id);
    alertMessage('You joined. Your self-reports are private to your own login.');
  }));
  $('inviteButton').addEventListener('click',e=>handle(e,async()=>{
    requireActive();
    if(study.owner_id!==user.id)throw new Error('Only the study creator can invite a participant.');
    if(members.length>=2)throw new Error('This study already has two participants.');
    const entropy=crypto.getRandomValues(new Uint8Array(32));
    const token=Array.from(entropy,b=>b.toString(16).padStart(2,'0')).join('');
    const hashBytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)));
    const token_hash=Array.from(hashBytes,b=>b.toString(16).padStart(2,'0')).join('');
    const {error}=await client.from('rb_invites').insert({
      study_id:study.id,created_by:user.id,token_hash
    });
    if(error)throw error;
    const target=new URL('./index.html',location.href);
    target.hash=new URLSearchParams({study:study.id,code:token}).toString();
    lastInvite=target.toString();
    $('inviteLink').value=lastInvite;
    $('invitation').hidden=false;
    alertMessage('One-use invitation created. Send it privately. Anyone with the link can redeem it once.');
  }));
  $('copyInvite').addEventListener('click',e=>handle(e,async()=>{
    if(!lastInvite)throw new Error('Generate an invitation first.');
    await navigator.clipboard.writeText(lastInvite);
    alertMessage('Private invitation link copied.');
  }));
  $('localDate').addEventListener('change',loadDateIntoForm);
  $('checkinForm').addEventListener('submit',e=>handle(e,async()=>{
    const payload=checkinPayload();
    const {error}=await client.from('rb_checkins').upsert(payload,{
      onConflict:'study_id,author_id,local_date'
    });
    if(error)throw error;
    const date=payload.local_date;
    rows=await fetchAllEntries(study.id);
    renderAnalysis();$('localDate').value=date;loadDateIntoForm();
    alertMessage('Private check-in saved. Edits to an existing entry are audit-logged.');
  }));
  $('deleteCheckin').addEventListener('click',e=>handle(e,async()=>{
    requireActive();
    const record=rows.find(r=>r.local_date===formData('localDate'));
    if(!record)throw new Error('No entry found for this date.');
    if(!confirm('Permanently delete this daily entry and its audit history? This cannot be undone.'))return;
    const {error}=await client.from('rb_checkins').delete().eq('id',record.id).eq('author_id',user.id);
    if(error)throw error;
    rows=await fetchAllEntries(study.id);
    loadDateIntoForm();renderAnalysis();alertMessage('Daily entry permanently deleted.');
  }));
  $('exportCSV').addEventListener('click',e=>handle(e,async()=>{
    if(!study)throw new Error('Choose a study first.');
    escapedCsvDownload(exportPersonalCSV(study,rows),'private-study-'+study.start_on+'.csv');
    alertMessage('Your private check-ins were exported as CSV. Keep the file somewhere secure.');
  }));
  $('stopStudy').addEventListener('submit',e=>handle(e,async()=>{
    requireActive();
    const key=formData('stopReason');
    if(!key)throw new Error('Choose a stopping reason.');
    const boundary=['physical_contact','uncovered_body','sexual_flirting','undressing'].includes(key);
    const reason=boundary?'boundary':key;
    if(!confirm('End the observation now? This permanently stops future entries for both people.'))return;
    const {error}=await client.from('rb_stops').insert({
      study_id:study.id,reported_by:user.id,reason,boundary_code:boundary?key:null
    });
    if(error)throw error;
    await refreshStudies(study.id);
    alertMessage('Observation stopped. Your historical measurements remain available for review and CSV export.');
  }));
  $('withdraw').addEventListener('click',e=>handle(e,async()=>{
    requireActive();
    if(!confirm('Withdraw from the study? This ends the shared observation. You may still export or delete your own data.'))return;
    const {error}=await client.from('rb_members')
      .update({withdrawn_at:new Date().toISOString()})
      .eq('study_id',study.id).eq('user_id',user.id);
    if(error)throw error;
    await refreshStudies(study.id);
    alertMessage('You withdrew. The observation was stopped.');
  }));
  const {data:session}=await client.auth.getSession();
  if(session?.session?.user)await refreshAuth();
  else await refreshAuth();
  client.auth.onAuthStateChange((event)=>{
    if(event==='SIGNED_IN'||event==='SIGNED_OUT') {
      Promise.resolve().then(()=>refreshAuth()).catch(report);
    }
  });
}
init().catch(report);
