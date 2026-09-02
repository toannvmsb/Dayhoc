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
          <span className="overline">Bắt đầu</span>
          <h1 className="h1">Thêm con của bạn</h1>
          <p style={{ margin: 0, color: 'var(--c-text-body)', fontSize: 15, lineHeight: 1.55 }}>
            Không bắt buộc kết nối trường/lớp. DạyZi sẽ ước tính nội dung con đang học
            theo tiến độ chương trình, và bạn có thể xác nhận lại bất cứ lúc nào.
          </p>
        </div>

        <ActionForm action={createChildAction} submitLabel="Tạo hồ sơ & xem hôm nay dạy gì">
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
