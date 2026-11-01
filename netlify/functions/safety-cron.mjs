/**
 * Netlify Scheduled Function — every 10 minutes it asks the app to run the AI safety auto-stop
 * (replaces `npm run cron:pilot:safety`, which needed a separate always-on host). Same CRON_SECRET as daily-cron.
 */
export default async () => {
  const secret = process.env.CRON_SECRET;
  const base = process.env.URL;
  if (!secret || !base) return;
  const res = await fetch(`${base}/api/cron/safety`, { method: 'POST', headers: { authorization: `Bearer ${secret}` } });
  const body = (await res.text()).slice(0, 300);
  if (!res.ok || body.includes('"tripped":true')) console.error(`safety-cron: ${res.status} ${body}`);
};

export const config = { schedule: '*/10 * * * *' };
