import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useChild } from '@/child';
import { ParentNav } from '@/nav';
import { theme } from '@/theme';
import { Body, Button, Card, Chip, ErrorNote, H1, Loading, Muted, Overline, Screen } from '@/ui';
import { errText, useClient, useQuery } from '@/useApi';
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

  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraErr, setCameraErr] = useState<string | undefined>();
  const [capturing, setCapturing] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const uploadAndAnalyze = async (base64: string, fileName: string, mimeType: string) => {
    setBusy(true);
    setErr(undefined);
    try {
      const up = await api.post<{ uploadId: string }>(`/children/${childId}/uploads`, {
        kind,
        filename: fileName,
        mimeType,
        contentBase64: base64,
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
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const pickFromLibrary = async () => {
    setErr(undefined);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setErr('DạyZi cần quyền truy cập ảnh để tải bài của con.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.6, mediaTypes: ['images'] });
    const asset = res.canceled ? undefined : res.assets[0];
    if (!asset?.base64) return;
    await uploadAndAnalyze(asset.base64, asset.fileName ?? 'anh.jpg', asset.mimeType ?? 'image/jpeg');
  };

  const openCamera = async () => {
    setErr(undefined);
    setCameraErr(undefined);
    const perm = permission?.granted ? permission : await requestPermission();
    if (!perm.granted) {
      setErr('DạyZi cần quyền camera để bạn chụp bài của con.');
      return;
    }
    setCameraOpen(true);
  };

  const capturePhoto = async () => {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.6 });
      if (photo?.base64) {
        setCameraOpen(false);
        await uploadAndAnalyze(photo.base64, 'anh.jpg', 'image/jpeg');
      }
    } catch (e) {
      setCameraErr(errText(e));
    } finally {
      setCapturing(false);
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
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  if (cameraOpen) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.color.night }}>
        <View style={{ paddingTop: 50, paddingHorizontal: 20, paddingBottom: 10, flexDirection: 'row', alignItems: 'center' }}>
          <Pressable onPress={() => setCameraOpen(false)} hitSlop={12}>
            <Text style={{ fontSize: 22, color: theme.color.onDark }}>✕</Text>
          </Pressable>
          <Text style={{ flex: 1, textAlign: 'center', fontSize: 15, fontWeight: '700', color: theme.color.onDark }}>
            Cập nhật việc học
          </Text>
          <View style={{ width: 22 }} />
        </View>

        <View style={{ flex: 1, margin: 20, borderRadius: 24, overflow: 'hidden' }}>
          <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back" />
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 26,
              left: 26,
              right: 26,
              bottom: 26,
              borderRadius: 18,
              borderWidth: 2,
              borderStyle: 'dashed',
              borderColor: 'rgba(255,255,255,.4)',
            }}
          />
          <View
            pointerEvents="none"
            style={{ position: 'absolute', left: 0, right: 0, bottom: 26, alignItems: 'center', gap: 4, paddingHorizontal: 40 }}
          >
            <Text style={{ fontSize: 15.5, fontWeight: '700', color: theme.color.onDark, textAlign: 'center' }}>
              Đưa trang vở vào khung
            </Text>
            <Text style={{ fontSize: 12.5, lineHeight: 18, color: 'rgba(255,255,255,.7)', textAlign: 'center' }}>
              Chụp rõ đề bài và phần con làm.
            </Text>
          </View>
        </View>

        <View style={{ paddingHorizontal: 20 }}>
          <View style={{ flexDirection: 'row', gap: 8, paddingBottom: 12 }}>
            {KINDS.map((k) => (
              <Pressable
                key={k.value}
                onPress={() => setKind(k.value)}
                style={{
                  paddingHorizontal: 13,
                  paddingVertical: 10,
                  borderRadius: 12,
                  backgroundColor: kind === k.value ? theme.color.primary : 'rgba(255,255,255,.1)',
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: '700', color: kind === k.value ? theme.color.onDark : '#DCE7E4' }}>
                  {k.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {cameraErr && (
          <View style={{ paddingHorizontal: 20 }}>
            <ErrorNote message={cameraErr} />
          </View>
        )}

        <View style={{ paddingHorizontal: 20, paddingBottom: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
          <Pressable onPress={capturePhoto} disabled={capturing}>
            <View
              style={{
                width: 80,
                height: 80,
                borderRadius: 40,
                borderWidth: 4,
                borderColor: 'rgba(255,255,255,.35)',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: capturing ? 0.6 : 1,
              }}
            >
              <View style={{ width: 62, height: 62, borderRadius: 31, backgroundColor: theme.color.onDark }} />
            </View>
          </Pressable>
        </View>
      </View>
    );
  }

  if (review && review.state === 'NEEDS_CONFIRMATION') {
    return (
      <Screen>
        <H1>Xem lại nội dung</H1>
        {review.items.length > 0 ? (
          <Muted>Ô đã tích là phần DạyZi khá chắc. Bỏ tích câu không đúng. Chỉ mục bạn xác nhận mới được ghi nhận.</Muted>
        ) : (
          <Muted>Ảnh này không có câu bài tập để ghi nhận (ví dụ: tin nhắn của giáo viên). Không có gì được lưu vào hồ sơ.</Muted>
        )}
        {review.teacherNote && <Card><Overline>Ghi chú</Overline><Body>{review.teacherNote}</Body></Card>}
        {review.items.map((it) => {
          const t = ticked[it.index] ?? { confirm: false };
          const top = it.skillCandidates[0];
          return (
            <Card key={it.index}>
              <Pressable
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
                onPress={() => setTicked((s) => ({ ...s, [it.index]: { ...t, confirm: !t.confirm } }))}
              >
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    borderWidth: 2,
                    borderColor: t.confirm ? theme.color.primary : theme.color.border,
                    backgroundColor: t.confirm ? theme.color.primary : 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {t.confirm && <Text style={{ color: theme.color.onDark, fontSize: 13, fontWeight: '800' }}>✓</Text>}
                </View>
                <Text style={{ flex: 1, fontSize: 14.5, fontWeight: '700', color: theme.color.textHeading }}>
                  Câu {it.index + 1}
                </Text>
                {top && (
                  <Chip
                    label={`Tin cậy ${top.confidence >= 0.7 ? 'cao' : top.confidence >= 0.45 ? 'vừa' : 'thấp'}`}
                    tone={top.confidence >= 0.7 ? 'positive' : 'neutral'}
                  />
                )}
              </Pressable>
              <Muted>{it.prompt}</Muted>
              {it.childAnswer ? <Muted>Con trả lời: {it.childAnswer}</Muted> : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
                {it.skillCandidates.map((c) => (
                  <Pressable
                    key={c.skillId}
                    onPress={() => setTicked((s) => ({ ...s, [it.index]: { ...t, skillId: c.skillId } }))}
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 7,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: t.skillId === c.skillId ? theme.color.primary : theme.color.border,
                      backgroundColor: t.skillId === c.skillId ? theme.color.primaryTint : theme.color.surface,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 12.5,
                        fontWeight: '600',
                        color: t.skillId === c.skillId ? theme.color.primaryStrong : theme.color.textBody,
                      }}
                    >
                      {c.skillName} ({Math.round(c.confidence * 100)}%)
                    </Text>
                  </Pressable>
                ))}
              </View>
            </Card>
          );
        })}
        {err && <ErrorNote message={err} />}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
          <View style={{ width: 96 }}>
            <Button label="Để sau" tone="ghost" onPress={() => setReview(null)} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Xác nhận & lưu" onPress={confirm} loading={busy} />
          </View>
        </View>
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
        <Button label="Chụp ảnh" onPress={openCamera} loading={busy} />
        <Button label="Chọn từ thư viện" tone="ghost" onPress={pickFromLibrary} />
      </Card>

      {list.loading && <Loading />}
      {(list.data ?? []).map((u) => (
        <Card key={u.id}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Body>{KINDS.find((k) => k.value === u.kind)?.label ?? u.kind}</Body>
            <Chip label={STATE[u.state] ?? u.state} tone={u.state === 'CONFIRMED' ? 'positive' : u.state === 'NEEDS_CONFIRMATION' ? 'primary' : 'neutral'} />
          </View>
          {u.itemCount > 0 && <Muted>{u.itemCount} câu</Muted>}
        </Card>
      ))}
    </Screen>
  );
}
