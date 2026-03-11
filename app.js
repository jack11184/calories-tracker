// ── API layer ────────────────────────────────────────────────────────────────

const API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? `${location.protocol}//${location.hostname}:3000/api`
  : '/api';

let authToken = localStorage.getItem('ct_token');
let captchaToken = null;

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  if (res.status === 401) { logout(); throw new Error('Unauthorized'); }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ── State ────────────────────────────────────────────────────────────────────

let profiles = [];            // [{id, name, goal, protein_goal, carbs_goal, fat_goal, is_active}]
let activeProfile = null;     // the active profile object
let todayEntries = [];        // food entries for today
let usdaApiKey = null;
let barcodeSelectedFile = null;

// ── Auth UI ──────────────────────────────────────────────────────────────────

function showOverlay() {
  document.getElementById('db-overlay').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

function hideOverlay() {
  document.getElementById('db-overlay').style.display = 'none';
  document.getElementById('app').style.display = 'block';
}

function setDbError(msg) {
  document.getElementById('db-error').textContent = msg;
}

function initAuth() {
  const loginForm    = document.getElementById('auth-login-form');
  const registerForm = document.getElementById('auth-register-form');

  document.getElementById('auth-show-register').addEventListener('click', () => {
    loginForm.style.display = 'none';
    registerForm.style.display = 'block';
    setDbError('');
    fetchCaptcha();
  });

  document.getElementById('captcha-refresh-btn').addEventListener('click', fetchCaptcha);
  document.getElementById('auth-show-login').addEventListener('click', () => {
    registerForm.style.display = 'none';
    loginForm.style.display = 'block';
    setDbError('');
  });

  document.getElementById('auth-login-btn').addEventListener('click', doLogin);
  document.getElementById('auth-password').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

  document.getElementById('auth-register-btn').addEventListener('click', doRegister);
  document.getElementById('reg-password2').addEventListener('keydown', e => { if (e.key === 'Enter') doRegister(); });
}

async function doLogin() {
  setDbError('');
  const username = document.getElementById('auth-username').value.trim();
  const password = document.getElementById('auth-password').value;
  if (!username || !password) { setDbError('Please enter username and password.'); return; }

  try {
    const data = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }).then(r => r.json());

    if (data.error) { setDbError(data.error); return; }
    authToken = data.token;
    localStorage.setItem('ct_token', authToken);
    usdaApiKey = data.user.usda_api_key || null;
    hideOverlay();
    await loadAllData();
    initApp();
  } catch (err) {
    setDbError('Login failed. Check your connection.');
  }
}

async function fetchCaptcha() {
  try {
    const data = await fetch(`${API_BASE}/auth/captcha`).then(r => r.json());
    captchaToken = data.token;
    document.getElementById('captcha-img').src = data.image;
    document.getElementById('captcha-answer').value = '';
  } catch {
    // silently ignore — captcha will just be missing
  }
}

async function doRegister() {
  setDbError('');
  const username      = document.getElementById('reg-username').value.trim();
  const password      = document.getElementById('reg-password').value;
  const password2     = document.getElementById('reg-password2').value;
  const captchaAnswer = document.getElementById('captcha-answer').value.trim();

  if (!username || !password) { setDbError('Please fill in all fields.'); return; }
  if (password !== password2)  { setDbError('Passwords do not match.'); return; }
  if (password.length < 6)     { setDbError('Password must be at least 6 characters.'); return; }
  if (!captchaAnswer)          { setDbError('Please complete the CAPTCHA.'); return; }

  try {
    const data = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, captchaToken, captchaAnswer }),
    }).then(r => r.json());

    if (data.error) { setDbError(data.error); fetchCaptcha(); return; }
    authToken = data.token;
    localStorage.setItem('ct_token', authToken);
    hideOverlay();
    await loadAllData();
    initApp();
  } catch (err) {
    setDbError('Registration failed. Check your connection.');
  }
}

function logout() {
  stopBarcodeScan();
  authToken = null;
  localStorage.removeItem('ct_token');
  profiles = [];
  activeProfile = null;
  todayEntries = [];
  showOverlay();
}

async function tryAutoLogin() {
  if (!authToken) return false;
  try {
    const user = await api('/auth/me');
    usdaApiKey = user.usda_api_key || null;
    return true;
  } catch {
    authToken = null;
    localStorage.removeItem('ct_token');
    return false;
  }
}

// ── Data loading ─────────────────────────────────────────────────────────────

async function loadAllData() {
  profiles = await api('/profiles');
  activeProfile = profiles.find(p => p.is_active) || profiles[0];
  if (activeProfile) {
    await loadTodayEntries();
  }
}

async function loadTodayEntries() {
  if (!activeProfile) { todayEntries = []; return; }
  const date = getSelectedDate();
  todayEntries = await api(`/entries/${activeProfile.id}?date=${date}`);
}

// ── Profile management ───────────────────────────────────────────────────────

function getProfileNames()  { return profiles.map(p => p.name); }
function getActiveProfile() { return activeProfile?.name || 'Me'; }

async function setActiveProfile(name) {
  const p = profiles.find(pr => pr.name === name);
  if (!p) return;
  await api(`/profiles/${p.id}/activate`, { method: 'PUT' });
  profiles.forEach(pr => pr.is_active = pr.id === p.id);
  activeProfile = p;
}

// ── Data layer (compatibility helpers matching old API) ──────────────────────

function getToday() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getSelectedDate() {
  const input = document.getElementById('log-date-input');
  return input?.value || getToday();
}

function getTodayEntries() {
  return todayEntries;
}

// ── Profile bar UI ───────────────────────────────────────────────────────────

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
      del.textContent = '\u00d7';
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

async function switchProfile(name) {
  await setActiveProfile(name);
  await loadTodayEntries();
  renderProfileBar();
  renderAll();
}

async function addProfile() {
  const name = window.prompt('Name for new profile:')?.trim();
  if (!name) return;
  if (profiles.some(p => p.name === name)) { alert(`"${name}" already exists.`); return; }
  try {
    await api('/profiles', { method: 'POST', body: JSON.stringify({ name }) });
    await loadAllData();
    await switchProfile(name);
  } catch (err) {
    alert(err.message);
  }
}

async function deleteProfile(name) {
  if (profiles.length <= 1) return;
  if (!confirm(`Delete profile "${name}" and all its data? This cannot be undone.`)) return;
  const p = profiles.find(pr => pr.name === name);
  if (!p) return;
  try {
    await api(`/profiles/${p.id}`, { method: 'DELETE' });
    await loadAllData();
    renderProfileBar();
    renderAll();
  } catch (err) {
    alert(err.message);
  }
}

// ── Goal & progress bar ─────────────────────────────────────────────────────

async function setGoal() {
  const input = document.getElementById('goal-input');
  const val   = parseInt(input.value, 10);
  if (!val || val < 1) return;
  activeProfile.goal = val;
  await api(`/profiles/${activeProfile.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      goal: val,
      protein_goal: activeProfile.protein_goal,
      carbs_goal: activeProfile.carbs_goal,
      fat_goal: activeProfile.fat_goal,
    }),
  });
  renderProgress();
}

function renderProgress() {
  const entries = getTodayEntries();
  const total   = entries.reduce((sum, e) => sum + e.calories, 0);
  const goal    = activeProfile?.goal || 2000;
  const pct     = Math.min((total / goal) * 100, 100);

  const fill = document.getElementById('progress-bar-fill');
  fill.style.width = pct + '%';
  fill.className = '';
  if (pct >= 100) fill.classList.add('over');
  else if (pct >= 85) fill.classList.add('near');

  document.getElementById('progress-label').textContent =
    `${total.toLocaleString()} / ${goal.toLocaleString()} kcal`;

  const remaining    = goal - total;
  const consumedEl   = document.getElementById('kcal-consumed');
  const remainingEl  = document.getElementById('kcal-remaining');
  const remainLblEl  = document.getElementById('kcal-remaining-label');
  const remainStat   = document.getElementById('kcal-remaining-stat');
  if (consumedEl)  consumedEl.textContent  = total.toLocaleString();
  if (remainingEl) remainingEl.textContent = Math.abs(remaining).toLocaleString();
  if (remainLblEl) remainLblEl.textContent = remaining >= 0 ? 'remaining' : 'over goal';
  if (remainStat)  remainStat.classList.toggle('over', remaining < 0);

  const goalInput = document.getElementById('goal-input');
  if (goalInput && !goalInput.matches(':focus')) goalInput.value = goal;

  // Macro progress bars
  const mg = {
    protein: activeProfile?.protein_goal,
    carbs:   activeProfile?.carbs_goal,
    fat:     activeProfile?.fat_goal,
  };
  const macroTotals = {
    protein: Math.round(entries.reduce((s, e) => s + (parseFloat(e.protein) || 0), 0) * 10) / 10,
    carbs:   Math.round(entries.reduce((s, e) => s + (parseFloat(e.carbs)   || 0), 0) * 10) / 10,
    fat:     Math.round(entries.reduce((s, e) => s + (parseFloat(e.fat)     || 0), 0) * 10) / 10,
  };
  ['protein', 'carbs', 'fat'].forEach(macro => {
    const barEl   = document.getElementById(`${macro}-bar-fill`);
    const labelEl = document.getElementById(`${macro}-label`);
    if (!barEl) return;
    const goalVal  = mg[macro];
    const totalVal = macroTotals[macro];
    barEl.className = `macro-bar-fill ${macro}-bar`;
    if (goalVal) {
      const p = Math.min((totalVal / goalVal) * 100, 100);
      barEl.style.width = p + '%';
      if (p >= 100) barEl.classList.add('over');
      else if (p >= 85) barEl.classList.add('near');
      labelEl.textContent = `${totalVal}g / ${goalVal}g`;
    } else {
      barEl.style.width = '0%';
      labelEl.textContent = `${totalVal}g`;
    }
  });
}

function initMacroGoals() {
  document.getElementById('macro-save-btn').addEventListener('click', async () => {
    const p = parseFloat(document.getElementById('macro-protein-input').value);
    const c = parseFloat(document.getElementById('macro-carbs-input').value);
    const f = parseFloat(document.getElementById('macro-fat-input').value);
    activeProfile.protein_goal = isNaN(p) ? null : p;
    activeProfile.carbs_goal   = isNaN(c) ? null : c;
    activeProfile.fat_goal     = isNaN(f) ? null : f;
    await api(`/profiles/${activeProfile.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        goal: activeProfile.goal,
        protein_goal: activeProfile.protein_goal,
        carbs_goal: activeProfile.carbs_goal,
        fat_goal: activeProfile.fat_goal,
      }),
    });
    renderProgress();
    const btn = document.getElementById('macro-save-btn');
    btn.textContent = 'Saved!';
    setTimeout(() => { btn.textContent = 'Save'; }, 1500);
  });
}

