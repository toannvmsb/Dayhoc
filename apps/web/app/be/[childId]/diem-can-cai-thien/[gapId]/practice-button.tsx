'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createTargetedPracticeAction } from '@/lib/server/actions';

/** "Giao con luyện tập phần này ngay" — creates one assignment scoped to this
 * gap's skill, ready for the child to do in their own login (Bài tập),
 * instead of waiting for the next whole-day plan to happen to include it. */
export function TargetedPracticeButton({ childId, gapId }: { childId: string; gapId: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const router = useRouter();

  if (done) {
    return (
      <p className="card" style={{ margin: 0, fontSize: 13.5, color: 'var(--c-text-body)' }}>
        Đã giao bài ôn tập cho phần này — con vào <b>Bài tập</b> trong ứng dụng của con để làm.
      </p>
    );
  }

  return (
    <>
      {err && <p className="card card--attention" style={{ margin: 0, fontSize: 13 }}>{err}</p>}
      <button
        type="button"
        className="cta cta--onteal"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setErr(null);
            try {
              await createTargetedPracticeAction(childId, gapId);
              setDone(true);
              router.refresh();
            } catch {
              setErr('Chưa đủ câu hỏi để ôn ngay phần này — thử lại sau.');
            }
          })
        }
      >
        {pending ? 'Đang soạn bài…' : 'Giao con luyện tập phần này ngay'}
      </button>
    </>
  );
}
