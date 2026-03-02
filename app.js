// ── Data layer ────────────────────────────────────────────────────────────────

function getToday() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function loadData() {
  const raw = localStorage.getItem('calorieTracker');
  return raw ? JSON.parse(raw) : { goal: 2000, days: {} };
}

function saveData(data) {
  localStorage.setItem('calorieTracker', JSON.stringify(data));
}

function getTodayEntries() {
  const data = loadData();
  return data.days[getToday()] || [];
}

// ── Goal & progress bar ───────────────────────────────────────────────────────

function setGoal() {
  const input = document.getElementById('goal-input');
  const val = parseInt(input.value, 10);
  if (!val || val < 1) return;
  const data = loadData();
  data.goal = val;
  saveData(data);
  renderProgress();
}

function renderProgress() {
  const data = loadData();
  const entries = getTodayEntries();
  const total = entries.reduce((sum, e) => sum + e.calories, 0);
  const goal = data.goal || 2000;
  const pct = Math.min((total / goal) * 100, 100);

  const fill = document.getElementById('progress-bar-fill');
  fill.style.width = pct + '%';
  fill.className = '';
  if (pct >= 100) fill.classList.add('over');
  else if (pct >= 85) fill.classList.add('near');

  document.getElementById('progress-label').textContent =
    `${total.toLocaleString()} / ${goal.toLocaleString()} kcal`;

  // Keep goal input in sync
  const goalInput = document.getElementById('goal-input');
  if (!goalInput.matches(':focus')) goalInput.value = goal;
}

// ── Food search (Open Food Facts API) ────────────────────────────────────────

