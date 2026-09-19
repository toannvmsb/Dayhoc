import { notFound, redirect } from 'next/navigation';
import { getApi, getViewer, parentAuth } from '@/lib/server/api';
import { daysAgoLabel } from '../../../components';
import { ActionForm, LessonPicker, type LessonChapter } from '../../../ui';
import { setLearningStartAction } from '@/lib/server/actions';

export const dynamic = 'force-dynamic';

export default async function LearningStart({ params }: { params: { childId: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/welcome');

  let child;
  let program: { chapters: LessonChapter[] } = { chapters: [] };
  let currentLessonId = '';
  let lastVerifiedAt: string | null = null;
  let hasConfirmedBefore = false;
  try {
    child = await getApi().getChild(parentAuth(), params.childId);
    const grade = 'schoolGrade' in child ? (child.schoolGrade as number) : 4;
    const [prog, ctx] = await Promise.all([
      getApi().getCurriculumProgram(parentAuth(), grade),
      getApi().getLearningContext(parentAuth(), params.childId),
    ]);
    program = prog as { chapters: LessonChapter[] };
    currentLessonId = ctx.resolved.lessonId ?? '';
    lastVerifiedAt = ctx.resolved.lastVerifiedAt;
    hasConfirmedBefore = ctx.resolved.confidence === 'VERIFIED' || ctx.resolved.confidence === 'STRONG';
  } catch {
    notFound();
  }

  const name = 'displayName' in child ? child.displayName : 'con';

  return (
    <div className="screen">
      <div className="screen__body" style={{ gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="overline">{hasConfirmedBefore ? 'Cập nhật hằng ngày' : 'Bước 2 / 2'}</span>
          <h1 className="h1">
            {hasConfirmedBefore ? `Hôm nay ${name} học đến đâu?` : `${name} đang học đến đâu?`}
          </h1>
          <p style={{ margin: 0, color: 'var(--c-text-body)', fontSize: 15, lineHeight: 1.55 }}>
            {hasConfirmedBefore
              ? 'Cập nhật mỗi khi con học sang bài mới ở trường — DạyZi tính lại đúng phần con đã học qua theo thời gian thực tế, để ra bài ôn tập bám sát con thay vì đoán theo lịch chương trình.'
              : 'Cho DạyZi biết con đang học đến bài nào trên lớp. Từ đó DạyZi tính ra phần con đã học qua và ra bài ôn tập đúng với kiến thức hiện tại của con — thay vì đoán.'}
          </p>
          {hasConfirmedBefore && (
            <span className="chip" style={{ alignSelf: 'flex-start', marginTop: 2 }}>
              Lần xác nhận gần nhất: {daysAgoLabel(lastVerifiedAt)}
            </span>
          )}
        </div>

        {program.chapters.length === 0 ? (
          <p className="card card--attention" style={{ margin: 0, fontSize: 13.5 }}>
            Chưa có dữ liệu chương trình cho lớp này. Bỏ qua bước này — bạn có thể khai báo
            sau trong <b>Hồ sơ con → Trường &amp; lớp</b>.
            <a href={`/be/${params.childId}`} style={{ display: 'block', marginTop: 8, fontWeight: 700 }}>
              Vào Hôm nay ›
            </a>
          </p>
        ) : (
          <ActionForm
            action={setLearningStartAction}
            submitLabel={hasConfirmedBefore ? 'Cập nhật' : 'Xong — xem hôm nay ôn gì'}
          >
            <input type="hidden" name="childId" value={params.childId} />
            <LessonPicker chapters={program.chapters} defaultValue={currentLessonId} />
          </ActionForm>
        )}

        <a
          href={`/be/${params.childId}`}
          style={{ color: 'var(--c-text-muted)', fontSize: 13, textAlign: 'center' }}
        >
          Để sau
        </a>
      </div>
    </div>
  );
}
