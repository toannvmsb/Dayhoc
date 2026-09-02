import { Text } from 'react-native';
import { StudentNav } from '@/nav';
import { theme } from '@/theme';
import { Body, Card, ErrorNote, H1, Loading, Muted, Overline, Screen } from '@/ui';
import { useClient, useQuery } from '@/useApi';
import type { StudentProgress, StudentReview } from '@/types';

export default function StudentProgressScreen() {
  const api = useClient('STUDENT');
  const p = useQuery<StudentProgress>(() => api.get('/student/progress'), []);
  const r = useQuery<StudentReview>(() => api.get('/student/review'), []);

  return (
    <Screen nav={<StudentNav />} edges={['bottom']}>
      <H1>Tiến bộ của con</H1>
      {p.loading && <Loading />}
      {p.error && <ErrorNote message={p.error} />}
      {p.data && (
        <>
          <Card tone="primary">
            <Text style={{ color: theme.color.onDark, fontWeight: '700', fontSize: 15 }}>{p.data.line}</Text>
            <Text style={{ color: theme.color.onDark, fontSize: 12.5 }}>
              Đã hoàn thành {p.data.streakDone} buổi luyện
            </Text>
          </Card>
          <Card>
            <Overline>Con làm chắc</Overline>
            {p.data.solid.length === 0 ? (
              <Muted>Làm thêm vài bài để DạyZi thấy rõ điểm mạnh của con nhé.</Muted>
            ) : (
              p.data.solid.map((s, i) => <Body key={i}>✓ {s}</Body>)
            )}
          </Card>
          {p.data.growing.length > 0 && (
            <Card>
              <Overline>Đang tiến bộ</Overline>
              {p.data.growing.map((s, i) => (
                <Muted key={i}>→ {s}</Muted>
              ))}
            </Card>
          )}
        </>
      )}
      {r.data && (
        <Card>
          <Overline>Nên xem lại</Overline>
          {r.data.revisit.length === 0 ? (
            <Muted>Chưa có phần nào cần ôn lại. Con đang theo kịp tốt!</Muted>
          ) : (
            r.data.revisit.map((x, i) => <Body key={i}>• {x.topic}</Body>)
          )}
        </Card>
      )}
    </Screen>
  );
}
