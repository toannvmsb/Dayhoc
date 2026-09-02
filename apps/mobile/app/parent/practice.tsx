import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useChild } from '@/child';
import { ParentNav } from '@/nav';
import { theme } from '@/theme';
import { Body, Button, Card, ErrorNote, H1, Loading, Muted, Overline, Screen } from '@/ui';
import { useClient, useQuery } from '@/useApi';
import type { Assignment } from '@/types';

const STATUS: Record<string, string> = {
  ASSIGNED: 'Chưa làm',
  IN_PROGRESS: 'Đang làm',
  COMPLETED: 'Đã xong',
  CANCELLED: 'Đã huỷ',
};

export default function ParentPractice() {
  const { childId } = useChild();
  const api = useClient('PARENT');
  const [minutes, setMinutes] = useState(20);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();

  const list = useQuery<Assignment[]>(() => api.get(`/children/${childId}/assignments`), [childId]);
  const open = (list.data ?? []).filter((a) => a.status !== 'COMPLETED' && a.status !== 'CANCELLED');
  const done = (list.data ?? []).filter((a) => a.status === 'COMPLETED');

  const create = async () => {
    setBusy(true);
    setErr(undefined);
    try {
      const res = await api.post<{ assignmentIds: string[] }>(`/children/${childId}/practice`, { minutes });
      if (res.assignmentIds[0]) {
        router.push({ pathname: '/run/[assignmentId]', params: { assignmentId: res.assignmentIds[0] } });
      } else list.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Không tạo được bài.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen nav={<ParentNav />} edges={['bottom']}>
      <H1>Bài tập</H1>
      <Card>
        <Overline>Tạo buổi luyện tập</Overline>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[10, 20, 30].map((m) => (
            <Pressable
              key={m}
              onPress={() => setMinutes(m)}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: theme.radius.sm,
                alignItems: 'center',
                borderWidth: 1,
                borderColor: m === minutes ? theme.color.primary : theme.color.border,
                backgroundColor: m === minutes ? theme.color.primaryTint : theme.color.surface,
              }}
            >
              <Body>{m}′</Body>
            </Pressable>
          ))}
        </View>
        {err && <ErrorNote message={err} />}
        <Button label={`Tạo bài ${minutes} phút`} onPress={create} loading={busy} />
        <Muted>DạyZi dùng ngân hàng câu hỏi soạn sẵn (chưa bật sinh đề bằng AI).</Muted>
      </Card>

      {list.loading && <Loading />}
      {open.map((a) => (
        <Pressable
          key={a.id}
          onPress={() => router.push({ pathname: '/run/[assignmentId]', params: { assignmentId: a.id } })}
        >
          <Card>
            <Body>Buổi luyện tập</Body>
            <Muted>
              {a.targetSkillIds.length} kỹ năng · {STATUS[a.status] ?? a.status}
            </Muted>
          </Card>
        </Pressable>
      ))}
      {done.length > 0 && (
        <Card>
          <Overline>Đã hoàn thành</Overline>
          {done.map((a) => (
            <Muted key={a.id}>Buổi luyện tập — {a.completedAt?.slice(0, 10) ?? 'xong'}</Muted>
          ))}
        </Card>
      )}
    </Screen>
  );
}
