/**
 * Netlify Scheduled Function (backlog B3-04) — once a day at 01:00 UTC (08:00 in Vietnam) it asks the
 * app to run its idempotent daily jobs: inactivity reminders, the 30-day raw-photo purge and the
 * internal-live retention sweeps. All the logic lives behind /api/cron/daily; this file only knocks.
 *
 * Needs the CRON_SECRET site env var (24+ random characters). Without it the route answers 404 and
 * nothing runs. Netlify provides URL (the site's primary URL).
 */
export default async () => {
  const secret = process.env.CRON_SECRET;
  const base = process.env.URL;
  if (!secret || !base) {
    console.log('daily-cron: CRON_SECRET or URL missing — skipped');
    return;
  }
  const res = await fetch(`${base}/api/cron/daily`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
  });
  console.log(`daily-cron: ${res.status} ${(await res.text()).slice(0, 500)}`);
};

export const config = { schedule: '0 1 * * *' };
