# My Calorie Tracker

A privacy-first, offline-capable calorie tracking web app. All your data is saved to a `.json` file **on your own computer** — nothing is ever uploaded to a server.

Live site: [[jack11184.github.io/calories-tracker](https://jack11184.github.io/calories-tracker)] <!-- update URL if needed -->

---

## Screenshot

```
┌─────────────────────────────────────────────────────────┐
│  [ Me ]  [ Bulk ]  [ Cut ]  [ + ]          (profiles)  │
├─────────────────────────────────────────────────────────┤
│              🥗  My Calorie Tracker                     │
│                  Monday, March 2, 2026                  │
│                                                         │
│  ┌─ Cutting & Bulking Plans ───────────────────────┐   │
│  │  Sex: [Male] [Female]    Age: 25 yr             │   │
│  │  Height: 5 ft 10 in      Weight: 185 lbs        │   │
│  │  Activity: Moderately active (3–5×/week)        │   │
│  │                    [ Calculate Plans ]          │   │
│  │                                                 │   │
│  │  TDEE: 2,850 kcal/day                          │   │
│  │  ┌────────────┐   ┌────────────┐               │   │
│  │  │  Cutting   │   │  Bulking   │               │   │
│  │  │  Lose Fat  │   │Build Muscle│               │   │
│  │  │ 2,350 kcal │   │ 3,100 kcal │               │   │
│  │  │[Apply Goal]│   │[Apply Goal]│               │   │
│  │  └────────────┘   └────────────┘               │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─ Daily Calorie Goal ────────────────────────────┐   │
│  │  [  2000  ] kcal  [ Set Goal ]                  │   │
│  │  ████████████░░░░░░░░░░░░  1,420 / 2,000 kcal  │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─ Add Food ──────────────────────────────────────┐   │
│  │  [ chicken breast          ] [ Search ]         │   │
│  │  ○ Chicken breast, cooked   165 kcal/100g  [+] │   │
│  │  ○ Chicken breast, raw      120 kcal/100g  [+] │   │
│  │  Search #3 · USDA FoodData Central              │   │
│  │  ─────────── or add manually ───────────        │   │
│  │  [ Food name ] [ kcal ] [ Add ]                 │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─ Today's Log ───────────────────────────────────┐   │
│  │  Time    Food                       kcal   [x]  │   │
│  │  8:02am  Oatmeal, cooked (200g)     142    [x]  │   │
│  │  12:14pm Chicken breast (150g)      248    [x]  │   │
│  │  3:30pm  Greek yogurt, nonfat       59     [x]  │   │
│  │                          Total: 449 kcal        │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─ History (Last 7 Days) ─────────────────────────┐   │
│  │  ▂▄▇█▅▃▆  (bar chart)   ── goal line ──        │   │
│  │  Feb 24: 1,890 kcal                             │   │
│  │  Feb 25: 2,310 kcal                             │   │
│  │  ...                                            │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## Features

- **Multi-profile support** — Switch between profiles (e.g. Me, Bulk Phase, Cut Phase). Each profile stores its own goal, food log, history, and plan stats.
- **Cutting & Bulking calculator** — Uses the Mifflin-St Jeor BMR formula to calculate your TDEE and recommend calorie targets for fat loss or muscle gain.
- **Daily calorie goal** — Set a custom goal or apply one directly from the plan calculator. A color-coded progress bar shows your remaining budget.
- **Food search with 3-tier fallback:**
  1. **USDA FoodData Central** — Large US government food database (free API key from [api.data.gov](https://api.data.gov/signup))
  2. **Open Food Facts** — Open-source crowd-sourced database, searched in parallel as a fallback
  3. **460+ built-in foods** — Always-available offline database covering proteins, grains, dairy, fruits, vegetables, fast food, candy, snacks, cereals, international dishes, and more
- **Manual entry** — Add any food by name and calorie count directly.
- **Today's Log** — Time-stamped food log with per-item deletion. Persists across page reloads.
- **7-day history chart** — Bar chart (via Chart.js) with a daily goal reference line.
- **100% private** — Data is stored in a `.json` file you pick on your own device using the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API). No accounts, no servers, no tracking.

---

## Getting Started

### Option A — Use the hosted version
Open the GitHub Pages link above in **Chrome or Edge** (required for the File System Access API).

### Option B — Run locally
1. Clone the repo:
   ```bash
   git clone https://github.com/your-username/calories-tracker.git
   cd calories-tracker
   ```
2. Open `index.html` in Chrome or Edge — no build step needed.

### First launch
On first load you'll see a setup screen:
- **Create new database** — creates a fresh `database.json` file where you choose to save it
- **Open database file** — picks an existing `database.json` to continue from

The app remembers your file between sessions so you won't need to re-pick it every time.

---

## Optional: USDA API Key

The app works without an API key (uses a built-in database of 460+ foods). For broader search coverage:

1. Get a free key at [api.data.gov/signup](https://api.data.gov/signup)
2. In the app, click **⚙ USDA API Key** under the search bar and paste it in

Your key is saved to your local `database.json` and never leaves your device.

---

## Browser Compatibility

| Browser | Supported |
|---|---|
| Chrome 86+ | ✅ Full support |
| Edge 86+ | ✅ Full support |
| Firefox | ❌ File System Access API not supported |
| Safari | ❌ File System Access API not supported |

Firefox/Safari users can still use the app if it's hosted and served over HTTPS — the built-in food database will work, but data won't persist between sessions without file system access.

---

## Tech Stack

- Vanilla HTML, CSS, JavaScript — no framework, no build tool
- [Chart.js](https://www.chartjs.org/) for the history chart
- [USDA FoodData Central API](https://fdc.nal.usda.gov/) for food search
- [Open Food Facts API](https://world.openfoodfacts.org/) as secondary search
- [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API) for local file storage
- IndexedDB for persisting the file handle across sessions

---

## Data & Privacy

Your `database.json` is listed in `.gitignore` and will never be committed to this repo. It contains your food log, profile stats, and API key — all stored only on your machine.
