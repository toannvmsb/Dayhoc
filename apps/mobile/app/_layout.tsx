import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import {
  BeVietnamPro_400Regular,
  BeVietnamPro_500Medium,
  BeVietnamPro_700Bold,
  useFonts,
} from '@expo-google-fonts/be-vietnam-pro';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { enableFreeze, enableScreens } from 'react-native-screens';
import { AuthProvider, useAuth } from '@/auth';
import { ChildProvider } from '@/child';
import { configStatus } from '@/config';
import { theme } from '@/theme';

// On Expo Go SDK 57 (RN 0.86, New Architecture) the native rn-screens layer
// froze the screen underneath after a router.back() ("Tried to enqueue runnable
// on already finished thread"). Turning off native screens + the react-freeze
// optimisation makes navigation JS-driven — slightly less slick transitions,
// but the app stays responsive. Stability > polish for the pilot.
enableScreens(false);
enableFreeze(false);

void SplashScreen.preventAutoHideAsync();

/**
 * Redirects to the welcome screen the moment the session is cleared (sign-out,
 * or a global 401) from anywhere in the app. `app/index.tsx` only gates the
 * initial launch; without this, signing out from a deep screen leaves the user
 * stranded on a now-empty authenticated screen.
 */
function AuthGate() {
  const { ready, session } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    const root = segments[0] as string | undefined;
    const onAuthScreen = !root || root === 'welcome';
    if (!session && !onAuthScreen) router.replace('/welcome');
  }, [ready, session, segments, router]);

  return null;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    BeVietnamPro_400Regular,
    BeVietnamPro_500Medium,
    BeVietnamPro_700Bold,
  });
  const cfg = configStatus();

  useEffect(() => {
    if (fontsLoaded || cfg.ok === false) void SplashScreen.hideAsync();
  }, [fontsLoaded, cfg.ok]);

  if (!cfg.ok) {
    return (
      <SafeAreaProvider>
        <View
          style={{
            flex: 1,
            backgroundColor: theme.color.bg,
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            gap: 12,
          }}
        >
          <Text style={{ fontSize: 20, fontWeight: '800', color: theme.color.textHeading }}>
            Chưa cấu hình được máy chủ
          </Text>
          <Text style={{ fontSize: 14, color: theme.color.textBody, textAlign: 'center', lineHeight: 20 }}>
            {cfg.message}
          </Text>
        </View>
      </SafeAreaProvider>
    );
  }

  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <ChildProvider>
          <AuthGate />
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: theme.color.bg },
              headerTitleStyle: { color: theme.color.textHeading, fontFamily: theme.font.bold },
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
            <Stack.Screen name="parent/connect" options={{ title: 'Giáo viên của con' }} />
            <Stack.Screen name="parent/school" options={{ title: 'Trường & lớp' }} />
            <Stack.Screen name="parent/gap/[gapId]" options={{ title: 'Điểm cần cải thiện' }} />
            <Stack.Screen name="parent/teach" options={{ title: 'Cách dạy con' }} />
            <Stack.Screen name="run/[assignmentId]" options={{ headerShown: false }} />
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
