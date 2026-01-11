import React from 'react';
import { getTagDisplayMapper } from '../utils/tagDisplayMapper';
import type { TagInfo } from 'shared-types';

interface TagDisplayComponentProps {
  tags?: TagInfo[];
}

const TagDisplayComponent: React.FC<TagDisplayComponentProps> = ({ tags }) => {
  if (!tags || tags.length === 0) {
    return null;
  }

  return (
    <div className="mt-1 flex flex-wrap gap-1 justify-end">
      <span
        // className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${colorClass}`}
        className="mt-1 text-font-secondary text-[11px] text-right"
      >
        {tags
          .map((tag, index) => {
            const tagDisplayInfo = getTagDisplayMapper().getTagDisplayInfo(tag.key);
            const displayName = tagDisplayInfo ? tagDisplayInfo.name : tag.name || tag.key;
            const colorClass = tagDisplayInfo ? tagDisplayInfo.color : 'bg-gray-100 text-gray-800';

            return displayName;
          })
          .join(',')}
      </span>
    </div>
  );
};

export default TagDisplayComponent;
