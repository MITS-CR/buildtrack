/**
 * BuildTrack — Express Server
 * Serves the frontend and exposes the /api/media REST endpoints.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const mediaRouter = require('./api/media');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Static files (frontend) ───────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/media', mediaRouter);

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'BuildTrack',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ── Catch-all: return index.html for SPA routing ─────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ BuildTrack server running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
