import { Redirect, Stack } from 'expo-router';
import { useAuthStore } from '../../src/stores/auth';

export default function AuthLayout() {
  const phase = useAuthStore((s) => s.phase);
  if (phase === 'authed') return <Redirect href="/(app)" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
