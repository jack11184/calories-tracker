# My Calorie Tracker

A full-stack calorie and nutrition tracking web app. Create an account, log in from any device, and track your calories and macros in the cloud.

Live site: [Calroies Tracker](https://calories-tracker-production.up.railway.app/)

---

## Features

- **Multi-profile support** — Switch between profiles (e.g. Me, Bulk Phase, Cut Phase). Each profile stores its own goal, food log, history, and plan stats independently.
- **TDEE & macro calculator** — Uses the Mifflin-St Jeor BMR formula to calculate your Total Daily Energy Expenditure and recommend calorie targets for fat loss or muscle gain.
- **Daily calorie goal** — Set a custom goal or apply one from the plan calculator. A color-coded progress bar shows remaining budget in real time.
- **Food search with 3-tier fallback:**
  1. **USDA FoodData Central** — US government food database (free API key at [api.data.gov](https://api.data.gov/signup))
  2. **Open Food Facts** — Open-source crowd-sourced global database
  3. **460+ built-in foods** — Always-available offline database covering proteins, grains, dairy, fruits, vegetables, fast food, snacks, cereals, and more
- **Barcode scanning** — Scan product barcodes via camera or upload a barcode photo for instant food lookup (ZXing + Open Food Facts)
- **Manual entry** — Add any food by name and calorie count directly
- **Time-stamped daily log** — Per-item deletion, persists across sessions
- **7-day history chart** — Bar chart with daily goal reference line (Chart.js)
- **Recent foods & favorites** — Quick access to the last 10 foods added and starred foods per profile
- **Macro tracking** — Optional protein, carbs, and fat tracking per food and per profile goal
- **Secure accounts** — CAPTCHA-protected registration, JWT authentication (30-day sessions), bcrypt password hashing

---

## Tech Stack

**Frontend:** Vanilla JavaScript (ES6+), HTML5, CSS3, Chart.js, ZXing Browser

**Backend:** Node.js, Express 5, PostgreSQL, JWT (jsonwebtoken), bcryptjs

**Database:** Supabase (PostgreSQL)

**Hosting:** Railway

**External APIs:** USDA FoodData Central, Open Food Facts

---

## Self-Hosting

### Prerequisites
- Node.js 18+
- A PostgreSQL database (e.g. [Supabase](https://supabase.com) free tier)

### Setup

1. Clone the repo:
   ```bash
   git clone https://github.com/jack11184/calories-tracker.git
   cd calories-tracker
   ```

2. Run `backend/schema.sql` against your PostgreSQL database to create all tables.

3. Copy the environment template:
   ```bash
   cp backend/.env.example backend/.env
   ```

4. Fill in `backend/.env`:
   ```
   DATABASE_URL=postgresql://user:password@host:5432/dbname
   JWT_SECRET=your-long-random-secret-here
   PORT=3000
   ```

5. Install dependencies and start:
   ```bash
   npm install
   npm start
   ```

6. Open [http://localhost:3000](http://localhost:3000)

### Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret used to sign JWT tokens — use any long random string |
| `PORT` | Port to run the server on (default: 3000) |

---

## Optional: USDA API Key

The app works without an API key using the built-in food database. For broader search coverage:

1. Get a free key at [api.data.gov/signup](https://api.data.gov/signup)
2. In the app, go to Settings and paste your key — it saves to your account

---

## API Endpoints

### Authentication (`/api/auth`)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/captcha` | Get CAPTCHA image and token |
| POST | `/register` | Register with username, password, and CAPTCHA |
| POST | `/login` | Login and receive JWT token |
| GET | `/me` | Get current user info (auth required) |
| PUT | `/usda-key` | Save USDA API key to account (auth required) |

### Profiles (`/api/profiles`)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/` | List all profiles |
| POST | `/` | Create a new profile |
| PUT | `/:id` | Update profile goals/macros |
| PUT | `/:id/activate` | Set active profile |
| DELETE | `/:id` | Delete a profile |
| GET/PUT | `/:id/plan-stats` | Get or save TDEE calculator data |

### Food Entries (`/api/entries/:profileId`)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/:profileId` | Get entries for a date (`?date=`) or range (`?from=&to=`) |
| POST | `/:profileId` | Add a food entry |
| DELETE | `/:profileId/:entryId` | Delete a food entry |

### Foods & Barcode (`/api/foods/:profileId`)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/:profileId/recent` | Get last 10 foods added |
| POST | `/:profileId/recent` | Add food to recent list |
| GET | `/:profileId/search?q=` | Search USDA + Open Food Facts |
| GET | `/:profileId/barcode/:barcode` | Look up product by barcode |
| GET | `/:profileId/favorites` | Get all favorited foods |
| POST | `/:profileId/favorites` | Toggle a food as favorite |

---

## Database Schema

7 tables managed via `backend/schema.sql`:

| Table | Description |
|---|---|
| `users` | Account credentials and optional USDA API key |
| `profiles` | Multiple named profiles per user with calorie/macro goals |
| `plan_stats` | TDEE calculator inputs (sex, age, height, weight, activity) |
| `food_entries` | Time-stamped daily food log per profile |
| `recent_foods` | Last 10 foods added per profile |
| `favorite_foods` | Starred foods per profile |
| `barcode_cache` | Cached barcode lookups to reduce external API calls |

A database trigger automatically creates a default "Me" profile when a new user registers.

---

## Browser Compatibility

All modern browsers are supported — Chrome, Firefox, Safari, Edge. The app no longer requires the File System Access API since all data is stored server-side.
