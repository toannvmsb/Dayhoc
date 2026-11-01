/**
 * Vietnam civil time (Asia/Ho_Chi_Minh = UTC+7, no DST). "Today" for a family is the Vietnam
 * calendar day, not the UTC day — a worksheet made at 06:30 in Hanoi must not count as "yesterday".
 */
const VN_OFFSET_MS = 7 * 3_600_000;

/** YYYY-MM-DD of `d` on the Vietnam calendar. */
export function vnDay(d: Date): string {
  return new Date(d.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** The most recent Monday on/before `d` (Vietnam calendar), as YYYY-MM-DD. */
export function vnMostRecentMonday(d: Date): string {
  const shifted = new Date(d.getTime() + VN_OFFSET_MS);
  const daysSinceMonday = (shifted.getUTCDay() + 6) % 7; // 0=Sun..6=Sat
  return new Date(shifted.getTime() - daysSinceMonday * 86_400_000).toISOString().slice(0, 10);
}

/** SQL expression for the Vietnam calendar date of a timestamptz column/expression. */
export const VN_DATE_SQL = (expr: string): string => `(${expr} AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`;
