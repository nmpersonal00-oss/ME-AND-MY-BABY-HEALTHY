from pathlib import Path
p=Path('index.html')
s=p.read_text()
def patch(a,b):
 global s
 if b in s:return
 n=s.count(a)
 if n!=1:raise RuntimeError(f'Expected one instance but found {n}: {a[:90]}')
 s=s.replace(a,b)
patch('wifeTimeZone: null,\n  husbandTimeZone: null,',"wifeTimeZone: 'America/Los_Angeles',\n  husbandTimeZone: 'America/Winnipeg',")
patch("const localZone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';","const localZone='America/Los_Angeles'; // Shared 3 a.m. Pacific reset for both phones")
patch("""const choreDayKey=(now=new Date())=>{
    const local=new Date(now);
    if(local.getHours()<3)local.setDate(local.getDate()-1);
    return `${local.getFullYear()}-${String(local.getMonth()+1).padStart(2,'0')}-${String(local.getDate()).padStart(2,'0')}`;
  };""","""const choreDayKey=(now=new Date())=>{
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now);
    const part=kind=>Number(parts.find(p=>p.type===kind)?.value||0);
    const date=new Date(Date.UTC(part('year'),part('month')-1,part('day'),12));
    if(part('hour')<3)date.setUTCDate(date.getUTCDate()-1);
    return date.toISOString().slice(0,10);
  };""")
patch('<label>Habit type<select id="habit-type"><option value="check">Check off</option><option value="counter">Count toward goal</option></select></label>','<label>How will you track it?<select id="habit-type" aria-describedby="habit-type-help"><option value="check">Mark as done (one checkmark)</option><option value="counter">Count each time (reach a daily goal)</option></select></label>')
patch('</div>\n          <div class="form-two">\n            <label>Repeat<select id="habit-repeat">','</div>\n          <p id="habit-type-help" style="font-size:13px;line-height:1.45;color:#ffe6df;margin:3px 0 10px">✓ <b>Mark as done:</b> Tap once when finished (like brushing teeth). ♡ <b>Count each time:</b> Tap + as you go (like eight glasses of water).</p>\n          <div class="form-two">\n            <label>Repeat<select id="habit-repeat">')
patch('</span></label></div>\n          <div class="calv-row2">\n            <label>Repeat<select id="calv-repeat">','</span></label></div>\n          <label style="display:block;margin:4px 0 11px;font-size:14px;color:#ffe6df">Event time zone<select id="calv-time-zone" style="width:100%;margin-top:4px"><option value="America/Los_Angeles">California (Pacific Time)</option><option value="America/Winnipeg">Manitoba (Central Time)</option></select></label>\n          <p style="font-size:13px;line-height:1.4;color:#ffe6df;margin:2px 0 10px">Both phones receive reminders at the same actual moment. California 9 AM is Manitoba 11 AM.</p>\n          <div class="calv-row2">\n            <label>Repeat<select id="calv-repeat">')
patch("$('calv-time').value=e?.time||'09:00';","$('calv-time').value=e?.time||'09:00';\n  $('calv-time-zone').value=e?.timeZone||'America/Los_Angeles';")
patch("favorite:$('calv-favorite').checked,done:[...(prev?.done||[])],skipped:[...(prev?.skipped||[])]","favorite:$('calv-favorite').checked,timeZone:$('calv-time-zone').value,done:[...(prev?.done||[])],skipped:[...(prev?.skipped||[])]")
patch("e.allDay?'All day':fmtClock(e.time),'calv-event-time'","e.allDay?'All day':fmtClock(e.time)+(e.timeZone==='America/Winnipeg'?' CT':' PT'),'calv-event-time'")
p.write_text(s)
print('Timezone and habit fix applied.')
