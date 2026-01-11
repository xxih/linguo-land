'use client';

import { useState, useEffect } from 'react';

interface WordFamily {
  id: number;
  rootWord: string;
  words: { text: string }[];
  createdAt: string;
}

export default function AdminPage() {
  const [families, setFamilies] = useState<WordFamily[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFamily, setSelectedFamily] = useState<WordFamily | null>(null);
  const [selectedWord, setSelectedWord] = useState<string>('');
  const [moveToFamily, setMoveToFamily] = useState<string>('');

  useEffect(() => {
    loadFamilies();
  }, []);

  const loadFamilies = async () => {
    setLoading(true);
    try {
      // TODO: 替换为实际的 API 地址
      const response = await fetch('http://localhost:3000/api/v1/admin/families');
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      setFamilies(data);
    } catch (error) {
      console.error('Failed to load families:', error);
      // 暂时使用模拟数据
      setFamilies([
        {
          id: 1,
          rootWord: 'test',
          words: [{ text: 'test' }, { text: 'testing' }, { text: 'tested' }],
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const removeWordFromFamily = async (word: string) => {
    if (!confirm(`确定要从词族中移除单词 "${word}" 吗？`)) return;

    try {
      const response = await fetch(
        `http://localhost:3000/api/v1/vocabulary/word/${encodeURIComponent(word)}/remove`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // TODO: 添加认证 token
          },
        }
      );

      const result = await response.json();
      if (result.success) {
        alert(result.message);
        loadFamilies();
        setSelectedFamily(null);
      } else {
        alert(`操作失败: ${result.message}`);
      }
    } catch (error) {
      console.error('Failed to remove word:', error);
      alert('操作失败');
    }
  };

  const moveWord = async () => {
    if (!selectedWord || !moveToFamily) {
      alert('请选择要移动的单词和目标词族');
      return;
    }

    try {
      const response = await fetch(
        `http://localhost:3000/api/v1/vocabulary/word/${encodeURIComponent(selectedWord)}/move`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // TODO: 添加认证 token
          },
          body: JSON.stringify({ newFamilyRoot: moveToFamily }),
        }
      );

      const result = await response.json();
      if (result.success) {
        alert(result.message);
        loadFamilies();
        setSelectedFamily(null);
        setSelectedWord('');
        setMoveToFamily('');
      } else {
        alert(`操作失败: ${result.message}`);
      }
    } catch (error) {
      console.error('Failed to move word:', error);
      alert('操作失败');
    }
  };

  const filteredFamilies = families.filter((f) =>
    f.rootWord.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-lg">加载中...</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* 左侧菜单 */}
      <aside className="w-80 border-r border-gray-200 bg-white">
        <div className="flex h-full flex-col">
          <div className="border-b border-gray-200 p-6">
            <h1 className="text-2xl font-bold">LinguoLand Admin</h1>
            <p className="mt-1 text-sm text-gray-600">词族管理后台</p>
          </div>

          <div className="flex-1 overflow-auto p-4">
            <div className="mb-4">
              <input
                type="text"
                placeholder="搜索词族..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div className="space-y-2">
              {filteredFamilies.map((family) => (
                <button
                  key={family.id}
                  onClick={() => setSelectedFamily(family)}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    selectedFamily?.id === family.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <div className="font-medium">{family.rootWord}</div>
                  <div className="mt-1 text-xs text-gray-500">
                    {family.words.length} 个单词
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-gray-200 p-4">
            <div className="text-xs text-gray-500">
              共 {families.length} 个词族
            </div>
          </div>
        </div>
      </aside>

      {/* 右侧内容区 */}
      <main className="flex-1 overflow-auto">
        <div className="container max-w-5xl py-8">
          {selectedFamily ? (
            <div className="space-y-6">
              <div>
                <h2 className="text-3xl font-bold">{selectedFamily.rootWord}</h2>
                <p className="mt-2 text-gray-600">
                  该词族包含 {selectedFamily.words.length} 个单词
                </p>
              </div>

              {/* 词族内的单词列表 */}
              <div className="rounded-lg border border-gray-200 bg-white">
                <div className="border-b border-gray-200 p-4">
                  <h3 className="font-semibold">词族内的单词</h3>
                </div>
                <div className="divide-y divide-gray-200">
                  {selectedFamily.words.map((word) => (
                    <div
                      key={word.text}
                      className="flex items-center justify-between p-4"
                    >
                      <div className="font-medium">{word.text}</div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setSelectedWord(word.text)}
                          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
                        >
                          移动
                        </button>
                        <button
                          onClick={() => removeWordFromFamily(word.text)}
                          disabled={selectedFamily.words.length === 1}
                          className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          移除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 移动单词表单 */}
              {selectedWord && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-6">
                  <h3 className="mb-4 font-semibold">
                    移动单词：{selectedWord}
                  </h3>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="输入目标词族的根词..."
                      value={moveToFamily}
                      onChange={(e) => setMoveToFamily(e.target.value)}
                      className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    />
                    <button
                      onClick={moveWord}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                    >
                      确认移动
                    </button>
                    <button
                      onClick={() => {
                        setSelectedWord('');
                        setMoveToFamily('');
                      }}
                      className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}

              {/* 词族信息 */}
              <div className="rounded-lg border border-gray-200 bg-white p-6">
                <h3 className="mb-4 font-semibold">词族信息</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">词族ID:</span>
                    <span className="font-medium">{selectedFamily.id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">根词:</span>
                    <span className="font-medium">{selectedFamily.rootWord}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">单词数量:</span>
                    <span className="font-medium">
                      {selectedFamily.words.length}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">创建时间:</span>
                    <span className="font-medium">
                      {new Date(selectedFamily.createdAt).toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-96 items-center justify-center">
              <div className="text-center text-gray-500">
                <p className="text-lg">请从左侧选择一个词族</p>
                <p className="mt-2 text-sm">选择后可以查看和管理词族内的单词</p>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

