import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '@/auth';
import { ChildProvider } from '@/child';
import { theme } from '@/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <ChildProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: theme.color.bg },
            headerTitleStyle: { color: theme.color.textHeading },
            headerTintColor: theme.color.primary,
            headerShadowVisible: false,
            contentStyle: { backgroundColor: theme.color.bg },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="welcome" options={{ headerShown: false }} />
          <Stack.Screen name="parent/home" options={{ title: 'DạyZi' }} />
          <Stack.Screen name="parent/progress" options={{ title: 'Tiến độ' }} />
          <Stack.Screen name="parent/practice" options={{ title: 'Bài tập' }} />
          <Stack.Screen name="parent/uploads" options={{ title: 'Tải bài của con' }} />
          <Stack.Screen name="parent/exams" options={{ title: 'Kiểm tra & ôn thi' }} />
          <Stack.Screen name="parent/settings" options={{ title: 'Cài đặt' }} />
          <Stack.Screen name="parent/gap/[gapId]" options={{ title: 'Điểm cần cải thiện' }} />
          <Stack.Screen name="parent/teach" options={{ title: 'Cách dạy con' }} />
          <Stack.Screen name="run/[assignmentId]" options={{ headerShown: false, presentation: 'modal' }} />
          <Stack.Screen name="student/today" options={{ title: 'Hôm nay' }} />
          <Stack.Screen name="student/practice" options={{ title: 'Bài tập' }} />
          <Stack.Screen name="student/progress" options={{ title: 'Tiến bộ' }} />
          <Stack.Screen name="teacher/students" options={{ title: 'Học sinh' }} />
          <Stack.Screen name="teacher/[childId]" options={{ title: 'Chi tiết học sinh' }} />
        </Stack>
        </ChildProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