function restoreMacroGoals() {
  const pi = document.getElementById('macro-protein-input');
  const ci = document.getElementById('macro-carbs-input');
  const fi = document.getElementById('macro-fat-input');
  if (pi && !pi.matches(':focus')) pi.value = activeProfile?.protein_goal ?? '';
  if (ci && !ci.matches(':focus')) ci.value = activeProfile?.carbs_goal   ?? '';
  if (fi && !fi.matches(':focus')) fi.value = activeProfile?.fat_goal     ?? '';
}

// ── Local food database (always-available fallback) ───────────────────────────

const LOCAL_DB = [
  // Poultry
  { name: 'Chicken breast, cooked',          kcalPer100g: 165 },
  { name: 'Chicken breast, raw',             kcalPer100g: 120 },
  { name: 'Chicken thigh, cooked',           kcalPer100g: 209 },
  { name: 'Chicken thigh, raw',              kcalPer100g: 177 },
  { name: 'Chicken drumstick, cooked',       kcalPer100g: 172 },
  { name: 'Chicken wings, cooked',           kcalPer100g: 290 },
  { name: 'Chicken nuggets',                 kcalPer100g: 296 },
  { name: 'Turkey breast, cooked',           kcalPer100g: 135 },
  { name: 'Turkey, ground, cooked',          kcalPer100g: 218 },
  { name: 'Turkey deli meat',                kcalPer100g: 104 },
  // Beef & Pork
  { name: 'Ground beef, 80% lean, cooked',   kcalPer100g: 254 },
  { name: 'Ground beef, 93% lean, cooked',   kcalPer100g: 218 },
  { name: 'Ground beef, 80% lean, raw',      kcalPer100g: 215 },
  { name: 'Steak, sirloin, cooked',          kcalPer100g: 207 },
  { name: 'Steak, ribeye, cooked',           kcalPer100g: 291 },
  { name: 'Steak, filet mignon, cooked',     kcalPer100g: 219 },
  { name: 'Steak, flank, cooked',            kcalPer100g: 192 },
  { name: 'Beef, brisket, cooked',           kcalPer100g: 235 },
  { name: 'Beef jerky',                      kcalPer100g: 410 },
  { name: 'Pork chop, cooked',               kcalPer100g: 231 },
  { name: 'Pork tenderloin, cooked',         kcalPer100g: 166 },
  { name: 'Pork ribs, cooked',               kcalPer100g: 292 },
  { name: 'Bacon, cooked',                   kcalPer100g: 541 },
  { name: 'Ham, cooked',                     kcalPer100g: 163 },
  { name: 'Sausage, pork, cooked',           kcalPer100g: 339 },
  { name: 'Sausage, Italian, cooked',        kcalPer100g: 323 },
  { name: 'Pepperoni',                       kcalPer100g: 494 },
  { name: 'Salami',                          kcalPer100g: 378 },
  { name: 'Lamb, cooked',                    kcalPer100g: 258 },
  { name: 'Bison, ground, cooked',           kcalPer100g: 188 },
  // Seafood
  { name: 'Salmon, cooked',                  kcalPer100g: 208 },
  { name: 'Salmon, raw',                     kcalPer100g: 142 },
  { name: 'Tuna, canned in water',           kcalPer100g: 116 },
  { name: 'Tuna, canned in oil',             kcalPer100g: 198 },
  { name: 'Tuna, fresh, cooked',             kcalPer100g: 184 },
  { name: 'Shrimp, cooked',                  kcalPer100g: 99  },
  { name: 'Tilapia, cooked',                 kcalPer100g: 128 },
  { name: 'Cod, cooked',                     kcalPer100g: 105 },
  { name: 'Halibut, cooked',                 kcalPer100g: 140 },
  { name: 'Mahi-mahi, cooked',               kcalPer100g: 109 },
  { name: 'Crab, cooked',                    kcalPer100g: 97  },
  { name: 'Lobster, cooked',                 kcalPer100g: 98  },
  { name: 'Scallops, cooked',                kcalPer100g: 111 },
  { name: 'Sardines, canned',                kcalPer100g: 208 },
  { name: 'Catfish, cooked',                 kcalPer100g: 144 },
  { name: 'Trout, cooked',                   kcalPer100g: 190 },
  // Eggs & Dairy
  { name: 'Egg, whole, cooked',              kcalPer100g: 155 },
  { name: 'Egg, whole, raw',                 kcalPer100g: 143 },
  { name: 'Egg white, cooked',               kcalPer100g: 52  },
  { name: 'Egg yolk',                        kcalPer100g: 322 },
  { name: 'Milk, whole',                     kcalPer100g: 61  },
  { name: 'Milk, 2%',                        kcalPer100g: 50  },
  { name: 'Milk, 1%',                        kcalPer100g: 42  },
  { name: 'Milk, skim',                      kcalPer100g: 34  },
  { name: 'Greek yogurt, plain, nonfat',     kcalPer100g: 59  },
  { name: 'Greek yogurt, plain, whole milk', kcalPer100g: 97  },
  { name: 'Yogurt, plain, low-fat',          kcalPer100g: 63  },
  { name: 'Cottage cheese, 2%',              kcalPer100g: 90  },
  { name: 'Cottage cheese, full fat',        kcalPer100g: 103 },
  { name: 'Cheese, cheddar',                 kcalPer100g: 402 },
  { name: 'Cheese, mozzarella',              kcalPer100g: 280 },
  { name: 'Cheese, parmesan',                kcalPer100g: 431 },
  { name: 'Cheese, swiss',                   kcalPer100g: 380 },
  { name: 'Cheese, feta',                    kcalPer100g: 264 },
  { name: 'Cheese, brie',                    kcalPer100g: 334 },
  { name: 'Cheese, american',                kcalPer100g: 371 },
  { name: 'Cream cheese',                    kcalPer100g: 342 },
  { name: 'Sour cream',                      kcalPer100g: 198 },
  { name: 'Heavy cream',                     kcalPer100g: 345 },
  { name: 'Butter',                          kcalPer100g: 717 },
  // Grains & Bread
  { name: 'White rice, cooked',              kcalPer100g: 130 },
  { name: 'Brown rice, cooked',              kcalPer100g: 112 },
  { name: 'Jasmine rice, cooked',            kcalPer100g: 129 },
  { name: 'Basmati rice, cooked',            kcalPer100g: 130 },
  { name: 'Quinoa, cooked',                  kcalPer100g: 120 },
  { name: 'Pasta, cooked',                   kcalPer100g: 158 },
  { name: 'Pasta, whole wheat, cooked',      kcalPer100g: 124 },
  { name: 'Oatmeal, cooked',                 kcalPer100g: 71  },
  { name: 'Oats, rolled, dry',               kcalPer100g: 389 },
  { name: 'Bread, white',                    kcalPer100g: 265 },
  { name: 'Bread, whole wheat',              kcalPer100g: 247 },
  { name: 'Bread, sourdough',                kcalPer100g: 274 },
  { name: 'Bread, rye',                      kcalPer100g: 259 },
  { name: 'Bread, multigrain',               kcalPer100g: 251 },
  { name: 'Bagel, plain',                    kcalPer100g: 270 },
  { name: 'English muffin',                  kcalPer100g: 227 },
  { name: 'Tortilla, flour',                 kcalPer100g: 312 },
  { name: 'Tortilla, corn',                  kcalPer100g: 218 },
  { name: 'Pita bread',                      kcalPer100g: 275 },
  { name: 'Naan bread',                      kcalPer100g: 317 },
  { name: 'Crackers, saltine',               kcalPer100g: 421 },
  { name: 'Cornflakes cereal',               kcalPer100g: 378 },
  { name: 'Granola',                         kcalPer100g: 471 },
  { name: 'Pancakes',                        kcalPer100g: 227 },
  { name: 'Waffles',                         kcalPer100g: 291 },
  { name: 'Muffin, blueberry',               kcalPer100g: 377 },
  { name: 'Croissant',                       kcalPer100g: 406 },
  // Vegetables
  { name: 'Broccoli, raw',                   kcalPer100g: 34  },
  { name: 'Broccoli, cooked',                kcalPer100g: 35  },
  { name: 'Spinach, raw',                    kcalPer100g: 23  },
  { name: 'Spinach, cooked',                 kcalPer100g: 23  },
  { name: 'Kale, raw',                       kcalPer100g: 49  },
  { name: 'Lettuce, romaine, raw',           kcalPer100g: 17  },
  { name: 'Cabbage, raw',                    kcalPer100g: 25  },
  { name: 'Carrot, raw',                     kcalPer100g: 41  },
  { name: 'Carrot, cooked',                  kcalPer100g: 35  },
  { name: 'Tomato, raw',                     kcalPer100g: 18  },
  { name: 'Cucumber, raw',                   kcalPer100g: 15  },
  { name: 'Bell pepper, raw',                kcalPer100g: 31  },
  { name: 'Onion, raw',                      kcalPer100g: 40  },
  { name: 'Garlic, raw',                     kcalPer100g: 149 },
  { name: 'Mushrooms, raw',                  kcalPer100g: 22  },
  { name: 'Mushrooms, cooked',               kcalPer100g: 28  },
  { name: 'Cauliflower, raw',                kcalPer100g: 25  },
  { name: 'Asparagus, cooked',               kcalPer100g: 22  },
  { name: 'Zucchini, raw',                   kcalPer100g: 17  },
  { name: 'Celery, raw',                     kcalPer100g: 14  },
  { name: 'Green beans, cooked',             kcalPer100g: 35  },
  { name: 'Peas, cooked',                    kcalPer100g: 84  },
  { name: 'Corn, cooked',                    kcalPer100g: 96  },
  { name: 'Brussels sprouts, cooked',        kcalPer100g: 36  },
  { name: 'Eggplant, cooked',                kcalPer100g: 33  },
  { name: 'Artichoke, cooked',               kcalPer100g: 53  },
  { name: 'Beets, cooked',                   kcalPer100g: 44  },
  { name: 'Bok choy, raw',                   kcalPer100g: 13  },
  { name: 'Arugula, raw',                    kcalPer100g: 25  },
  // Potatoes
  { name: 'Potato, baked',                   kcalPer100g: 93  },
  { name: 'Potato, boiled',                  kcalPer100g: 87  },
  { name: 'Sweet potato, baked',             kcalPer100g: 90  },
  { name: 'French fries',                    kcalPer100g: 312 },
  { name: 'Mashed potatoes',                 kcalPer100g: 113 },
  { name: 'Hash browns',                     kcalPer100g: 265 },
  // Fruits
  { name: 'Apple',                           kcalPer100g: 52  },
  { name: 'Banana',                          kcalPer100g: 89  },
  { name: 'Orange',                          kcalPer100g: 47  },
  { name: 'Strawberries',                    kcalPer100g: 32  },
  { name: 'Blueberries',                     kcalPer100g: 57  },
  { name: 'Raspberries',                     kcalPer100g: 52  },
  { name: 'Blackberries',                    kcalPer100g: 43  },
  { name: 'Grapes',                          kcalPer100g: 69  },
  { name: 'Watermelon',                      kcalPer100g: 30  },
  { name: 'Mango',                           kcalPer100g: 60  },
  { name: 'Pineapple',                       kcalPer100g: 50  },
  { name: 'Peach',                           kcalPer100g: 39  },
  { name: 'Pear',                            kcalPer100g: 57  },
  { name: 'Kiwi',                            kcalPer100g: 61  },
  { name: 'Cherries',                        kcalPer100g: 63  },
  { name: 'Plum',                            kcalPer100g: 46  },
  { name: 'Grapefruit',                      kcalPer100g: 42  },
  { name: 'Cantaloupe',                      kcalPer100g: 34  },
  { name: 'Papaya',                          kcalPer100g: 43  },
  { name: 'Pomegranate seeds',               kcalPer100g: 83  },
  { name: 'Avocado',                         kcalPer100g: 160 },
  { name: 'Dates',                           kcalPer100g: 282 },
  { name: 'Dried mango',                     kcalPer100g: 319 },
  { name: 'Raisins',                         kcalPer100g: 299 },
  // Legumes & Beans
  { name: 'Black beans, cooked',             kcalPer100g: 132 },
  { name: 'Lentils, cooked',                 kcalPer100g: 116 },
  { name: 'Chickpeas, cooked',               kcalPer100g: 164 },
  { name: 'Kidney beans, cooked',            kcalPer100g: 127 },
  { name: 'Pinto beans, cooked',             kcalPer100g: 143 },
  { name: 'White beans, cooked',             kcalPer100g: 139 },
  { name: 'Edamame, cooked',                 kcalPer100g: 121 },
  { name: 'Tofu, firm',                      kcalPer100g: 76  },
  { name: 'Tofu, silken',                    kcalPer100g: 55  },
  { name: 'Tempeh',                          kcalPer100g: 193 },
  // Nuts & Seeds
  { name: 'Almonds',                         kcalPer100g: 579 },
  { name: 'Walnuts',                         kcalPer100g: 654 },
  { name: 'Cashews',                         kcalPer100g: 553 },
  { name: 'Peanuts',                         kcalPer100g: 567 },
  { name: 'Pistachios',                      kcalPer100g: 562 },
  { name: 'Pecans',                          kcalPer100g: 691 },
  { name: 'Macadamia nuts',                  kcalPer100g: 718 },
  { name: 'Sunflower seeds',                 kcalPer100g: 584 },
  { name: 'Pumpkin seeds',                   kcalPer100g: 559 },
  { name: 'Chia seeds',                      kcalPer100g: 486 },
  { name: 'Flaxseeds',                       kcalPer100g: 534 },
  { name: 'Peanut butter',                   kcalPer100g: 588 },
  { name: 'Almond butter',                   kcalPer100g: 614 },
  { name: 'Hummus',                          kcalPer100g: 166 },
  // Oils, Fats & Condiments
  { name: 'Olive oil',                       kcalPer100g: 884 },
  { name: 'Vegetable oil',                   kcalPer100g: 884 },
  { name: 'Coconut oil',                     kcalPer100g: 862 },
  { name: 'Mayonnaise',                      kcalPer100g: 680 },
  { name: 'Ketchup',                         kcalPer100g: 112 },
  { name: 'Mustard, yellow',                 kcalPer100g: 66  },
  { name: 'Hot sauce',                       kcalPer100g: 18  },
  { name: 'Soy sauce',                       kcalPer100g: 53  },
  { name: 'Ranch dressing',                  kcalPer100g: 475 },
  { name: 'Caesar dressing',                 kcalPer100g: 363 },
  { name: 'Italian dressing',                kcalPer100g: 272 },
  { name: 'Honey',                           kcalPer100g: 304 },
  { name: 'Maple syrup',                     kcalPer100g: 260 },
  { name: 'BBQ sauce',                       kcalPer100g: 172 },
  { name: 'Salsa',                           kcalPer100g: 36  },
  { name: 'Guacamole',                       kcalPer100g: 157 },
  { name: 'Tomato sauce',                    kcalPer100g: 29  },
  { name: 'Sriracha',                        kcalPer100g: 93  },
  // Snacks
  { name: 'Potato chips',                    kcalPer100g: 536 },
  { name: 'Tortilla chips',                  kcalPer100g: 489 },
  { name: 'Pretzels',                        kcalPer100g: 381 },
  { name: 'Popcorn, air-popped',             kcalPer100g: 387 },
  { name: 'Popcorn, butter',                 kcalPer100g: 424 },
  { name: 'Rice cakes',                      kcalPer100g: 387 },
  { name: 'Granola bar',                     kcalPer100g: 471 },
  { name: 'Trail mix',                       kcalPer100g: 462 },
  { name: 'Doritos, nacho cheese',           kcalPer100g: 490 },
  { name: 'Cheetos, crunchy',                kcalPer100g: 547 },
  { name: 'Fritos corn chips',               kcalPer100g: 540 },
  { name: 'Pringles, original',              kcalPer100g: 536 },
  { name: 'Cheez-It crackers',               kcalPer100g: 521 },
  { name: 'Goldfish crackers',               kcalPer100g: 414 },
  { name: 'Ritz crackers',                   kcalPer100g: 493 },
  { name: 'Triscuit crackers',               kcalPer100g: 400 },
  { name: 'Oreo cookies',                    kcalPer100g: 471 },
  { name: 'Chips Ahoy cookies',              kcalPer100g: 480 },
  { name: 'Nutter Butter cookies',           kcalPer100g: 487 },
  { name: 'Fig Newtons',                     kcalPer100g: 374 },
  { name: 'Pop-Tart, frosted strawberry',    kcalPer100g: 392 },
  { name: 'Rice Krispies Treat',             kcalPer100g: 410 },
  { name: 'Nature Valley granola bar',       kcalPer100g: 452 },
  { name: 'Cliff Bar, chocolate chip',       kcalPer100g: 410 },
  { name: 'KIND bar, dark chocolate nuts',   kcalPer100g: 450 },
  { name: 'RXBAR, chocolate sea salt',       kcalPer100g: 364 },
  { name: 'Fruit snacks, gummies',           kcalPer100g: 338 },
  { name: 'Slim Jim, original',              kcalPer100g: 430 },
  { name: 'String cheese, mozzarella',       kcalPer100g: 250 },
  { name: 'Babybel cheese round',            kcalPer100g: 306 },
  { name: 'Sunflower seeds, roasted',        kcalPer100g: 582 },
  { name: 'Beef jerky, peppered',            kcalPer100g: 388 },
  { name: 'White cheddar popcorn',           kcalPer100g: 490 },
  { name: 'Veggie straws',                   kcalPer100g: 510 },
  { name: 'Pork rinds',                      kcalPer100g: 544 },
  // Fast Food & Prepared
  { name: 'Pizza, cheese',                   kcalPer100g: 266 },
  { name: 'Pizza, pepperoni',                kcalPer100g: 297 },
  { name: 'Hamburger with bun',              kcalPer100g: 275 },
  { name: 'Cheeseburger with bun',           kcalPer100g: 295 },
  { name: 'Hot dog with bun',                kcalPer100g: 290 },
  { name: 'Chicken sandwich',                kcalPer100g: 250 },
  { name: 'Burrito, bean and cheese',        kcalPer100g: 188 },
  { name: 'Taco, beef',                      kcalPer100g: 218 },
  { name: 'Macaroni and cheese',             kcalPer100g: 164 },
  { name: 'Lasagna',                         kcalPer100g: 166 },
  { name: 'Fried rice',                      kcalPer100g: 163 },
  { name: 'Pad thai',                        kcalPer100g: 150 },
  { name: 'Sushi roll, California',          kcalPer100g: 170 },
  { name: 'Falafel',                         kcalPer100g: 333 },
  { name: 'Gyro, beef and lamb',             kcalPer100g: 192 },
  { name: 'Soup, chicken noodle',            kcalPer100g: 46  },
  { name: 'Soup, tomato',                    kcalPer100g: 66  },
  { name: 'Soup, lentil',                    kcalPer100g: 93  },
  { name: 'Buffalo wings',                   kcalPer100g: 271 },
  { name: 'Nachos with cheese',              kcalPer100g: 306 },
  { name: 'Quesadilla, cheese',              kcalPer100g: 280 },
  { name: "McDonald's Big Mac",              kcalPer100g: 251 },
  { name: "McDonald's Quarter Pounder w/ Cheese", kcalPer100g: 257 },
  { name: "McDonald's Egg McMuffin",         kcalPer100g: 230 },
  { name: "McDonald's McNuggets, 10 piece",  kcalPer100g: 272 },
  { name: "McDonald's French Fries, medium", kcalPer100g: 274 },
  { name: "McDonald's McFlurry, Oreo",       kcalPer100g: 203 },
  { name: "Chick-fil-A Chicken Sandwich",    kcalPer100g: 207 },
  { name: "Chick-fil-A Nuggets, 8 piece",    kcalPer100g: 230 },
  { name: "Chick-fil-A Waffle Fries, medium",kcalPer100g: 288 },
  { name: "Burger King Whopper",             kcalPer100g: 244 },
  { name: "Subway Turkey Breast, 6-inch",    kcalPer100g: 185 },
  { name: "Subway Meatball Marinara, 6-inch",kcalPer100g: 236 },
  { name: "Chipotle Burrito Bowl, chicken",  kcalPer100g: 140 },
  { name: "Chipotle Burrito, chicken",       kcalPer100g: 190 },
  { name: "Taco Bell Crunchwrap Supreme",    kcalPer100g: 222 },
  { name: "Taco Bell Chalupa Supreme",       kcalPer100g: 241 },
  { name: "Wendy's Frosty, chocolate",       kcalPer100g: 125 },
  { name: "Wendy's Baconator",               kcalPer100g: 283 },
  { name: "Panda Express Orange Chicken",    kcalPer100g: 212 },
  { name: "Panda Express Fried Rice",        kcalPer100g: 170 },
  { name: "Domino's pepperoni pizza, slice", kcalPer100g: 266 },
  { name: 'Chili, beef',                     kcalPer100g: 128 },
  { name: 'Beef stew',                       kcalPer100g: 104 },
  { name: 'Clam chowder, New England',       kcalPer100g: 89  },
  // Sweets & Desserts
  { name: 'Dark chocolate, 70%',             kcalPer100g: 604 },
  { name: 'Milk chocolate',                  kcalPer100g: 535 },
  { name: 'Ice cream, vanilla',              kcalPer100g: 207 },
  { name: 'Ice cream, chocolate',            kcalPer100g: 216 },
  { name: 'Cookie, chocolate chip',          kcalPer100g: 502 },
  { name: 'Brownie',                         kcalPer100g: 466 },
  { name: 'Cake, chocolate',                 kcalPer100g: 352 },
  { name: 'Cheesecake',                      kcalPer100g: 321 },
  { name: 'Donut, glazed',                   kcalPer100g: 452 },
  { name: 'Candy bar, Snickers',             kcalPer100g: 488 },
  { name: 'Gummy bears',                     kcalPer100g: 343 },
  { name: 'M&Ms, plain',                     kcalPer100g: 501 },
  { name: 'M&Ms, peanut',                    kcalPer100g: 516 },
  { name: "Reese's Peanut Butter Cups",      kcalPer100g: 515 },
  { name: 'Twix bar',                        kcalPer100g: 498 },
  { name: 'Kit Kat bar',                     kcalPer100g: 518 },
  { name: 'Milky Way bar',                   kcalPer100g: 444 },
  { name: "Hershey's milk chocolate bar",    kcalPer100g: 535 },
  { name: 'Skittles',                        kcalPer100g: 398 },
  { name: 'Starburst candies',               kcalPer100g: 401 },
  { name: 'Sour Patch Kids',                 kcalPer100g: 373 },
  { name: 'Jolly Ranchers',                  kcalPer100g: 394 },
  { name: 'Swedish Fish',                    kcalPer100g: 348 },
  { name: 'Nerds candy',                     kcalPer100g: 380 },
  { name: 'Laffy Taffy',                     kcalPer100g: 380 },
  { name: 'Airheads candy',                  kcalPer100g: 390 },
  { name: 'Peach rings, gummy',              kcalPer100g: 350 },
  { name: 'Gummy worms',                     kcalPer100g: 340 },
  { name: 'Peanut brittle',                  kcalPer100g: 454 },
  { name: 'Fudge, chocolate',               kcalPer100g: 411 },
  { name: 'Cake, vanilla',                   kcalPer100g: 344 },
  { name: 'Cake, carrot',                    kcalPer100g: 369 },
  { name: 'Cupcake, chocolate frosted',      kcalPer100g: 394 },
  { name: 'Mochi ice cream',                 kcalPer100g: 214 },
  { name: 'Cinnamon roll',                   kcalPer100g: 379 },
  // Beverages
  { name: 'Orange juice',                    kcalPer100g: 45  },
  { name: 'Apple juice',                     kcalPer100g: 46  },
  { name: 'Grape juice',                     kcalPer100g: 60  },
  { name: 'Whole milk latte',                kcalPer100g: 54  },
  { name: 'Coffee, black',                   kcalPer100g: 2   },
  { name: 'Coffee, with cream and sugar',    kcalPer100g: 30  },
  { name: 'Soda, cola',                      kcalPer100g: 42  },
  { name: 'Soda, diet',                      kcalPer100g: 0   },
  { name: 'Sports drink, Gatorade',          kcalPer100g: 26  },
  { name: 'Energy drink, Red Bull',          kcalPer100g: 46  },
  { name: 'Beer, regular',                   kcalPer100g: 43  },
  { name: 'Wine, red',                       kcalPer100g: 85  },
  { name: 'Wine, white',                     kcalPer100g: 82  },
  { name: 'Smoothie, fruit',                 kcalPer100g: 60  },
  { name: 'Protein shake, mixed',            kcalPer100g: 65  },
  { name: 'Monster Energy drink',            kcalPer100g: 44  },
  { name: 'Celsius energy drink',            kcalPer100g: 3   },
  { name: 'Arizona Iced Tea',                kcalPer100g: 17  },
  { name: 'Snapple, peach iced tea',         kcalPer100g: 18  },
  { name: 'Coconut water',                   kcalPer100g: 19  },
  { name: 'Kombucha',                        kcalPer100g: 25  },
  { name: 'Almond milk, unsweetened',        kcalPer100g: 15  },
  { name: 'Almond milk, sweetened',          kcalPer100g: 24  },
  { name: 'Oat milk',                        kcalPer100g: 45  },
  { name: 'Soy milk',                        kcalPer100g: 54  },
  { name: 'Chocolate milk',                  kcalPer100g: 83  },
  { name: 'Hot chocolate',                   kcalPer100g: 72  },
  { name: 'Starbucks Frappuccino, caramel',  kcalPer100g: 91  },
  { name: 'Starbucks Caramel Macchiato',     kcalPer100g: 53  },
  { name: 'Starbucks Pumpkin Spice Latte',   kcalPer100g: 80  },
  { name: 'Chai latte, whole milk',          kcalPer100g: 67  },
  { name: 'Sparkling water',                 kcalPer100g: 0   },
  { name: 'Lemonade',                        kcalPer100g: 40  },
  { name: 'Sweet tea',                       kcalPer100g: 38  },
  { name: 'Iced coffee, black',              kcalPer100g: 2   },
  { name: 'Iced coffee, sweetened',          kcalPer100g: 36  },
  { name: 'Espresso',                        kcalPer100g: 9   },
  { name: 'Cappuccino, whole milk',          kcalPer100g: 40  },
  { name: 'Hot tea, unsweetened',            kcalPer100g: 1   },
  { name: 'Cranberry juice cocktail',        kcalPer100g: 52  },
  { name: 'Pineapple juice',                 kcalPer100g: 53  },
  { name: 'Tomato juice',                    kcalPer100g: 17  },
  { name: 'Soda, lemon-lime (Sprite)',       kcalPer100g: 38  },
  { name: 'Soda, orange (Fanta)',            kcalPer100g: 48  },
  { name: 'Soda, root beer',                 kcalPer100g: 44  },
  { name: 'Hard seltzer (White Claw)',       kcalPer100g: 25  },
  { name: 'Vodka',                           kcalPer100g: 231 },
  { name: 'Whiskey/Bourbon',                 kcalPer100g: 250 },
  { name: 'Tequila',                         kcalPer100g: 231 },
  // Protein Supplements
  { name: 'Whey protein powder',             kcalPer100g: 375 },
  { name: 'Casein protein powder',           kcalPer100g: 370 },
  { name: 'Plant protein powder',            kcalPer100g: 360 },
  { name: 'Mass gainer powder',              kcalPer100g: 390 },
  // Breakfast Foods
  { name: 'French toast',                    kcalPer100g: 229 },
  { name: 'Breakfast burrito',               kcalPer100g: 180 },
  { name: 'Eggs Benedict',                   kcalPer100g: 179 },
  { name: 'Avocado toast',                   kcalPer100g: 175 },
  { name: 'Yogurt parfait',                  kcalPer100g: 95  },
  { name: 'Acai bowl',                       kcalPer100g: 98  },
  { name: 'Smoothie bowl',                   kcalPer100g: 100 },
  { name: 'Bagel with cream cheese',         kcalPer100g: 295 },
  { name: 'Biscuit, buttermilk',             kcalPer100g: 358 },
  { name: 'Biscuit with sausage gravy',      kcalPer100g: 210 },
  { name: 'Grits, cooked',                   kcalPer100g: 65  },
  { name: 'Cream of Wheat, cooked',          kcalPer100g: 57  },
  { name: 'Hash brown casserole',            kcalPer100g: 175 },
  // Breakfast Cereals
  { name: 'Cheerios cereal',                 kcalPer100g: 371 },
  { name: 'Honey Nut Cheerios cereal',       kcalPer100g: 375 },
  { name: 'Frosted Flakes cereal',           kcalPer100g: 376 },
  { name: 'Lucky Charms cereal',             kcalPer100g: 382 },
  { name: 'Cinnamon Toast Crunch cereal',    kcalPer100g: 397 },
  { name: 'Raisin Bran cereal',              kcalPer100g: 342 },
  { name: 'Froot Loops cereal',              kcalPer100g: 380 },
  { name: "Cap'n Crunch cereal",             kcalPer100g: 400 },
  { name: 'Special K cereal',                kcalPer100g: 358 },
  { name: 'Life cereal',                     kcalPer100g: 386 },
  { name: 'Grape Nuts cereal',               kcalPer100g: 371 },
  { name: 'Frosted Mini-Wheats cereal',      kcalPer100g: 354 },
  { name: 'Cocoa Puffs cereal',              kcalPer100g: 386 },
  { name: "Reese's Puffs cereal",            kcalPer100g: 400 },
  { name: 'Kashi Go cereal',                 kcalPer100g: 357 },
  { name: 'Fiber One cereal',                kcalPer100g: 344 },
  // Sandwiches & Wraps
  { name: 'BLT sandwich',                    kcalPer100g: 240 },
  { name: 'Turkey sandwich',                 kcalPer100g: 175 },
  { name: 'Grilled cheese sandwich',         kcalPer100g: 320 },
  { name: 'PB&J sandwich',                   kcalPer100g: 310 },
  { name: 'Tuna salad sandwich',             kcalPer100g: 200 },
  { name: 'Club sandwich',                   kcalPer100g: 228 },
  { name: 'Egg salad sandwich',              kcalPer100g: 215 },
  { name: 'Chicken Caesar wrap',             kcalPer100g: 185 },
  { name: 'Panini, ham and cheese',          kcalPer100g: 250 },
  { name: 'Roast beef sandwich',             kcalPer100g: 210 },
  { name: 'Meatball sub',                    kcalPer100g: 236 },
  // International Dishes
  { name: 'Ramen, instant noodles, dry',     kcalPer100g: 437 },
  { name: 'Ramen, prepared with broth',      kcalPer100g: 70  },
  { name: "General Tso's chicken",           kcalPer100g: 190 },
  { name: 'Orange chicken (takeout)',         kcalPer100g: 212 },
  { name: 'Dumplings, steamed',              kcalPer100g: 180 },
  { name: 'Spring rolls, fried',             kcalPer100g: 220 },
  { name: 'Pho, beef broth with noodles',    kcalPer100g: 50  },
  { name: 'Bibimbap',                        kcalPer100g: 130 },
  { name: 'Shawarma, chicken',               kcalPer100g: 195 },
  { name: 'Chicken tikka masala',            kcalPer100g: 140 },
  { name: 'Butter chicken',                  kcalPer100g: 135 },
  { name: 'Baklava',                         kcalPer100g: 428 },
  { name: 'Fish and chips',                  kcalPer100g: 250 },
  { name: 'Kimchi',                          kcalPer100g: 15  },
  { name: 'Miso soup',                       kcalPer100g: 24  },
  { name: 'Sushi roll, spicy tuna',          kcalPer100g: 175 },
  { name: 'Sushi roll, salmon avocado',      kcalPer100g: 180 },
  { name: 'Congee (rice porridge)',          kcalPer100g: 47  },
  { name: 'Chow mein, chicken',              kcalPer100g: 126 },
  { name: 'Beef and broccoli (takeout)',      kcalPer100g: 105 },
  { name: 'Lo mein, vegetable',              kcalPer100g: 145 },
  { name: 'Chicken fried rice',              kcalPer100g: 170 },
  { name: 'Egg rolls, fried',                kcalPer100g: 227 },
  { name: 'Soba noodles, cooked',            kcalPer100g: 99  },
  { name: 'Udon noodles, cooked',            kcalPer100g: 96  },
  // Deli & Packaged Meats
  { name: 'Bologna lunchmeat',               kcalPer100g: 310 },
  { name: 'Roast beef, deli sliced',         kcalPer100g: 152 },
  { name: 'Chicken breast, deli sliced',     kcalPer100g: 89  },
  { name: 'Spam, classic',                   kcalPer100g: 296 },
  { name: 'Corned beef hash, canned',        kcalPer100g: 161 },
  { name: 'Rotisserie chicken',              kcalPer100g: 165 },
  { name: 'Chicken salad (with mayo)',       kcalPer100g: 186 },
  { name: 'Tuna salad (with mayo)',          kcalPer100g: 187 },
  // Sides & Extras
  { name: 'Coleslaw',                        kcalPer100g: 152 },
  { name: 'Potato salad',                    kcalPer100g: 143 },
  { name: 'Macaroni salad',                  kcalPer100g: 175 },
  { name: 'Caesar salad (with dressing)',    kcalPer100g: 90  },
  { name: 'Garden salad (plain)',            kcalPer100g: 20  },
  { name: 'Stuffing, bread',                 kcalPer100g: 175 },
  { name: 'Cornbread',                       kcalPer100g: 337 },
  { name: 'Dinner roll',                     kcalPer100g: 296 },
  { name: 'Garlic bread',                    kcalPer100g: 350 },
  { name: 'Onion rings, fried',              kcalPer100g: 311 },
  { name: 'Mozzarella sticks, fried',        kcalPer100g: 298 },
  { name: 'Jalape\u00f1o poppers',                kcalPer100g: 267 },
  { name: 'Spinach artichoke dip',           kcalPer100g: 180 },
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
    if (err.message === 'HTTP 429') throw err;
    console.warn(`Direct fetch failed (${err.message}) \u2014 retrying via proxy`);
    return await fetchDirect(`https://corsproxy.io/?${encodeURIComponent(url)}`, 9000);
  }
}

