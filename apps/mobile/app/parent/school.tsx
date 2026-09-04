import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useChild } from '@/child';
import { theme } from '@/theme';
import { Body, Button, Card, ErrorNote, Field, H1, Loading, Muted, Overline, Screen } from '@/ui';
import { errText, useClient, useQuery } from '@/useApi';
import type { AcademicYear, Child, ClassRow, EnrollmentInfo, SchoolRow } from '@/types';

const PRIVACY = [
  { value: 'PRIVATE_LEARNING', label: 'Riêng tư — chỉ bố mẹ thấy dữ liệu học tập' },
  { value: 'LINKED_PRIVATE', label: 'Gắn lớp, dữ liệu học tập vẫn riêng' },
  { value: 'LINKED_SHARED', label: 'Gắn lớp & cho giáo viên phụ trách cập nhật bài' },
];
const CLASS_TYPES = [
  { value: 'PRIMARY', label: 'Lớp chính' },
  { value: 'SUPPLEMENTARY', label: 'Lớp học thêm' },
  { value: 'HSG_TEAM', label: 'Đội tuyển HSG' },
  { value: 'TUTOR_GROUP', label: 'Nhóm gia sư' },
];
const PRIVACY_LABEL: Record<string, string> = Object.fromEntries(PRIVACY.map((p) => [p.value, p.label]));

