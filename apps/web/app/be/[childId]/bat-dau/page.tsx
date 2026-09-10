import { notFound, redirect } from 'next/navigation';
import { getApi, getViewer, parentAuth } from '@/lib/server/api';
import { ActionForm, Field, LessonPicker, type LessonChapter } from '../../../ui';
import { setLearningStartAction } from '@/lib/server/actions';

export const dynamic = 'force-dynamic';

export default async function LearningStart({ params }: { params: { childId: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/welcome');

  let child;
  let program: { chapters: LessonChapter[] } = { chapters: [] };
  try {
    child = await getApi().getChild(parentAuth(), params.childId);
    const grade = 'schoolGrade' in child ? (child.schoolGrade as number) : 4;
    program = (await getApi().getCurriculumProgram(parentAuth(), grade)) as { chapters: LessonChapter[] };
  } catch {
    notFound();
  }

  const name = 'displayName' in child ? child.displayName : 'con';

  return (
    <div className="screen">
      <div className="screen__body" style={{ gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="overline">Bước 2 / 2</span>
          <h1 className="h1">{name} đang học đến đâu?</h1>
          <p style={{ margin: 0, color: 'var(--c-text-body)', fontSize: 15, lineHeight: 1.55 }}>
            Cho DạyZi biết con đang học đến bài nào trên lớp. Từ đó DạyZi tính ra phần con
            đã học qua và ra bài ôn tập đúng với kiến thức hiện tại của con — thay vì đoán.
          </p>
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
          <ActionForm action={setLearningStartAction} submitLabel="Xong — xem hôm nay ôn gì">
            <input type="hidden" name="childId" value={params.childId} />
            <LessonPicker chapters={program.chapters} />
            <Field name="schoolName" label="Tên trường (không bắt buộc)" placeholder="Tiểu học Nguyễn Du" />
            <Field name="className" label="Tên lớp (không bắt buộc)" placeholder="4A2" />
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
