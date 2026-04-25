import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { api, getApiBaseUrl } from '../../src/lib/api';
import { readSecure } from '../../src/lib/secure-storage';
import { ACCESS_TOKEN_KEY } from '../../src/lib/api';
import type { DocumentMeta } from 'shared-types';

export default function UploadScreen() {
  const router = useRouter();
  const [picked, setPicked] = useState<DocumentPicker.DocumentPickerAsset | null>(
    null,
  );
  const [uploading, setUploading] = useState(false);

  async function pick() {
    const res = await DocumentPicker.getDocumentAsync({
      type: ['application/epub+zip', 'text/plain'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (res.canceled) return;
    setPicked(res.assets[0]);
  }

  /**
   * RN 上 axios 处理 multipart 偶尔有 boundary / file-uri 兼容问题，
   * 直接走 fetch + FormData 最可靠（Expo / RN 都支持 file:// uri 自动读流）。
   */
  async function upload() {
    if (!picked) return;
    setUploading(true);
    try {
      const baseURL = await getApiBaseUrl();
      const token = await readSecure(ACCESS_TOKEN_KEY);
      const form = new FormData();
      form.append('file', {
        uri: picked.uri,
        name: picked.name,
        type: picked.mimeType ?? guessMime(picked.name),
      } as any);
      const res = await fetch(`${baseURL}/api/v1/documents/upload`, {
        method: 'POST',
        headers: { Authorization: token ? `Bearer ${token}` : '' },
        body: form,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const meta = (await res.json()) as DocumentMeta;
      router.replace({
        pathname: '/(app)/reader/[id]',
        params: { id: String(meta.id) },
      });
    } catch (err: any) {
      Alert.alert('上传失败', err?.message ?? '');
    } finally {
      setUploading(false);
    }
  }

  return (
    <View className="flex-1 bg-white px-6 pt-8">
      <Pressable
        onPress={pick}
        className="border-2 border-dashed border-gray-300 rounded-lg py-10 items-center"
      >
        <Text className="text-base text-gray-700">
          {picked ? picked.name : '点击选择 .txt 或 .epub'}
        </Text>
        {picked && (
          <Text className="text-xs text-gray-400 mt-1">
            {Math.max(1, Math.round((picked.size ?? 0) / 1024))} KB
          </Text>
        )}
      </Pressable>

      <Pressable
        disabled={!picked || uploading}
        onPress={upload}
        className={`mt-8 py-3 rounded-md ${
          !picked || uploading ? 'bg-blue-300' : 'bg-blue-600'
        }`}
      >
        <Text className="text-center text-white font-medium">
          {uploading ? '上传中…' : '开始上传'}
        </Text>
      </Pressable>

      <Text className="text-xs text-gray-400 mt-6 leading-5">
        上限 50MB；EPUB 上传时服务端会提取 title / author / 目录，正文不解析，移动端用
        epub.js 直渲，保留原书排版。
      </Text>
    </View>
  );
}

function guessMime(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'epub') return 'application/epub+zip';
  if (ext === 'txt') return 'text/plain';
  return 'application/octet-stream';
}
