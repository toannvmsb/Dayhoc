import { useState } from 'react';
import { Pressable, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useChild } from '@/child';
import { ParentNav } from '@/nav';
import { theme } from '@/theme';
import { Body, Button, Card, ErrorNote, H1, Loading, Muted, Overline, Screen } from '@/ui';
import { useClient, useQuery } from '@/useApi';
import type { UploadAnalysis, UploadListItem } from '@/types';

const STATE: Record<string, string> = {
  UPLOAD_CREATED: 'Vừa tải lên',
  UPLOADED: 'Đã nhận',
  READING: 'Đang đọc',
  ANALYZING: 'Đang phân tích',
  MAPPED: 'Đã nhận dạng',
  NEEDS_CONFIRMATION: 'Cần bạn xác nhận',
  CONFIRMED: 'Đã xác nhận',
  FAILED: 'Không xử lý được',
};
const KINDS = [
  { value: 'NOTEBOOK_PAGE', label: 'Trang vở' },
  { value: 'GRADED_TEST', label: 'Bài kiểm tra đã chấm' },
  { value: 'HOMEWORK', label: 'Bài tập về nhà' },
];

export default function UploadsScreen() {
  const { childId } = useChild();
  const api = useClient('PARENT');
  const list = useQuery<UploadListItem[]>(() => api.get(`/children/${childId}/uploads`), [childId]);

  const [kind, setKind] = useState('NOTEBOOK_PAGE');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();
  const [review, setReview] = useState<UploadAnalysis | null>(null);
  const [ticked, setTicked] = useState<Record<number, { confirm: boolean; skillId?: string }>>({});

  const pick = async (fromCamera: boolean) => {
    setErr(undefined);
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setErr('DạyZi cần quyền camera / ảnh để tải bài của con.');
      return;
    }
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.6 })
      : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.6 });
    if (res.canceled || !res.assets[0]?.base64) return;
    const asset = res.assets[0];
    setBusy(true);
    try {
      const up = await api.post<{ uploadId: string }>(`/children/${childId}/uploads`, {
        kind,
        filename: asset.fileName ?? 'anh.jpg',
        mimeType: asset.mimeType ?? 'image/jpeg',
        contentBase64: asset.base64,
      });
      const analysis = await api.post<UploadAnalysis>(
        `/children/${childId}/uploads/${up.uploadId}/analyze`,
      );
      setReview(analysis);
      setTicked(
        Object.fromEntries(
          analysis.items.map((it) => [
            it.index,
            { confirm: it.autoSelected, skillId: it.skillCandidates[0]?.skillId },
          ]),
        ),
      );
      list.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Không tải lên được.');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!review) return;
    setBusy(true);
    try {
      await api.post(`/children/${childId}/uploads/${review.uploadId}/confirm`, {
        corrections: review.items.map((it) => ({
          index: it.index,
          confirm: !!ticked[it.index]?.confirm && !!ticked[it.index]?.skillId,
          skillId: ticked[it.index]?.skillId,
        })),
      });
      setReview(null);
      list.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Không xác nhận được.');
    } finally {
      setBusy(false);
    }
  };

  if (review && review.state === 'NEEDS_CONFIRMATION') {
    return (
      <Screen>
        <H1>Xem lại nội dung</H1>
        <Muted>Ô đã tích là phần DạyZi khá chắc. Bỏ tích câu không đúng. Chỉ mục bạn xác nhận mới được ghi nhận.</Muted>
        {review.items.map((it) => {
          const t = ticked[it.index] ?? { confirm: false };
          return (
            <Card key={it.index}>
              <Pressable
                onPress={() => setTicked((s) => ({ ...s, [it.index]: { ...t, confirm: !t.confirm } }))}
              >
                <Body>
                  {t.confirm ? '☑' : '☐'} Câu {it.index + 1}
                </Body>
              </Pressable>
              <Muted>{it.prompt}</Muted>
              {it.childAnswer ? <Muted>Con trả lời: {it.childAnswer}</Muted> : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {it.skillCandidates.map((c) => (
                  <Pressable
                    key={c.skillId}
                    onPress={() => setTicked((s) => ({ ...s, [it.index]: { ...t, skillId: c.skillId } }))}
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: t.skillId === c.skillId ? theme.color.primary : theme.color.border,
                      backgroundColor: t.skillId === c.skillId ? theme.color.primaryTint : theme.color.surface,
                    }}
                  >
                    <Muted>
                      {c.skillName} ({Math.round(c.confidence * 100)}%)
                    </Muted>
                  </Pressable>
                ))}
              </View>
            </Card>
          );
        })}
        {err && <ErrorNote message={err} />}
        <Button label="Xác nhận" onPress={confirm} loading={busy} />
        <Button label="Để sau" tone="ghost" onPress={() => setReview(null)} />
      </Screen>
    );
  }

  return (
    <Screen nav={<ParentNav />} edges={['bottom']}>
      <H1>Tải bài của con</H1>
      <Muted>
        Chụp trang vở / bài kiểm tra. DạyZi đọc thử và đề xuất — bạn xem lại và xác nhận trước khi ghi nhận.
      </Muted>

      <Card>
        <Overline>Loại tài liệu</Overline>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {KINDS.map((k) => (
            <Pressable
              key={k.value}
              onPress={() => setKind(k.value)}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: kind === k.value ? theme.color.primary : theme.color.border,
                backgroundColor: kind === k.value ? theme.color.primaryTint : theme.color.surface,
              }}
            >
              <Muted>{k.label}</Muted>
            </Pressable>
          ))}
        </View>
        {err && <ErrorNote message={err} />}
        <Button label="Chụp ảnh" onPress={() => pick(true)} loading={busy} />
        <Button label="Chọn từ thư viện" tone="ghost" onPress={() => pick(false)} />
      </Card>

      {list.loading && <Loading />}
      {(list.data ?? []).map((u) => (
        <Card key={u.id}>
          <Body>{KINDS.find((k) => k.value === u.kind)?.label ?? u.kind}</Body>
          <Muted>
            {STATE[u.state] ?? u.state}
            {u.itemCount > 0 ? ` · ${u.itemCount} câu` : ''}
          </Muted>
        </Card>
      ))}
    </Screen>
  );
}
