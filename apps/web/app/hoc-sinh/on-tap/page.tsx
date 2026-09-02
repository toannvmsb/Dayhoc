import { redirect } from 'next/navigation';
import { Screen, StudentNav } from '../../components';
import { getApi, getViewer, studentAuth } from '@/lib/server/api';

export const dynamic = 'force-dynamic';

export default async function StudentReview() {
  const viewer = await getViewer();
  if (!viewer) redirect('/welcome');
  if (!viewer.roles.includes('STUDENT')) redirect('/');

  const review = await getApi().studentGetReview(studentAuth());

  return (
    <Screen nav={<StudentNav active="review" />}>
      <h1 className="h1">Ôn tập</h1>

      <div className="card">
        <span className="overline">Nên xem lại</span>
        {review.revisit.length === 0 ? (
          <p style={{ margin: 0, fontSize: 14, color: 'var(--c-text-body)' }}>
            Chưa có phần nào cần ôn lại. Con đang theo kịp tốt!
          </p>
        ) : (
          review.revisit.map((r, i) => (
            <div key={i} style={{ fontSize: 14, color: 'var(--c-text-heading)' }}>
              • {r.topic}
            </div>
          ))
        )}
      </div>

      <div className="card">
        <span className="overline">Bài chưa xong</span>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--c-text-body)' }}>
          {review.unfinished > 0
            ? `Con còn ${review.unfinished} bài đang làm dở — hoàn thành nốt nhé.`
            : 'Con không còn bài nào dang dở. Tuyệt vời!'}
        </p>
      </div>

      <p className="muted" style={{ textAlign: 'center' }}>
        Con đã hoàn thành {review.recent} buổi luyện gần đây
      </p>
    </Screen>
  );
}
