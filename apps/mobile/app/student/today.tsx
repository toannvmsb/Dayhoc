import { useState } from 'react';
import { Pressable } from 'react-native';
import { router } from 'expo-router';
import { StudentNav } from '@/nav';
import { Body, Button, Card, ErrorNote, H1, Loading, Muted, Overline, Screen } from '@/ui';
import { errText, useClient, useQuery } from '@/useApi';
import type { ChildToday } from '@/types';

export default function StudentToday() {
  const api = useClient('STUDENT');
  const q = useQuery<ChildToday>(() => api.get('/student/today'), []);
  const me = useQuery<{ childId: string }>(() => api.get('/student/me'), []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();

  // The tasks in /student/today are a plan preview — their ids are ephemeral
  // (`asg_1`…), not real assignment rows. Tapping one materialises a real
  // practice session from the child's current plan, then opens the runner.
  const startTask = async () => {
    if (!me.data || busy) return;
    setBusy(true);
    setErr(undefined);
    try {
      const res = await api.post<{ assignmentIds: string[] }>(
        `/children/${me.data.childId}/practice`,
        { minutes: 15 },
      );
      if (res.assignmentIds[0]) {
        router.push({
          pathname: '/run/[assignmentId]',
          params: { assignmentId: res.assignmentIds[0] },
        });
      } else {
        setErr('Chưa tạo được bài luyện tập. Con thử lại sau nhé.');
      }
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen nav={<StudentNav />} edges={['bottom']} refreshing={q.loading} onRefresh={q.reload}>
      {q.loading && <Loading />}
      {q.error && <ErrorNote message={q.error} />}
      {err && <ErrorNote message={err} />}
      {q.data && (
        <>
          <Overline>Xin chào {q.data.greetingName}</Overline>
          <H1>Hôm nay của con</H1>
          <Body>{q.data.summary}</Body>

          {q.data.tasks.length === 0 ? (
            <Card>
              <Body>Con có thể làm thêm một buổi luyện tập nếu muốn.</Body>
              <Button
                label={busy ? 'Đang mở bài…' : 'Luyện thêm 15 phút'}
                onPress={startTask}
                loading={busy}
                disabled={busy}
              />
            </Card>
          ) : (
            q.data.tasks.map((t) => (
              <Pressable key={t.assignmentId} onPress={startTask} disabled={busy}>
                <Card>
                  <Body>{t.title}</Body>
                  <Muted>{busy ? 'Đang mở bài…' : t.subtitle}</Muted>
                </Card>
              </Pressable>
            ))
          )}
          {q.data.totalCount > 0 && (
            <Muted>
              Đã xong {q.data.doneCount}/{q.data.totalCount} việc hôm nay
            </Muted>
          )}
        </>
      )}
    </Screen>
  );
}