async function searchUSDA(query) {
  const params = new URLSearchParams({
    query, dataType: 'SR Legacy,Survey (FNDDS),Branded', pageSize: 10, api_key: usdaApiKey || 'DEMO_KEY',
  });
  try {
    const json = await fetchJSON(`https://api.nal.usda.gov/fdc/v1/foods/search?${params}`, 7000);
    return (json.foods || [])
      .map(f => {
        const ns      = f.foodNutrients || [];
        const kcalN   = ns.find(n => n.nutrientName === 'Energy' && n.unitName?.toLowerCase() === 'kcal');
        if (!(kcalN?.value > 0)) return null;
        const proteinN = ns.find(n => n.nutrientName === 'Protein');
        const carbsN   = ns.find(n => n.nutrientName === 'Carbohydrate, by difference');
        const fatN     = ns.find(n => n.nutrientName === 'Total lipid (fat)');
        const round1 = v => v != null ? Math.round(v * 10) / 10 : null;
        return {
          name:        f.description?.trim(),
          brand:       f.brandOwner?.trim() || f.brandName?.trim() || '',
          kcalPer100g: Math.round(kcalN.value),
          protein:     round1(proteinN?.value),
          carbs:       round1(carbsN?.value),
          fat:         round1(fatN?.value),
        };
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
        if (!(kcal > 0) || !p.product_name?.trim()) return null;
        const round1 = v => v != null ? Math.round(v * 10) / 10 : null;
        return {
          name:        p.product_name.trim(),
          brand:       p.brands?.split(',')[0]?.trim() || '',
          kcalPer100g: Math.round(kcal),
          protein:     round1(p.nutriments?.['proteins_100g']),
          carbs:       round1(p.nutriments?.['carbohydrates_100g']),
          fat:         round1(p.nutriments?.['fat_100g']),
        };
      })
      .filter(Boolean);
  } catch (err) {
    console.error('Open Food Facts failed:', err.message);
    throw err;
  }
}

