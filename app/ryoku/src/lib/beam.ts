/**
 * Position of the Beam's lit segment, as Ryoku's Beam scan moves it: one eased leg from
 * the left end to the right end, then one back, forever.
 */
export function bouncePosition(
  t: number,
  trackWidth: number,
  segmentWidth: number,
  legMs = 900,
): { x: number; back: boolean } {
  const travel = Math.max(0, trackWidth - segmentWidth);
  const phase = ((t % (2 * legMs)) + 2 * legMs) % (2 * legMs);
  const back = phase >= legMs;
  const u = (phase - (back ? legMs : 0)) / legMs;
  const eased = (1 - Math.cos(Math.PI * u)) / 2;
  const x = travel * (back ? 1 - eased : eased);
  return { x: Math.min(travel, Math.max(0, x)), back };
}
