export function formatDate(dateString: string | null): string {
  if (!dateString) return '-';

  const date = new Date(dateString);
  const now = new Date();
  const diffHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

  if (diffHours < 1) {
    return '刚刚';
  } else if (diffHours < 24) {
    return `${Math.floor(diffHours)} 小时前`;
  } else {
    const days = Math.floor(diffHours / 24);
    return days === 0 ? '今天' : `${days} 天前`;
  }
}
