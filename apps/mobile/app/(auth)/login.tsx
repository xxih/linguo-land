import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../src/stores/auth';
import { setApiBaseUrl, getApiBaseUrl } from '../../src/lib/api';
import { useEffect } from 'react';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [loading, setLoading] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');

  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);

  useEffect(() => {
    void getApiBaseUrl().then(setBaseUrl);
  }, []);

  async function submit() {
    if (!email || !password) {
      Alert.alert('请填写邮箱和密码');
      return;
    }
    setLoading(true);
    try {
      if (mode === 'register') {
        await register(email, password);
        Alert.alert('注册成功', '现在可以用刚才的账号登录');
        setMode('login');
      } else {
        await login(email, password);
      }
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ?? err?.message ?? '请求失败，请检查网络';
      Alert.alert(mode === 'login' ? '登录失败' : '注册失败', String(msg));
    } finally {
      setLoading(false);
    }
  }

  async function commitBaseUrl() {
    if (!baseUrl) return;
    await setApiBaseUrl(baseUrl);
    Alert.alert('已更新 API 地址', baseUrl);
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 px-6 pt-12"
      >
        <Text className="text-3xl font-semibold mb-2">LinguoLand</Text>
        <Text className="text-base text-gray-500 mb-10">
          {mode === 'login' ? '登录开始阅读' : '创建你的账号'}
        </Text>

        <Text className="text-sm text-gray-700 mb-1">邮箱</Text>
        <TextInput
          className="border border-gray-300 rounded-md px-3 py-2 mb-4 text-base"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
        />

        <Text className="text-sm text-gray-700 mb-1">密码</Text>
        <TextInput
          className="border border-gray-300 rounded-md px-3 py-2 mb-6 text-base"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
        />

        <Pressable
          disabled={loading}
          onPress={submit}
          className={`py-3 rounded-md ${loading ? 'bg-blue-300' : 'bg-blue-600'}`}
        >
          <Text className="text-center text-white font-medium text-base">
            {loading ? '处理中…' : mode === 'login' ? '登录' : '注册'}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setMode((m) => (m === 'login' ? 'register' : 'login'))}
          className="mt-3"
        >
          <Text className="text-center text-blue-600 text-sm">
            {mode === 'login' ? '没有账号？去注册' : '已有账号，去登录'}
          </Text>
        </Pressable>

        <View className="mt-12 pt-6 border-t border-gray-100">
          <Text className="text-xs text-gray-500 mb-1">API 地址</Text>
          <TextInput
            className="border border-gray-200 rounded-md px-3 py-2 text-sm"
            autoCapitalize="none"
            value={baseUrl}
            onChangeText={setBaseUrl}
            placeholder="http://10.0.2.2:3000"
          />
          <Pressable onPress={commitBaseUrl} className="mt-2 py-2">
            <Text className="text-center text-blue-600 text-sm">保存 API 地址</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
