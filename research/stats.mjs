// Pure descriptive statistics. No hypothesis tests, no causal claims.
export function calendarDate(instant, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(instant instanceof Date ? instant : new Date(instant));
  const value = key => parts.find(p => p.type === key)?.value;
  return [value('year'), value('month'), value('day')].join('-');
}
export function inclusiveDays(start, end) {
  if (!start || !end || end < start) return 0;
  return Math.floor((Date.parse(end + 'T00:00:00Z') -
    Date.parse(start + 'T00:00:00Z')) / 86400000) + 1;
}
export function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}
export function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export function summarize(study, rows, now = new Date()) {
  const lastPossible = calendarDate(now, study.timezone);
  const stoppedOn = study.ended_at ? calendarDate(study.ended_at, study.timezone) : lastPossible;
  const end = stoppedOn < lastPossible ? stoppedOn : lastPossible;
  const eligible = rows.filter(r => r.local_date >= study.start_on && r.local_date <= end);
  const days = inclusiveDays(study.start_on, end);
  const completed = new Set(eligible.map(r => r.local_date)).size;
  const episodes = eligible.map(r => r.disagreement_episodes);
  const total = episodes.reduce((a, b) => a + b, 0);
  const tensionEpisodes = eligible.map(r => r.tension_episodes);
  const angerEpisodes = eligible.map(r => r.anger_episodes);
  return {
    expectedDays: days,
    recordedDays: completed,
    missingDays: Math.max(0, days - completed),
    coveragePct: days ? 100 * completed / days : null,
    meanCalm: mean(eligible.map(r => r.calm)),
    medianCalm: median(eligible.map(r => r.calm)),
    meanTension: mean(eligible.map(r => r.tension)),
    meanAnger: mean(eligible.map(r => r.anger)),
    meanHappiness: mean(eligible.map(r => r.happiness)),
    totalEpisodes: eligible.length ? total : null,
    meanEpisodesPerRecordedDay: mean(episodes),
    daysWithEpisodes: episodes.filter(x => x > 0).length,
    tensionEpisodeTotal: eligible.length ? tensionEpisodes.reduce((a,b) => a + b, 0) : null,
    angerEpisodeTotal: eligible.length ? angerEpisodes.reduce((a,b) => a + b, 0) : null,
    meanTensionEpisodes: mean(tensionEpisodes),
    meanAngerEpisodes: mean(angerEpisodes)
  };
}
const CSV_COLUMNS = [
  'study_id','protocol_version','start_on','timezone','local_date','calm',
  'tension','anger','happiness','connectedness','disagreement_episodes',
  'tension_episodes','anger_episodes',
  'outside_stress','communication_quality','sleep_hours','together_minutes',
  'notes','created_at','updated_at'
];
// Protect CSV viewers against formula injection from notes or the study title.
function csvCell(value) {
  if (value == null) return '';
  let s = String(value);
  if (/^[\s]*[=+\-@]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function exportPersonalCSV(study, rows) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of [...rows].sort((a,b) => a.local_date.localeCompare(b.local_date))) {
    const merged = {
      ...r, study_id: study.id, protocol_version: study.protocol_version,
      start_on: study.start_on, timezone: study.timezone
    };
    lines.push(CSV_COLUMNS.map(k => csvCell(merged[k])).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}