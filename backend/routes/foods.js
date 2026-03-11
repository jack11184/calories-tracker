const express = require('express');
const pool = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();
router.use(auth);

function normalizeBarcode(value = '') {
  return String(value).replace(/[^0-9]/g, '');
}

async function fetchWithTimeout(url, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'calories-tracker/1.0 (barcode-lookup)',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function mapOpenFoodFactsProduct(product, barcode) {
  const kcal = product?.nutriments?.['energy-kcal_100g'] ?? product?.nutriments?.['energy-kcal'];
  const round1 = v => (v != null ? Math.round(v * 10) / 10 : null);
  return {
    barcode,
    name: (product?.product_name || '').trim(),
    brand: (product?.brands || '').split(',')[0]?.trim() || 'Open Food Facts',
    kcalPer100g: kcal != null ? Math.round(Number(kcal)) : null,
    protein: round1(product?.nutriments?.['proteins_100g']),
    carbs: round1(product?.nutriments?.['carbohydrates_100g']),
    fat: round1(product?.nutriments?.['fat_100g']),
  };
}

async function verifyProfile(profileId, userId) {
  const r = await pool.query('SELECT id FROM profiles WHERE id = $1 AND user_id = $2', [profileId, userId]);
  return r.rows.length > 0;
}

// --- RECENT FOODS ---

// GET /api/foods/:profileId/recent
router.get('/:profileId/recent', async (req, res) => {
  try {
    if (!(await verifyProfile(req.params.profileId, req.userId))) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    const result = await pool.query(
      'SELECT * FROM recent_foods WHERE profile_id = $1 ORDER BY added_at DESC LIMIT 10',
      [req.params.profileId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/foods/:profileId/recent
router.post('/:profileId/recent', async (req, res) => {
  try {
    if (!(await verifyProfile(req.params.profileId, req.userId))) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const { name, brand, kcal_per_100g, protein, carbs, fat } = req.body;
    const profileId = req.params.profileId;

    // Remove existing entry with same name (move to front)
    await pool.query('DELETE FROM recent_foods WHERE profile_id = $1 AND name = $2', [profileId, name]);

    // Insert new
    await pool.query(
      `INSERT INTO recent_foods (profile_id, name, brand, kcal_per_100g, protein, carbs, fat)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [profileId, name, brand || 'Built-in', kcal_per_100g, protein ?? null, carbs ?? null, fat ?? null]
    );

    // Keep only 10 most recent
    await pool.query(
      `DELETE FROM recent_foods WHERE profile_id = $1 AND id NOT IN (
         SELECT id FROM recent_foods WHERE profile_id = $1 ORDER BY added_at DESC LIMIT 10
       )`,
      [profileId]
    );

    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/foods/:profileId/barcode/:barcode
router.get('/:profileId/barcode/:barcode', async (req, res) => {
  try {
    if (!(await verifyProfile(req.params.profileId, req.userId))) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const barcode = normalizeBarcode(req.params.barcode);
    if (!barcode || barcode.length < 8 || barcode.length > 14) {
      return res.status(400).json({ error: 'Please enter a valid UPC/EAN barcode.' });
    }

    const fields = [
      'product_name',
      'brands',
      'nutriments',
    ].join(',');
    const url = `https://world.openfoodfacts.org/api/v2/product/${barcode}.json?fields=${encodeURIComponent(fields)}`;
    const json = await fetchWithTimeout(url, 7000);

    if (json?.status !== 1 || !json?.product) {
      return res.status(404).json({ error: 'No product found for that barcode.' });
    }

    const food = mapOpenFoodFactsProduct(json.product, barcode);
    if (!food.name || !(food.kcalPer100g >= 0)) {
      return res.status(404).json({ error: 'Barcode found, but nutrition data is incomplete.' });
    }

    res.json({ source: 'Open Food Facts', food });
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Barcode lookup timed out. Please try again.' });
    }
    res.status(500).json({ error: 'Barcode lookup failed.' });
  }
});

// --- FAVORITE FOODS ---

// GET /api/foods/:profileId/favorites
router.get('/:profileId/favorites', async (req, res) => {
  try {
    if (!(await verifyProfile(req.params.profileId, req.userId))) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    const result = await pool.query(
      'SELECT * FROM favorite_foods WHERE profile_id = $1 ORDER BY name',
      [req.params.profileId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/foods/:profileId/favorites - toggle favorite
router.post('/:profileId/favorites', async (req, res) => {
  try {
    if (!(await verifyProfile(req.params.profileId, req.userId))) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const { name, brand, kcal_per_100g, protein, carbs, fat } = req.body;
    const profileId = req.params.profileId;

    // Check if already favorited
    const existing = await pool.query(
      'SELECT id FROM favorite_foods WHERE profile_id = $1 AND name = $2',
      [profileId, name]
    );

    if (existing.rows.length > 0) {
      // Remove (toggle off)
      await pool.query('DELETE FROM favorite_foods WHERE id = $1', [existing.rows[0].id]);
      res.json({ favorited: false });
    } else {
      // Add (toggle on)
      await pool.query(
        `INSERT INTO favorite_foods (profile_id, name, brand, kcal_per_100g, protein, carbs, fat)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [profileId, name, brand || 'Built-in', kcal_per_100g, protein ?? null, carbs ?? null, fat ?? null]
      );
      res.json({ favorited: true });
    }
  } catch (err) {
    if (err.code === '23505') {
      // Race condition - already exists, just return
      res.json({ favorited: true });
    } else {
      res.status(500).json({ error: 'Server error' });
    }
  }
});

module.exports = router;
