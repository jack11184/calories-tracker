const express = require('express');
const pool = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();
router.use(auth);

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
