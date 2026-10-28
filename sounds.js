/* Wifey & Hubby: gentle audio feedback, enabled on first install.
 * Web Audio starts only inside user gestures, as required by iPhone browsers. */
(() => {
  'use strict';
  const key='wifey-hubby-app-settings-v1';
  const toggle=document.getElementById('set-sounds');
  const originalSet=Storage.prototype.setItem;
  function read(){try{const p=JSON.parse(localStorage.getItem(key)||'{}');return p&&typeof p==='object'?p:{}}catch{return {}}}
  let p=read();
  // No saved preference means ON; a user-chosen OFF is respected.
  if(typeof p.soundEffects!=='boolean'){
    p.soundEffects=true;
    try{localStorage.setItem(key,JSON.stringify(p))}catch{}
  }
  if(toggle)toggle.checked=p.soundEffects;
  let audio;
  let lastPlayed=0;
  function enabled(){return read().soundEffects!==false}
  function play(kind='tap'){
    if(!enabled())return;
    const Audio=window.AudioContext||window.webkitAudioContext;
    if(!Audio)return;
    try{
      audio=audio||new Audio({latencyHint:'interactive'});
      if(audio.state==='suspended')void audio.resume().catch(()=>{});
      const start=audio.currentTime+0.002;
      const frequencies=kind==='complete'?[784,1174.66]:kind==='switch'?[659.25,880]:[740,987.77];
      const duration=kind==='complete'?.16:.095;
      frequencies.forEach((frequency,i)=>{
        const at=start+i*(kind==='complete'?.058:.032);
        const oscillator=audio.createOscillator();
        const gain=audio.createGain();
        oscillator.type=i===0?'sine':'triangle';
        oscillator.frequency.setValueAtTime(frequency,at);
        gain.gain.setValueAtTime(.0001,at);
        gain.gain.exponentialRampToValueAtTime(i===0?.045:.024,at+.014);
        gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
        oscillator.connect(gain);gain.connect(audio.destination);
        oscillator.start(at);oscillator.stop(at+duration+.003);
      });
      lastPlayed=Date.now();
    }catch(err){console.debug('Audio unavailable on this device',err)}
  }
  const interactive='button, [role="button"], [role="checkbox"], input[type="checkbox"], input[type="radio"], select, .habit-row, .chore-row, .calendar-day, .calv-day, .settings-switch, .tab';
  document.addEventListener('click',event=>{
    const target=event.target instanceof Element?event.target:null;
    if(!target||!target.closest(interactive))return;
    if(target.closest('input[type="checkbox"], [role="checkbox"]'))play('complete');
    else if(target.closest('.settings-switch'))play('switch');
    else play('tap');
  },true);
  document.addEventListener('change',event=>{
    const t=event.target;
    if(!(t instanceof Element))return;
    if(t.matches('select, input[type="radio"]') && Date.now()-lastPlayed>85)play('switch');
  },true);
  // The existing Settings handler will also persist sound preference.
  // Keep the audio available to other components without replacing their handlers.
  window.WifeyHubbySounds=Object.freeze({play,enabled});
})();
