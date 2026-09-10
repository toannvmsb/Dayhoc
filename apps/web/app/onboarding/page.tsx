import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/server/api';
import { ActionForm, Field, GradePicker } from '../ui';
import { createChildAction, logoutAction } from '@/lib/server/actions';

export const dynamic = 'force-dynamic';

export default async function Onboarding() {
  const viewer = await getViewer();
  if (!viewer) redirect('/welcome');

  return (
    <div className="screen">
      <div className="screen__body" style={{ gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="overline">Bước 1 / 2</span>
          <h1 className="h1">Thêm con của bạn</h1>
          <p style={{ margin: 0, color: 'var(--c-text-body)', fontSize: 15, lineHeight: 1.55 }}>
            Bước tiếp theo bạn sẽ cho DạyZi biết con đang học đến bài nào trên lớp — để
            nội dung ôn tập bám đúng chương trình, không đoán.
          </p>
        </div>

        <ActionForm action={createChildAction} submitLabel="Tiếp tục">
          <Field name="displayName" label="Tên con" placeholder="Bé An" required />
          <GradePicker />
        </ActionForm>

        <form action={logoutAction}>
          <button
            type="submit"
            style={{ background: 'none', border: 'none', color: 'var(--c-text-muted)', fontSize: 13, cursor: 'pointer' }}
          >
            Đăng xuất
          </button>
        </form>
      </div>
    </div>
  );
}
