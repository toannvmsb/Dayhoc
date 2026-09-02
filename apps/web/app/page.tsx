import { redirect } from 'next/navigation';
import { getApi, getViewer, parentAuth } from '@/lib/server/api';

export const dynamic = 'force-dynamic';

export default async function Root() {
  const viewer = await getViewer();
  if (!viewer) redirect('/welcome');
  if (!viewer.roles.includes('PARENT')) redirect('/welcome');

  const children = await getApi().listChildren(parentAuth());
  if (children.length === 0) redirect('/onboarding');
  redirect(`/be/${children[0]!.childId}`);
}