function Chips({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={{ gap: 6 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 9,
              borderRadius: theme.radius.sm,
              borderWidth: 1,
              borderColor: on ? theme.color.primary : theme.color.border,
              backgroundColor: on ? theme.color.primaryTint : theme.color.surface,
            }}
          >
            <Muted>
              {on ? '● ' : '○ '}
              {o.label}
            </Muted>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function SchoolScreen() {
  const { childId } = useChild();
  const api = useClient('PARENT');
  const children = useQuery<Child[]>(() => api.get('/children'), []);
  const years = useQuery<AcademicYear[]>(() => api.get('/academic-years'), []);
  const enr = useQuery<EnrollmentInfo>(() => api.get(`/children/${childId}/enrollments`), [childId]);

  const grade = children.data?.find((c) => c.childId === childId)?.schoolGrade ?? 4;
  const year = years.data?.find((y) => y.status === 'ACTIVE') ?? years.data?.[0];

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();

  const [q, setQ] = useState('');
  const [results, setResults] = useState<SchoolRow[] | null>(null);
  const [picked, setPicked] = useState<SchoolRow | null>(null);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [newSchool, setNewSchool] = useState('');
  const [newClass, setNewClass] = useState('');
  const [classType, setClassType] = useState('PRIMARY');
  const [privacy, setPrivacy] = useState('LINKED_PRIVATE');

  useFocusEffect(
    useCallback(() => {
      enr.reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [childId]),
  );

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(undefined);
    try {
      await fn();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const search = () =>
    run(async () => {
      setResults(await api.get<SchoolRow[]>('/schools', { q: q.trim() }));
    });

  const pickSchool = (s: SchoolRow) =>
    run(async () => {
      setPicked(s);
      setResults(null);
      setClasses(year ? await api.get<ClassRow[]>(`/schools/${s.id}/classes`, { academicYearId: year.id }) : []);
    });

  const proposeSchool = () =>
    run(async () => {
      const res = await api.post<{ school: SchoolRow }>('/schools', { officialName: newSchool.trim() });
      setNewSchool('');
      await pickSchool(res.school);
    });

  const enrollSchool = () =>
    run(async () => {
      if (!picked || !year) return;
      await api.post(`/children/${childId}/enrollments/school`, {
        schoolId: picked.id,
        academicYearId: year.id,
        grade,
      });
      enr.reload();
    });

  const addClass = () =>
    run(async () => {
      if (!picked || !year || !newClass.trim()) return;
      const res = await api.post<{ id: string; className: string }>(`/schools/${picked.id}/classes`, {
        academicYearId: year.id,
        grade,
        className: newClass.trim(),
      });
      setNewClass('');
      setClasses((cs) => [
        ...cs,
        { id: res.id, grade, className: res.className, displayName: res.className, verificationStatus: 'PROPOSED' },
      ]);
    });

  const enrollClass = (classroomId: string) =>
    run(async () => {
      if (!year) return;
      await api.post(`/children/${childId}/enrollments/class`, {
        classroomId,
        academicYearId: year.id,
        enrollmentType: classType,
        privacyMode: privacy,
      });
      enr.reload();
    });

  const changePrivacy = (classEnrollmentId: string, mode: string) =>
    run(async () => {
      await api.patch(`/children/${childId}/class-enrollments/${classEnrollmentId}/privacy`, {
        privacyMode: mode,
      });
      enr.reload();
    });

  const schoolEnrolled = (enr.data?.school ?? []).length > 0;

  return (
    <Screen>
      <H1>Trường & lớp</H1>
      <Muted>
        Không bắt buộc. Khai báo trường/lớp giúp DạyZi ước lượng con đang học tới bài nào theo lịch năm học.
      </Muted>
      {err && <ErrorNote message={err} />}

      {(enr.loading || children.loading) && <Loading />}

      {(enr.data?.school ?? []).length > 0 && (
        <Card>
          <Overline>Trường đang học</Overline>
          {enr.data!.school.map((s) => (
            <Body key={s.id}>
              {s.schoolName ?? 'Trường'} · Lớp {s.grade}
            </Body>
          ))}
        </Card>
      )}

      {(enr.data?.class ?? []).length > 0 && (
        <Card>
          <Overline>Lớp học của con</Overline>
          {enr.data!.class.map((c) => (
            <View key={c.id} style={{ gap: 6, marginTop: 6 }}>
              <Body>
                {c.className ?? 'Lớp'} · {CLASS_TYPES.find((t) => t.value === c.enrollmentType)?.label ?? c.enrollmentType}
              </Body>
              <Muted>Chế độ chia sẻ: {PRIVACY_LABEL[c.privacyMode] ?? c.privacyMode}</Muted>
              <Chips options={PRIVACY} value={c.privacyMode} onChange={(m) => changePrivacy(c.id, m)} />
            </View>
          ))}
        </Card>
      )}

      <Card>
        <Overline>{schoolEnrolled ? 'Thêm lớp khác' : 'Chọn trường của con'}</Overline>
        {!picked && (
          <>
            <Field label="Tên trường" value={q} onChangeText={setQ} placeholder="VD: THCS Thử Nghiệm" />
            <Button label="Tìm trường" onPress={search} loading={busy} />
            {results?.length === 0 && (
              <>
                <Muted>Không thấy trường. Bạn có thể đề xuất trường mới:</Muted>
                <Field label="Tên trường đầy đủ" value={newSchool} onChangeText={setNewSchool} />
                <Button label="Đề xuất trường" tone="ghost" onPress={proposeSchool} loading={busy} />
              </>
            )}
            {(results ?? []).map((s) => (
              <Pressable key={s.id} onPress={() => pickSchool(s)}>
                <Card>
                  <Body>{s.officialName}</Body>
                  <Muted>
                    {[s.district, s.province].filter(Boolean).join(', ') || 'Chưa rõ địa bàn'}
                  </Muted>
                </Card>
              </Pressable>
            ))}
          </>
        )}

        {picked && (
          <>
            <Body>Trường: {picked.officialName}</Body>
            <Button label="Đổi trường" tone="ghost" onPress={() => setPicked(null)} />

            {!schoolEnrolled && (
              <Button label="Ghi nhận con học trường này" onPress={enrollSchool} loading={busy} />
            )}

            <View style={{ height: 8 }} />
            <Overline>Chọn lớp</Overline>
            {classes.length === 0 && <Muted>Chưa có lớp nào. Thêm lớp bên dưới.</Muted>}

            <Overline>Loại lớp</Overline>
            <Chips options={CLASS_TYPES} value={classType} onChange={setClassType} />
            <Overline>Chế độ chia sẻ khi gán</Overline>
            <Chips options={PRIVACY} value={privacy} onChange={setPrivacy} />

            {classes.map((c) => (
              <Pressable key={c.id} onPress={() => enrollClass(c.id)}>
                <Card>
                  <Body>{c.displayName || c.className}</Body>
                  <Muted>Nhấn để gán con vào lớp này</Muted>
                </Card>
              </Pressable>
            ))}

            <View style={{ height: 8 }} />
            <Field label="Tên lớp mới (VD: 4A2)" value={newClass} onChangeText={setNewClass} />
            <Button label="Thêm lớp" tone="ghost" onPress={addClass} loading={busy} />
          </>
        )}
      </Card>
    </Screen>
  );
}
