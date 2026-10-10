import '@fontsource/vazirmatn/400.css';
import '@fontsource/vazirmatn/600.css';
import '@fontsource/vazirmatn/800.css';
import './style.css';
import { createAudio } from './audio.js';
import { mountGame } from './game.js';

const BEST_KEY = 'snake3d-best';
const MUTE_KEY = 'snake3d-muted';
const fmt = new Intl.NumberFormat('fa-IR');

const scoreEl = document.querySelector('#score');
const bestEl = document.querySelector('#best');
const lengthEl = document.querySelector('#length');
const heightEl = document.querySelector('#height');
const speedEl = document.querySelector('#speed');
const soundBtn = document.querySelector('#sound');
const pauseBtn = document.querySelector('#pause');
const overlay = document.querySelector('#overlay');
const panel = document.querySelector('#panel');
const eyebrow = document.querySelector('#eyebrow');
const title = document.querySelector('#title');
const lede = document.querySelector('#lede');
const result = document.querySelector('#result');
const primary = document.querySelector('#primary');
const secondary = document.querySelector('#secondary');
const help = document.querySelector('#help');
const note = document.querySelector('#note');
const pad = document.querySelector('#pad');
const vignette = document.querySelector('#vignette');
const fallback = document.querySelector('#fallback');

const audio = createAudio();
let best = readNumber(BEST_KEY);
let muted = localStorage.getItem(MUTE_KEY) === '1';
let mode = 'menu';
let newRecord = false;
audio.setMuted(muted);
paintSound();
bestEl.textContent = fmt.format(best);

const canvas = document.querySelector('#view');
let game;
try {
  game = mountGame(canvas, { onEvent });
} catch (error) {
  console.error(error);
  overlay.hidden = true;
  pad.hidden = true;
  fallback.hidden = false;
}

soundBtn.addEventListener('click', () => {
  muted = !muted;
  audio.setMuted(muted);
  localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  paintSound();
  if (!muted) audio.resume();
  soundBtn.blur();
});

pauseBtn.addEventListener('click', () => {
  audio.resume();
  game?.togglePause();
  pauseBtn.blur();
});

primary.addEventListener('click', () => {
  audio.resume();
  game?.primaryAction();
  primary.blur();
});

secondary.addEventListener('click', () => {
  audio.resume();
  game?.restart();
  secondary.blur();
});

pad.addEventListener('pointerdown', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  event.preventDefault();
  audio.resume();
  game?.nudge(button.dataset.cmd);
});

window.addEventListener('pointerdown', () => audio.resume());

function onEvent(event) {
  if (event.type === 'start') audio.start();
  if (event.type === 'eat') {
    audio.eat(event.score);
    navigator.vibrate?.(14);
    scoreEl.classList.remove('bump');
    void scoreEl.offsetWidth;
    scoreEl.classList.add('bump');
  }
  if (event.type === 'die') {
    audio.die();
    navigator.vibrate?.(70);
    vignette.classList.add('hit');
    window.setTimeout(() => vignette.classList.remove('hit'), 520);
  }
  if (event.type === 'win') audio.win();

  const enteredEnd = event.mode !== mode && (event.mode === 'dead' || event.mode === 'won');
  if (enteredEnd) {
    newRecord = event.score > best && event.score > 0;
    if (newRecord) {
      best = event.score;
      localStorage.setItem(BEST_KEY, String(best));
    }
  }

  paintHud(event);
  if (event.mode !== mode || event.type === 'die' || event.type === 'win') {
    mode = event.mode;
    paintOverlay(event);
    if (mode !== 'playing') panel.focus();
  }
}

function paintHud(snap) {
  scoreEl.textContent = fmt.format(snap.score);
  bestEl.textContent = fmt.format(best);
  lengthEl.textContent = fmt.format(snap.length);
  heightEl.textContent = fmt.format(snap.height);
  speedEl.textContent = fmt.format(snap.speed);
  pauseBtn.hidden = snap.mode !== 'playing' && snap.mode !== 'paused';
  pauseBtn.textContent = snap.mode === 'paused' ? 'ادامه' : 'مکث';
  pad.hidden = snap.mode === 'paused' || snap.mode === 'dead' || snap.mode === 'won';
}

function paintOverlay(snap) {
  const playing = snap.mode === 'playing';
  overlay.hidden = playing;
  if (playing) return;

  const view = copyFor(snap);
  eyebrow.textContent = view.eyebrow;
  title.textContent = view.title;
  title.className = view.tone;
  lede.textContent = view.lede;
  result.hidden = !view.result;
  result.textContent = view.result;
  primary.textContent = view.primary;
  secondary.hidden = !view.restart;
  help.hidden = !view.help;
  note.hidden = !view.help;
}

function copyFor(snap) {
  if (snap.mode === 'paused') {
    return {
      eyebrow: 'توقف',
      title: 'مکث',
      tone: '',
      lede: 'مار همان‌جا مانده. ادامه بده یا از نو شروع کن.',
      result: '',
      primary: 'ادامه',
      restart: true,
      help: true,
    };
  }
  if (snap.mode === 'dead') {
    const why = snap.reason === 'self' ? 'به بدن خودت خوردی.' : 'به دیوار مکعب خوردی.';
    return {
      eyebrow: 'پایان این دور',
      title: 'برخورد کردی',
      tone: 'danger',
      lede: why,
      result: scoreLine(snap.score),
      primary: 'دوباره',
      restart: false,
      help: false,
    };
  }
  if (snap.mode === 'won') {
    return {
      eyebrow: 'مکعب پر شد',
      title: 'همه‌ی خانه‌ها مال توست',
      tone: 'win',
      lede: 'جایی برای گوی بعدی نماند.',
      result: scoreLine(snap.score),
      primary: 'دوباره',
      restart: false,
      help: false,
    };
  }
  return {
    eyebrow: 'مکعب نئون',
    title: 'مار سه‌بعدی',
    tone: '',
    lede: 'گوی طلایی را ببلع و از دیوار و بدن خودت دور بمان. جهت‌نما نسبت به دوربین است؛ Q بالا می‌برد و E پایین می‌آورد.',
    result: '',
    primary: 'شروع بازی',
    restart: false,
    help: true,
  };
}

function scoreLine(score) {
  if (newRecord) return `امتیاز ${fmt.format(score)}\nرکورد جدید`;
  return `امتیاز ${fmt.format(score)}\nرکورد ${fmt.format(best)}`;
}

function paintSound() {
  soundBtn.textContent = muted ? 'صدا خاموش' : 'صدا روشن';
  soundBtn.setAttribute('aria-pressed', muted ? 'false' : 'true');
}

function readNumber(key) {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

paintOverlay({ mode: 'menu', score: 0, reason: null });
