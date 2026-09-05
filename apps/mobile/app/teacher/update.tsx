import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { TeacherNav } from '@/nav';
import { theme } from '@/theme';
import { Body, Button, Card, ErrorNote, Field, Loading, Muted, Overline, Screen } from '@/ui';
import { errText, useClient, useQuery } from '@/useApi';
import type { Subject, TeacherChildRow } from '@/types';

const TYPES = [
  { value: 'CURRENT_LESSON', label: 'Bài đang dạy' },
  { value: 'CURRICULUM_PROGRESS', label: 'Tiến độ chương trình' },
  { value: 'HOMEWORK', label: 'Bài tập về nhà' },
  { value: 'EXAM_NOTICE', label: 'Lịch kiểm tra' },
] as const;
type ContributionType = (typeof TYPES)[number]['value'];

export default function TeacherUpdate() {
  // Local to this screen — NOT the shared `useChild()` pref, which is the
  // PARENT workspace's remembered active child. A teacher's students are a
  // different set of childIds; reusing that global pref here would silently
  // overwrite a parent's selection on a device signed into both workspaces.
  const [childId, setChildId] = useState('');
  const api = useClient('TEACHER');
  const students = useQuery<TeacherChildRow[]>(() => api.get('/teacher/children'), []);
  const subjects = useQuery<Subject[]>(() => api.get('/subjects'), []);

  const [type, setType] = useState<ContributionType>('CURRENT_LESSON');
  const [subjectId, setSubjectId] = useState('');
  const [examDate, setExamDate] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();
  const [ok, setOk] = useState(false);

  const activeId = childId || students.data?.[0]?.childId || '';
  const activeSubjectId = subjectId || subjects.data?.[0]?.id || '';

  const submit = async () => {
    if (!activeId || !activeSubjectId) {
      setErr('Chọn học sinh và môn học.');
      return;
    }
    setBusy(true);
    setErr(undefined);
    setOk(false);
    try {
      await api.post(`/teacher/children/${activeId}/contributions`, {
        subjectId: activeSubjectId,
        contributionType: type,
        ...(type === 'EXAM_NOTICE' ? { examDate } : {}),
        ...(type !== 'EXAM_NOTICE' || note ? { note } : {}),
      });
      setOk(true);
      setNote('');
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen nav={<TeacherNav />} edges={['bottom']}>
      <View style={{ padding: 18, backgroundColor: theme.color.night, borderRadius: theme.radius.lg, gap: 8 }}>
        <Text style={{ fontSize: 11, fontWeight: '800', letterSpacing: 1, color: 'rgba(255,255,255,.55)' }}>
          CẬP NHẬT HÔM NAY
        </Text>
        <Text style={{ fontSize: 18, fontWeight: '700', lineHeight: 25, color: theme.color.onDark }}>
          Cho phụ huynh biết hôm nay đã dạy gì
        </Text>
        <Text style={{ fontSize: 13, lineHeight: 19.5, color: 'rgba(255,255,255,.6)' }}>
          Khoảng 40 giây. Phụ huynh dùng thông tin này để dạy con buổi tối.
        </Text>
      </View>

      {students.loading && <Loading />}
      {(students.data ?? []).length === 0 && !students.loading && (
        <Muted>Chưa có học sinh nào được phụ huynh chấp thuận.</Muted>
      )}

      {(students.data?.length ?? 0) > 0 && (
        <Card>
          <Overline>Học sinh</Overline>
          <View style={{ gap: 6 }}>
            {students.data!.map((s) => {
              const on = s.childId === activeId;
              return (
                <Pressable
                  key={s.childId}
                  onPress={() => setChildId(s.childId)}
                  style={{
                    padding: 12,
                    borderRadius: theme.radius.sm,
                    borderWidth: 1,
                    borderColor: on ? theme.color.primary : theme.color.border,
                    backgroundColor: on ? theme.color.primaryTint : theme.color.surface,
                  }}
                >
                  <Body>{s.displayName}</Body>
                </Pressable>
              );
            })}
          </View>
        </Card>
      )}

      {(subjects.data?.length ?? 0) > 0 && (
        <Card>
          <Overline>Môn học</Overline>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {subjects.data!.map((s) => {
              const on = s.id === activeSubjectId;
              return (
                <Pressable
                  key={s.id}
                  onPress={() => setSubjectId(s.id)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: on ? theme.color.primary : theme.color.border,
                    backgroundColor: on ? theme.color.primaryTint : theme.color.surface,
                  }}
                >
                  <Text style={{ fontSize: 13, fontWeight: '600', color: on ? theme.color.primaryStrong : theme.color.textBody }}>
                    {s.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Card>
      )}

      <Card>
        <Overline>Loại cập nhật</Overline>
        <View style={{ gap: 6 }}>
          {TYPES.map((t) => {
            const on = t.value === type;
            return (
              <Pressable
                key={t.value}
                onPress={() => setType(t.value)}
                style={{
                  padding: 12,
                  borderRadius: theme.radius.sm,
                  borderWidth: 1,
                  borderColor: on ? theme.color.primary : theme.color.border,
                  backgroundColor: on ? theme.color.primaryTint : theme.color.surface,
                }}
              >
                <Body>{t.label}</Body>
              </Pressable>
            );
          })}
        </View>

        {type === 'EXAM_NOTICE' && (
          <Field label="Ngày kiểm tra (YYYY-MM-DD)" value={examDate} onChangeText={setExamDate} placeholder="2027-05-15" />
        )}
        <Field
          label={
            type === 'HOMEWORK'
              ? 'Mã / mô tả bài tập (phân tách bằng dấu phẩy)'
              : type === 'EXAM_NOTICE'
                ? 'Phạm vi kiểm tra'
                : 'Ghi chú (không bắt buộc)'
          }
          value={note}
          onChangeText={setNote}
        />

        {err && <ErrorNote message={err} />}
        {ok && <Muted>Đã gửi cập nhật cho phụ huynh.</Muted>}
        <Button label="Gửi cập nhật" onPress={submit} loading={busy} />
      </Card>
    </Screen>
  );
}
