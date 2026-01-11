import React from 'react';
import type { DictionaryEntry } from 'shared-types';

interface WordDefinitionsProps {
  details: DictionaryEntry;
}

/**
 * WordCard 定义组件
 * 优先显示中文释义，如果没有则显示英文释义
 */
export const WordDefinitions: React.FC<WordDefinitionsProps> = ({ details }) => {
  // 优先使用中文释义
  if (
    details.chineseEntriesShort &&
    Array.isArray(details.chineseEntriesShort) &&
    details.chineseEntriesShort.length > 0
  ) {
    return (
      <div className="space-y-1.5">
        {details.chineseEntriesShort.map((entry: any, entryIndex: number) => (
          <div key={entryIndex} className="flex gap-2">
            {/* 词性 */}
            <span className="text-sm font-semibold text-gray-700 shrink-0">{entry.pos}</span>

            {/* 中文释义 - 用分号分隔 */}
            <span className="text-sm text-font-base">
              {entry.definitions && entry.definitions.join('；')}
            </span>
          </div>
        ))}
      </div>
    );
  }

  // 如果没有中文释义，显示英文释义（兜底）
  if (!details.entries || details.entries.length === 0) {
    return <div className="text-font-secondary italic">暂无释义</div>;
  }

  return (
    <div className="space-y-4">
      {details.entries.map((entry, entryIndex) => (
        <div key={entryIndex}>
          {/* 词性 */}
          {entry.pos !== 'error' && (
            <div className="text-sm font-bold text-font-base mb-1">{entry.pos}</div>
          )}

          {/* 义项列表 */}
          <ul className="list-decimal pl-5 space-y-2">
            {entry.senses.map((sense, senseIndex) => (
              <li key={senseIndex}>
                {/* 释义 */}
                <div className="text-font-base font-medium">{sense.glosses.join('; ')}</div>

                {/* 例句（如果有） */}
                {sense.examples && sense.examples.length > 0 && (
                  <div className="text-font-secondary text-sm italic mt-1 pl-2 border-l-2 border-gray-200">
                    "{sense.examples[0]}"
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
};