function sanitizeBarcode(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function setBarcodeStatus(msg, isError = false) {
  const el = document.getElementById('barcode-status');
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = isError ? '#c53030' : '#718096';
}

async function lookupBarcode(barcode) {
  if (!activeProfile) return;
  const clean = sanitizeBarcode(barcode);
  if (!clean || clean.length < 8 || clean.length > 14) {
    setBarcodeStatus('Enter a valid UPC/EAN code (8-14 digits).', true);
    return;
  }

  setBarcodeStatus(`Looking up barcode ${clean}...`);
  try {
    const data = await api(`/foods/${activeProfile.id}/barcode/${clean}`);
    const food = data.food;
    setBarcodeStatus(`Found: ${food.name}`);
    setSearchStatus(`${data.source} (Barcode)`, true);
    displaySearchResults([food]);
  } catch (err) {
    setBarcodeStatus(err.message || 'Barcode lookup failed.', true);
    document.getElementById('search-results').innerHTML =
      '<li style="color:#a0aec0;font-style:italic">No product found for that barcode.</li>';
  }
}

function stopBarcodeScan() {
  barcodeSelectedFile = null;
  const previewWrap = document.getElementById('barcode-preview-wrap');
  const previewImg  = document.getElementById('barcode-preview-img');
  if (previewWrap) previewWrap.classList.add('hidden');
  if (previewImg) {
    if (previewImg.src?.startsWith('blob:')) URL.revokeObjectURL(previewImg.src);
    previewImg.src = '';
  }
}

async function handleBarcodePhoto() {
  const file = barcodeSelectedFile;
  if (!file) return;

  const ZXingLib = window.ZXing || window.ZXingBrowser;
  if (!ZXingLib?.BrowserMultiFormatReader) {
    setBarcodeStatus('Scanner library not loaded. Hard-refresh the page and try again.', true);
    return;
  }

  setBarcodeStatus('Reading barcode from photo...');
  const url = URL.createObjectURL(file);

  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload  = () => resolve(el);
      el.onerror = () => reject(new Error('Image failed to load'));
      el.src = url;
    });

    const reader = new ZXingLib.BrowserMultiFormatReader();
    const result = typeof reader.decodeFromImageElement === 'function'
      ? await reader.decodeFromImageElement(img)
      : await reader.decode(img);

    const value = sanitizeBarcode(result.getText());
    if (!value) {
      setBarcodeStatus('Barcode decoded but contained no numbers. Try again.', true);
      return;
    }

    document.getElementById('barcode-input').value = value;
    setBarcodeStatus(`\u2713 Barcode found: ${value}`);
    stopBarcodeScan();
    await lookupBarcode(value);
  } catch (err) {
    const msg = String(err?.message || '').toLowerCase();
    if (msg.includes('no multiformat') || msg.includes('not found') || msg.includes('no barcode')) {
      setBarcodeStatus('No barcode detected in this photo. Make sure the barcode is clear and try again.', true);
    } else {
      setBarcodeStatus(`Scan error: ${err?.message || 'unknown'}. Try another photo or enter the UPC manually.`, true);
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

function initBarcodeSection() {
  const lookupBtn  = document.getElementById('barcode-lookup-btn');
  const input      = document.getElementById('barcode-input');
  const photoInput = document.getElementById('barcode-photo-input');
  const confirmBtn = document.getElementById('barcode-confirm-btn');

  lookupBtn.addEventListener('click', () => lookupBarcode(input.value));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') lookupBarcode(input.value);
  });

  photoInput?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (!file) return;
    barcodeSelectedFile = file;

    const previewWrap = document.getElementById('barcode-preview-wrap');
    const previewImg  = document.getElementById('barcode-preview-img');
    if (previewImg.src?.startsWith('blob:')) URL.revokeObjectURL(previewImg.src);
    previewImg.src = URL.createObjectURL(file);
    previewWrap.classList.remove('hidden');
    setBarcodeStatus('Photo selected \u2014 tap "Scan Barcode" to continue.');
    e.target.value = '';
  });

  confirmBtn?.addEventListener('click', handleBarcodePhoto);
}


