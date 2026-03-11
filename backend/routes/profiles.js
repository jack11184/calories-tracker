const express = require('express');
const pool = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();
router.use(auth);

// GET /api/profiles - list all profiles for user
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, goal, protein_goal, carbs_goal, fat_goal, is_active FROM profiles WHERE user_id = $1 ORDER BY created_at',
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/profiles - create a new profile
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Profile name required' });

    const result = await pool.query(
      'INSERT INTO profiles (user_id, name) VALUES ($1, $2) RETURNING *',
      [req.userId, name]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Profile name already exists' });
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/profiles/:id/activate - set active profile
router.put('/:id/activate', async (req, res) => {
  try {
    const profileId = req.params.id;
    // Verify ownership
    const check = await pool.query('SELECT id FROM profiles WHERE id = $1 AND user_id = $2', [profileId, req.userId]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Profile not found' });

    await pool.query('UPDATE profiles SET is_active = FALSE WHERE user_id = $1', [req.userId]);
    await pool.query('UPDATE profiles SET is_active = TRUE WHERE id = $1', [profileId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/profiles/:id - update goal/macros
router.put('/:id', async (req, res) => {
  try {
    const profileId = req.params.id;
    const { goal, protein_goal, carbs_goal, fat_goal } = req.body;

    const check = await pool.query('SELECT id FROM profiles WHERE id = $1 AND user_id = $2', [profileId, req.userId]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Profile not found' });

    const result = await pool.query(
      `UPDATE profiles SET goal = COALESCE($1, goal), protein_goal = $2, carbs_goal = $3, fat_goal = $4
       WHERE id = $5 RETURNING *`,
      [goal, protein_goal ?? null, carbs_goal ?? null, fat_goal ?? null, profileId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/profiles/:id
router.delete('/:id', async (req, res) => {
  try {
    const profileId = req.params.id;
    // Check at least 2 profiles exist
    const count = await pool.query('SELECT COUNT(*) FROM profiles WHERE user_id = $1', [req.userId]);
    if (parseInt(count.rows[0].count) <= 1) {
      return res.status(400).json({ error: 'Cannot delete last profile' });
    }

    const result = await pool.query('DELETE FROM profiles WHERE id = $1 AND user_id = $2 RETURNING id', [profileId, req.userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Profile not found' });

    // If deleted profile was active, activate another
    await pool.query(
      `UPDATE profiles SET is_active = TRUE WHERE id = (
         SELECT id FROM profiles WHERE user_id = $1 AND is_active = FALSE LIMIT 1
       )`,
      [req.userId]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/profiles/:id/plan-stats
router.get('/:id/plan-stats', async (req, res) => {
  try {
    const check = await pool.query('SELECT id FROM profiles WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Profile not found' });

    const result = await pool.query('SELECT * FROM plan_stats WHERE profile_id = $1', [req.params.id]);
    res.json(result.rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/profiles/:id/plan-stats
router.put('/:id/plan-stats', async (req, res) => {
  try {
    const profileId = req.params.id;
    const { sex, age, ft, inches, lbs, activity } = req.body;

    const check = await pool.query('SELECT id FROM profiles WHERE id = $1 AND user_id = $2', [profileId, req.userId]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Profile not found' });

    const result = await pool.query(
      `INSERT INTO plan_stats (profile_id, sex, age, ft, inches, lbs, activity)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (profile_id) DO UPDATE SET sex=$2, age=$3, ft=$4, inches=$5, lbs=$6, activity=$7
       RETURNING *`,
      [profileId, sex, age, ft, inches, lbs, activity]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
