import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useAuth } from '@/auth';
import { errText } from '@/useApi';
import { Button, Card, ErrorNote, Field, H1, Loading, Muted, Screen, theme } from '@/ui';

type Mode = 'login' | 'register' | 'teacher';
const ROLE_TABS: { key: 'register' | 'teacher'; label: string }[] = [
  { key: 'register', label: 'Bố mẹ' },
  { key: 'teacher', label: 'Giáo viên' },
];

export default function Welcome() {
  const { ready, session, signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();

  if (!ready) return <Loading />;
  if (session) return <Redirect href="/" />;

  const submit = async () => {
    setBusy(true);
    setErr(undefined);
    try {
      if (mode === 'login') await signIn(email.trim());
      else
        await signUp({
          email: email.trim(),
          password,
          displayName: name.trim() || undefined,
          role: mode === 'teacher' ? 'TEACHER' : 'PARENT',
        });
      router.replace('/');
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  // The role tab (bố mẹ/giáo viên) only applies while registering — while
  // logging in there is one shared form, so the tab is hidden rather than
  // forcing a choice that doesn't change anything.
  const role: 'register' | 'teacher' = mode === 'teacher' ? 'teacher' : 'register';

  return (
    <Screen>
      <View style={{ alignItems: 'center', gap: 14, marginTop: 20, marginBottom: 4 }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 18,
            backgroundColor: theme.color.primary,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 24, color: theme.color.onDark, fontWeight: '800' }}>D</Text>
        </View>
        <View style={{ alignItems: 'center', gap: 6 }}>
          <H1>{mode === 'teacher' ? 'DạyZi cho giáo viên' : 'Hôm nay dạy con gì?'}</H1>
          <Text style={{ fontSize: 15, lineHeight: 22, color: theme.color.textBody, textAlign: 'center' }}>
            {mode === 'teacher'
              ? 'Cập nhật nội dung đã dạy để phụ huynh đồng hành cùng con ở nhà.'
              : 'Hiểu con. Dạy đúng. Cùng con tiến bộ mỗi ngày.'}
          </Text>
        </View>
      </View>

      {mode !== 'login' && (
        <View style={{ flexDirection: 'row', padding: 4, backgroundColor: theme.color.surfaceRaised, borderRadius: 14 }}>
          {ROLE_TABS.map((t) => {
            const on = t.key === role;
            return (
              <Pressable
                key={t.key}
                onPress={() => setMode(t.key)}
                style={{
                  flex: 1,
                  height: 40,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: on ? theme.color.surface : 'transparent',
                  borderRadius: 11,
                }}
              >
                <Text style={{ fontSize: 13.5, fontWeight: on ? '700' : '600', color: on ? theme.color.textHeading : theme.color.textMuted }}>
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <Card>
        <View style={{ gap: 12 }}>
          {mode !== 'login' && (
            <Field
              label={mode === 'teacher' ? 'Tên giáo viên' : 'Tên bố / mẹ'}
              value={name}
              onChangeText={setName}
            />
          )}
          <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
          {mode !== 'login' && (
            <Field
              label="Mật khẩu (tối thiểu 8 ký tự)"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
          )}
          {err && <ErrorNote message={err} />}
          <Button
            label={mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}
            onPress={submit}
            loading={busy}
          />
        </View>
      </Card>

      <View style={{ alignItems: 'center' }}>
        <Pressable onPress={() => setMode(mode === 'login' ? 'register' : 'login')}>
          <Muted>{mode === 'login' ? 'Chưa có tài khoản? Đăng ký' : 'Đã có tài khoản? Đăng nhập'}</Muted>
        </Pressable>
      </View>

      <View style={{ height: theme.space(4) }} />
    </Screen>
  );
}
