// The Log headline: kcal left or over today, and protein to go. Plain ink, never red.
// To check entries count in today's totals as estimates, so they make the figures "~".

import { entriesOn, dayTotal, isEstimated } from './entries.js';
import { roundDiv, formatKcal, formatGrams } from './nutrition.js';

/**
 * target is dayTarget()'s answer for date (exercise added back in fixed mode only); exercise is
 * dayExercise()'s. Returns { kcal, over, estimated, text, proteinText } or null with no target.
 */
export function headline({ entries, date, target, exercise = null }) {
  if (!target) return null;
  const eaten = dayTotal(entries, date);
  const estimated = entriesOn(entries, date).some(isEstimated) || (target.addBackKcal > 0 && !!exercise?.estimated);
  const t = estimated ? '~' : '';
  const left = roundDiv(target.kcal * 1000 - (eaten.kcalMilli ?? 0), 1000);
  const over = left < 0;
  const text = over ? `${t}${formatKcal(-left)} over today.` : `${t}${formatKcal(left)} left today.`;
  let proteinText = null;
  if (target.proteinG) {
    const toGo = roundDiv(target.proteinG * 1_000_000 - (eaten.proteinUg ?? 0), 1_000_000);
    const p = estimated || eaten.unknown.proteinUg ? '~' : '';
    proteinText = toGo > 0 ? `${p}${formatGrams(toGo, 'protein')} to go.` : 'Protein target reached.';
  }
  return { kcal: Math.abs(left), over, estimated, text, proteinText };
}
