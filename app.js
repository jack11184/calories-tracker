// ── File System helpers (IndexedDB stores the file handle between sessions) ────

let fileHandle = null; // the FileSystemFileHandle for database.json
let dbData     = null; // in-memory mirror of the file
let writeTimer = null; // debounce timer for file writes

const HANDLE_STORE = 'calTracker_handle';

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('calTrackerDB', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('handles');
    req.onsuccess  = e => resolve(e.target.result);
    req.onerror    = e => reject(e.target.error);
  });
}

async function saveHandleToIDB(handle) {
  try {
    const db = await openIDB();
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(handle, HANDLE_STORE);
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = e => rej(e.target.error); });
  } catch { /* non-fatal */ }
}

async function loadHandleFromIDB() {
  try {
    const db  = await openIDB();
    const tx  = db.transaction('handles', 'readonly');
    const req = tx.objectStore('handles').get(HANDLE_STORE);
    return await new Promise((res, rej) => { req.onsuccess = e => res(e.target.result); req.onerror = e => rej(e.target.error); });
  } catch { return null; }
}

// ── Read / write the JSON file ────────────────────────────────────────────────

const BLANK_DB = () => ({
  activeProfile: 'Me',
  usdaApiKey: null,
  profiles: {
    Me: { goal: 2000, days: {}, planStats: null },
  },
});

async function readFromFile() {
  const file = await fileHandle.getFile();
  const text = await file.text();
  try {
    dbData = JSON.parse(text);
    if (!dbData.profiles)      dbData.profiles = {};
    if (!dbData.activeProfile) dbData.activeProfile = Object.keys(dbData.profiles)[0] || 'Me';
    if (!dbData.profiles[dbData.activeProfile]) {
      dbData.profiles[dbData.activeProfile] = { goal: 2000, days: {}, planStats: null };
    }
  } catch {
    dbData = BLANK_DB();
  }
}

async function writeToFile() {
  if (!fileHandle) return;
  try {
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(dbData, null, 2));
    await writable.close();
  } catch (err) {
    console.error('File write error:', err);
  }
}

function scheduleWrite() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(writeToFile, 250);
}

// ── Database overlay UI ───────────────────────────────────────────────────────

function showOverlay() {
  document.getElementById('db-overlay').style.display = 'flex';
  document.getElementById('app').classList.add('hidden');
}

function hideOverlay() {
  document.getElementById('db-overlay').style.display = 'none';
  document.getElementById('app').classList.remove('hidden');
}

function setDbError(msg) {
  document.getElementById('db-error').textContent = msg;
}

async function tryRestoreSavedHandle() {
  const handle = await loadHandleFromIDB();
  if (!handle) return false;

  const perm = await handle.queryPermission({ mode: 'readwrite' });
  if (perm === 'granted') {
    fileHandle = handle;
    await readFromFile();
    return true;
  }
  if (perm === 'prompt') {
    // Show one-click "continue with" button
    document.getElementById('db-filename').textContent = handle.name;
    document.getElementById('db-restore').classList.remove('hidden');
    document.getElementById('db-restore-btn').onclick = async () => {
      const granted = await handle.requestPermission({ mode: 'readwrite' });
      if (granted === 'granted') {
        fileHandle = handle;
        await readFromFile();
        await saveHandleToIDB(handle);
        hideOverlay();
        initApp();
      } else {
        setDbError('Permission denied — please open the file manually.');
      }
    };
  }
  return false;
}

async function pickExistingFile() {
  try {
    [fileHandle] = await window.showOpenFilePicker({
      types: [{ description: 'JSON Database', accept: { 'application/json': ['.json'] } }],
      multiple: false,
    });
    await readFromFile();
    await saveHandleToIDB(fileHandle);
    hideOverlay();
    initApp();
  } catch (err) {
    if (err.name !== 'AbortError') setDbError('Could not open file. Please try again.');
  }
}

async function createNewFile() {
  try {
    fileHandle = await window.showSaveFilePicker({
      suggestedName: 'calories-database.json',
      types: [{ description: 'JSON Database', accept: { 'application/json': ['.json'] } }],
    });
    // Start fresh, but migrate old localStorage data if present
    const oldRaw = localStorage.getItem('calorieTracker');
    if (oldRaw) {
      try {
        const old = JSON.parse(oldRaw);
        dbData = {
          activeProfile: 'Me',
          profiles: { Me: { goal: old.goal || 2000, days: old.days || {}, planStats: old.planStats || null } },
        };
      } catch { dbData = BLANK_DB(); }
    } else {
      dbData = BLANK_DB();
    }
    await writeToFile();
    await saveHandleToIDB(fileHandle);
    hideOverlay();
    initApp();
  } catch (err) {
    if (err.name !== 'AbortError') setDbError('Could not create file. Please try again.');
  }
}

