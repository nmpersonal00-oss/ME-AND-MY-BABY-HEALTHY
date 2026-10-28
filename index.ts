// Server-side Web Push sender. Runs even if both phones have the app closed.
// Schedule this Supabase Edge Function every minute with pg_cron + pg_net.
// Deployment requires --no-verify-jwt; CRON_SECRET is checked below.
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';
import webpush from 'npm:web-push@3.6.7';

const url=Deno.env.get('SUPABASE_URL')||'';
const serviceRole=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const vapidPublic=Deno.env.get('VAPID_PUBLIC_KEY')||'';
const vapidPrivate=Deno.env.get('VAPID_PRIVATE_KEY')||'';
const vapidSubject=Deno.env.get('VAPID_SUBJECT')||'mailto:your-email@example.com';
const cronSecret=Deno.env.get('CRON_SECRET')||'';
const db=createClient(url,serviceRole,{auth:{persistSession:false,autoRefreshToken:false}});
if (vapidPublic && vapidPrivate) webpush.setVapidDetails(vapidSubject,vapidPublic,vapidPrivate);

const localParts=(instant,zone)=>{
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(instant);
  const get=t=>parts.find(p=>p.type===t)?.value||'';
  return {date:`${get('year')}-${get('month')}-${get('day')}`,time:`${get('hour')}:${get('minute')}`};
};
const dayDifference=(a,b)=>{
  const [y1,m1,d1]=a.split('-').map(Number),[y2,m2,d2]=b.split('-').map(Number);
  return Math.round((Date.UTC(y1,m1-1,d1)-Date.UTC(y2,m2-1,d2))/86400000);
};
function eventOccurs(e,day) {
  if(!e||!e.date||day<e.date||(e.until&&day>e.until)||(e.skipped||[]).includes(day)||(e.done||[]).includes(day))return false;
  const diff=dayDifference(day,e.date);
  if(diff<0)return false;
  const repeat=e.repeat||'none';
  if(repeat==='daily')return true;
  if(repeat==='weekly')return diff%7===0;
  if(repeat==='weekdays'){
    const [y,m,d]=day.split('-').map(Number),w=new Date(Date.UTC(y,m-1,d)).getUTCDay();return w!==0&&w!==6;
  }
  if(repeat==='monthly')return day.slice(8)===e.date.slice(8);
  if(repeat==='yearly')return day.slice(5)===e.date.slice(5);
  return day===e.date;
}
function dueOccurrences(e,timeZone,now) {
  if(e.remind==null||e.remind==='none'||!Number.isFinite(Number(e.remind))||Number(e.remind)<0)return [];
  const remind=Number(e.remind);
  const out=[];
  // Three-minute catch-up window tolerates minor cron delays without duplicate delivery.
  for(let lag=0;lag<=2;lag++){
    const at=new Date(now.getTime()+(remind-lag)*60000);
    let p;
    try{p=localParts(at,timeZone)}catch{p=localParts(at,'UTC')}
    if(p.time!==(e.allDay?'09:00':(e.time||'09:00'))||!eventOccurs(e,p.date))continue;
    out.push({id:String(e.id||e.title),date:p.date,remind, title:String(e.title||'Calendar reminder')});
  }
  return out;
}
Deno.serve(async req=>{
  if(!cronSecret||req.headers.get('x-cron-secret')!==cronSecret)return new Response('Unauthorized',{status:401});
  if(!vapidPublic||!vapidPrivate||!serviceRole)return new Response('Server secrets not configured',{status:503});
  const now=new Date();let examined=0,sent=0,errors=0;
  // For this two-person household, fetching the matching calendar documents is inexpensive.
  const {data:documents,error:docError}=await db.from('wh_documents')
    .select('user_id,value').eq('document_key','wifey-hubby-calendar-v1').limit(1000);
  if(docError)return new Response('Calendar database error',{status:500});
  const {data:subscriptions,error:subError}=await db.from('wh_push_subscriptions')
    .select('user_id,endpoint,p256dh,auth,time_zone').eq('enabled',true).limit(2000);
  if(subError)return new Response('Subscription database error',{status:500});
  const byUser=new Map();for(const sub of subscriptions||[]){const group=byUser.get(sub.user_id)||[];group.push(sub);byUser.set(sub.user_id,group)}
  for(const doc of documents||[]){
    let events;try{events=JSON.parse(doc.value)}catch{continue}
    if(!Array.isArray(events))continue;
    for(const sub of byUser.get(doc.user_id)||[]){
      for(const e of events){
        const due=dueOccurrences(e,sub.time_zone||'UTC',now);
        for(const occurrence of due){
          examined++;
          const reminder_key=`${occurrence.id}|${occurrence.date}|${occurrence.remind}`;
          // Unique claim prevents duplicate notifications from concurrent cron invocations.
          const {data:claim,error:claimError}=await db.from('wh_push_deliveries')
            .upsert({user_id:doc.user_id,endpoint:sub.endpoint,reminder_key},{onConflict:'user_id,endpoint,reminder_key',ignoreDuplicates:true})
            .select('reminder_key');
          if(claimError){errors++;continue}
          if(!claim?.length)continue;
          try{
            await webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},
              JSON.stringify({title:'Wifey & Hubby ♡',body:occurrence.title,tag:reminder_key}),
              {TTL:86400,urgency:'normal'});
            sent++;
          }catch(pushError){
            errors++;
            const status=Number(pushError?.statusCode)||0;
            if(status===404||status===410)await db.from('wh_push_subscriptions').update({enabled:false}).eq('endpoint',sub.endpoint);
            else await db.from('wh_push_deliveries').delete().eq('user_id',doc.user_id).eq('endpoint',sub.endpoint).eq('reminder_key',reminder_key);
          }
        }
      }
    }
  }
  return new Response(JSON.stringify({examined,sent,errors}),{headers:{'content-type':'application/json'}});
});
