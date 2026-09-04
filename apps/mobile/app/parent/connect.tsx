import { useState } from 'react';
import { Pressable, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useChild } from '@/child';
import { Body, Button, Card, ErrorNote, H1, Loading, Muted, Overline, Screen } from '@/ui';
import { errText, useClient, useQuery } from '@/useApi';
import { useReloadOnFocus } from '@/useReloadOnFocus';
import type {
  InviteCode,
  RelationshipRequest,
  TeacherLink,
  TeacherLinkPermissions,
} from '@/types';

const GROUPS: { title: string; note?: string; codes: { code: string; label: string }[] }[] = [
  { title: 'Thông tin lớp học', codes: [{ code: 'VIEW_CLASS_CONTEXT', label: 'Xem bối cảnh lớp con đang học' }] },
  {
    title: 'Bài học & bài giao',
    codes: [
      { code: 'SUBMIT_CURRENT_LESSON', label: 'Cập nhật bài đang dạy' },
      { code: 'SUBMIT_CURRICULUM_PROGRESS', label: 'Cập nhật tiến độ chương trình' },
      { code: 'SUBMIT_HOMEWORK', label: 'Cập nhật bài tập về nhà' },
      { code: 'SUBMIT_EXAM_NOTICE', label: 'Báo lịch kiểm tra' },
      { code: 'SUBMIT_EXAM_SCOPE', label: 'Báo phạm vi kiểm tra' },
      { code: 'VIEW_ASSIGNMENT_COMPLETION', label: 'Xem con đã hoàn thành bài giao chưa' },
    ],
  },
  {
    title: 'Thông tin học tập cá nhân',
    codes: [
      { code: 'VIEW_SELECTED_MASTERY', label: 'Xem mức độ nắm bài ở một số kỹ năng' },
      { code: 'SUBMIT_TEST_RESULT', label: 'Nhập kết quả bài kiểm tra' },
      { code: 'SUBMIT_SKILL_ASSESSMENT', label: 'Nhận xét mức độ nắm kỹ năng' },
      { code: 'SUBMIT_LEARNING_OBSERVATION', label: 'Ghi nhận quan sát học tập' },
    ],
  },
  {
    title: 'Nhạy cảm — mặc định tắt',
    note: 'Chỉ bật khi bạn thật sự muốn giáo viên thấy bức tranh học tập sâu của con.',
    codes: [
      { code: 'VIEW_LEARNING_TWIN_SUMMARY', label: 'Xem tóm tắt toàn cảnh mức độ hiểu bài' },
      { code: 'VIEW_SELECTED_GAPS', label: 'Xem những điểm con cần củng cố' },
    ],
  },
  { title: 'Trao đổi', codes: [{ code: 'MESSAGE_PARENT', label: 'Nhắn tin cho bố mẹ' }] },
];

function Checkbox({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', gap: 8, paddingVertical: 6 }}>
      <Body>{on ? '☑' : '☐'}</Body>
      <View style={{ flex: 1 }}>
        <Muted>{label}</Muted>
      </View>
    </Pressable>
  );
}

