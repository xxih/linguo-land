import { Redirect } from 'expo-router';
import { useAuthStore } from '../src/stores/auth';

export default function Index() {
  const phase = useAuthStore((s) => s.phase);
  if (phase === 'authed') return <Redirect href="/(app)" />;
  return <Redirect href="/(auth)/login" />;
}