function initOverlay() {
  if (!window.showOpenFilePicker) {
    // Browser doesn't support File System Access API
    document.querySelector('.db-actions').innerHTML = `
      <p style="color:#fc8181;font-size:0.9rem">
        This feature requires <strong>Chrome</strong> or <strong>Edge</strong>.<br>
        Please open the app in one of those browsers.
      </p>`;
    return;
  }
  document.getElementById('db-open-btn').addEventListener('click',   pickExistingFile);
  document.getElementById('db-create-btn').addEventListener('click', createNewFile);
}

// ── Profile management ────────────────────────────────────────────────────────

function getProfileNames()    { return Object.keys(dbData.profiles); }
function getActiveProfile()   { return dbData.activeProfile; }

function setActiveProfile(name) {
  dbData.activeProfile = name;
  scheduleWrite();
}

// ── Data layer ────────────────────────────────────────────────────────────────

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function loadData() {
  return dbData.profiles[getActiveProfile()] || { goal: 2000, days: {} };
}

function saveData(profileData) {
  dbData.profiles[getActiveProfile()] = profileData;
  scheduleWrite();
}

function getTodayEntries() {
  return loadData().days[getToday()] || [];
}

// ── Profile bar UI ────────────────────────────────────────────────────────────

function renderProfileBar() {
  const names  = getProfileNames();
  const active = getActiveProfile();
  const bar    = document.getElementById('profile-bar');
  bar.innerHTML = '';

  names.forEach(name => {
    const tab = document.createElement('div');
    tab.className = 'profile-tab' + (name === active ? ' active' : '');

    const nameSpan = document.createElement('span');
    nameSpan.textContent = name;
    tab.appendChild(nameSpan);

    if (names.length > 1) {
      const del = document.createElement('button');
      del.className = 'profile-del';
      del.textContent = '×';
      del.title = `Delete "${name}"`;
      del.addEventListener('click', e => { e.stopPropagation(); deleteProfile(name); });
      tab.appendChild(del);
    }

    tab.addEventListener('click', () => switchProfile(name));
    bar.appendChild(tab);
  });

  const addBtn = document.createElement('button');
  addBtn.className = 'profile-add';
  addBtn.textContent = '+';
  addBtn.title = 'Add profile';
  addBtn.addEventListener('click', addProfile);
  bar.appendChild(addBtn);
}

function switchProfile(name) {
  setActiveProfile(name);
  renderProfileBar();
  renderAll();
}

function addProfile() {
  const name = window.prompt('Name for new profile:')?.trim();
  if (!name) return;
  if (dbData.profiles[name]) { alert(`"${name}" already exists.`); return; }
  dbData.profiles[name] = { goal: 2000, days: {}, planStats: null };
  switchProfile(name);
}

function deleteProfile(name) {
  const names = getProfileNames();
  if (names.length <= 1) return;
  if (!confirm(`Delete profile "${name}" and all its data? This cannot be undone.`)) return;
  const idx = names.indexOf(name);
  delete dbData.profiles[name];
  const remaining = getProfileNames();
  const newActive = remaining[Math.min(idx, remaining.length - 1)];
  scheduleWrite();
  switchProfile(newActive);
}

// ── Goal & progress bar ───────────────────────────────────────────────────────

function setGoal() {
  const input = document.getElementById('goal-input');
  const val   = parseInt(input.value, 10);
  if (!val || val < 1) return;
  const data = loadData();
  data.goal  = val;
  saveData(data);
  renderProgress();
}

function renderProgress() {
  const data    = loadData();
  const entries = getTodayEntries();
  const total   = entries.reduce((sum, e) => sum + e.calories, 0);
  const goal    = data.goal || 2000;
  const pct     = Math.min((total / goal) * 100, 100);

  const fill = document.getElementById('progress-bar-fill');
  fill.style.width = pct + '%';
  fill.className = '';
  if (pct >= 100) fill.classList.add('over');
  else if (pct >= 85) fill.classList.add('near');

  document.getElementById('progress-label').textContent =
    `${total.toLocaleString()} / ${goal.toLocaleString()} kcal`;

  const goalInput = document.getElementById('goal-input');
  if (!goalInput.matches(':focus')) goalInput.value = goal;
}

