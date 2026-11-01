import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Screen, StudentNav } from '../../components';
import { getViewer } from '@/lib/server/api';
import { JoinClassForm } from './client';

export const dynamic = 'force-dynamic';

export default async function JoinClass() {
  const viewer = await getViewer();
  if (!viewer) redirect('/welcome');
  if (!viewer.roles.includes('STUDENT')) redirect('/');

  return (
    <Screen nav={<StudentNav active="home" />}>
      <div className="child-hero">
        <h1 className="h1" style={{ color: '#fff' }}>Vào lớp của con</h1>
        <p style={{ margin: 0, color: 'rgba(255,255,255,.9)', fontSize: 14.5 }}>
          Nhập mã lớp thầy/cô đưa. Bố mẹ sẽ đồng ý trước khi con vào lớp.
        </p>
      </div>
      <div className="screen__body" style={{ gap: 12 }}>
        <JoinClassForm />
        <Link href="/hoc-sinh" className="chip" style={{ alignSelf: 'flex-start' }}>‹ Về Hôm nay</Link>
      </div>
    </Screen>
  );
}
