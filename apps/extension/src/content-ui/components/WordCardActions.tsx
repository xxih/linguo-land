import React from 'react';
import type { WordFamiliarityStatus } from 'shared-types';
// import Button from "@mui/material/Button";
import { Button } from '../../components/ui/button';
// import MenuBookIcon from "@mui/icons-material/MenuBook";
// import CheckCircleIcon from "@mui/icons-material/CheckCircle";
// import HelpOutlineIcon from "@mui/icons-material/HelpOutline";

interface WordCardActionsProps {
  lemmas: string[];
  word: string; // 添加原始单词，用于忽略功能
  currentStatus?: WordFamiliarityStatus | 'ignored'; // 当前状态，用于显示对应的两个按钮
  onUpdateStatus: (
    lemmas: string[],
    status: WordFamiliarityStatus,
    familiarityLevel?: number,
  ) => void;
  onIgnoreWord?: (word: string) => void; // 添加忽略功能
  createHoverHandlers?: (buttonType: 'known' | 'learning' | 'unknown' | 'ignore') => {
    onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => void;
    onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => void;
  };
}

interface ActionConfig {
  type: 'known' | 'learning' | 'unknown';
  label: string;
  // icon: React.ReactElement; // MUI 图标组件
  title: string;
  status: WordFamiliarityStatus;
  familiarityLevel: number;
  isPrimary?: boolean; // 是否为主推荐按钮
  className?: string;
}

/**
 * WordCard 动作按钮组件 - 智能双按钮系统
 * 根据当前状态，智能显示两个最相关的动作按钮
 *
 * 核心原则：
 * 1. 恒定数量：始终只显示两个主要动作按钮
 * 2. 目标导向：两个按钮功能永远是切换到另外两个可能的状态
 * 3. 状态明确：通过顶部状态徽章让用户知道当前状态
 * 4. 主次分离：忽略按钮与主按钮在同一行，但视觉上明显区分
 */
export const WordCardActions: React.FC<WordCardActionsProps> = ({
  lemmas,
  currentStatus,
  onUpdateStatus,
}) => {
  /**
   * 根据当前状态，返回应该显示的两个按钮配置
   * - Unknown (陌生) 🟡 -> [学习] (主推荐) 和 [掌握]
   * - Learning (学习中) 🔵 -> [掌握] (主推荐) 和 [陌生]
   * - Known (已掌握) 🟢 -> [学习] (主推荐) 和 [陌生]
   * - 默认情况(无状态) -> [学习] (主推荐) 和 [掌握]
   */
  const getSmartButtons = (): [ActionConfig, ActionConfig] => {
    switch (currentStatus) {
      case 'unknown':
        // 陌生 -> 显示 [学习] 和 [掌握]
        return [
          {
            type: 'learning',
            label: '学习',
            // icon: <MenuBookIcon fontSize="small" />,
            title: '加入学习列表',
            status: 'learning',
            familiarityLevel: 1,
            isPrimary: true,
            className: 'bg-primary hover:bg-primary/90 text-font-base font-bold',
          },
          {
            type: 'known',
            label: '掌握',
            // icon: <CheckCircleIcon fontSize="small" />,
            title: '标记为已掌握',
            status: 'known',
            familiarityLevel: 7,
            isPrimary: false,
            className: 'bg-lang-blue hover:bg-lang-blue/90 text-white font-bold',
          },
        ];

      case 'learning':
        // 学习中 -> 显示 [掌握] 和 [陌生]
        return [
          {
            type: 'known',
            label: '掌握',
            // icon: <CheckCircleIcon fontSize="small" />,
            title: '标记为已掌握',
            status: 'known',
            familiarityLevel: 7,
            isPrimary: true,
            className: 'bg-lang-blue hover:bg-lang-blue/90 text-white font-bold',
          },
          {
            type: 'unknown',
            label: '陌生',
            // icon: <HelpOutlineIcon fontSize="small" />,
            title: '标记为陌生',
            status: 'unknown',
            familiarityLevel: 0,
            isPrimary: false,
            className: 'bg-gray-200 hover:bg-gray-200/90 text-font-base font-bold',
          },
        ];

      case 'known':
        // 已掌握 -> 显示 [学习] 和 [陌生]
        return [
          {
            type: 'learning',
            label: '学习',
            // icon: <MenuBookIcon fontSize="small" />,
            title: '重新加入学习',
            status: 'learning',
            familiarityLevel: 1,
            isPrimary: true,
            className: 'bg-primary hover:bg-primary/90 text-font-base font-bold',
          },
          {
            type: 'unknown',
            label: '陌生',
            // icon: <HelpOutlineIcon fontSize="small" />,
            title: '重置为陌生',
            status: 'unknown',
            familiarityLevel: 0,
            isPrimary: false,
            className: 'bg-gray-200 hover:bg-gray-200/90 text-font-base',
          },
        ];

      case 'ignored':
        // 已忽略 -> 显示 [学习] 和 [掌握]
        return [
          {
            type: 'learning',
            label: '学习',
            // icon: <MenuBookIcon fontSize="small" />,
            title: '取消忽略并加入学习列表',
            status: 'learning',
            familiarityLevel: 1,
            isPrimary: true,
            className: 'bg-primary hover:bg-primary/90 text-font-base font-bold',
          },
          {
            type: 'known',
            label: '掌握',
            // icon: <CheckCircleIcon fontSize="small" />,
            title: '取消忽略并标记为已掌握',
            status: 'known',
            familiarityLevel: 7,
            isPrimary: false,
            className: 'bg-lang-blue hover:bg-lang-blue/90 text-white font-bold',
          },
        ];

      default:
        // 默认情况（无状态）-> 显示 [学习] 和 [掌握]
        return [
          {
            type: 'learning',
            label: '学习',
            // icon: <MenuBookIcon fontSize="small" />,
            title: '加入学习列表',
            status: 'learning',
            familiarityLevel: 1,
            isPrimary: true,
            className: 'bg-primary hover:bg-primary/90',
          },
          {
            type: 'known',
            label: '掌握',
            // icon: <CheckCircleIcon fontSize="small" />,
            title: '标记为已掌握',
            status: 'known',
            familiarityLevel: 7,
            isPrimary: false,
            className: 'bg-success hover:bg-success/90',
          },
        ];
    }
  };

  const smartButtons = getSmartButtons();

  return (
    <div className="grid grid-cols-2 gap-2 mt-2">
      {/* 两个主要动作按钮 */}
      {smartButtons.map((action) => (
        <Button
          key={action.type}
          onClick={(e) => {
            e.stopPropagation();
            onUpdateStatus(lemmas, action.status, action.familiarityLevel);
          }}
          title={action.title}
          className={`${action.className} font-bold`}
        >
          {action.label}
        </Button>
      ))}

      {/* 忽略按钮 - 在同一行，但视觉上分离 */}
      {/* {onIgnoreWord && (
				<Tooltip title='忽略此词' placement='top'>
					<IconButton
						size='small'
						onClick={() => onIgnoreWord(word)}
						sx={{
							color: "text.secondary",
							border: "1px solid",
							borderColor: "divider",
							borderRadius: "6px",
							padding: "4px",
							transition: "all 0.2s ease",
							"&:hover": {
								backgroundColor: "error.lighter",
								borderColor: "error.light",
								color: "error.main",
								transform: "scale(1.05)"
							}
						}}
					>
						<BlockIcon sx={{fontSize: 16}} />
					</IconButton>
				</Tooltip>
			)} */}
    </div>
  );
};
