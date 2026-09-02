import { Redirect } from 'expo-router';
import { useAuth } from '@/auth';
import { Loading } from '@/ui';

export default function Gate() {
  const { ready, session } = useAuth();
  if (!ready) return <Loading />;
  if (!session) return <Redirect href="/welcome" />;

  const roles = session.viewer.roles;
  if (roles.includes('PARENT')) return <Redirect href="/parent/home" />;
  if (roles.includes('STUDENT')) return <Redirect href="/student/today" />;
  if (roles.includes('TEACHER')) return <Redirect href="/teacher/students" />;
  return <Redirect href="/welcome" />;
}
