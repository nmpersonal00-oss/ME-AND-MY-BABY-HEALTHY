/* Daily Sweets — California and Manitoba clocks and calendar event zones.
Existing calendar entries without a timezone use California time. */
(() => {
'use strict';
const CA='America/Los_Angeles', MB='America/Winnipeg', $=id=>document.getElementById(id);
const clock=(d,z)=>new Intl.DateTimeFormat('en-US',{timeZone:z,hour:'numeric',minute:'2-digit',hour12:true}).format(d);
function parts(date,zone){
 const p=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
 const v=k=>Number(p.find(x=>x.type===k)?.value);
 return {year:v('year'),month:v('month'),day:v('day'),hour:v('hour'),minute:v('minute')};
}
function wallToInstant(day,time,zone){
 const [y,m,d]=day.split('-').map(Number),[h,min]=time.split(':').map(Number);
 const target=Date.UTC(y,m-1,d,h,min),wanted={year:y,month:m,day:d,hour:h,minute:min};
 let t=target;
 for(let i=0;i<5;i++){
   const got=parts(new Date(t),zone),difference=Date.UTC(got.year,got.month-1,got.day,got.hour,got.minute)-target;
   if(!difference)break;
   t-=difference;
 }
 const actual=parts(new Date(t),zone);
 return Object.keys(wanted).some(k=>actual[k]!==wanted[k])?null:new Date(t);
}
function updateClocks(){
 const row=$('two-clocks');if(!row||row.children.length!==3)return;
 const now=new Date(),w='Wifey '+clock(now,CA),h='Hubby '+clock(now,MB);
 if(row.children[0].textContent!==w)row.children[0].textContent=w;
 if(row.children[2].textContent!==h)row.children[2].textContent=h;
 row.setAttribute('aria-label','Wifey California '+clock(now,CA)+'; Hubby Manitoba '+clock(now,MB));
}
const clocks=$('two-clocks');
if(clocks){
 let busy=false;
 new MutationObserver(()=>{if(busy)return;busy=true;try{updateClocks()}finally{busy=false}}).observe(clocks,{childList:true,characterData:true,subtree:true});
 updateClocks();setInterval(updateClocks,30000);
}
const habitType=$('habit-type');
if(habitType){
 const label=habitType.closest('label');
 if(label?.firstChild?.nodeType===Node.TEXT_NODE)label.firstChild.textContent='How do you complete this habit?';
 const check=habitType.querySelector('option[value="check"]'),counter=habitType.querySelector('option[value="counter"]');
 if(check)check.textContent='Mark it done (one checkmark)';
 if(counter)counter.textContent='Count progress (e.g. 8 glasses)';
 const hint=document.createElement('p');
 hint.id='daily-habit-type-guide';
 hint.style.cssText='font-size:12px;line-height:1.35;margin:2px 0 5px;color:#ffe6df;grid-column:1/-1';
 function explain(){hint.textContent=habitType.value==='counter'?'Track a number until you reach a goal, like 8 glasses of water.':'Tap one checkmark when the habit is finished, like brushing your teeth.'}
 habitType.addEventListener('change',explain);explain();habitType.closest('.form-two')?.append(hint);
}
const form=$('calv-form'),modal=$('calv-modal'),forLabel=$('calv-for')?.closest('label');
if(!form||!modal||!forLabel)return;
const label=document.createElement('label');label.textContent='Event time zone';label.id='daily-event-zone-label';
const select=document.createElement('select');select.id='daily-event-zone';select.name='event-time-zone';
for(const [value,text] of [[CA,'California (Wifey · Pacific Time)'],[MB,'Manitoba (Hubby · Central Time)']]){
 const opt=document.createElement('option');opt.value=value;opt.textContent=text;select.append(opt);
}
label.append(select);
const previewText=document.createElement('div');previewText.id='daily-event-time-preview';previewText.setAttribute('role','status');
previewText.style.cssText='font-size:12px;line-height:1.4;color:#fff0dc;padding:6px 8px;background:rgba(73,39,60,.5);border-radius:10px;margin:-2px 0 5px';
forLabel.after(label,previewText);
function preview(){
 const day=$('calv-date')?.value,time=$('calv-time')?.value;
 if(!day||!time){previewText.textContent='Choose a date and time to see both local times.';return}
 if($('calv-all-day')?.checked){previewText.textContent='All-day event: shown on the selected calendar date.';return}
 const instant=wallToInstant(day,time,select.value);
 if(!instant){previewText.textContent='This local time does not exist on this date because of daylight saving. Choose another time.';return}
 const f=zone=>new Intl.DateTimeFormat('en-US',{timeZone:zone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true}).format(instant);
 previewText.textContent='Same moment on both phones: Wifey '+f(CA)+' · Hubby '+f(MB)+'. Reminders go out together.';
}
select.addEventListener('change',preview);
for(const id of ['calv-date','calv-time','calv-all-day']){
 $(id)?.addEventListener('input',preview);$(id)?.addEventListener('change',preview);
}
const KEY='wifey-hubby-calendar-v1';
function getEvents(){try{const x=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(x)?x:[]}catch{return []}}
let prior=[],opened=false;
new MutationObserver(()=>{
 if(modal.hidden){opened=false;return}
 if(opened)return;
 opened=true;prior=getEvents();
 const entry=prior.find(e=>e.date===$('calv-date')?.value&&e.title===$('calv-name')?.value);
 select.value=entry?.timeZone===MB?MB:CA;preview();
}).observe(modal,{attributes:true,attributeFilter:['hidden']});
form.addEventListener('submit',()=>{
 const zone=select.value===MB?MB:CA, title=$('calv-name')?.value.trim(),day=$('calv-date')?.value,time=$('calv-time')?.value;
 queueMicrotask(()=>{
  if(!title||!day)return;
  const list=getEvents(),matches=list.filter(e=>e.date===day&&e.title===title&&(e.time===time||e.allDay));
  const entry=matches.find(e=>!prior.some(p=>p.id===e.id))||matches.find(e=>prior.some(p=>p.id===e.id))||matches.at(-1);
  if(!entry||entry.timeZone===zone)return;
  entry.timeZone=zone;
  const updated=JSON.stringify(list);
  localStorage.setItem(KEY,updated);
  // Same-tab localStorage writes do not emit storage events. Refresh the calendar's own in-memory event list.
  window.dispatchEvent(new StorageEvent('storage',{key:KEY,newValue:updated}));
 });
});
window.DailySweetsTimeZones=Object.freeze({california:CA,manitoba:MB,wallToInstant});
})();