// ── Local food database (always-available fallback) ───────────────────────────

const LOCAL_DB = [
  { name: 'Chicken breast, cooked',        kcalPer100g: 165 },
  { name: 'Chicken thigh, cooked',         kcalPer100g: 209 },
  { name: 'Chicken drumstick, cooked',     kcalPer100g: 172 },
  { name: 'Chicken wings, cooked',         kcalPer100g: 290 },
  { name: 'Ground beef, 80% lean, cooked', kcalPer100g: 254 },
  { name: 'Ground beef, 93% lean, cooked', kcalPer100g: 218 },
  { name: 'Steak, sirloin, cooked',        kcalPer100g: 207 },
  { name: 'Steak, ribeye, cooked',         kcalPer100g: 291 },
  { name: 'Pork chop, cooked',             kcalPer100g: 231 },
  { name: 'Bacon, cooked',                 kcalPer100g: 541 },
  { name: 'Ham, cooked',                   kcalPer100g: 163 },
  { name: 'Salmon, cooked',                kcalPer100g: 208 },
  { name: 'Tuna, canned in water',         kcalPer100g: 116 },
  { name: 'Shrimp, cooked',               kcalPer100g: 99  },
  { name: 'Tilapia, cooked',              kcalPer100g: 128 },
  { name: 'Egg, whole, cooked',            kcalPer100g: 155 },
  { name: 'Egg white, cooked',             kcalPer100g: 52  },
  { name: 'White rice, cooked',            kcalPer100g: 130 },
  { name: 'Brown rice, cooked',            kcalPer100g: 112 },
  { name: 'Pasta, cooked',                 kcalPer100g: 158 },
  { name: 'Oatmeal, cooked',               kcalPer100g: 71  },
  { name: 'Bread, white',                  kcalPer100g: 265 },
  { name: 'Bread, whole wheat',            kcalPer100g: 247 },
  { name: 'Bagel, plain',                  kcalPer100g: 270 },
  { name: 'Tortilla, flour',               kcalPer100g: 312 },
  { name: 'Potato, baked',                 kcalPer100g: 93  },
  { name: 'Sweet potato, baked',           kcalPer100g: 90  },
  { name: 'French fries',                  kcalPer100g: 312 },
  { name: 'Broccoli, raw',                 kcalPer100g: 34  },
  { name: 'Spinach, raw',                  kcalPer100g: 23  },
  { name: 'Lettuce, romaine, raw',         kcalPer100g: 17  },
  { name: 'Carrot, raw',                   kcalPer100g: 41  },
  { name: 'Tomato, raw',                   kcalPer100g: 18  },
  { name: 'Cucumber, raw',                 kcalPer100g: 15  },
  { name: 'Bell pepper, raw',              kcalPer100g: 31  },
  { name: 'Onion, raw',                    kcalPer100g: 40  },
  { name: 'Corn, cooked',                  kcalPer100g: 96  },
  { name: 'Black beans, cooked',           kcalPer100g: 132 },
  { name: 'Lentils, cooked',               kcalPer100g: 116 },
  { name: 'Apple',                          kcalPer100g: 52  },
  { name: 'Banana',                         kcalPer100g: 89  },
  { name: 'Orange',                         kcalPer100g: 47  },
  { name: 'Strawberries',                   kcalPer100g: 32  },
  { name: 'Blueberries',                    kcalPer100g: 57  },
  { name: 'Grapes',                         kcalPer100g: 69  },
  { name: 'Watermelon',                     kcalPer100g: 30  },
  { name: 'Mango',                          kcalPer100g: 60  },
  { name: 'Milk, whole',                    kcalPer100g: 61  },
  { name: 'Milk, 2%',                       kcalPer100g: 50  },
  { name: 'Milk, skim',                     kcalPer100g: 34  },
  { name: 'Greek yogurt, plain, nonfat',    kcalPer100g: 59  },
  { name: 'Cottage cheese, 2%',             kcalPer100g: 90  },
  { name: 'Cheese, cheddar',               kcalPer100g: 402 },
  { name: 'Cheese, mozzarella',            kcalPer100g: 280 },
  { name: 'Cheese, parmesan',              kcalPer100g: 431 },
  { name: 'Butter',                         kcalPer100g: 717 },
  { name: 'Olive oil',                      kcalPer100g: 884 },
  { name: 'Almonds',                        kcalPer100g: 579 },
  { name: 'Walnuts',                        kcalPer100g: 654 },
  { name: 'Cashews',                        kcalPer100g: 553 },
  { name: 'Peanut butter',                  kcalPer100g: 588 },
  { name: 'Avocado',                        kcalPer100g: 160 },
  { name: 'Hummus',                         kcalPer100g: 166 },
  { name: 'Pizza, cheese, frozen',          kcalPer100g: 266 },
  { name: 'Hamburger with bun',             kcalPer100g: 275 },
  { name: 'Hot dog with bun',              kcalPer100g: 290 },
  { name: 'Dark chocolate, 70%',           kcalPer100g: 604 },
  { name: 'Whey protein powder',           kcalPer100g: 375 },
  { name: 'Orange juice',                   kcalPer100g: 45  },
  { name: 'Apple juice',                    kcalPer100g: 46  },
  { name: 'Whole milk latte',              kcalPer100g: 54  },
  { name: 'Soda, cola',                    kcalPer100g: 42  },
].map(f => ({ ...f, brand: 'Built-in' }));

