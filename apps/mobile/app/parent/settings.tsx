import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/auth';
import { useChild } from '@/child';
import { ParentNav } from '@/nav';
import { theme } from '@/theme';
import { Body, Button, Card, ErrorNote, Field, H1, Loading, Muted, Overline, Screen } from '@/ui';
import { errText, useClient, useQuery } from '@/useApi';
import { WorkspaceSwitcher } from '@/workspace-switcher';
import type { Child, Entitlements, StudentAccess } from '@/types';

const PLAN_LABEL: Record<string, string> = { free: 'Miễn phí', basic: 'Cơ bản', plus: 'Plus', pro: 'Pro' };

export default function SettingsScreen() {
  const { session, signOut } = useAuth();
  const { childId, setChildId } = useChild();
  const api = useClient('PARENT');

  const children = useQuery<Child[]>(() => api.get('/children'), [session?.bearer]);
  const ent = useQuery<Entitlements>(() => api.get('/me/entitlements'), [session?.bearer]);
  const access = useQuery<StudentAccess>(
    () => (childId ? api.get(`/children/${childId}/student-access`) : Promise.resolve(null)),
    [childId, session?.bearer],
  );

  const [name, setName] = useState('');
  const [grade, setGrade] = useState<4 | 7>(4);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();
  const [delName, setDelName] = useState('');

  const [saPass, setSaPass] = useState('');
  const [saShow, setSaShow] = useState(false);
  const [saBusy, setSaBusy] = useState(false);
  const [saErr, setSaErr] = useState<string | undefined>();

  const createAccess = async () => {
    if (!childId) return;
    if (saPass.length < 8) {
      setSaErr('Mật khẩu cần tối thiểu 8 ký tự.');
      return;
    }
    setSaBusy(true);
    setSaErr(undefined);
    try {
      await api.post(`/children/${childId}/student-access`, { password: saPass });
      setSaPass('');
      setSaShow(false);
      access.reload();
    } catch (e) {
      setSaErr(errText(e));
    } finally {
      setSaBusy(false);
    }
  };
  const revokeAccess = async () => {
    if (!childId) return;
    setSaBusy(true);
    setSaErr(undefined);
    try {
      await api.post(`/children/${childId}/student-access/revoke`);
      access.reload();
    } catch (e) {
      setSaErr(errText(e));
    } finally {
      setSaBusy(false);
    }
  };

  const addChild = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setErr(undefined);
    try {
      const c = await api.post<{ childId: string }>('/children', { displayName: name.trim(), schoolGrade: grade });
      setChildId(c.childId);
      setName('');
      children.reload();
      ent.reload();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const setPlan = async (plan: string) => {
    setBusy(true);
    try {
      await api.post('/me/plan', { plan });
      ent.reload();
    } finally {
      setBusy(false);
    }
  };

  const requestDeletion = async () => {
    if (!childId) return;
    await api.post(`/children/${childId}/deletion/request`);
    setErr(undefined);
  };
  const confirmDeletion = async () => {
    if (!childId) return;
    setBusy(true);
    setErr(undefined);
    try {
      await api.post(`/children/${childId}/deletion/confirm`, { confirmName: delName });
      setChildId('');
      children.reload();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen nav={<ParentNav />} edges={['bottom']}>
      <H1>Cài đặt</H1>

      <WorkspaceSwitcher />

      <Card>
        <Overline>Tài khoản</Overline>
        <Body>{session?.viewer.displayName ?? '—'}</Body>
        <Muted>{session?.viewer.roles.join(' · ')}</Muted>
        <Button label="Đăng xuất" tone="ghost" onPress={signOut} />
      </Card>

      <Card>
        <Overline>Con của bạn</Overline>
        {children.loading && <Loading />}
        {(children.data ?? []).map((c) => (
          <Pressable key={c.childId} onPress={() => setChildId(c.childId)}>
            <Body>
              {c.childId === childId ? '● ' : '○ '}
              {c.displayName} — lớp {c.schoolGrade}
            </Body>
          </Pressable>
        ))}
        <View style={{ height: 8 }} />
        <Field label="Tên con mới" value={name} onChangeText={setName} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[4, 7].map((g) => (
            <Pressable
              key={g}
              onPress={() => setGrade(g as 4 | 7)}
              style={{
                flex: 1,
                paddingVertical: 8,
                alignItems: 'center',
                borderRadius: theme.radius.sm,
                borderWidth: 1,
                borderColor: grade === g ? theme.color.primary : theme.color.border,
                backgroundColor: grade === g ? theme.color.primaryTint : theme.color.surface,
              }}
            >
              <Body>Lớp {g}</Body>
            </Pressable>
          ))}
        </View>
        {err && <ErrorNote message={err} />}
        <Button label="Thêm con" onPress={addChild} loading={busy} />
      </Card>

      {childId ? (
        <Card>
          <Overline>Tài khoản cho con</Overline>
          {access.loading && <Loading />}
          {access.data && access.data.status === 'ACTIVE' ? (
            <>
              <Body>Con đăng nhập bằng email:</Body>
              <Body>{access.data.loginEmail}</Body>
              <Muted>
                Con chỉ thấy phần dành cho học sinh — không thấy ghi chú của bố mẹ hay đánh giá của
                giáo viên.
              </Muted>
              {saErr && <ErrorNote message={saErr} />}
              <Button
                label="Thu hồi quyền truy cập của con"
                tone="danger"
                onPress={revokeAccess}
                loading={saBusy}
              />
              <Muted>Thu hồi có hiệu lực ngay. Hồ sơ học tập của con không bị xoá.</Muted>
            </>
          ) : (
            <>
              <Muted>
                Tạo lối đăng nhập riêng để con tự xem bài tập và luyện tập.
                {access.data ? ' Quyền trước đó đã bị thu hồi.' : ''}
              </Muted>
              {saShow ? (
                <>
                  <Field
                    label="Mật khẩu cho con (tối thiểu 8 ký tự)"
                    value={saPass}
                    onChangeText={setSaPass}
                    secureTextEntry
                  />
                  {saErr && <ErrorNote message={saErr} />}
                  <Button label="Tạo lối đăng nhập" onPress={createAccess} loading={saBusy} />
                </>
              ) : (
                <Button label="Tạo tài khoản cho con" tone="ghost" onPress={() => setSaShow(true)} />
              )}
            </>
          )}
        </Card>
      ) : null}

      {childId ? (
        <Card>
          <Overline>Giáo viên của con</Overline>
          <Muted>Kết nối giáo viên, duyệt yêu cầu và chọn giáo viên thấy được gì.</Muted>
          <Button label="Mở" tone="ghost" onPress={() => router.push('/parent/connect')} />
        </Card>
      ) : null}

      {childId ? (
        <Card>
          <Overline>Trường & lớp</Overline>
          <Muted>Khai báo trường/lớp để DạyZi ước lượng tiến độ theo lịch năm học.</Muted>
          <Button label="Mở" tone="ghost" onPress={() => router.push('/parent/school')} />
        </Card>
      ) : null}

      {childId ? (
        <Card>
          <Overline>Kiểm tra & ôn thi</Overline>
          <Muted>Khai báo kỳ kiểm tra để có bản đồ ôn tập, rồi nhập kết quả để xem chẩn đoán mất điểm.</Muted>
          <Button label="Mở" tone="ghost" onPress={() => router.push('/parent/exams')} />
        </Card>
      ) : null}

      <Card>
        <Overline>Quyền riêng tư & dữ liệu</Overline>
        <Muted>
          Bài con làm và bằng chứng học tập là nhật ký chỉ-thêm. Dữ liệu suy ra (mức độ nắm bài,
          điểm cần cải thiện) được tính lại từ nhật ký đó. DạyZi không dùng dữ liệu của con để
          huấn luyện mô hình AI.
        </Muted>
      </Card>

      <Card>
        <Overline>Gói dịch vụ {ent.data ? `· đang dùng ${PLAN_LABEL[ent.data.plan] ?? ent.data.plan}` : ''}</Overline>
        <Muted>Đổi gói không phát sinh thanh toán. Gói không ảnh hưởng chất lượng hay mô hình AI.</Muted>
        {(ent.data?.options ?? []).map((o) => (
          <Pressable key={o.plan} onPress={() => setPlan(o.plan)} disabled={o.plan === ent.data?.plan}>
            <Body>
              {o.plan === ent.data?.plan ? '● ' : '○ '}
              {PLAN_LABEL[o.plan] ?? o.plan}
              {o.recommended ? ' · Khuyên dùng' : ''} —{' '}
              {o.priceVnd === null ? 'Miễn phí' : `${(o.priceVnd / 1000).toLocaleString('vi-VN')}K/tháng`}
            </Body>
          </Pressable>
        ))}
      </Card>

      {childId ? (
        <Card tone="attention">
          <Overline>Xóa hồ sơ của con</Overline>
          <Muted>Xóa vĩnh viễn toàn bộ dữ liệu học tập. Không khôi phục được.</Muted>
          <Button label="Bắt đầu quy trình xóa" tone="danger" onPress={requestDeletion} />
          <Field label="Nhập tên hiển thị của con để xác nhận" value={delName} onChangeText={setDelName} />
          <Button label="Xóa vĩnh viễn" tone="danger" onPress={confirmDeletion} loading={busy} />
        </Card>
      ) : null}
    </Screen>
  );
}
