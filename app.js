// ==========================================================================
// ГЛИБШЕ · Преміальний рушій взаємодії та аудіо-атмосфери
// ==========================================================================

const journey = document.querySelector('.journey');
const stage = document.querySelector('.stage');
const visual = document.querySelector('#visual');
const canvas = document.querySelector('#landscape');
const context = canvas.getContext('2d', { alpha: false });
const heroCopy = document.querySelector('#hero-copy');
const sceneCopy = document.querySelector('#scene-copy');
const sceneTitle = document.querySelector('#scene-title');
const sceneLabel = document.querySelector('#scene-label');
const sceneDescription = document.querySelector('#scene-description');
const loadingStatus = document.querySelector('#loading-status');
const motionToggle = document.querySelector('#motion-toggle');
const soundToggle = document.querySelector('#sound-toggle');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const variant = matchMedia('(max-width: 700px)').matches ? 'mobile' : 'desktop';
const count = 50;
const blobs = new Map();
const decoded = new Map();
const decoding = new Map();
const failed = new Set();
let loaded = 0;
let motionOff = reducedMotion.matches || !context;
let manuallySelectedMotion = false;
let preloading = false;
let raf = 0;
let latestFrame = 0;
let targetFrame = 0;
let currentFrame = 0;
let isLerping = false;
let lastCaption = -1;
let lastPosition = null;

function triggerHaptic(ms = 8) {
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(ms);
    }
  } catch (e) {}
}

const clamp = (n, low = 0, high = 1) => Math.max(low, Math.min(high, n));
const smooth = (start, end, value) => {
  const t = clamp((value - start) / (end - start));
  return t * t * (3 - 2 * t);
};
const frameURL = index => `assets/frames/${variant}/frame_${String(index + 1).padStart(3, '0')}.webp`;
const captions = [
  ['Крізь геологічний час', 'Змінюється світ.<br>Камінь пам’ятає.', 'Знайомий краєвид поступається місцем морському середовищу.'],
  ['Міоцен / Давнє море', 'Тут виростало<br>майбутнє Поділля.', 'Водорості, молюски та інші організми створювали вапнякові рифи.'],
  ['Минуле під нашими ногами', 'Минуле стало<br>ландшафтом.', 'Сліди давнього моря збереглися у вапнякових скелях сучасних Товтр.']
];

function fetchFrame(index) {
  if (blobs.has(index)) return blobs.get(index);
  const promise = fetch(frameURL(index)).then(response => {
    if (!response.ok) throw new Error(`Frame ${index + 1}: ${response.status}`);
    return response.blob();
  }).then(blob => {
    loaded++;
    loadingStatus.textContent = `Готуємо подорож · ${Math.round(loaded / count * 100)}%`;
    if (loaded === count) {
      loadingStatus.textContent = 'Подорож готова';
      loadingStatus.classList.add('complete');
    }
    return blob;
  }).catch(error => {
    failed.add(index);
    loadingStatus.textContent = 'Частина кадрів завантажується. Історію можна читати нижче.';
    loadingStatus.classList.remove('complete');
    throw error;
  });
  blobs.set(index, promise);
  return promise;
}

function getDecoded(index) {
  if (decoded.has(index)) {
    const image = decoded.get(index);
    decoded.delete(index);
    decoded.set(index, image);
    return Promise.resolve(image);
  }
  if (failed.has(index)) return Promise.reject(new Error('Frame unavailable'));
  if (decoding.has(index)) return decoding.get(index);
  const promise = fetchFrame(index).then(async blob => {
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      decoded.set(index, image);
      while (decoded.size > 12) {
        const candidates = [...decoded.keys()];
        const victim = candidates.find(key => Math.abs(key - latestFrame) > 2);
        if (victim === undefined) break;
        decoded.delete(victim);
      }
      return image;
    } finally { URL.revokeObjectURL(url); }
  }).catch(error => { failed.add(index); throw error; }).finally(() => decoding.delete(index));
  decoding.set(index, promise);
  return promise;
}

async function preload() {
  if (preloading || motionOff) return;
  preloading = true;
  const order = [0, count - 1, ...Array.from({ length: count - 2 }, (_, i) => i + 1)];
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < order.length && !motionOff) {
      const index = order[next++];
      try { await fetchFrame(index); } catch { /* Poster fallback remains */ }
    }
  }));
  preloading = false;
}

