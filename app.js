(() => {
  'use strict';

  const config = window.COZY_CONFIG || {};
  const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const wifeZone = validTimeZone(config.wifeTimeZone) || localTimeZone;
  const husbandZone = validTimeZone(config.husbandTimeZone) || localTimeZone;
  const waterGoal = Math.max(1, Math.round(Number(config.waterGoalGlasses) || 8));
  const STORE_KEY = 'wifey-hubby-dashboard-v1';
  const TAB_NAMES = {home: 'Home', habits: 'Habits', chores: 'Chores', wellness: 'Wellness', games: 'Games', more: 'More'};

  const el = id => document.getElementById(id);
  const navButtons = [...document.querySelectorAll('.tab')];

  function validTimeZone(timeZone) {
    if (typeof timeZone !== 'string' || !timeZone.trim()) return null;
    try { new Intl.DateTimeFormat('en-US', {timeZone}); return timeZone; }
    catch { console.warn('Unknown time zone in config.js:', timeZone); return null; }
  }

  function zonedDateKey(date, timeZone) {
    // en-CA formatting isn't consistent across all browsers; use formatToParts.
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const get = type => parts.find(part => part.type === type)?.value || '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  }

  function readState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      return {
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
        water: parsed.water && typeof parsed.water === 'object' ? parsed.water : {}
      };
    } catch {
      return {tasks: [], water: {}};
    }
  }

  function saveState(state) {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    updateDashboard();
  }

  function updateClocks() {
    const now = new Date();
    const localHour = Number(new Intl.DateTimeFormat('en-US', {hour: 'numeric', hourCycle: 'h23'}).format(now));
    const greeting = localHour < 12 ? 'Good Morning' : localHour < 17 ? 'Good Afternoon' : 'Good Evening';
    el('greeting').textContent = greeting;
    el('today-date').textContent = new Intl.DateTimeFormat('en-US', {
      weekday: 'short', month: 'short', day: 'numeric'
    }).format(now);
    el('status-time').textContent = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true
    }).format(now).replace(/\s?[AP]M$/i, '');
    const timeText = timeZone => new Intl.DateTimeFormat('en-US', {
      timeZone, hour: 'numeric', minute: '2-digit', hour12: true
    }).format(now);
    el('two-clocks').innerHTML = '';
    const wife = document.createElement('span');
    const star = document.createElement('span');
    const husband = document.createElement('span');
    wife.textContent = `Wifey ${timeText(wifeZone)}`;
    star.textContent = '✦';
    star.className = 'clock-star';
    husband.textContent = `Hubby ${timeText(husbandZone)}`;
    el('two-clocks').append(wife, star, husband);
  }

  function updateDashboard() {
    const state = readState();
    // Filter dated tasks to the viewer's local day; undated tasks are always in scope.
    const today = zonedDateKey(new Date(), localTimeZone);
    const tasks = state.tasks.filter(task => task && (!task.date || task.date === today));
    const completed = tasks.filter(task => task.completed === true).length;
    const percent = tasks.length ? Math.round(completed / tasks.length * 100) : 0;
    const storedWater = state.water[today];
    const glasses = Number.isFinite(Number(storedWater)) ? Math.max(0, Number(storedWater)) : 0;
    const waterPercent = Math.min(100, (glasses / waterGoal) * 100);

    el('tasks-number').textContent = `${percent}%`;
    el('tasks-fill').style.setProperty('--fill', `${percent}%`);
    el('task-track').setAttribute('aria-valuenow', String(percent));
    el('task-track').setAttribute('aria-valuetext', `${completed} of ${tasks.length} tasks completed`);

    el('water-number').textContent = `${Number.isInteger(glasses) ? glasses : glasses.toFixed(1)}/${waterGoal}`;
    el('water-fill').style.setProperty('--fill', `${waterPercent}%`);
    el('water-track').setAttribute('aria-valuemax', String(waterGoal));
    el('water-track').setAttribute('aria-valuenow', String(Math.min(waterGoal, glasses)));
    el('water-track').setAttribute('aria-valuetext', `${glasses} of ${waterGoal} glasses consumed`);
  }

  function showTab(tab) {
    if (!Object.hasOwn(TAB_NAMES, tab)) tab = 'home';
    const isHome = tab === 'home';
    el('home-page').hidden = !isHome;
    el('blank-page').hidden = isHome;
    if (!isHome) {
      el('blank-heading').textContent = TAB_NAMES[tab];
      el('blank-page').setAttribute('aria-label', TAB_NAMES[tab]);
    }
    navButtons.forEach(btn => {
      const active = btn.dataset.tab === tab;
      btn.classList.toggle('active', active);
      if (active) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
    if (isHome) { updateClocks(); updateDashboard(); }
  }

  navButtons.forEach(btn => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
  el('tasks-card').addEventListener('click', () => showTab('habits'));
  el('water-card').addEventListener('click', () => showTab('habits'));

  updateClocks();
  updateDashboard();
  showTab('home');
  setInterval(() => { updateClocks(); updateDashboard(); }, 30_000);
  window.addEventListener('focus', () => { updateClocks(); updateDashboard(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { updateClocks(); updateDashboard(); }
  });
  window.addEventListener('storage', event => { if (event.key === STORE_KEY) updateDashboard(); });

  // Integration API for the Habits screen we'll build next. No demo data is invented.
  // Tasks: [{ id: '...', completed: true|false, date?: 'YYYY-MM-DD' }]
  // setWaterGlasses(3) updates the current day's water total.
  window.CozyApp = Object.freeze({
    showTab,
    getData: readState,
    setTasks(tasks) {
      if (!Array.isArray(tasks)) throw new TypeError('tasks must be an array');
      const state = readState();
      state.tasks = tasks;
      saveState(state);
    },
    setWaterGlasses(glasses) {
      const count = Number(glasses);
      if (!Number.isFinite(count) || count < 0) throw new RangeError('glasses must be a nonnegative number');
      const state = readState();
      state.water[zonedDateKey(new Date(), localTimeZone)] = count;
      saveState(state);
    },
    getTimeZones: () => ({wifeZone, husbandZone, localTimeZone}),
    refresh: () => { updateClocks(); updateDashboard(); }
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
})();
