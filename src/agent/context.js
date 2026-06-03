let _override = null;      // { mode, expiry }

function getCurrentMode() {
  if (_override && new Date() < _override.expiry) return _override.mode;
  if (_override && new Date() >= _override.expiry) _override = null;

  const hour = new Date().getHours();
  if (hour >= 10 && hour < 18) return 'hexaware';
  if (hour >= 18 && hour < 23) return 'smartresq';
  return 'personal';
}

function setModeOverride(mode) {
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  _override = { mode, expiry: midnight };
}

function clearModeOverride() {
  _override = null;
}

function getModeDescription(mode) {
  const descriptions = {
    hexaware: 'Tarun is in Hexaware intern mode (10am–6pm). Focus: intern work tasks and GenAI learning capture.',
    smartresq: 'Tarun is in SmartResQ mode. Focus: startup work, intern PR reviews, product decisions.',
    personal: 'Tarun is in personal/rest mode (late night or early morning).',
  };
  return descriptions[mode];
}

module.exports = { getCurrentMode, setModeOverride, clearModeOverride, getModeDescription };