function drawImage(image, alpha = 1) {
  const scale = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  context.globalAlpha = alpha;
  context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
}

function paint(position) {
  if (motionOff || !context) return;
  const lo = Math.floor(position);
  const hi = Math.min(count - 1, lo + 1);
  const first = decoded.get(lo);
  const second = decoded.get(hi);
  if (first && second) {
    drawImage(first);
    if (hi !== lo) drawImage(second, position - lo);
    context.globalAlpha = 1;
    canvas.classList.add('ready');
    canvas.dataset.frame = String(Math.round(position) + 1);
  } else {
    if (first || second) { drawImage(first || second); canvas.classList.add('ready'); }
    Promise.allSettled([getDecoded(lo), getDecoded(hi)]).then(results => {
      if (motionOff) return;
      if (results.some(result => result.status === 'fulfilled') && Math.abs(latestFrame - position) < 1.2) {
        const image = decoded.get(Math.floor(latestFrame)) || decoded.get(Math.min(count - 1, Math.ceil(latestFrame)));
        if (image) {
          drawImage(image);
          const upper = decoded.get(Math.ceil(latestFrame));
          if (decoded.has(Math.floor(latestFrame)) && upper && latestFrame % 1) drawImage(upper, latestFrame % 1);
          context.globalAlpha = 1;
          canvas.classList.add('ready');
        }
      }
    });
  }
}

// ==========================================================================
// Web Audio Ambient Synthesizer (Generative Wind & Ancient Sea)
// ==========================================================================

let audioCtx = null;
let soundPlaying = false;
let masterGain = null;
let windGain = null;
let seaGain = null;
let windFilter = null;
let seaFilter = null;
let noiseNode = null;
let seaOsc1 = null;
let seaOsc2 = null;

function initAudio() {
  if (audioCtx) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  audioCtx = new AudioContext();

  masterGain = audioCtx.createGain();
  masterGain.gain.setValueAtTime(0, audioCtx.currentTime);
  masterGain.connect(audioCtx.destination);

  // 1. Wind pink-noise generator (cliff air)
  const bufferSize = audioCtx.sampleRate * 2;
  const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const output = noiseBuffer.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < bufferSize; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.05;
    b6 = white * 0.115926;
  }

  noiseNode = audioCtx.createBufferSource();
  noiseNode.buffer = noiseBuffer;
  noiseNode.loop = true;

  windFilter = audioCtx.createBiquadFilter();
  windFilter.type = 'bandpass';
  windFilter.frequency.setValueAtTime(320, audioCtx.currentTime);
  windFilter.Q.setValueAtTime(1.2, audioCtx.currentTime);

  windGain = audioCtx.createGain();
  windGain.gain.setValueAtTime(0.7, audioCtx.currentTime);

  noiseNode.connect(windFilter);
  windFilter.connect(windGain);
  windGain.connect(masterGain);
  noiseNode.start();

  // 2. Prehistoric underwater ocean resonance
  seaOsc1 = audioCtx.createOscillator();
  seaOsc1.type = 'sine';
  seaOsc1.frequency.setValueAtTime(55, audioCtx.currentTime); // A1

  seaOsc2 = audioCtx.createOscillator();
  seaOsc2.type = 'triangle';
  seaOsc2.frequency.setValueAtTime(82.4, audioCtx.currentTime); // E2

  seaFilter = audioCtx.createBiquadFilter();
  seaFilter.type = 'lowpass';
  seaFilter.frequency.setValueAtTime(120, audioCtx.currentTime);

  seaGain = audioCtx.createGain();
  seaGain.gain.setValueAtTime(0.05, audioCtx.currentTime);

  seaOsc1.connect(seaFilter);
  seaOsc2.connect(seaFilter);
  seaFilter.connect(seaGain);
  seaGain.connect(masterGain);
  seaOsc1.start();
  seaOsc2.start();
}