async function searchFood() {
  const query = document.getElementById('search-input').value.trim();
  if (!query) return;

  const resultsList = document.getElementById('search-results');
  resultsList.innerHTML = '<li style="color:#a0aec0;font-style:italic">Searching…</li>';

  const params = new URLSearchParams({
    query,
    dataType: 'SR Legacy,Survey (FNDDS),Branded',
    pageSize: 10,
    api_key: 'DEMO_KEY',
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(
      `https://api.nal.usda.gov/fdc/v1/foods/search?${params}`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    displaySearchResults(json.foods || []);
  } catch (err) {
    clearTimeout(timeout);
    console.error('Food search error:', err);
    const msg = err.name === 'AbortError'
      ? 'Search timed out — try again.'
      : 'Search failed — check your connection.';
    resultsList.innerHTML = `<li style="color:#fc8181">${msg}</li>`;
  }
}

function displaySearchResults(foods) {
  const list = document.getElementById('search-results');
  list.innerHTML = '';

  // USDA foods: description, brandOwner, foodNutrients[{nutrientName, unitName, value}]
  function getKcal(f) {
    return f.foodNutrients?.find(n => n.nutrientName === 'Energy' && n.unitName?.toLowerCase() === 'kcal');
  }

  const valid = foods.filter(f => f.description?.trim() && getKcal(f)?.value > 0);

  if (!valid.length) {
    list.innerHTML = '<li style="color:#a0aec0;font-style:italic">No results found.</li>';
    return;
  }

  valid.forEach(food => {
    const name = food.description.trim();
    const brand = food.brandOwner?.trim() || food.brandName?.trim() || '';
    const kcalPer100g = Math.round(getKcal(food).value);

    const li = document.createElement('li');
    li.innerHTML = `
      <div class="result-info">
        <div class="result-name">${escapeHtml(name)}</div>
        <div class="result-meta">${escapeHtml(brand)} · ${kcalPer100g} kcal / 100g</div>
      </div>
      <button class="add-result-btn">Add</button>
    `;
    li.querySelector('button').addEventListener('click', () => {
      addFoodFromSearch(name, kcalPer100g);
    });
    list.appendChild(li);
  });
}

function addFoodFromSearch(name, kcalPer100g) {
  const gramsStr = window.prompt(
    `How many grams of "${name}" did you eat?\n(${kcalPer100g} kcal per 100g)`
  );
  if (gramsStr === null) return; // user cancelled
  const grams = parseFloat(gramsStr);
  if (!grams || grams <= 0) {
    alert('Please enter a valid number of grams.');
    return;
  }
  const calories = Math.round((grams / 100) * kcalPer100g);
  addEntry(`${name} (${grams}g)`, calories);
  document.getElementById('search-results').innerHTML = '';
  document.getElementById('search-input').value = '';
}

// ── Log management ────────────────────────────────────────────────────────────

function addEntry(name, calories) {
  const now = new Date();
  const time = now.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const entry = { id: Date.now(), time, name, calories };

  const data = loadData();
  const today = getToday();
  if (!data.days[today]) data.days[today] = [];
  data.days[today].push(entry);
  saveData(data);

  renderLog();
  renderProgress();
  renderHistory();
  renderChart();
}

function addManualEntry() {
  const nameInput = document.getElementById('manual-name');
  const calInput  = document.getElementById('manual-calories');
  const errEl     = document.getElementById('manual-error');
  errEl.textContent = '';

  const name = nameInput.value.trim();
  const calories = parseInt(calInput.value, 10);

  if (!name) {
    errEl.textContent = 'Please enter a food name.';
    return;
  }
  if (!calories || calories < 1) {
    errEl.textContent = 'Please enter a valid calorie amount.';
    return;
  }

  addEntry(name, calories);
  nameInput.value = '';
  calInput.value = '';
}

function deleteEntry(id) {
  const data = loadData();
  const today = getToday();
  if (data.days[today]) {
    data.days[today] = data.days[today].filter(e => e.id !== id);
    if (data.days[today].length === 0) delete data.days[today];
  }
  saveData(data);
  renderLog();
  renderProgress();
  renderHistory();
  renderChart();
}

function renderLog() {
  const entries = getTodayEntries();
  const tbody = document.getElementById('log-body');
  tbody.innerHTML = '';

  if (!entries.length) {
    tbody.innerHTML = `
      <tr class="placeholder-row">
        <td colspan="4">No meals logged yet.</td>
      </tr>`;
    document.getElementById('daily-total').textContent = 'Total: 0 kcal';
    return;
  }

  entries.forEach(entry => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="col-time">${escapeHtml(entry.time)}</td>
      <td>${escapeHtml(entry.name)}</td>
      <td class="col-kcal">${entry.calories.toLocaleString()}</td>
      <td class="col-del">
        <button class="delete-btn" title="Remove">×</button>
      </td>
    `;
    tr.querySelector('.delete-btn').addEventListener('click', () => deleteEntry(entry.id));
    tbody.appendChild(tr);
  });

  const total = entries.reduce((sum, e) => sum + e.calories, 0);
  document.getElementById('daily-total').textContent =
    `Total: ${total.toLocaleString()} kcal`;
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
  const [year, month, day] = isoStr.split('-');
  const d = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function renderHistory() {
  const data = loadData();
  const days = getLast7Days();
  const goal = data.goal || 2000;

  const list = document.getElementById('history-list');
  list.innerHTML = '';

  // Show in reverse (most recent first)
  [...days].reverse().forEach(dateKey => {
    const entries = data.days[dateKey] || [];
    if (!entries.length) return; // skip days with no data

    const total = entries.reduce((sum, e) => sum + e.calories, 0);
    const isOver = total > goal;

    const li = document.createElement('li');
    li.innerHTML = `
      <span class="hist-date">${formatDate(dateKey)}</span>
      <span class="hist-kcal">${total.toLocaleString()} kcal</span>
      <span class="hist-badge ${isOver ? 'over' : 'under'}">
        ${isOver ? 'Over' : 'Under'}
      </span>
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

  const labels = days.map(formatDate);
  const caloriesData = days.map(d => {
    const entries = data.days[d] || [];
    return entries.reduce((sum, e) => sum + e.calories, 0);
  });
  const goalData = days.map(() => goal);

  buildChart(labels, caloriesData, goalData);
}

function buildChart(labels, caloriesData, goalData) {
  const canvas = document.getElementById('history-chart');

  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }

  chartInstance = new Chart(canvas, {
    data: {
      labels,
      datasets: [
        {
          type: 'bar',
          label: 'Calories',
          data: caloriesData,
          backgroundColor: 'rgba(102, 126, 234, 0.7)',
          borderColor: 'rgba(102, 126, 234, 1)',
          borderWidth: 1,
          borderRadius: 4,
        },
        {
          type: 'line',
          label: 'Goal',
          data: goalData,
          borderColor: '#fc8181',
          borderDash: [6, 4],
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
          tension: 0,
        },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: 'index' },
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y.toLocaleString()} kcal`,
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: val => `${val.toLocaleString()} kcal`,
          },
        },
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

  // Restore saved stats and auto-calculate if available
  const data = loadData();
  if (data.planStats) {
    const s = data.planStats;
    if (s.sex) {
      selectedSex = s.sex;
      document.querySelectorAll('#plan-section .seg-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.val === s.sex);
      });
    }
    if (s.age)      document.getElementById('plan-age').value = s.age;
    if (s.ft)       document.getElementById('plan-height-ft').value = s.ft;
    if (s.inches != null) document.getElementById('plan-height-in').value = s.inches;
    if (s.lbs)      document.getElementById('plan-weight').value = s.lbs;
    if (s.activity) document.getElementById('plan-activity').value = s.activity;
    calculatePlan();
  }
}

function calculatePlan() {
  const age      = parseInt(document.getElementById('plan-age').value, 10);
  const ft       = parseInt(document.getElementById('plan-height-ft').value, 10);
  const inches   = parseInt(document.getElementById('plan-height-in').value, 10) || 0;
  const lbs      = parseFloat(document.getElementById('plan-weight').value);
  const activity = parseFloat(document.getElementById('plan-activity').value);
  const errEl    = document.getElementById('plan-error');

  if (!age || age < 10 || age > 120)     { errEl.textContent = 'Enter a valid age (10–120).'; return; }
  if (!ft || ft < 1 || inches < 0 || inches > 11) { errEl.textContent = 'Enter a valid height (e.g. 5 ft 10 in).'; return; }
  if (!lbs || lbs < 1)                   { errEl.textContent = 'Enter a valid weight in lbs.'; return; }
  errEl.textContent = '';

  // Convert to metric for Mifflin-St Jeor
  const heightCm = (ft * 12 + inches) * 2.54;
  const weightKg = lbs * 0.453592;

  const bmr = selectedSex === 'male'
    ? 10 * weightKg + 6.25 * heightCm - 5 * age + 5
    : 10 * weightKg + 6.25 * heightCm - 5 * age - 161;
  const tdee     = Math.round(bmr * activity);
  const cutKcal  = Math.max(tdee - 500, 1200); // floor at 1200 kcal
  const bulkKcal = tdee + 300;

  // Persist stats
  const data = loadData();
  data.planStats = { sex: selectedSex, age, ft, inches, lbs, activity };
  saveData(data);

  // Update results
  document.getElementById('tdee-value').textContent = tdee.toLocaleString();

  document.getElementById('cut-kcal').textContent    = `${cutKcal.toLocaleString()} kcal/day`;
  const cutNote = cutKcal === 1200 ? '1,200 kcal minimum — consult a doctor' : '−500 kcal deficit · ~0.5 kg/week loss';
  document.getElementById('cut-detail').textContent  = cutNote;

  document.getElementById('bulk-kcal').textContent   = `${bulkKcal.toLocaleString()} kcal/day`;
  document.getElementById('bulk-detail').textContent = '+300 kcal surplus · ~0.3 kg/week gain';

  document.getElementById('cut-apply-btn').onclick  = () => applyPlanGoal(cutKcal,  'cut');
  document.getElementById('bulk-apply-btn').onclick = () => applyPlanGoal(bulkKcal, 'bulk');

  document.getElementById('plan-results').classList.remove('hidden');
}

function applyPlanGoal(calories, type) {
  const data = loadData();
  data.goal = calories;
  saveData(data);
  renderProgress();

  const btn = document.getElementById(type + '-apply-btn');
  btn.textContent = 'Goal Applied!';
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = 'Apply Goal';
    btn.disabled = false;
  }, 1500);

  document.getElementById('goal-section').scrollIntoView({ behavior: 'smooth' });
}

// ── Utility ───────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Initialisation ────────────────────────────────────────────────────────────

function init() {
  // Show today's date in the header
  document.getElementById('current-date').textContent =
    new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

  // Wire up buttons
  document.getElementById('set-goal-btn').addEventListener('click', setGoal);
  document.getElementById('goal-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') setGoal();
  });

  document.getElementById('search-btn').addEventListener('click', searchFood);
  document.getElementById('search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') searchFood();
  });

  document.getElementById('add-manual-btn').addEventListener('click', addManualEntry);
  document.getElementById('manual-calories').addEventListener('keydown', e => {
    if (e.key === 'Enter') addManualEntry();
  });

  initPlanSection();

  // Initial render
  renderLog();
  renderProgress();
  renderHistory();
  renderChart();
}

window.addEventListener('load', init);
