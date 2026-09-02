import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useAuth } from '@/auth';
import { errText } from '@/useApi';
import { Body, Button, Card, ErrorNote, Field, H1, Loading, Muted, Overline, Screen, theme } from '@/ui';

type Mode = 'login' | 'register' | 'teacher';

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

  return (
    <Screen>
      <View style={{ gap: 6, marginTop: 24 }}>
        <Overline>DạyZi</Overline>
        <H1>{mode === 'teacher' ? 'DạyZi cho giáo viên' : 'Hôm nay dạy con gì?'}</H1>
        <Body>
          {mode === 'teacher'
            ? 'Cập nhật nội dung đã dạy để phụ huynh đồng hành cùng con ở nhà.'
            : 'Hiểu con. Dạy đúng. Cùng con tiến bộ mỗi ngày.'}
        </Body>
      </View>

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

      <View style={{ alignItems: 'center', gap: 8 }}>
        <Pressable onPress={() => setMode(mode === 'login' ? 'register' : 'login')}>
          <Muted>{mode === 'login' ? 'Chưa có tài khoản? Đăng ký' : 'Đã có tài khoản? Đăng nhập'}</Muted>
        </Pressable>
        <Pressable onPress={() => setMode(mode === 'teacher' ? 'register' : 'teacher')}>
          <Body>
            <Muted>{mode === 'teacher' ? 'Tôi là phụ huynh' : 'Tôi là giáo viên'}</Muted>
          </Body>
        </Pressable>
      </View>

      <View style={{ height: theme.space(4) }} />
    </Screen>
  );
}