function toggleSound() {
  if (!soundToggle) return;
  if (!soundPlaying) {
    initAudio();
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    masterGain.gain.cancelScheduledValues(audioCtx.currentTime);
    masterGain.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + 1.2);
    soundPlaying = true;
    soundToggle.classList.add('playing');
    soundToggle.setAttribute('aria-pressed', 'true');
    soundToggle.title = 'Вимкнути атмосферний звук';
  } else {
    if (audioCtx && masterGain) {
      masterGain.gain.cancelScheduledValues(audioCtx.currentTime);
      masterGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.5);
      setTimeout(() => {
        soundPlaying = false;
        soundToggle.classList.remove('playing');
        soundToggle.setAttribute('aria-pressed', 'false');
        soundToggle.title = 'Увімкнути атмосферний звук';
      }, 500);
    }
  }
}

if (soundToggle) {
  soundToggle.addEventListener('click', toggleSound);
}

function updateSoundModulation(frameProgress) {
  if (!audioCtx || !soundPlaying || !windGain || !seaGain) return;
  const now = audioCtx.currentTime;
  const seaRatio = clamp(frameProgress);
  windGain.gain.setTargetAtTime(0.7 * (1 - seaRatio * 0.8), now, 0.2);
  seaGain.gain.setTargetAtTime(0.05 + 0.65 * seaRatio, now, 0.2);
  seaFilter.frequency.setTargetAtTime(120 + 260 * seaRatio, now, 0.2);
}

// ==========================================================================
// Scroll Engine & Stage Sync
// ==========================================================================

function stepLerp() {
  if (motionOff) {
    isLerping = false;
    return;
  }
  const diff = targetFrame - currentFrame;
  if (Math.abs(diff) > 0.004) {
    currentFrame += diff * 0.12;
    paint(currentFrame);
    const norm = currentFrame / Math.max(1, count - 1);
    const zoom = 1 + norm * 0.055;
    canvas.style.transform = `scale(${zoom.toFixed(4)})`;
    requestAnimationFrame(stepLerp);
  } else {
    currentFrame = targetFrame;
    paint(currentFrame);
    const norm = currentFrame / Math.max(1, count - 1);
    const zoom = 1 + norm * 0.055;
    canvas.style.transform = `scale(${zoom.toFixed(4)})`;
    isLerping = false;
  }
}

function startLerp() {
  if (!isLerping && !motionOff) {
    isLerping = true;
    requestAnimationFrame(stepLerp);
  }
}

function update() {
  raf = 0;
  if (motionOff) return;
  const distance = Math.max(1, journey.offsetHeight - stage.offsetHeight);
  const progress = clamp(-journey.getBoundingClientRect().top / distance);
  const frameProgress = clamp((progress - .12) / .71);
  targetFrame = frameProgress * (count - 1);
  latestFrame = targetFrame;
  document.querySelector('#era-progress').style.width = `${frameProgress * 100}%`;
  const eraLabel = frameProgress < .02 ? 'Сьогодні' : frameProgress > .98 ? 'Давнє море' : 'Крізь час';
  const eraEl = document.querySelector('#era');
  if (eraEl && eraEl.textContent !== eraLabel) {
    eraEl.textContent = eraLabel;
    triggerHaptic(6);
  }
  
  updateSoundModulation(frameProgress);

  const heroOpacity = 1 - smooth(.015, .145, progress);
  heroCopy.style.opacity = heroOpacity;
  heroCopy.style.transform = `translateY(${-35 * (1 - heroOpacity)}px)`;
  heroCopy.style.pointerEvents = heroOpacity < .01 ? 'none' : 'auto';
  document.querySelector('.journey-start').tabIndex = heroOpacity < .01 ? -1 : 0;
  
  const caption = progress < .42 ? 0 : progress < .67 ? 1 : 2;
  if (caption !== lastCaption) {
    [sceneLabel.textContent, sceneTitle.innerHTML, sceneDescription.textContent] = captions[caption];
    if (lastCaption !== -1) triggerHaptic(8);
    lastCaption = caption;
  }
  const captionStart = caption === 0 ? .15 : caption === 1 ? .42 : .67;
  const captionEnd = caption === 0 ? .42 : caption === 1 ? .67 : 1.08;
  const opacity = smooth(captionStart, captionStart + .045, progress) * (1 - smooth(captionEnd - .045, captionEnd, progress));
  sceneCopy.style.opacity = opacity;
  sceneCopy.style.transform = `translateY(${16 * (1 - opacity)}px)`;
  startLerp();
}

