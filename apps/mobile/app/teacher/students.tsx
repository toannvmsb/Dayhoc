import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/auth';
import { TeacherNav } from '@/nav';
import { theme } from '@/theme';
import { Avatar, Button, Card, Chip, ErrorNote, Field, H1, Loading, Muted, Overline, Screen } from '@/ui';
import { errText, useClient, useQuery } from '@/useApi';
import { WorkspaceSwitcher } from '@/workspace-switcher';
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
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen nav={<TeacherNav />} edges={['bottom']}>
      <H1>Học sinh</H1>
      <WorkspaceSwitcher />

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
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Avatar label={c.displayName} size={38} />
              <Text style={{ flex: 1, fontSize: 15.5, fontWeight: '700', color: theme.color.textHeading }}>
                {c.displayName}
              </Text>
              <Chip label={c.subjectId ? 'Có phân môn' : 'Chưa gắn môn'} tone={c.subjectId ? 'primary' : 'neutral'} />
            </View>
          </Card>
        </Pressable>
      ))}

      <Button label="Đăng xuất" tone="ghost" onPress={signOut} />
    </Screen>
  );
}
