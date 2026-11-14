import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarDate, inclusiveDays, mean, median, summarize, exportPersonalCSV } from './stats.mjs';
const study = {
  id: 'research', start_on: '2026-11-13', timezone: 'America/Los_Angeles',
  protocol_version: '1.0.0', ended_at: null
};
const row = (date, changes = {}) => ({
  local_date: date, calm: 8, tension: 2, anger: 1, happiness: 7,
  connectedness: 9, disagreement_episodes: 1, tension_episodes: 2,
  anger_episodes: 1, notes: null, ...changes
});

test('time-zone date respects evening in California', () => {
  assert.equal(calendarDate(new Date('2026-11-14T05:30:00Z'),'America/Los_Angeles'),'2026-11-13');
});
test('inclusive day count and ordering', () => {
  assert.equal(inclusiveDays('2026-11-13','2026-11-13'), 1);
  assert.equal(inclusiveDays('2026-11-13','2026-11-16'), 4);
  assert.equal(inclusiveDays('2026-11-14','2026-11-13'), 0);
});
test('empty data means missing outcomes, never a fabricated zero', () => {
  const s = summarize(study,[],new Date('2026-11-14T05:30:00Z'));
  assert.equal(s.recordedDays,0);
  assert.equal(s.missingDays,1);
  assert.equal(s.meanCalm,null);
  assert.equal(s.totalEpisodes,null);
  assert.equal(s.tensionEpisodeTotal,null);
  assert.equal(s.angerEpisodeTotal,null);
});
test('descriptive statistics use only recorded days', () => {
  const s = summarize(study,[row('2026-11-13'),row('2026-11-15',{
    calm:6,tension:6,anger:4,disagreement_episodes:0,tension_episodes:1,anger_episodes:0
  })],new Date('2026-11-16T06:00:00Z'));
  assert.equal(s.expectedDays,3);
  assert.equal(s.recordedDays,2);
  assert.equal(s.missingDays,1);
  assert.equal(s.coveragePct,200/3);
  assert.equal(s.meanCalm,7);
  assert.equal(s.meanTension,4);
  assert.equal(s.totalEpisodes,1);
  assert.equal(s.tensionEpisodeTotal,3);
  assert.equal(s.angerEpisodeTotal,1);
});
test('means and medians are empty-safe', () => {
  assert.equal(mean([]),null);
  assert.equal(median([]),null);
  assert.equal(median([8,1,9,2]),5);
});
test('a stopped study limits expected days', () => {
  const s=summarize({...study,ended_at:'2026-11-15T20:00:00Z'},[row('2026-11-13')],
    new Date('2026-11-20T21:00:00Z'));
  assert.equal(s.expectedDays,3);
});
test('CSV exports only fields and protects spreadsheet formula input', () => {
  const csv=exportPersonalCSV(study,[row('2026-11-13',{notes:'=SUM(1,1)'})]);
  assert.ok(csv.includes('tension_episodes'));
  assert.ok(csv.includes('"\'=SUM(1,1)"'));
  assert.equal(csv.trimEnd().split('\r\n').length,2);
});