function schedule() { if (!raf && !motionOff) raf = requestAnimationFrame(update); }
function resize() {
  const rect = visual.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
  lastPosition = null;
  schedule();
}

function setMotion(off, userAction = false) {
  const wasInJourney = journey.getBoundingClientRect().bottom > 0 && journey.getBoundingClientRect().top < 0;
  motionOff = off;
  document.body.classList.toggle('static-mode', off);
  motionToggle.setAttribute('aria-pressed', String(off));
  motionToggle.querySelector('.motion-label').textContent = off ? 'Увімкнути рух' : 'Зупинити рух';
  motionToggle.querySelector('.motion-icon').textContent = off ? '▷' : 'Ⅱ';
  motionToggle.title = off ? 'Увімкнути анімацію' : 'Зупинити анімацію';
  motionToggle.setAttribute('aria-label', motionToggle.title);
  if (off) {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    heroCopy.style.pointerEvents = 'auto';
    document.querySelector('.journey-start').tabIndex = 0;
    loadingStatus.classList.add('complete');
  } else {
    if (loaded < count) loadingStatus.classList.remove('complete');
    preload();
    lastPosition = null;
    resize();
  }
  if (userAction && wasInJourney) window.scrollTo({ top: 0, behavior: 'instant' });
}

motionToggle.addEventListener('click', () => { manuallySelectedMotion = true; setMotion(!motionOff, true); });
reducedMotion.addEventListener('change', event => { if (!manuallySelectedMotion) setMotion(event.matches); });
document.querySelector('.journey-start').addEventListener('click', event => {
  event.preventDefault();
  if (motionOff) {
    document.querySelector('#origin').scrollIntoView({ behavior: 'auto' });
  } else {
    window.scrollTo({ top: journey.offsetTop + (journey.offsetHeight - stage.offsetHeight) * .28, behavior: 'smooth' });
  }
});

const comparison = document.querySelector('#comparison');
const comparisonRange = document.querySelector('#comparison-range');
if (comparisonRange && comparison) {
  comparisonRange.addEventListener('input', () => {
    comparison.style.setProperty('--split', `${comparisonRange.value}%`);
    comparisonRange.setAttribute('aria-valuetext', `${comparisonRange.value}% сучасного пейзажу`);
  });
}

window.addEventListener('scroll', schedule, { passive: true });
window.addEventListener('pageshow', schedule);
new ResizeObserver(resize).observe(visual);
setMotion(motionOff);

// ==========================================================================
// Landmarks Explorer (Section 04)
// ==========================================================================