let searchCount = 0;

function setSearchStatus(dbName, isFallback) {
  const el = document.getElementById('search-status');
  el.innerHTML = `Search #${searchCount} \u00b7 <span class="status-db${isFallback ? ' fallback' : ''}">${dbName}</span>`;
}

async function searchFood() {
  const query = document.getElementById('search-input').value.trim();
  if (!query) return;

  searchCount++;
  const resultsList = document.getElementById('search-results');
  document.getElementById('search-status').textContent = '';
  resultsList.innerHTML = '<li style="color:#a0aec0;font-style:italic">Searching\u2026</li>';

  // Fast path: use backend unified search so users get one ranked result list.
  try {
    const data = await api(`/foods/${activeProfile.id}/search?q=${encodeURIComponent(query)}`);
    if (data?.results?.length) {
      setSearchStatus(data.source || 'Cloud search', false);
      displaySearchResults(data.results);
      return;
    }
  } catch {
    // Fall back to legacy client-side providers below.
  }

  const winner = await Promise.any([
    searchUSDA(query).then(r => ({ results: r, source: 'USDA FoodData Central', fallback: false })),
    searchOpenFoodFacts(query).then(r => ({ results: r, source: 'Open Food Facts', fallback: true })),
  ]).catch(() => null);

  if (winner) {
    setSearchStatus(winner.source, winner.fallback);
    displaySearchResults(winner.results);
    return;
  }

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

  results.forEach(food => {
    const { name, brand, kcalPer100g, protein, carbs, fat } = food;
    const isFav     = cachedFavorites.some(f => f.name === name);
    const hasMacros = protein != null || carbs != null || fat != null;
    const macroStr  = hasMacros
      ? ` \u00b7 <span class="result-macros">P ${protein ?? '--'}g \u00b7 C ${carbs ?? '--'}g \u00b7 F ${fat ?? '--'}g</span>`
      : '';

    const li = document.createElement('li');
    li.innerHTML = `
      <div class="result-info">
        <div class="result-name">${escapeHtml(name)}</div>
        <div class="result-meta">${escapeHtml(brand)} \u00b7 ${kcalPer100g} kcal/100g${macroStr}</div>
      </div>
      <div class="result-actions">
        <button class="fav-btn" title="${isFav ? 'Unfavorite' : 'Favorite'}">${isFav ? '\u2605' : '\u2606'}</button>
        <button class="add-result-btn">Add</button>
      </div>
    `;
    li.querySelector('.add-result-btn').addEventListener('click', () => addFoodFromSearch(food));
    li.querySelector('.fav-btn').addEventListener('click', () => {
      toggleFavorite(food);
      displaySearchResults(results);
    });
    list.appendChild(li);
  });
}

