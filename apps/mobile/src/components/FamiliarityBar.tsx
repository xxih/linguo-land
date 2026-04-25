import { Pressable, View } from 'react-native';

interface Props {
  /** 0..7 */
  value: number;
  /** 点击改变。返回 false 表示不让本地立即更新（等服务端确认） */
  onChange?: (value: number) => void;
  /** 状态决定颜色色调，learning 黄、known 灰、unknown 蓝 */
  status?: 'unknown' | 'learning' | 'known';
  size?: 'sm' | 'md';
}

const SLOTS = [0, 1, 2, 3, 4, 5, 6, 7];

const TONE: Record<NonNullable<Props['status']>, string> = {
  unknown: 'bg-blue-500',
  learning: 'bg-amber-500',
  known: 'bg-gray-400',
};

export function FamiliarityBar({ value, onChange, status = 'learning', size = 'md' }: Props) {
  const filled = TONE[status] ?? TONE.learning;
  const cellH = size === 'sm' ? 'h-1.5' : 'h-2.5';
  const gap = size === 'sm' ? 'gap-0.5' : 'gap-1';
  return (
    <View className={`flex-row ${gap} items-center`}>
      {SLOTS.map((slot) => {
        const active = slot < value;
        return (
          <Pressable
            key={slot}
            disabled={!onChange}
            onPress={() => onChange?.(slot + 1 === value ? slot : slot + 1)}
            className={`flex-1 ${cellH} rounded-full ${active ? filled : 'bg-gray-200'}`}
          />
        );
      })}
    </View>
  );
}
