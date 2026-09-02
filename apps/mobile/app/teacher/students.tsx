import { useState } from 'react';
import { Pressable } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/auth';
import { TeacherNav } from '@/nav';
import { Body, Button, Card, ErrorNote, Field, H1, Loading, Muted, Overline, Screen } from '@/ui';
import { useClient, useQuery } from '@/useApi';
import type { TeacherChildRow } from '@/types';

export default function TeacherStudents() {
  const { signOut } = useAuth();
  const api = useClient('TEACHER');
  const list = useQuery<TeacherChildRow[]>(() => api.get('/teacher/children'), []);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();
  const [ok, setOk] = useState(false);

  const redeem = async () => {
    if (!code.trim()) return;
    setBusy(true);
    setErr(undefined);
    setOk(false);
    try {
      await api.post('/teacher/redeem-code', { code: code.trim().toUpperCase() });
      setOk(true);
      setCode('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Mã không hợp lệ.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen nav={<TeacherNav />} edges={['bottom']}>
      <H1>Học sinh</H1>

      <Card>
        <Overline>Nhập mã kết nối từ phụ huynh</Overline>
        <Field label="Mã" value={code} onChangeText={setCode} placeholder="9F3A2C7B1E4D" />
        {err && <ErrorNote message={err} />}
        {ok && <Muted>Đã gửi yêu cầu. Phụ huynh cần chấp thuận trước khi bạn thấy thông tin.</Muted>}
        <Button label="Gửi yêu cầu kết nối" onPress={redeem} loading={busy} />
      </Card>

      {list.loading && <Loading />}
      {(list.data ?? []).length === 0 && !list.loading && (
        <Muted>Chưa có học sinh nào được phụ huynh chấp thuận.</Muted>
      )}
      {(list.data ?? []).map((c) => (
        <Pressable
          key={c.childId}
          onPress={() => router.push({ pathname: '/teacher/[childId]', params: { childId: c.childId } })}
        >
          <Card>
            <Body>{c.displayName}</Body>
            <Muted>{c.subjectId ? 'Có phân môn' : 'Chưa gắn môn'}</Muted>
          </Card>
        </Pressable>
      ))}

      <Button label="Đăng xuất" tone="ghost" onPress={signOut} />
    </Screen>
  );
}