async function addFoodFromSearch(food) {
  const { name, kcalPer100g, protein, carbs, fat } = food;
  const gramsStr = window.prompt(
    `How many grams of "${name}" did you eat?\n(${kcalPer100g} kcal per 100g)`
  );
  if (gramsStr === null) return;
  const grams = parseFloat(gramsStr);
  if (!grams || grams <= 0) { alert('Please enter a valid number of grams.'); return; }
  const scale = v => v != null ? Math.round((grams / 100) * v * 10) / 10 : null;
  await addEntry(`${name} (${grams}g)`, Math.round((grams / 100) * kcalPer100g), {
    protein: scale(protein), carbs: scale(carbs), fat: scale(fat),
  });
  trackRecentFood(food);
  document.getElementById('search-results').innerHTML = '';
  document.getElementById('search-input').value = '';
  renderRecentFavorites();
}

// ── Log management ───────────────────────────────────────────────────────────

async function addEntry(name, calories, macros = {}) {
  if (!activeProfile) return;
  const now  = new Date();
  const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  const date = getSelectedDate();

  const entry = await api(`/entries/${activeProfile.id}`, {
    method: 'POST',
    body: JSON.stringify({
      entry_date: date,
      entry_time: time,
      name,
      calories,
      protein: macros.protein ?? null,
      carbs:   macros.carbs   ?? null,
      fat:     macros.fat     ?? null,
    }),
  });

  todayEntries.push(entry);
  renderLog(); renderProgress(); renderHistory(); renderChart();
}