const landmarkContent = [
  ['Прочитати рельєф', 'Пагорби, які починалися під водою.', 'Товтри зберігають обриси давніх рифових споруд. На справжній місцевості придивіться, як скелясті пасма піднімаються над навколишнім ландшафтом.'],
  ['Роздивитися породу', 'Камінь із морською біографією.', 'Рифові масиви Товтр складені вапняками. На доступних природних відслоненнях спостерігайте за фактурою породи — не відколюючи й не забираючи її із собою.'],
  ['Помітити сліди життя', 'Колишнє життя стає частиною скелі.', 'У справжніх вапняках можна зустріти рештки морських організмів. Шукайте черепашки або відбитки, але не сприймайте деталі художньої сцени як визначник скам’янілостей.']
];
const landmarkButtons = [...document.querySelectorAll('[data-landmark]')];
for (const button of landmarkButtons) {
  button.addEventListener('click', () => {
    const index = Number(button.dataset.landmark);
    for (const other of landmarkButtons) other.setAttribute('aria-pressed', String(other === button));
    document.querySelector('#landmark-number').textContent = String(index + 1).padStart(2, '0');
    document.querySelector('#landmark-category').textContent = landmarkContent[index][0];
    document.querySelector('#landmark-title').textContent = landmarkContent[index][1];
    document.querySelector('#landmark-description').textContent = landmarkContent[index][2];
    triggerHaptic(8);
    const panel = document.querySelector('#landmark-panel');
    if (panel && panel.getBoundingClientRect().bottom > window.innerHeight - 80) {
      panel.scrollIntoView({ block: 'nearest', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    }
  });
}

// ==========================================================================
// Interactive Reef Map Component (3D Relief Map)
// ==========================================================================

const mapSpotsData = [
  {
    num: "01",
    name: "Сатанів",
    subtitle: "Північні ворота Товтр · Збручанське пасмо",
    tag: "Мінеральні джерела & Рифові вали",
    coords: "49.251° N, 26.248° E",
    alt: "~320 м над р. м.",
    age: "14–16 млн років (Міоцен)",
    desc: "Початок 200-кілометрового рифового пасма на кордоні Хмельниччини та Тернопільщини. Вапнякові хребти вкриті буковими пралісами над річкою Збруч. У надрах залягають знамениті мінеральні води типу «Нафтуся».",
    feature: "Залишки давніх рифових гребенів, Сатанівський замок на вапняковій кручі, печерний монастир у товтрах",
    link: "https://maps.google.com/?q=49.251,26.248"
  },
  {
    num: "02",
    name: "Товтра Сокіл",
    subtitle: "Скелястий вапняковий конус біля Нігина",
    tag: "Біогермний риф & Степові трави",
    coords: "48.835° N, 26.634° E",
    alt: "~345 м над р. м.",
    age: "14–15 млн років",
    desc: "Одна з найвищих і найстрімкіших товтр Поділля. Це окремий підводний біогермний рифовий масив, складений мільярдами мікроскопічних водоростей і мохуваток, що різко здіймається над довколишніми рівнинними полями на понад 80 метрів.",
    feature: "Круті обривисті схили, відкриті кам'янисті відслонення, реліктова степова рослинність міоценового віку",
    link: "https://maps.google.com/?q=48.835,26.634"
  },
  {
    num: "03",
    name: "Кам'янець-Подільський",
    subtitle: "Смотрицький каньйон & Місто на скелі",
    tag: "Каньйон & Морське дно",
    coords: "48.673° N, 26.568° E",
    alt: "~210 м над р. м.",
    age: "14–420 млн років (Силур–Міоцен)",
    desc: "Серце Подільських Товтр. Річка Смотрич прорізала товщу давнього морського дна, утворивши каньйон завглибшки до 40 метрів. Середньовічна фортеця буквально виростає з вапнякових скель, фундаментом яких є давній коралово-мохуватковий риф.",
    feature: "Вертикальні прямовисні стіни з горизонтальними нашаруваннями порід, міст «Стрімка лань», Замковий міст на природному перешийку",
    link: "https://maps.google.com/?q=48.673,26.568"
  },
  {
    num: "04",
    name: "Бакота",
    subtitle: "Дністровський каньйон & Біла скеля",
    tag: "Затоплена долина & Печери",
    coords: "48.583° N, 26.996° E",
    alt: "~150 м над р. м.",
    age: "14–15 млн років",
    desc: "Південний край Товтр над величним Дністровським водосховищем. Білосніжні 120-метрові вапнякові кручі обриваються прямо в бірюзову воду затоки. Завдяки скелястому амфітеатру тут утворився теплий, майже субтропічний мікроклімат.",
    feature: "Найдавніший скельний монастир у товтрових породах (XI ст.), оглядовий майданчик Білої скелі, джерела кришталевої води",
    link: "https://maps.google.com/?q=48.583,26.996"
  },
  {
    num: "05",
    name: "Печера «Атлантида»",
    subtitle: "с. Завалля над річкою Збруч",
    tag: "Триярусний підземний лабіринт",
    coords: "48.599° N, 26.342° E",
    alt: "~195 м над р. м.",
    age: "Міоценові гіпси та вапняки",
    desc: "Єдина в Поділлі триярусна карстова печера загальною довжиною понад 2,5 км. Утворилася у вимитих водою товтрових осадових пластах. Відома унікальними залами, вкритими кристалами гіпсу найрізноманітніших форм («квіти Атлантиди»).",
    feature: "Триярусна будова галерей, кристалічні зали «Динамо», «Червоні маки», спелеологічні експедиційні маршрути",
    link: "https://maps.google.com/?q=48.599,26.342"
  }
];

function initReefMap() {
  const hotspots = document.querySelectorAll('.map-hotspot');
  const pills = document.querySelectorAll('.map-pill');
  const carousel = document.querySelector('#map-cards-carousel');
  const cards = document.querySelectorAll('.map-cards-carousel .map-card');
  const carouselLayout = matchMedia('(max-width: 1050px)');
  let currentSpot = 2;
  let isProgrammaticScroll = false;
  let scrollTimeout = null;
  let layoutFrame = 0;

  function syncSelectionFromScroll() {
    if (!carousel || !carouselLayout.matches) return;
    const rect = carousel.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    let closestIndex = currentSpot;
    let minDistance = Infinity;
    cards.forEach((card, index) => {
      const bounds = card.getBoundingClientRect();
      const distance = Math.abs(center - bounds.left - bounds.width / 2);
      if (distance < minDistance) { minDistance = distance; closestIndex = index; }
    });
    if (closestIndex !== currentSpot) selectSpot(closestIndex, true);
  }

  function alignCarousel(behavior = 'instant') {
    if (!carousel || !carouselLayout.matches || !cards[currentSpot]) return;
    const viewport = carousel.getBoundingClientRect();
    const card = cards[currentSpot].getBoundingClientRect();
    const left = carousel.scrollLeft + card.left + card.width / 2 - viewport.left - viewport.width / 2;
    isProgrammaticScroll = true;
    clearTimeout(scrollTimeout);
    // Scroll only the carousel; page load and breakpoint changes must not move the page.
    carousel.scrollTo({ left, behavior });
    scrollTimeout = setTimeout(() => { isProgrammaticScroll = false; syncSelectionFromScroll(); }, 150);
  }

  function selectSpot(index, fromUserScroll = false) {
    if (index < 0 || index >= cards.length) return;
    currentSpot = index;
    hotspots.forEach((spot, i) => {
      spot.classList.toggle('active', i === index);
      spot.setAttribute('aria-pressed', String(i === index));
    });
    pills.forEach((pill, i) => {
      pill.classList.toggle('active', i === index);
      pill.setAttribute('aria-selected', String(i === index));
    });
    cards.forEach((card, i) => card.classList.toggle('active', i === index));
    if (!fromUserScroll) {
      alignCarousel(reducedMotion.matches ? 'instant' : 'smooth');
      triggerHaptic(8);
    }
  }

  hotspots.forEach((spot, index) => spot.addEventListener('click', () => selectSpot(index)));
  pills.forEach((pill, index) => pill.addEventListener('click', () => selectSpot(index)));
  document.querySelector('#map-prev-btn')?.addEventListener('click', () => selectSpot((currentSpot - 1 + cards.length) % cards.length));
  document.querySelector('#map-next-btn')?.addEventListener('click', () => selectSpot((currentSpot + 1) % cards.length));

  // Native horizontal scrolling is the only swipe mechanism. Do not advance again on touchend.
  carousel?.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      isProgrammaticScroll = false;
      syncSelectionFromScroll();
    }, isProgrammaticScroll ? 150 : 50);
  }, { passive: true });

  function scheduleAlignment() {
    cancelAnimationFrame(layoutFrame);
    layoutFrame = requestAnimationFrame(() => alignCarousel());
  }
  carouselLayout.addEventListener('change', scheduleAlignment);
  if (carousel) new ResizeObserver(scheduleAlignment).observe(carousel);
  selectSpot(currentSpot, true);
  scheduleAlignment();
}