function searchLocalDB(query) {
  const q = query.toLowerCase();
  return LOCAL_DB.filter(f => f.name.toLowerCase().includes(q)).slice(0, 10);
}

// ── Online food search (USDA + Open Food Facts in parallel) ──────────────────

async function fetchDirect(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

async function fetchJSON(url, timeoutMs) {
  try {
    return await fetchDirect(url, timeoutMs);
  } catch (err) {
    // Rate limited — proxy won't help, the API itself is rejecting us
    if (err.message === 'HTTP 429') throw err;
    // Otherwise retry through CORS proxy (fixes file:// origin issues)
    console.warn(`Direct fetch failed (${err.message}) — retrying via proxy`);
    return await fetchDirect(`https://corsproxy.io/?${encodeURIComponent(url)}`, 9000);
  }
}

async function searchUSDA(query) {
  const params = new URLSearchParams({
    query, dataType: 'SR Legacy,Survey (FNDDS),Branded', pageSize: 10, api_key: dbData.usdaApiKey || 'DEMO_KEY',
  });
  try {
    const json = await fetchJSON(`https://api.nal.usda.gov/fdc/v1/foods/search?${params}`, 7000);
    return (json.foods || [])
      .map(f => {
        const n = f.foodNutrients?.find(n => n.nutrientName === 'Energy' && n.unitName?.toLowerCase() === 'kcal');
        return n?.value > 0 ? { name: f.description?.trim(), brand: f.brandOwner?.trim() || f.brandName?.trim() || '', kcalPer100g: Math.round(n.value) } : null;
      })
      .filter(Boolean);
  } catch (err) {
    console.error('USDA failed:', err.message);
    throw err;
  }
}

async function searchOpenFoodFacts(query) {
  const params = new URLSearchParams({
    action: 'process', search_terms: query, search_simple: 1, json: 1, page_size: 10,
    fields: 'product_name,brands,nutriments',
  });
  try {
    const json = await fetchJSON(`https://world.openfoodfacts.org/cgi/search.pl?${params}`, 10000);
    return (json.products || [])
      .map(p => {
        const kcal = p.nutriments?.['energy-kcal_100g'] ?? p.nutriments?.['energy-kcal'];
        return kcal > 0 && p.product_name?.trim()
          ? { name: p.product_name.trim(), brand: p.brands?.split(',')[0]?.trim() || '', kcalPer100g: Math.round(kcal) }
          : null;
      })
      .filter(Boolean);
  } catch (err) {
    console.error('Open Food Facts failed:', err.message);
    throw err;
  }
}

let searchCount = 0;

function setSearchStatus(dbName, isFallback) {
  const el = document.getElementById('search-status');
  el.innerHTML = `Search #${searchCount} · <span class="status-db${isFallback ? ' fallback' : ''}">${dbName}</span>`;
}

async function searchFood() {
  const query = document.getElementById('search-input').value.trim();
  if (!query) return;

  searchCount++;
  const resultsList = document.getElementById('search-results');
  document.getElementById('search-status').textContent = '';
  resultsList.innerHTML = '<li style="color:#a0aec0;font-style:italic">Searching…</li>';

  // Race both APIs in parallel — take whichever responds first
  const winner = await Promise.any([
    searchUSDA(query).then(r => ({ results: r, source: 'USDA FoodData Central', fallback: false })),
    searchOpenFoodFacts(query).then(r => ({ results: r, source: 'Open Food Facts', fallback: true })),
  ]).catch(() => null);

  if (winner) {
    setSearchStatus(winner.source, winner.fallback);
    displaySearchResults(winner.results);
    return;
  }

  // Both APIs failed — use built-in local database
  const local = searchLocalDB(query);
  setSearchStatus('Built-in database', true);
  displaySearchResults(local);
}

function displaySearchResults(results) {
  const list = document.getElementById('search-results');
  list.innerHTML = '';

  if (!results.length) {
    list.innerHTML = '<li style="color:#a0aec0;font-style:italic">No results found.</li>';
    return;
  }

  results.forEach(({ name, brand, kcalPer100g }) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="result-info">
        <div class="result-name">${escapeHtml(name)}</div>
        <div class="result-meta">${escapeHtml(brand)} · ${kcalPer100g} kcal / 100g</div>
      </div>
      <button class="add-result-btn">Add</button>
    `;
    li.querySelector('button').addEventListener('click', () => addFoodFromSearch(name, kcalPer100g));
    list.appendChild(li);
  });
}

function addFoodFromSearch(name, kcalPer100g) {
  const gramsStr = window.prompt(
    `How many grams of "${name}" did you eat?\n(${kcalPer100g} kcal per 100g)`
  );
  if (gramsStr === null) return;
  const grams = parseFloat(gramsStr);
  if (!grams || grams <= 0) { alert('Please enter a valid number of grams.'); return; }
  addEntry(`${name} (${grams}g)`, Math.round((grams / 100) * kcalPer100g));
  document.getElementById('search-results').innerHTML = '';
  document.getElementById('search-input').value = '';
}

// ── Log management ────────────────────────────────────────────────────────────

function addEntry(name, calories) {
  const now  = new Date();
  const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  const data  = loadData();
  const today = getToday();
  if (!data.days[today]) data.days[today] = [];
  data.days[today].push({ id: Date.now(), time, name, calories });
  saveData(data);
  renderLog(); renderProgress(); renderHistory(); renderChart();
}

function addManualEntry() {
  const nameInput = document.getElementById('manual-name');
  const calInput  = document.getElementById('manual-calories');
  const errEl     = document.getElementById('manual-error');
  errEl.textContent = '';

  const name     = nameInput.value.trim();
  const calories = parseInt(calInput.value, 10);

  if (!name)                    { errEl.textContent = 'Please enter a food name.'; return; }
  if (!calories || calories < 1) { errEl.textContent = 'Please enter a valid calorie amount.'; return; }

  addEntry(name, calories);
  nameInput.value = '';
  calInput.value  = '';
}

function deleteEntry(id) {
  const data  = loadData();
  const today = getToday();
  if (data.days[today]) {
    data.days[today] = data.days[today].filter(e => e.id !== id);
    if (!data.days[today].length) delete data.days[today];
  }
  saveData(data);
  renderLog(); renderProgress(); renderHistory(); renderChart();
}

function renderLog() {
  const entries = getTodayEntries();
  const tbody   = document.getElementById('log-body');
  tbody.innerHTML = '';

  if (!entries.length) {
    tbody.innerHTML = '<tr class="placeholder-row"><td colspan="4">No meals logged yet.</td></tr>';
    document.getElementById('daily-total').textContent = 'Total: 0 kcal';
    return;
  }

  entries.forEach(entry => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="col-time">${escapeHtml(entry.time)}</td>
      <td>${escapeHtml(entry.name)}</td>
      <td class="col-kcal">${entry.calories.toLocaleString()}</td>
      <td class="col-del"><button class="delete-btn" title="Remove">×</button></td>
    `;
    tr.querySelector('.delete-btn').addEventListener('click', () => deleteEntry(entry.id));
    tbody.appendChild(tr);
  });

  const total = entries.reduce((sum, e) => sum + e.calories, 0);
  document.getElementById('daily-total').textContent = `Total: ${total.toLocaleString()} kcal`;
}

