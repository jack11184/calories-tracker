const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profiles');
const entryRoutes = require('./routes/entries');
const foodRoutes = require('./routes/foods');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Serve the frontend (index.html, app.js, styles.css) from parent directory
app.use(express.static(path.join(__dirname, '..')));

// DB connection test
const pool = require('./db');
app.get('/api/ping', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/profiles', profileRoutes);
app.use('/api/entries', entryRoutes);
app.use('/api/foods', foodRoutes);

// Fallback to index.html for SPA
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