initReefMap();

// ==========================================================================
// Field Card Modal & Print
// ==========================================================================

function initFieldModal() {
  const fieldModal = document.querySelector('#field-modal');
  const openFieldBtn = document.querySelector('#open-field-card');
  const cardPreviewWidget = document.querySelector('#card-preview-widget');
  const closeFieldBtn = document.querySelector('#close-field-btn');
  const printFieldBtn = document.querySelector('#print-field-btn');

  if (openFieldBtn && fieldModal) {
    openFieldBtn.addEventListener('click', () => fieldModal.showModal());
  }
  if (cardPreviewWidget && fieldModal) {
    cardPreviewWidget.addEventListener('click', () => fieldModal.showModal());
    cardPreviewWidget.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fieldModal.showModal();
      }
    });
  }
  if (closeFieldBtn && fieldModal) {
    closeFieldBtn.addEventListener('click', () => fieldModal.close());
  }
  if (printFieldBtn) {
    printFieldBtn.addEventListener('click', () => window.print());
  }
  if (fieldModal) {
    fieldModal.addEventListener('click', (e) => {
      if (e.target === fieldModal) fieldModal.close();
    });
  }
}

initFieldModal();

// ==========================================================================
// Floating Navigation Dock
// ==========================================================================

const dock = document.querySelector('.chapter-dock');
const chapterLinks = [...dock.querySelectorAll('[data-chapter]')];
const chapterSections = chapterLinks.map(link => document.getElementById(link.dataset.chapter));
let dockFrame = 0;
let lastScrollPos = 0;