// ── History & chart ───────────────────────────────────────────────────────────

let chartInstance = null;

function getLast7Days() {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

function formatDate(isoStr) {
  const [y, m, d] = isoStr.split('-');
  return new Date(+y, +m - 1, +d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function renderHistory() {
  const data = loadData();
  const goal = data.goal || 2000;
  const list = document.getElementById('history-list');
  list.innerHTML = '';

  [...getLast7Days()].reverse().forEach(dateKey => {
    const entries = data.days[dateKey] || [];
    if (!entries.length) return;
    const total  = entries.reduce((sum, e) => sum + e.calories, 0);
    const isOver = total > goal;
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="hist-date">${formatDate(dateKey)}</span>
      <span class="hist-kcal">${total.toLocaleString()} kcal</span>
      <span class="hist-badge ${isOver ? 'over' : 'under'}">${isOver ? 'Over' : 'Under'}</span>
    `;
    list.appendChild(li);
  });

  if (!list.children.length) {
    list.innerHTML = '<li style="color:#a0aec0;font-style:italic;padding:12px 0">No history yet — start logging meals!</li>';
  }
}

function renderChart() {
  const data = loadData();
  const days = getLast7Days();
  const goal = data.goal || 2000;
  const labels       = days.map(formatDate);
  const caloriesData = days.map(d => (data.days[d] || []).reduce((s, e) => s + e.calories, 0));
  const goalData     = days.map(() => goal);

  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

  chartInstance = new Chart(document.getElementById('history-chart'), {
    data: {
      labels,
      datasets: [
        {
          type: 'bar', label: 'Calories', data: caloriesData,
          backgroundColor: 'rgba(102,126,234,0.7)', borderColor: 'rgba(102,126,234,1)',
          borderWidth: 1, borderRadius: 4,
        },
        {
          type: 'line', label: 'Goal', data: goalData,
          borderColor: '#fc8181', borderDash: [6, 4], borderWidth: 2,
          pointRadius: 0, fill: false, tension: 0,
        },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: 'index' },
      plugins: {
        legend: { position: 'top' },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y.toLocaleString()} kcal` } },
      },
      scales: {
        y: { beginAtZero: true, ticks: { callback: val => `${val.toLocaleString()} kcal` } },
      },
    },
  });
}

