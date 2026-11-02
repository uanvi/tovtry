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
let lastCaption = -1;
let lastPosition = null;

const clamp = (n, low = 0, high = 1) => Math.max(low, Math.min(high, n));
const smooth = (start, end, value) => { const t = clamp((value - start) / (end - start)); return t * t * (3 - 2 * t); };
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
    loadingStatus.textContent = 'Частина кадрів недоступна. Історію можна читати нижче.';
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
      // Keep compressed WebP blobs, but only ten decoded images in memory.
      while (decoded.size > 10) {
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
      try { await fetchFrame(index); } catch { /* The poster and readable story remain available. */ }
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
    canvas.dataset.position = position.toFixed(2);
  } else {
    if (first || second) { drawImage(first || second); canvas.classList.add('ready'); }
    Promise.allSettled([getDecoded(lo), getDecoded(hi)]).then(results => {
      if (motionOff) return;
      if (results.some(result => result.status === 'fulfilled') && Math.abs(latestFrame - position) < 1) {
        // Draw the latest requested position, never a stale frame after fast scrolling.
        const image = decoded.get(Math.floor(latestFrame)) || decoded.get(Math.min(count - 1, Math.ceil(latestFrame)));
        if (image) {
          drawImage(image);
          const upper = decoded.get(Math.ceil(latestFrame));
          if (decoded.has(Math.floor(latestFrame)) && upper && latestFrame % 1) drawImage(upper, latestFrame % 1);
          context.globalAlpha = 1;
          canvas.classList.add('ready');
          canvas.dataset.frame = String(Math.round(latestFrame) + 1);
          canvas.dataset.position = latestFrame.toFixed(2);
        }
      }
    });
  }
}

function update() {
  raf = 0;
  if (motionOff) return;
  const distance = Math.max(1, journey.offsetHeight - stage.offsetHeight);
  const progress = clamp(-journey.getBoundingClientRect().top / distance);
  const frameProgress = clamp((progress - .12) / .71);
  latestFrame = frameProgress * (count - 1);
  document.querySelector('#era-progress').style.width = `${frameProgress * 100}%`;
  document.querySelector('#era').textContent = frameProgress < .02 ? 'Сьогодні' : frameProgress > .98 ? 'Давнє море' : 'Крізь час';
  const heroOpacity = 1 - smooth(.015, .145, progress);
  heroCopy.style.opacity = heroOpacity;
  heroCopy.style.transform = `translateY(${-35 * (1 - heroOpacity)}px)`;
  heroCopy.style.pointerEvents = heroOpacity < .01 ? 'none' : 'auto';
  document.querySelector('.journey-start').tabIndex = heroOpacity < .01 ? -1 : 0;
  const caption = progress < .42 ? 0 : progress < .67 ? 1 : 2;
  if (caption !== lastCaption) {
    [sceneLabel.textContent, sceneTitle.innerHTML, sceneDescription.textContent] = captions[caption];
    lastCaption = caption;
  }
  const captionStart = caption === 0 ? .15 : caption === 1 ? .42 : .67;
  const captionEnd = caption === 0 ? .42 : caption === 1 ? .67 : 1.08;
  const opacity = smooth(captionStart, captionStart + .045, progress) * (1 - smooth(captionEnd - .045, captionEnd, progress));
  sceneCopy.style.opacity = opacity;
  sceneCopy.style.transform = `translateY(${16 * (1 - opacity)}px)`;
  if (lastPosition !== latestFrame) { paint(latestFrame); lastPosition = latestFrame; }
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
comparisonRange.addEventListener('input', () => {
  comparison.style.setProperty('--split', `${comparisonRange.value}%`);
  comparisonRange.setAttribute('aria-valuetext', `${comparisonRange.value}% сучасного пейзажу`);
});
window.addEventListener('scroll', schedule, { passive: true });
window.addEventListener('pageshow', schedule);
new ResizeObserver(resize).observe(visual);
setMotion(motionOff);

// Read the landscape: independent of animation, available in static mode too.
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
    const panel = document.querySelector('#landmark-panel');
    if (panel.getBoundingClientRect().bottom > window.innerHeight - 80) {
      panel.scrollIntoView({ block: 'nearest', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    }
  });
}

