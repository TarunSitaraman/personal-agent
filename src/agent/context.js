const memory = require('./memory');

let _override = null; // { mode, expiry } — in-memory cache

// Load persisted override from DB on startup
async function initContext() {
  const row = await memory.loadModeOverride();
  if (row) {
    _override = { mode: row.value, expiry: new Date(row.expires_at) };
  }
}

function getCurrentMode() {
  if (_override && new Date() < _override.expiry) return _override.mode;
  if (_override) _override = null; // expired

  const hour = new Date().getHours();
  if (hour >= 10 && hour < 18) return 'hexaware';
  if (hour >= 18 && hour < 23) return 'smartresq';
  return 'personal';
}

async function setModeOverride(mode) {
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  _override = { mode, expiry: midnight };
  await memory.saveModeOverride(mode, midnight);
}

async function clearModeOverride() {
  _override = null;
  await memory.clearModeOverride();
}

function getModeDescription(mode) {
  const descriptions = {
    hexaware: 'Tarun is in Hexaware intern mode (10am–6pm). Focus: intern work tasks and GenAI learning capture.',
    smartresq: 'Tarun is in SmartResQ mode. Focus: startup work, intern PR reviews, product decisions.',
    personal: 'Tarun is in personal/rest mode (late night or early morning).',
  };
  return descriptions[mode];
}

module.exports = { initContext, getCurrentMode, setModeOverride, clearModeOverride, getModeDescription };