async function addManualEntry() {
  const nameInput = document.getElementById('manual-name');
  const calInput  = document.getElementById('manual-calories');
  const errEl     = document.getElementById('manual-error');
  errEl.textContent = '';

  const name     = nameInput.value.trim();
  const calories = parseInt(calInput.value, 10);

  if (!name)                    { errEl.textContent = 'Please enter a food name.'; return; }
  if (!calories || calories < 1) { errEl.textContent = 'Please enter a valid calorie amount.'; return; }

  const pVal = parseFloat(document.getElementById('manual-protein').value);
  const cVal = parseFloat(document.getElementById('manual-carbs').value);
  const fVal = parseFloat(document.getElementById('manual-fat').value);

  await addEntry(name, calories, {
    protein: isNaN(pVal) ? null : pVal,
    carbs:   isNaN(cVal) ? null : cVal,
    fat:     isNaN(fVal) ? null : fVal,
  });
  nameInput.value = '';
  calInput.value  = '';
  document.getElementById('manual-protein').value = '';
  document.getElementById('manual-carbs').value   = '';
  document.getElementById('manual-fat').value     = '';
}

async function deleteEntry(id) {
  if (!activeProfile) return;
  await api(`/entries/${activeProfile.id}/${id}`, { method: 'DELETE' });
  todayEntries = todayEntries.filter(e => e.id !== id);
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
    const hasMacros  = entry.protein != null || entry.carbs != null || entry.fat != null;
    const macroLine  = hasMacros
      ? `<div class="entry-macros">P: ${entry.protein ?? '--'}g \u00b7 C: ${entry.carbs ?? '--'}g \u00b7 F: ${entry.fat ?? '--'}g</div>`
      : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="col-time">${escapeHtml(entry.entry_time || entry.time || '')}</td>
      <td><div>${escapeHtml(entry.name)}</div>${macroLine}</td>
      <td class="col-kcal">${entry.calories.toLocaleString()}</td>
      <td class="col-del"><button class="delete-btn" title="Remove">\u00d7</button></td>
    `;
    tr.querySelector('.delete-btn').addEventListener('click', () => deleteEntry(entry.id));
    tbody.appendChild(tr);
  });

  const total = entries.reduce((sum, e) => sum + e.calories, 0);
  document.getElementById('daily-total').textContent = `Total: ${total.toLocaleString()} kcal`;
}

// ── History & chart ──────────────────────────────────────────────────────────

let chartInstance = null;

function getLast7Days() {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    days.push(`${y}-${m}-${day}`);
  }
  return days;
}

function formatDate(isoStr) {
  const [y, m, d] = isoStr.split('-');
  return new Date(+y, +m - 1, +d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Cache for history data
let historyCache = {};

async function loadHistoryData() {
  if (!activeProfile) return;
  const days = getLast7Days();
  const from = days[0];
  const to   = days[days.length - 1];
  const entries = await api(`/entries/${activeProfile.id}?from=${from}&to=${to}`);
  // Group by date
  historyCache = {};
  entries.forEach(e => {
    const d = e.entry_date?.split('T')[0] || e.entry_date;
    if (!historyCache[d]) historyCache[d] = [];
    historyCache[d].push(e);
  });
}

function renderHistory() {
  const goal = activeProfile?.goal || 2000;
  const list = document.getElementById('history-list');
  list.innerHTML = '';

  [...getLast7Days()].reverse().forEach(dateKey => {
    const entries = historyCache[dateKey] || [];
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
    list.innerHTML = '<li style="color:#a0aec0;font-style:italic;padding:12px 0">No history yet \u2014 start logging meals!</li>';
  }
}

function renderChart() {
  const days = getLast7Days();
  const goal = activeProfile?.goal || 2000;
  const labels       = days.map(formatDate);
  const caloriesData = days.map(d => (historyCache[d] || []).reduce((s, e) => s + e.calories, 0));
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

// ── Cutting & Bulking Plans ─────────────────────────────────────────────────

let selectedSex = 'male';
let cachedPlanStats = null;

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

async function restorePlanSection() {
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

  if (!activeProfile) return;
  try {
    const s = await api(`/profiles/${activeProfile.id}/plan-stats`);
    cachedPlanStats = s;
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
    calculatePlanUI();
  } catch { /* no plan stats yet */ }
}

async function calculatePlan() {
  const age      = parseInt(document.getElementById('plan-age').value, 10);
  const ft       = parseInt(document.getElementById('plan-height-ft').value, 10);
  const inches   = parseInt(document.getElementById('plan-height-in').value, 10) || 0;
  const lbs      = parseFloat(document.getElementById('plan-weight').value);
  const activity = parseFloat(document.getElementById('plan-activity').value);
  const errEl    = document.getElementById('plan-error');

  if (!age || age < 10 || age > 120)              { errEl.textContent = 'Enter a valid age (10\u2013120).'; return; }
  if (!ft || ft < 1 || inches < 0 || inches > 11) { errEl.textContent = 'Enter a valid height (e.g. 5 ft 10 in).'; return; }
  if (!lbs || lbs < 1)                            { errEl.textContent = 'Enter a valid weight in lbs.'; return; }
  errEl.textContent = '';

  // Save to backend
  if (activeProfile) {
    try {
      await api(`/profiles/${activeProfile.id}/plan-stats`, {
        method: 'PUT',
        body: JSON.stringify({ sex: selectedSex, age, ft, inches, lbs, activity }),
      });
    } catch { /* non-fatal */ }
  }

  calculatePlanUI();
}

function calculatePlanUI() {
  const age      = parseInt(document.getElementById('plan-age').value, 10);
  const ft       = parseInt(document.getElementById('plan-height-ft').value, 10);
  const inches   = parseInt(document.getElementById('plan-height-in').value, 10) || 0;
  const lbs      = parseFloat(document.getElementById('plan-weight').value);
  const activity = parseFloat(document.getElementById('plan-activity').value);

  if (!age || !ft || !lbs) return;

  const heightCm = (ft * 12 + inches) * 2.54;
  const weightKg = lbs * 0.453592;
  const bmr      = selectedSex === 'male'
    ? 10 * weightKg + 6.25 * heightCm - 5 * age + 5
    : 10 * weightKg + 6.25 * heightCm - 5 * age - 161;
  const tdee     = Math.round(bmr * activity);
  const cutKcal  = Math.max(tdee - 500, 1200);
  const bulkKcal = tdee + 300;

  document.getElementById('tdee-value').textContent  = tdee.toLocaleString();
  document.getElementById('cut-kcal').textContent    = `${cutKcal.toLocaleString()} kcal/day`;
  document.getElementById('cut-detail').textContent  = cutKcal === 1200
    ? '1,200 kcal minimum \u2014 consult a doctor' : '\u2212500 kcal deficit \u00b7 ~0.5 kg/week loss';
  document.getElementById('bulk-kcal').textContent   = `${bulkKcal.toLocaleString()} kcal/day`;
  document.getElementById('bulk-detail').textContent = '+300 kcal surplus \u00b7 ~0.3 kg/week gain';
  document.getElementById('cut-apply-btn').onclick   = () => applyPlanGoal(cutKcal,  'cut');
  document.getElementById('bulk-apply-btn').onclick  = () => applyPlanGoal(bulkKcal, 'bulk');
  document.getElementById('plan-results').classList.remove('hidden');
}

async function applyPlanGoal(calories, type) {
  activeProfile.goal = calories;
  await api(`/profiles/${activeProfile.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      goal: calories,
      protein_goal: activeProfile.protein_goal,
      carbs_goal: activeProfile.carbs_goal,
      fat_goal: activeProfile.fat_goal,
    }),
  });
  renderProgress();
  const btn = document.getElementById(type + '-apply-btn');
  btn.textContent = 'Goal Applied!';
  btn.disabled = true;
  setTimeout(() => { btn.textContent = 'Apply Goal'; btn.disabled = false; }, 1500);
  restoreMacroGoals();
}

