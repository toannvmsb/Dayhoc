import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Screen } from '../../../components';
import { getApi, getViewer, parentAuth } from '@/lib/server/api';
import { InviteCode, PendingRequest, TeacherLinkCard } from './client';

export const dynamic = 'force-dynamic';

export default async function Connect({ params }: { params: { childId: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/welcome');

  let links;
  let requests;
  let subjects;
  try {
    [links, requests, subjects] = await Promise.all([
      getApi().listTeacherLinks(parentAuth(), params.childId),
      getApi().listRelationshipRequests(parentAuth()),
      getApi().listSubjects(parentAuth()),
    ]);
  } catch {
    notFound();
  }

  const pending = requests.inbox.filter(
    (r) => r.targetChildId === params.childId && r.status === 'PENDING',
  );
  const accepted = links.filter((l) => l.status === 'ACCEPTED');
  const subjectName = new Map(subjects.map((s) => [String(s.id), s.name]));

  const linkPerms = await Promise.all(
    accepted.map((l) =>
      getApi()
        .getTeacherLinkPermissions(parentAuth(), params.childId, l.id)
        .then((p) => p.grants.map((g) => g.code as string))
        .catch(() => [] as string[]),
    ),
  );

  return (
    <Screen nav={null}>
      <Link href={`/be/${params.childId}/cai-dat`} className="chip">‹ Cài đặt</Link>
      <h1 className="h1">Kết nối giáo viên</h1>
      <p className="card" style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: 'var(--c-text-body)' }}>
        Bố mẹ vẫn dùng đầy đủ DạyZi mà không cần kết nối. Trước khi bố mẹ chấp thuận,
        giáo viên không xem được bất kỳ thông tin học tập nào của con.
      </p>

      {pending.length > 0 && (
        <div className="card">
          <span className="overline">Yêu cầu đang chờ bạn duyệt</span>
          {pending.map((r) => (
            <PendingRequest
              key={r.id}
              childId={params.childId}
              requestId={r.id}
              label={`${r.relationshipType ?? 'Giáo viên'}${
                r.subjectId ? ` · ${subjectName.get(String(r.subjectId)) ?? ''}` : ''
              }`}
              proposed={(r.proposedPermissions ?? []) as string[]}
            />
          ))}
        </div>
      )}

      {accepted.map((l, i) => (
        <TeacherLinkCard
          key={l.id}
          childId={params.childId}
          linkId={l.id}
          title={l.teacherName ?? 'Giáo viên'}
          subtitle={[
            l.relationshipType,
            l.subjectId ? subjectName.get(String(l.subjectId)) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
          granted={linkPerms[i] ?? []}
        />
      ))}

      {accepted.length === 0 && pending.length === 0 && (
        <p className="muted">Chưa có giáo viên nào được kết nối.</p>
      )}

      <div className="card">
        <span className="overline">Mời giáo viên bằng mã</span>
        <InviteCode
          childId={params.childId}
          subjects={subjects.map((s) => ({ id: String(s.id), name: s.name }))}
        />
      </div>
    </Screen>
  );
}
