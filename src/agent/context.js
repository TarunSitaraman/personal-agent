function getCurrentMode() {
  // All times are IST (TZ=Asia/Kolkata set in env)
  const hour = new Date().getHours();

  if (hour >= 10 && hour < 18) return 'hexaware';
  if (hour >= 18 && hour < 23) return 'smartresq';
  return 'personal';
}

function getModeDescription(mode) {
  const descriptions = {
    hexaware: 'Tarun is in Hexaware intern mode (10am–6pm). Focus: intern work tasks and GenAI learning capture.',
    smartresq: 'Tarun is in SmartResQ mode (6pm–11pm). Focus: startup work, intern PR reviews, product decisions.',
    personal: 'Tarun is in personal/rest mode (late night or early morning).',
  };
  return descriptions[mode];
}

module.exports = { getCurrentMode, getModeDescription };
