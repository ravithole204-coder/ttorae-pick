export const AGE_GROUPS = ['10대', '20대', '30대', '40대', '50대+'] as const;
export type AgeGroup = (typeof AGE_GROUPS)[number];

export type FeedKind = 'youtube' | 'community';
/** 커뮤니티 정렬: 인기순(사이트 인기글 순서) / 조회수순 / 최신순 */
export type CommunitySort = 'popular' | 'views' | 'recent';
export type Gender = 'all' | 'male' | 'female';
export type GenderFilter = Gender;

/** 순위 변동: 숫자(+는 상승, -는 하락) 또는 신규 진입 */
export type RankDelta = number | 'new';

export interface FeedItem {
  id: string;
  /**
   * 커뮤니티 글: 그 커뮤니티를 주로 쓰는 연령대 (이용자 통계·사이트 성격 기준).
   * 유튜브: 'all' — 영상별 시청자 나이는 공개되지 않아서 연령 구분 없이 전체 인기 순위예요.
   */
  age: AgeGroup | 'all';
  kind: FeedKind;
  title: string;
  /** 유튜브는 채널명, 커뮤니티는 사이트명 */
  source: string;
  /** 커뮤니티 이용자 성비 기준. 유튜브는 'all' */
  gender: Gender;
  /** 커뮤니티를 이 연령대로 묶은 근거 (화면에 그대로 보여줘요) */
  basis?: string;
  /** 근거 출처 링크 */
  basisUrl?: string;
  views: number;
  comments: number;
  /** 추천/좋아요 수 (커뮤니티 글) */
  recommends?: number;
  /** 모르면 -1 (화면에 표시하지 않음) */
  hoursAgo: number;
  emoji: string;
  summary: string;
  rankDelta: RankDelta;
  /** 유튜브 영상 길이 */
  duration?: string;
  /** 원문 링크 (실제 데이터에만 있음) */
  url?: string;
  /** 썸네일 이미지 주소 (실제 데이터에만 있음) */
  thumbnail?: string;
  /** 썸네일이 없을 때 대신 보여줄 사이트 로고 */
  logo?: string;
  /** 최근 관측 간격 동안 늘어난 조회수 */
  viewsDelta?: number;
  /** 최근 관측 간격 동안 늘어난 추천 수 (조회수가 없는 커뮤니티용) */
  recommendsDelta?: number;
  /** 최근 관측 간격 동안 늘어난 댓글 수 */
  commentsDelta?: number;
  /** 유튜브 영상 ID (앱 안에서 재생할 때 사용) */
  videoId?: string;
  /** 유튜브 카테고리 이름 (음악, 게임, 스포츠…) */
  category?: string;
  /** 좋아요 수 */
  likes?: number;
}

/** 수집 프로그램이 만들어 내는 파일(public/data/feed.json)의 모양 */
export interface FeedFile {
  updatedAt: string;
  /** 이전 수집과의 시간 간격 (시간 단위). 처음 수집이면 null */
  intervalHours: number | null;
  items: FeedItem[];
}

export function isAgeGroup(value: unknown): value is AgeGroup {
  return typeof value === 'string' && (AGE_GROUPS as readonly string[]).includes(value);
}

/** "20대가", "50대 이상이"처럼 조사까지 붙여서 반환 */
export function ageSubject(age: AgeGroup): string {
  return age === '50대+' ? '50대 이상이' : `${age}가`;
}

export function ageLabel(age: AgeGroup): string {
  return age === '50대+' ? '50대 이상' : age;
}
