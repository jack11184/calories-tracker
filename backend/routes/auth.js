const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();

// ── CAPTCHA helpers ──────────────────────────────────────────────────────────
function rnd(max) { return (Math.random() * max).toFixed(1); }
function randDark() {
  return `rgb(${Math.floor(Math.random()*110)},${Math.floor(Math.random()*110)},${Math.floor(Math.random()*110)})`;
}
function randNoise() {
  return `rgb(${Math.floor(Math.random()*200)},${Math.floor(Math.random()*200)},${Math.floor(Math.random()*200)})`;
}

function generateCaptcha() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let text = '';
  for (let i = 0; i < 6; i++) text += chars[Math.floor(Math.random() * chars.length)];

  const w = 220, h = 72;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`;
  svg += `<rect width="${w}" height="${h}" fill="#efefef" rx="6"/>`;

  // Noise lines
  for (let i = 0; i < 10; i++) {
    svg += `<line x1="${rnd(w)}" y1="${rnd(h)}" x2="${rnd(w)}" y2="${rnd(h)}" stroke="${randNoise()}" stroke-width="${(Math.random()*2+0.5).toFixed(1)}"/>`;
  }
  // Noise dots
  for (let i = 0; i < 45; i++) {
    svg += `<circle cx="${rnd(w)}" cy="${rnd(h)}" r="1.4" fill="${randNoise()}"/>`;
  }
  // Characters — each with random position offset, rotation, size, dark color
  for (let i = 0; i < text.length; i++) {
    const x = 18 + i * 33;
    const y = 42 + (Math.random() * 18 - 9);
    const rot = (Math.random() * 52 - 26).toFixed(1);
    const size = (24 + Math.random() * 9).toFixed(0);
    svg += `<text x="${x}" y="${y}" font-size="${size}" font-family="Arial,sans-serif" fill="${randDark()}" transform="rotate(${rot},${x},${y})" font-weight="bold">${text[i]}</text>`;
  }
  svg += '</svg>';

  return { text, image: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64') };
}

// GET /api/auth/captcha
router.get('/captcha', (_req, res) => {
  const { text, image } = generateCaptcha();
  const token = jwt.sign({ captcha: text.toLowerCase() }, process.env.JWT_SECRET, { expiresIn: '5m' });
  res.json({ image, token });
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { username, password, captchaToken, captchaAnswer } = req.body;

    // Verify CAPTCHA first
    if (!captchaToken || !captchaAnswer) {
      return res.status(400).json({ error: 'Please complete the CAPTCHA.' });
    }
    try {
      const decoded = jwt.verify(captchaToken, process.env.JWT_SECRET);
      if (decoded.captcha !== captchaAnswer.trim().toLowerCase()) {
        return res.status(400).json({ error: 'Incorrect CAPTCHA. Please try again.' });
      }
    } catch {
      return res.status(400).json({ error: 'CAPTCHA expired. Please refresh and try again.' });
    }

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id, username',
      [username, hash]
    );

    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });

    res.status(201).json({ token, user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/me - verify token & get user info
router.get('/me', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, usda_api_key FROM users WHERE id = $1', [req.userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/auth/usda-key - save USDA API key for current user
router.put('/usda-key', auth, async (req, res) => {
  try {
    const { usda_api_key } = req.body;
    const key = typeof usda_api_key === 'string' ? usda_api_key.trim().slice(0, 64) : null;
    await pool.query('UPDATE users SET usda_api_key = $1 WHERE id = $2', [key || null, req.userId]);
    res.json({ usda_api_key: key || null });
  } catch (err) {
    console.error('Save USDA key error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