function updateDock() {
  dockFrame = 0;
  const currentScroll = window.scrollY;
  const mobileJourneyVisible = matchMedia('(max-width: 700px), (max-width: 1000px) and (max-height: 500px)').matches && journey.getBoundingClientRect().bottom > window.innerHeight * .5;
  dock.hidden = mobileJourneyVisible || currentScroll < window.innerHeight * .65 || document.querySelector('#about').getBoundingClientRect().top < window.innerHeight * .6;

  if (matchMedia('(max-width: 768px)').matches) {
    if (currentScroll > lastScrollPos + 8 && currentScroll > window.innerHeight) {
      dock.classList.add('dock-hidden');
    } else if (currentScroll < lastScrollPos - 8) {
      dock.classList.remove('dock-hidden');
    }
  } else {
    dock.classList.remove('dock-hidden');
  }
  lastScrollPos = currentScroll;

  let active = 0;
  chapterSections.forEach((section, index) => {
    if (section && section.getBoundingClientRect().top < window.innerHeight * .5) active = index;
  });
  chapterLinks.forEach((link, index) => {
    if (index === active) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
}

function scheduleDock() { if (!dockFrame) dockFrame = requestAnimationFrame(updateDock); }
window.addEventListener('scroll', scheduleDock, { passive: true });
window.addEventListener('resize', scheduleDock);
window.addEventListener('pageshow', scheduleDock);
motionToggle.addEventListener('click', scheduleDock);
updateDock();

// ==========================================================================
// Atlas of Documentary & Project Images (Section 02)
// ==========================================================================

const traceItems = [
  {
    "id": "fossils",
    "file": "fossils.png",
    "location": "Морські мушлі у вапняку",
    "author": "матеріали проєкту",
    "source": null,
    "license": null,
    "licenseUrl": null,
    "alt": "Світла порода з численними спіральними мушлями та стулками молюсків.",
    "kicker": "Морське життя → гірська порода",
    "title": "Мушля стає частиною каменю.",
    "description": "Рештки морських організмів можуть зберігатися в осадовій породі. Це зображення допомагає придивитися до форм мушель і уявити, як сліди життя стають частиною вапняку.",
    "observation": "Знайдіть спіральні мушлі та широкі ребристі стулки. Порівняйте їхні форми.",
    "width": 1449,
    "height": 1086
  },
  {
    "id": "limestone",
    "file": "limestone.jpg",
    "location": "Відслонення породи",
    "author": "матеріали проєкту",
    "source": null,
    "license": null,
    "licenseUrl": null,
    "alt": "Шарувата світла скеля з вертикальними тріщинами у теплому світлі.",
    "kicker": "Відслонення → будова породи",
    "title": "Камінь відкриває свою будову.",
    "description": "Природні відслонення дають змогу роздивитися будову породи. Тут добре помітні горизонтальні лінії та вертикальні тріщини — деталі, які губляться в загальному краєвиді.",
    "observation": "Простежте лінії шарів і вертикальні тріщини. Подивіться, як вони ділять скелю на окремі блоки.",
    "width": 1536,
    "height": 1024
  },
  {
    "id": "tovtry",
    "file": "tovtry.png",
    "location": "Скелясті пагорби",
    "author": "матеріали проєкту",
    "source": null,
    "license": null,
    "licenseUrl": null,
    "alt": "Панорама скелястих пагорбів, трав’янистих схилів і полів у теплому світлі.",
    "kicker": "Рифові споруди → сучасний рельєф",
    "title": "Морська історія в силуеті пагорбів.",
    "description": "Товтри — залишки давніх рифових споруд. Їхні сучасні обриси змінювалися під дією вивітрювання та ерозії. Цей пейзаж ілюструє, як скелясті пагорби можуть вирізнятися серед навколишнього рельєфу.",
    "observation": "Порівняйте обриси відкритих скель із пологими полями вдалині. Знайдіть межу між каменем, трав’янистими схилами та рівниною.",
    "width": 1600,
    "height": 726
  }
];

const traceTabs = [...document.querySelectorAll('[data-trace]')];
const tracePanel = document.querySelector('#trace-panel');
const tracePhoto = document.querySelector('#trace-photo');
const traceStatus = document.querySelector('#trace-loading');
let activeTrace = 0;
let traceRequest = 0;
const traceRevision = '89ac053b4b';
const tracePath = (item, width) => `assets/traces/${item.id}-${width}.webp?v=${traceRevision}`;

async function selectTrace(index) {
  if (index === activeTrace && !tracePanel.hasAttribute('aria-busy')) return;
  const request = ++traceRequest;
  const item = traceItems[index];
  const width = matchMedia('(max-width: 700px)').matches ? 800 : 1600;
  tracePanel.setAttribute('aria-busy', 'true');
  traceStatus.textContent = 'Завантажуємо фото…';
  try {
    const image = new Image();
    image.src = tracePath(item, width);
    await image.decode();
    if (request !== traceRequest) return;
    tracePhoto.srcset = `${tracePath(item,800)} 800w, ${tracePath(item,1600)} ${item.width}w`;
    tracePhoto.src = tracePath(item,1600);
    tracePhoto.alt = item.alt;
    tracePhoto.width = item.width;
    tracePhoto.height = item.height;
    for (const key of ['location','kicker','title','description','observation']) {
      const el = document.querySelector(`#trace-${key}`);
      if (el) el.textContent = item[key];
    }
    document.querySelector('#trace-counter').textContent = `${String(index+1).padStart(2,'0')} / 03`;
    traceTabs.forEach((tab,i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
    });
    tracePanel.setAttribute('aria-labelledby', traceTabs[index].id);
    activeTrace = index;
    traceStatus.textContent = '';
    triggerHaptic(8);
    const panelTop = tracePanel.getBoundingClientRect().top;
    if (panelTop < 40 || panelTop > window.innerHeight * .65) {
      tracePanel.scrollIntoView({ block:'nearest', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    }
  } catch {
    if (request === traceRequest) traceStatus.textContent = 'Фото не завантажилося. Спробуйте обрати його ще раз.';
  } finally {
    if (request === traceRequest) tracePanel.removeAttribute('aria-busy');
  }
}

let traceTouchStartX = 0;
let traceTouchStartY = 0;
if (tracePanel) {
  tracePanel.addEventListener('touchstart', e => {
    traceTouchStartX = e.changedTouches[0].clientX;
    traceTouchStartY = e.changedTouches[0].clientY;
  }, { passive: true });

  tracePanel.addEventListener('touchend', e => {
    const diffX = e.changedTouches[0].clientX - traceTouchStartX;
    const diffY = e.changedTouches[0].clientY - traceTouchStartY;
    if (Math.abs(diffX) > 45 && Math.abs(diffX) > Math.abs(diffY) * 1.3) {
      if (diffX < 0) {
        selectTrace((activeTrace + 1) % traceTabs.length);
      } else {
        selectTrace((activeTrace - 1 + traceTabs.length) % traceTabs.length);
      }
    }
  }, { passive: true });
}

traceTabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTrace(index));
  tab.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % traceTabs.length;
    if (event.key === 'ArrowLeft') next = (index + traceTabs.length - 1) % traceTabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = traceTabs.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    traceTabs[next].focus();
    selectTrace(next);
  });
});

const traceDialog = document.querySelector('#trace-dialog');
let originalOverflow = '';
document.querySelector('#trace-zoom').addEventListener('click', () => {
  const item = traceItems[activeTrace];
  document.querySelector('#trace-dialog-image').src = tracePath(item, 1600);
  document.querySelector('#trace-dialog-image').alt = item.alt;
  document.querySelector('#trace-dialog-caption').textContent = `${item.location}. Матеріали надані для проєкту. Підготовка: масштабування та WebP.`;
  originalOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  traceDialog.showModal();
});
document.querySelector('#trace-dialog-close').addEventListener('click', () => traceDialog.close());
traceDialog.addEventListener('click', event => { if (event.target === traceDialog) traceDialog.close(); });
traceDialog.addEventListener('close', () => { document.body.style.overflow = originalOverflow; });
