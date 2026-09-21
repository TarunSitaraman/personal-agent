// Turns the nudge model's raw output into a message worth sending, or null.
//
// The model tends to narrate its checklist ("No One Big Thing pending, so skip that.") and to
// prefix lines with the section it is answering ("Automation suggestion: …"). Both went out
// verbatim before. A reply that is only narration, or any spelling of SKIP, sends nothing.

const SKIP = /^\W*skip\b/i;

// Lines that describe the model's reasoning rather than say something to Tarun.
const NARRATION = [
  /\bso (i'?ll )?skip(ping)?\b/i,
  /\bskipping\b/i,
  /^\W*(no|none)\b.*\b(pending|urgent|set)\b/i,
  /^\W*priority\s*\d\b[^:]*:\s*(none|n\/a|nothing)\b/i,
  /^\W*nothing (urgent|pending|to (report|flag))\b/i,
];

// "Proactive nudge:", "Automation suggestion:", "Priority 3 (General):" — labels, not content.
const LABEL = /^\W*(proactive nudge|automation( suggestion)?|goal check|general|nudge|priority\s*\d(\s*\([^)]*\))?)\s*:\s*/i;

function cleanNudge(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text || SKIP.test(text)) return null;

  const lines = text.split('\n')
    .map(line => line.trimEnd())
    .filter(line => !NARRATION.some(re => re.test(line)))
    .map(line => {
      let out = line;
      while (LABEL.test(out)) out = out.replace(LABEL, ''); // "Proactive nudge: Automation: …"
      return out;
    })
    .filter(line => line.trim());

  return lines.length ? lines.join('\n') : null;
}

module.exports = { cleanNudge };
