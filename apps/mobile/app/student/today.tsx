import { Pressable } from 'react-native';
import { router } from 'expo-router';
import { StudentNav } from '@/nav';
import { Body, Card, ErrorNote, H1, Loading, Muted, Overline, Screen } from '@/ui';
import { useClient, useQuery } from '@/useApi';
import type { ChildToday } from '@/types';

export default function StudentToday() {
  const api = useClient('STUDENT');
  const q = useQuery<ChildToday>(() => api.get('/student/today'), []);

  return (
    <Screen nav={<StudentNav />} edges={['bottom']}>
      {q.loading && <Loading />}
      {q.error && <ErrorNote message={q.error} />}
      {q.data && (
        <>
          <Overline>Xin chào {q.data.greetingName}</Overline>
          <H1>Hôm nay của con</H1>
          <Body>{q.data.summary}</Body>

          {q.data.tasks.length === 0 ? (
            <Card>
              <Body>Hôm nay con không có bài bắt buộc. Con có thể tự luyện thêm ở mục Bài tập nhé!</Body>
            </Card>
          ) : (
            q.data.tasks.map((t) => (
              <Pressable
                key={t.assignmentId}
                onPress={() => router.push({ pathname: '/run/[assignmentId]', params: { assignmentId: t.assignmentId } })}
              >
                <Card>
                  <Body>{t.title}</Body>
                  <Muted>{t.subtitle}</Muted>
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
