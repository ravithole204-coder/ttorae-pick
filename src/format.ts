/** 1240000 → "124만", 52000 → "5.2만", 3400 → "3,400" */
export function formatCount(n: number): string {
  if (n >= 10000) {
    const man = n / 10000;
    const text = man >= 100 ? Math.round(man).toString() : man.toFixed(1).replace(/\.0$/, '');
    return `${text}만`;
  }
  return n.toLocaleString('ko-KR');
}

export function formatAgo(hours: number): string {
  if (hours < 0) return '';
  if (hours < 1) return '방금 전';
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

export type VideoFormat = 'shorts' | 'video';

/** "1:02:03" → 초 */
export function durationSeconds(duration: string | undefined): number {
  if (!duration) return 0;
  const parts = duration.split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/** 쇼츠(4분 이하 짧은 영상) / 영상(그 이상) — 인급동이 짧은 영상으로 가득해서 나눠요 */
export function videoFormat(duration: string | undefined): VideoFormat {
  return durationSeconds(duration) <= 240 ? 'shorts' : 'video';
}

/** 썸네일에 "쇼츠" 빨간 표시를 붙일지 — 유튜브 기준(1분 이하)만 */
export function isShorts(duration: string | undefined): boolean {
  const s = durationSeconds(duration);
  return s > 0 && s <= 60;
}

/** 조회수 증가량 → "+12만" */
export function formatDelta(n: number): string {
  return n > 0 ? `+${formatCount(n)}` : formatCount(n);
}

const THUMB_COLORS = ['#FFE8E8', '#E8F3FF', '#FFF4DB', '#E5F8EE', '#F1EBFF', '#FFEDE3'];

/** 썸네일 자리 배경색 (실제 썸네일 이미지가 붙기 전까지 사용) */
export function thumbColor(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return THUMB_COLORS[hash % THUMB_COLORS.length];
}
