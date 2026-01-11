/**
 * Tag Display Mapper - Decouples tag display from backend database
 * 
 * This system allows maintaining tag display information in the frontend
 * while keeping the backend focused on just the tag keys.
 */

// Define the tag display information structure
interface TagDisplayInfo {
  name: string;
  description: string;
  color?: string; // Optional color for UI styling
}

// Define the tag mapping structure
interface TagMapping {
  [key: string]: TagDisplayInfo;
}

// Default tag mapping - can be extended or overridden
const DEFAULT_TAG_MAPPING: TagMapping = {
  'cet4': {
    name: '大学四级',
    description: '大学英语四级考试核心词汇',
    color: 'bg-blue-100 text-blue-800',
  },
  'cet6': {
    name: '大学六级',
    description: '大学英语六级考试核心词汇',
    color: 'bg-purple-100 text-purple-800',
  },
  'toefl': {
    name: '托福',
    description: 'TOEFL考试核心词汇',
    color: 'bg-green-100 text-green-800',
  },
  'ielts': {
    name: '雅思',
    description: 'IELTS考试核心词汇',
    color: 'bg-yellow-100 text-yellow-800',
  },
  'gre': {
    name: 'GRE',
    description: 'GRE考试核心词汇',
    color: 'bg-red-100 text-red-800',
  },
  'high': {
    name: '高中词汇',
    description: '高中阶段核心英语词汇',
    color: 'bg-indigo-100 text-indigo-800',
  },
  'junior_high': {
    name: '初中词汇',
    description: '初中阶段核心英语词汇',
    color: 'bg-teal-100 text-teal-800',
  },
  // Add more mappings as needed
};

class TagDisplayMapper {
  private tagMapping: TagMapping;

  constructor(mapping?: Partial<TagMapping>) {
    // Start with default mapping and allow custom overrides
    this.tagMapping = { ...DEFAULT_TAG_MAPPING, ...mapping };
  }

  /**
   * Get the display information for a tag key
   * @param key - The tag key from the backend
   * @returns The display information or null if not found
   */
  getTagDisplayInfo(key: string): TagDisplayInfo | null {
    return this.tagMapping[key] || null;
  }

  /**
   * Get the display name for a tag key
   * @param key - The tag key from the backend
   * @returns The display name or the key itself if not found
   */
  getTagName(key: string): string {
    const displayInfo = this.getTagDisplayInfo(key);
    return displayInfo?.name || key;
  }

  /**
   * Get the display description for a tag key
   * @param key - The tag key from the backend
   * @returns The description or empty string if not found
   */
  getTagDescription(key: string): string {
    const displayInfo = this.getTagDisplayInfo(key);
    return displayInfo?.description || '';
  }

  /**
   * Get the color class for a tag key
   * @param key - The tag key from the backend
   * @returns The color class or a default class if not found
   */
  getTagColor(key: string): string {
    const displayInfo = this.getTagDisplayInfo(key);
    return displayInfo?.color || 'bg-gray-100 text-gray-800';
  }

  /**
   * Check if a tag exists in the mapping
   * @param key - The tag key to check
   * @returns True if the tag exists in the mapping
   */
  hasTag(key: string): boolean {
    return !!this.tagMapping[key];
  }

  /**
   * Add or update a tag mapping
   * @param key - The tag key
   * @param displayInfo - The display information
   */
  setTag(key: string, displayInfo: TagDisplayInfo): void {
    this.tagMapping[key] = displayInfo;
  }

  /**
   * Get all available tag keys
   * @returns Array of tag keys
   */
  getAllTagKeys(): string[] {
    return Object.keys(this.tagMapping);
  }

  /**
   * Get all tag mappings
   * @returns The complete tag mapping object
   */
  getAllMappings(): TagMapping {
    return { ...this.tagMapping };
  }

  /**
   * Update the entire tag mapping
   * @param newMapping - New mapping to replace existing one
   */
  updateMapping(newMapping: TagMapping): void {
    this.tagMapping = { ...DEFAULT_TAG_MAPPING, ...newMapping };
  }
}

// Create a singleton instance
let tagDisplayMapper: TagDisplayMapper;

export function getTagDisplayMapper(mapping?: Partial<TagMapping>): TagDisplayMapper {
  if (!tagDisplayMapper) {
    tagDisplayMapper = new TagDisplayMapper(mapping);
  }
  return tagDisplayMapper;
}

// Export the type for use in other files
export type { TagDisplayInfo, TagMapping };