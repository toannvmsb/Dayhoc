import { useState } from 'react';
import { Pressable } from 'react-native';
import { router } from 'expo-router';
import { StudentNav } from '@/nav';
import { Body, Button, Card, ErrorNote, H1, Loading, Muted, Overline, Screen } from '@/ui';
import { useClient, useQuery } from '@/useApi';
import type { Assignment } from '@/types';

export default function StudentPractice() {
  const api = useClient('STUDENT');
  const me = useQuery<{ childId: string }>(() => api.get('/student/me'), []);
  const list = useQuery<Assignment[]>(() => api.get('/student/assignments'), []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();

  const open = (list.data ?? []).filter((a) => a.status !== 'COMPLETED' && a.status !== 'CANCELLED');

  const start = async () => {
    if (!me.data) return;
    setBusy(true);
    setErr(undefined);
    try {
      const res = await api.post<{ assignmentIds: string[] }>(
        `/children/${me.data.childId}/practice`,
        { minutes: 15 },
      );
      if (res.assignmentIds[0]) {
        router.push({ pathname: '/run/[assignmentId]', params: { assignmentId: res.assignmentIds[0] } });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Không tạo được bài.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen nav={<StudentNav />} edges={['bottom']}>
      <H1>Bài tập</H1>
      <Card>
        <Overline>Tự luyện tập</Overline>
        {err && <ErrorNote message={err} />}
        <Button label="Luyện 15 phút" onPress={start} loading={busy} />
      </Card>

      {list.loading && <Loading />}
      {open.map((a) => (
        <Pressable
          key={a.id}
          onPress={() => router.push({ pathname: '/run/[assignmentId]', params: { assignmentId: a.id } })}
        >
          <Card>
            <Body>Buổi luyện tập</Body>
            <Muted>{a.targetSkillIds.length} kỹ năng</Muted>
          </Card>
        </Pressable>
      ))}
      {open.length === 0 && !list.loading && (
        <Muted>Con chưa có bài nào đang làm dở. Nhấn “Luyện 15 phút” nhé.</Muted>
      )}
    </Screen>
  );
}