// A compact table of contents appears once visitors enter the story.
const dock = document.querySelector('.chapter-dock');
const chapterLinks = [...dock.querySelectorAll('[data-chapter]')];
const chapterSections = chapterLinks.map(link => document.getElementById(link.dataset.chapter));
let dockFrame = 0;
function updateDock() {
  dockFrame = 0;
  dock.hidden = window.scrollY < window.innerHeight * .65 || document.querySelector('#about').getBoundingClientRect().top < window.innerHeight * .6;
  let active = 0;
  chapterSections.forEach((section, index) => { if (section.getBoundingClientRect().top < window.innerHeight * .5) active = index; });
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

// Atlas of user-provided replacement images. Do not carry over original Commons attribution.
const traceItems = [
  {
    "id": "fossils",
    "file": "fossils.png",
    "location": "Морські мушлі у вапняку · ілюстративний матеріал",
    "author": "матеріали проєкту",
    "source": null,
    "license": null,
    "licenseUrl": null,
    "alt": "Світла порода з численними спіральними мушлями та стулками молюсків, ілюстративне зображення.",
    "kicker": "Морське життя → гірська порода",
    "title": "Мушля стає частиною каменю.",
    "description": "Рештки морських організмів можуть зберігатися в осадовій породі. Це зображення допомагає придивитися до форм мушель і уявити, як сліди життя стають частиною вапняку.",
    "observation": "Знайдіть спіральні мушлі та широкі ребристі стулки. Порівняйте їхні форми; масштабну лінійку на цьому зображенні не наведено.",
    "provenance": "Ілюстративний матеріал, наданий для проєкту. Точну географічну прив’язку й масштаб зображення не вказано.",
    "width": 1449,
    "height": 1086
  },
  {
    "id": "limestone",
    "file": "limestone.jpg",
    "location": "Відслонення породи · ілюстративний матеріал",
    "author": "матеріали проєкту",
    "source": null,
    "license": null,
    "licenseUrl": null,
    "alt": "Шарувата світла скеля з вертикальними тріщинами у теплому світлі, ілюстративне зображення.",
    "kicker": "Відслонення → будова породи",
    "title": "Камінь відкриває свою будову.",
    "description": "Природні відслонення дають змогу роздивитися будову породи. Тут добре помітні горизонтальні лінії та вертикальні тріщини — деталі, які губляться в загальному краєвиді.",
    "observation": "Простежте лінії шарів і вертикальні тріщини. Подивіться, як вони ділять скелю на окремі блоки.",
    "provenance": "Ілюстративний матеріал про будову породи. Конкретне місце зйомки й вік породи для цього зображення не підтверджено.",
    "width": 1536,
    "height": 1024
  },
  {
    "id": "tovtry",
    "file": "tovtry.png",
    "location": "Скелясті пагорби · ілюстративний пейзаж",
    "author": "матеріали проєкту",
    "source": null,
    "license": null,
    "licenseUrl": null,
    "alt": "Панорама скелястих пагорбів, трав’янистих схилів і полів у теплому світлі, ілюстративний пейзаж.",
    "kicker": "Рифові споруди → сучасний рельєф",
    "title": "Морська історія в силуеті пагорбів.",
    "description": "Товтри — залишки давніх рифових споруд. Їхні сучасні обриси змінювалися під дією вивітрювання та ерозії. Цей пейзаж ілюструє, як скелясті пагорби можуть вирізнятися серед навколишнього рельєфу.",
    "observation": "Порівняйте обриси відкритих скель із пологими полями вдалині. Знайдіть межу між каменем, трав’янистими схилами та рівниною.",
    "provenance": "Ілюстративний пейзаж, наданий для проєкту. Конкретну локацію для цього зображення не вказано.",
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
    for (const key of ['location','author','kicker','title','description','observation','provenance']) document.querySelector(`#trace-${key}`).textContent = item[key];
    document.querySelector('#trace-source').removeAttribute('href');
    document.querySelector('#trace-license').removeAttribute('href');
    document.querySelector('#trace-license').textContent = ''; document.querySelector('#trace-license').hidden = true;
    document.querySelector('#trace-index').textContent = String(index+1).padStart(2,'0');
    document.querySelector('#trace-counter').textContent = `${String(index+1).padStart(2,'0')} / 03`;
    traceTabs.forEach((tab,i) => { tab.setAttribute('aria-selected',String(i===index)); tab.tabIndex=i===index?0:-1; });
    tracePanel.setAttribute('aria-labelledby',traceTabs[index].id);
    activeTrace = index;
    traceStatus.textContent = '';
    const panelTop = tracePanel.getBoundingClientRect().top;
    if (panelTop < 100 || panelTop > window.innerHeight * .45) {
      tracePanel.scrollIntoView({ block:'start', behavior:reducedMotion.matches?'auto':'smooth' });
    }
  } catch {
    if (request === traceRequest) traceStatus.textContent = 'Фото не завантажилося. Спробуйте обрати його ще раз.';
  } finally { if(request===traceRequest) tracePanel.removeAttribute('aria-busy'); }
}
traceTabs.forEach((tab,index) => {
  tab.addEventListener('click',()=>selectTrace(index));
  tab.addEventListener('keydown',event=>{
    let next;
    if (event.key==='ArrowRight') next=(index+1)%traceTabs.length;
    if (event.key==='ArrowLeft') next=(index+traceTabs.length-1)%traceTabs.length;
    if (event.key==='Home') next=0;
    if (event.key==='End') next=traceTabs.length-1;
    if (next===undefined) return;
    event.preventDefault(); traceTabs[next].focus(); selectTrace(next);
  });
});
const traceDialog = document.querySelector('#trace-dialog');
let originalOverflow = '';
document.querySelector('#trace-zoom').addEventListener('click',()=>{
  const item=traceItems[activeTrace];
  document.querySelector('#trace-dialog-image').src=tracePath(item,1600);
  document.querySelector('#trace-dialog-image').alt=item.alt;
  document.querySelector('#trace-dialog-caption').textContent=`${item.location}. Матеріали надані для проєкту. Підготовка: масштабування та WebP.`;
  originalOverflow=document.body.style.overflow;
  document.body.style.overflow='hidden';
  traceDialog.showModal();
});
document.querySelector('#trace-dialog-close').addEventListener('click',()=>traceDialog.close());
traceDialog.addEventListener('click',event=>{if(event.target===traceDialog)traceDialog.close();});
traceDialog.addEventListener('close',()=>{document.body.style.overflow=originalOverflow;});
