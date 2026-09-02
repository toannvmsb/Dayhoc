import { Link, Stack } from 'expo-router';
import { Body, H1, Screen } from '@/ui';

export default function NotFound() {
  return (
    <>
      <Stack.Screen options={{ title: 'Không tìm thấy' }} />
      <Screen scroll={false}>
        <H1>Không tìm thấy trang</H1>
        <Body>Màn hình này không tồn tại.</Body>
        <Link href="/" style={{ marginTop: 12 }}>
          <Body>Về trang chính</Body>
        </Link>
      </Screen>
    </>
  );
}