// ── Cutting & Bulking Plans ───────────────────────────────────────────────────

let selectedSex = 'male';

function initPlanSection() {
  document.querySelectorAll('#plan-section .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#plan-section .seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedSex = btn.dataset.val;
    });
  });
  document.getElementById('calc-plan-btn').addEventListener('click', calculatePlan);
}

function restorePlanSection() {
  selectedSex = 'male';
  document.querySelectorAll('#plan-section .seg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.val === 'male');
  });
  document.getElementById('plan-age').value       = '';
  document.getElementById('plan-height-ft').value = '';
  document.getElementById('plan-height-in').value = '';
  document.getElementById('plan-weight').value    = '';
  document.getElementById('plan-activity').value  = '1.55';
  document.getElementById('plan-error').textContent = '';
  document.getElementById('plan-results').classList.add('hidden');

  const s = loadData().planStats;
  if (!s) return;
  if (s.sex) {
    selectedSex = s.sex;
    document.querySelectorAll('#plan-section .seg-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.val === s.sex);
    });
  }
  if (s.age)            document.getElementById('plan-age').value       = s.age;
  if (s.ft)             document.getElementById('plan-height-ft').value = s.ft;
  if (s.inches != null) document.getElementById('plan-height-in').value = s.inches;
  if (s.lbs)            document.getElementById('plan-weight').value    = s.lbs;
  if (s.activity)       document.getElementById('plan-activity').value  = s.activity;
  calculatePlan();
}