// ── Recent foods & Favorites ─────────────────────────────────────────────────

let cachedRecentFoods   = [];
let cachedFavorites     = [];

async function loadRecentAndFavorites() {
  if (!activeProfile) return;
  try {
    [cachedRecentFoods, cachedFavorites] = await Promise.all([
      api(`/foods/${activeProfile.id}/recent`),
      api(`/foods/${activeProfile.id}/favorites`),
    ]);
  } catch { /* non-fatal */ }
}

async function trackRecentFood(food) {
  if (!activeProfile) return;
  try {
    await api(`/foods/${activeProfile.id}/recent`, {
      method: 'POST',
      body: JSON.stringify({
        name: food.name,
        brand: food.brand || 'Built-in',
        kcal_per_100g: food.kcalPer100g,
        protein: food.protein ?? null,
        carbs: food.carbs ?? null,
        fat: food.fat ?? null,
      }),
    });
    await loadRecentAndFavorites();
  } catch { /* non-fatal */ }
}

async function toggleFavorite(food) {
  if (!activeProfile) return;
  try {
    await api(`/foods/${activeProfile.id}/favorites`, {
      method: 'POST',
      body: JSON.stringify({
        name: food.name,
        brand: food.brand || 'Built-in',
        kcal_per_100g: food.kcalPer100g,
        protein: food.protein ?? null,
        carbs: food.carbs ?? null,
        fat: food.fat ?? null,
      }),
    });
    await loadRecentAndFavorites();
  } catch { /* non-fatal */ }
}

function renderQuickList(container, foods, emptyMsg) {
  container.innerHTML = '';
  if (!foods.length) {
    container.innerHTML = `<li class="quick-empty">${emptyMsg}</li>`;
    return;
  }
  foods.forEach(food => {
    const isFav = cachedFavorites.some(f => f.name === food.name);
    const kcal  = food.kcal_per_100g || food.kcalPer100g || 0;
    const li = document.createElement('li');
    li.className = 'quick-food-item';
    li.innerHTML = `
      <div class="quick-info">
        <span class="quick-name">${escapeHtml(food.name)}</span>
        <span class="quick-meta">${kcal} kcal/100g</span>
      </div>
      <button class="fav-btn" title="${isFav ? 'Unfavorite' : 'Favorite'}">${isFav ? '\u2605' : '\u2606'}</button>
      <button class="quick-add-btn">Add</button>
    `;
    const searchFood = { name: food.name, brand: food.brand || '', kcalPer100g: kcal, protein: food.protein, carbs: food.carbs, fat: food.fat };
    li.querySelector('.quick-add-btn').addEventListener('click', () => addFoodFromSearch(searchFood));
    li.querySelector('.fav-btn').addEventListener('click', async () => { await toggleFavorite(searchFood); renderRecentFavorites(); });
    container.appendChild(li);
  });
}

function renderRecentFavorites() {
  renderQuickList(document.getElementById('recent-list'),  cachedRecentFoods,  'No recent foods yet \u2014 start logging!');
  renderQuickList(document.getElementById('fav-list'),     cachedFavorites,    'No favorites yet \u2014 star a food from search results.');
}

function initQuickFoods() {
  ['recent', 'fav'].forEach(key => {
    const btn  = document.getElementById(`${key}-toggle`);
    const list = document.getElementById(`${key}-list`);
    btn.addEventListener('click', () => {
      const hidden = list.classList.toggle('hidden');
      btn.querySelector('.toggle-arrow').textContent = hidden ? '\u25b6' : '\u25bc';
    });
  });
  renderRecentFavorites();
}

// ── Tab navigation ───────────────────────────────────────────────────────────

function switchTab(tabId) {
  if (tabId !== 'add-food') stopBarcodeScan();
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`tab-${tabId}`).classList.remove('hidden');
  document.querySelector(`.tab-btn[data-tab="${tabId}"]`).classList.add('active');
  if (tabId === 'overview') renderChart();
  if (tabId === 'goals')    restoreMacroGoals();
}

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

// ── Render all (used when switching profiles) ────────────────────────────────

async function renderAll() {
  await Promise.all([loadHistoryData(), loadRecentAndFavorites()]);
  // Also put today's entries in history cache
  const today = getToday();
  historyCache[today] = todayEntries;
  restorePlanSection();
  restoreMacroGoals();
  renderLog();
  renderProgress();
  renderHistory();
  renderChart();
  renderRecentFavorites();
  document.getElementById('search-results').innerHTML = '';
  document.getElementById('search-input').value = '';
}

// ── Utility ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── API key settings ─────────────────────────────────────────────────────────

function initApiKeySection() {
  const toggle   = document.getElementById('api-key-toggle');
  const form     = document.getElementById('api-key-form');
  const input    = document.getElementById('api-key-input');
  const saveBtn  = document.getElementById('api-key-save-btn');

  function updateToggleLabel() {
    toggle.textContent = usdaApiKey ? '\u2699 USDA API Key \u2713' : '\u2699 USDA API Key';
    toggle.style.color = usdaApiKey ? '#48bb78' : '';
  }
  updateToggleLabel();

  toggle.addEventListener('click', () => {
    const hidden = form.classList.toggle('hidden');
    if (!hidden && usdaApiKey) input.value = usdaApiKey;
  });

  saveBtn.addEventListener('click', async () => {
    const key = input.value.trim();
    usdaApiKey = key || null;
    updateToggleLabel();
    form.classList.add('hidden');
    input.value = '';
    try {
      await api('/auth/usda-key', { method: 'PUT', body: JSON.stringify({ usda_api_key: key || null }) });
    } catch (err) {
      console.warn('Could not save USDA key to server:', err);
    }
  });
}

// ── App init (called after login) ────────────────────────────────────────────

async function initApp() {
  document.getElementById('current-date').textContent =
    new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

  const logDateInput = document.getElementById('log-date-input');
  logDateInput.value = getToday();
  document.getElementById('log-date-today-btn').addEventListener('click', () => {
    logDateInput.value = getToday();
  });

  // Reload entries when date changes
  logDateInput.addEventListener('change', async () => {
    await loadTodayEntries();
    renderLog();
    renderProgress();
  });

  document.getElementById('set-goal-btn').addEventListener('click', setGoal);
  document.getElementById('goal-input').addEventListener('keydown', e => { if (e.key === 'Enter') setGoal(); });
  document.getElementById('search-btn').addEventListener('click', searchFood);
  document.getElementById('search-input').addEventListener('keydown', e => { if (e.key === 'Enter') searchFood(); });
  document.getElementById('add-manual-btn').addEventListener('click', addManualEntry);
  document.getElementById('manual-calories').addEventListener('keydown', e => { if (e.key === 'Enter') addManualEntry(); });
  document.getElementById('logout-btn').addEventListener('click', logout);

  initTabs();
  initPlanSection();
  initApiKeySection();
  initBarcodeSection();
  initMacroGoals();
  initQuickFoods();
  renderProfileBar();
  await renderAll();
}

// ── Bootstrap ────────────────────────────────────────────────────────────────

window.addEventListener('load', async () => {
  initAuth();
  showOverlay();

  const restored = await tryAutoLogin();
  if (restored) {
    hideOverlay();
    await loadAllData();
    initApp();
  }
});
