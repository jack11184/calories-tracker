const express = require('express');
const pool = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();
router.use(auth);

// Helper to verify profile ownership
async function verifyProfile(profileId, userId) {
  const r = await pool.query('SELECT id FROM profiles WHERE id = $1 AND user_id = $2', [profileId, userId]);
  return r.rows.length > 0;
}

// GET /api/entries/:profileId?date=YYYY-MM-DD
// If no date, returns today. If date=range&from=X&to=Y, returns range.
router.get('/:profileId', async (req, res) => {
  try {
    if (!(await verifyProfile(req.params.profileId, req.userId))) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const { date, from, to } = req.query;

    let result;
    if (from && to) {
      // Date range query (for history/chart)
      result = await pool.query(
        `SELECT id, entry_date, entry_time, name, calories, protein, carbs, fat
         FROM food_entries WHERE profile_id = $1 AND entry_date BETWEEN $2 AND $3
         ORDER BY entry_date, entry_time`,
        [req.params.profileId, from, to]
      );
    } else {
      // Single date query
      const targetDate = date || new Date().toISOString().split('T')[0];
      result = await pool.query(
        `SELECT id, entry_date, entry_time, name, calories, protein, carbs, fat
         FROM food_entries WHERE profile_id = $1 AND entry_date = $2
         ORDER BY entry_time`,
        [req.params.profileId, targetDate]
      );
    }

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/entries/:profileId - add a food entry
router.post('/:profileId', async (req, res) => {
  try {
    if (!(await verifyProfile(req.params.profileId, req.userId))) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const { entry_date, entry_time, name, calories, protein, carbs, fat } = req.body;
    if (!name || calories == null) {
      return res.status(400).json({ error: 'Name and calories required' });
    }

    const d = entry_date || new Date().toISOString().split('T')[0];
    const t = entry_time || new Date().toTimeString().slice(0, 5);

    const result = await pool.query(
      `INSERT INTO food_entries (profile_id, entry_date, entry_time, name, calories, protein, carbs, fat)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.params.profileId, d, t, name, calories, protein ?? null, carbs ?? null, fat ?? null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/entries/:profileId/:entryId
router.delete('/:profileId/:entryId', async (req, res) => {
  try {
    if (!(await verifyProfile(req.params.profileId, req.userId))) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const result = await pool.query(
      'DELETE FROM food_entries WHERE id = $1 AND profile_id = $2 RETURNING id',
      [req.params.entryId, req.params.profileId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Entry not found' });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