function calculatePlan() {
  const age      = parseInt(document.getElementById('plan-age').value, 10);
  const ft       = parseInt(document.getElementById('plan-height-ft').value, 10);
  const inches   = parseInt(document.getElementById('plan-height-in').value, 10) || 0;
  const lbs      = parseFloat(document.getElementById('plan-weight').value);
  const activity = parseFloat(document.getElementById('plan-activity').value);
  const errEl    = document.getElementById('plan-error');

  if (!age || age < 10 || age > 120)              { errEl.textContent = 'Enter a valid age (10–120).'; return; }
  if (!ft || ft < 1 || inches < 0 || inches > 11) { errEl.textContent = 'Enter a valid height (e.g. 5 ft 10 in).'; return; }
  if (!lbs || lbs < 1)                            { errEl.textContent = 'Enter a valid weight in lbs.'; return; }
  errEl.textContent = '';

  const heightCm = (ft * 12 + inches) * 2.54;
  const weightKg = lbs * 0.453592;
  const bmr      = selectedSex === 'male'
    ? 10 * weightKg + 6.25 * heightCm - 5 * age + 5
    : 10 * weightKg + 6.25 * heightCm - 5 * age - 161;
  const tdee     = Math.round(bmr * activity);
  const cutKcal  = Math.max(tdee - 500, 1200);
  const bulkKcal = tdee + 300;

  const data = loadData();
  data.planStats = { sex: selectedSex, age, ft, inches, lbs, activity };
  saveData(data);

  document.getElementById('tdee-value').textContent  = tdee.toLocaleString();
  document.getElementById('cut-kcal').textContent    = `${cutKcal.toLocaleString()} kcal/day`;
  document.getElementById('cut-detail').textContent  = cutKcal === 1200
    ? '1,200 kcal minimum — consult a doctor' : '−500 kcal deficit · ~0.5 kg/week loss';
  document.getElementById('bulk-kcal').textContent   = `${bulkKcal.toLocaleString()} kcal/day`;
  document.getElementById('bulk-detail').textContent = '+300 kcal surplus · ~0.3 kg/week gain';
  document.getElementById('cut-apply-btn').onclick   = () => applyPlanGoal(cutKcal,  'cut');
  document.getElementById('bulk-apply-btn').onclick  = () => applyPlanGoal(bulkKcal, 'bulk');
  document.getElementById('plan-results').classList.remove('hidden');
}

function applyPlanGoal(calories, type) {
  const data = loadData();
  data.goal  = calories;
  saveData(data);
  renderProgress();
  const btn = document.getElementById(type + '-apply-btn');
  btn.textContent = 'Goal Applied!';
  btn.disabled = true;
  setTimeout(() => { btn.textContent = 'Apply Goal'; btn.disabled = false; }, 1500);
  document.getElementById('goal-section').scrollIntoView({ behavior: 'smooth' });
}

// ── Render all (used when switching profiles) ─────────────────────────────────

function renderAll() {
  restorePlanSection();
  renderLog();
  renderProgress();
  renderHistory();
  renderChart();
  document.getElementById('search-results').innerHTML = '';
  document.getElementById('search-input').value = '';
}

// ── Utility ───────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── API key settings ──────────────────────────────────────────────────────────

function initApiKeySection() {
  const toggle   = document.getElementById('api-key-toggle');
  const form     = document.getElementById('api-key-form');
  const input    = document.getElementById('api-key-input');
  const saveBtn  = document.getElementById('api-key-save-btn');

  function updateToggleLabel() {
    toggle.textContent = dbData.usdaApiKey ? '⚙ USDA API Key ✓' : '⚙ USDA API Key';
    toggle.style.color = dbData.usdaApiKey ? '#48bb78' : '';
  }
  updateToggleLabel();

  toggle.addEventListener('click', () => {
    const hidden = form.classList.toggle('hidden');
    if (!hidden && dbData.usdaApiKey) input.value = dbData.usdaApiKey;
  });

  saveBtn.addEventListener('click', () => {
    const key = input.value.trim();
    dbData.usdaApiKey = key || null;
    scheduleWrite();
    updateToggleLabel();
    form.classList.add('hidden');
    input.value = '';
  });
}

// ── App init (called after database file is loaded) ───────────────────────────

function initApp() {
  document.getElementById('current-date').textContent =
    new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

  document.getElementById('set-goal-btn').addEventListener('click', setGoal);
  document.getElementById('goal-input').addEventListener('keydown', e => { if (e.key === 'Enter') setGoal(); });
  document.getElementById('search-btn').addEventListener('click', searchFood);
  document.getElementById('search-input').addEventListener('keydown', e => { if (e.key === 'Enter') searchFood(); });
  document.getElementById('add-manual-btn').addEventListener('click', addManualEntry);
  document.getElementById('manual-calories').addEventListener('keydown', e => { if (e.key === 'Enter') addManualEntry(); });

  initPlanSection();
  initApiKeySection();
  renderProfileBar();
  renderAll();
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

window.addEventListener('load', async () => {
  initOverlay();
  showOverlay();

  // Try to restore the previously used file handle
  const restored = await tryRestoreSavedHandle();
  if (restored) {
    hideOverlay();
    initApp();
  }
});