function PermissionEditor({ childId, link }: { childId: string; link: TeacherLink }) {
  const api = useClient('PARENT');
  const perms = useQuery<TeacherLinkPermissions>(
    () => api.get(`/children/${childId}/teacher-links/${link.id}/permissions`),
    [childId, link.id],
  );
  const [draft, setDraft] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();

  const granted = new Set((perms.data?.grants ?? []).map((g) => g.code));
  const current = draft ?? granted;
  const dirty = draft !== null && [...draft].sort().join(',') !== [...granted].sort().join(',');

  const toggle = (code: string) => {
    const next = new Set(current);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setDraft(next);
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setErr(undefined);
    try {
      await api.post(`/children/${childId}/teacher-links/${link.id}/permissions`, {
        grant: [...draft].filter((c) => !granted.has(c)),
        revoke: [...granted].filter((c) => !draft.has(c)),
      });
      setDraft(null);
      perms.reload();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  if (perms.loading) return <Loading />;

  return (
    <View style={{ gap: 4, marginTop: 8 }}>
      {GROUPS.map((g) => (
        <View key={g.title} style={{ marginTop: 6 }}>
          <Overline>{g.title}</Overline>
          {g.note ? <Muted>{g.note}</Muted> : null}
          {g.codes.map((c) => (
            <Checkbox key={c.code} on={current.has(c.code)} label={c.label} onPress={() => toggle(c.code)} />
          ))}
        </View>
      ))}
      {err && <ErrorNote message={err} />}
      {dirty && <Button label="Lưu quyền" onPress={save} loading={busy} />}
    </View>
  );
}

export default function ConnectScreen() {
  const { childId } = useChild();
  const api = useClient('PARENT');
  const links = useQuery<TeacherLink[]>(() => api.get(`/children/${childId}/teacher-links`), [childId]);
  const reqs = useQuery<{ inbox: RelationshipRequest[]; outbox: RelationshipRequest[] }>(
    () => api.get('/relationship-requests'),
    [childId],
  );

  const [open, setOpen] = useState<string | null>(null);
  const [invite, setInvite] = useState<InviteCode | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();

  const copyCode = async () => {
    if (!invite) return;
    await Clipboard.setStringAsync(invite.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useReloadOnFocus(() => {
    links.reload();
    reqs.reload();
  });

  const pending = (reqs.data?.inbox ?? []).filter(
    (r) => r.status === 'PENDING' && (!r.targetChildId || r.targetChildId === childId),
  );

  const respond = async (id: string, action: 'accept' | 'reject') => {
    setBusy(true);
    setErr(undefined);
    try {
      await api.post(`/relationship-requests/${id}/${action}`);
      reqs.reload();
      links.reload();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const makeCode = async () => {
    setBusy(true);
    setErr(undefined);
    try {
      setInvite(await api.post<InviteCode>(`/children/${childId}/invite-code`));
      setCopied(false);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <H1>Giáo viên của con</H1>
      <Muted>
        Bạn kiểm soát giáo viên nào được kết nối và họ thấy được gì. Có thể ngừng bất cứ lúc nào.
      </Muted>

      {err && <ErrorNote message={err} />}

      {pending.length > 0 && (
        <Card tone="attention">
          <Overline>Yêu cầu đang chờ</Overline>
          {pending.map((r) => (
            <View key={r.id} style={{ gap: 6, marginTop: 6 }}>
              <Body>Một giáo viên muốn kết nối để {r.proposedPermissions.length} quyền cơ bản.</Body>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Button label="Chấp thuận" onPress={() => respond(r.id, 'accept')} loading={busy} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button label="Từ chối" tone="ghost" onPress={() => respond(r.id, 'reject')} loading={busy} />
                </View>
              </View>
            </View>
          ))}
        </Card>
      )}

      {links.loading && <Loading />}
      {(links.data ?? []).length === 0 && !links.loading && pending.length === 0 && (
        <Muted>Chưa có giáo viên nào được kết nối với con.</Muted>
      )}
      {(links.data ?? []).map((l) => (
        <Card key={l.id}>
          <Pressable onPress={() => setOpen(open === l.id ? null : l.id)}>
            <Body>{l.teacherName}</Body>
            <Muted>
              {l.status === 'ACCEPTED' ? 'Đã kết nối' : l.status} · {open === l.id ? 'Ẩn quyền ▲' : 'Chỉnh quyền ▼'}
            </Muted>
          </Pressable>
          {open === l.id && <PermissionEditor childId={childId!} link={l} />}
        </Card>
      ))}

      <Card>
        <Overline>Mời giáo viên mới</Overline>
        <Muted>Tạo mã kết nối và gửi cho giáo viên. Giáo viên nhập mã, bạn sẽ nhận yêu cầu để chấp thuận.</Muted>
        {invite ? (
          <View style={{ gap: 6, marginVertical: 4 }}>
            <Body>Mã: {invite.code}</Body>
            <Muted>Hết hạn: {invite.expiresAt.slice(0, 10)}</Muted>
            <Button
              label={copied ? '✓ Đã sao chép' : 'Sao chép mã'}
              tone="ghost"
              onPress={copyCode}
            />
          </View>
        ) : null}
        <Button label={invite ? 'Tạo mã mới' : 'Tạo mã kết nối'} onPress={makeCode} loading={busy} />
      </Card>
    </Screen>
  );
}
