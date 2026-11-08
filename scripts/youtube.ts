/**
 * 유튜브 공식 API에서 한국 인기 영상 목록을 가져와요.
 * 호출 1번에 할당량 1포인트(하루 1만 포인트)라서 3시간마다 돌려도 넉넉해요.
 */
import { z } from 'zod';

const VideoSchema = z.object({
  id: z.string(),
  snippet: z.object({
    publishedAt: z.string(),
    title: z.string(),
    description: z.string(),
    channelTitle: z.string(),
    categoryId: z.string(),
    tags: z.array(z.string()).optional(),
    defaultLanguage: z.string().optional(),
    defaultAudioLanguage: z.string().optional(),
    thumbnails: z.record(z.string(), z.object({ url: z.string() })),
  }),
  statistics: z.object({
    viewCount: z.string().optional(),
    likeCount: z.string().optional(),
    commentCount: z.string().optional(),
  }),
  contentDetails: z.object({ duration: z.string() }),
});

const ResponseSchema = z.object({
  items: z.array(VideoSchema),
  nextPageToken: z.string().optional(),
});

export type YoutubeVideo = z.infer<typeof VideoSchema>;

/** 유튜브 카테고리 번호 → 한글 이름 (AI 분류에 힌트로 줘요) */
const CATEGORY_NAMES: Record<string, string> = {
  '1': '영화/애니메이션',
  '2': '자동차',
  '10': '음악',
  '15': '동물',
  '17': '스포츠',
  '19': '여행',
  '20': '게임',
  '22': '인물/블로그',
  '23': '코미디',
  '24': '엔터테인먼트',
  '25': '뉴스/정치',
  '26': '노하우/스타일',
  '27': '교육',
  '28': '과학/기술',
  '29': '비영리/사회운동',
};

export function categoryName(id: string): string {
  return CATEGORY_NAMES[id] ?? '기타';
}

/**
 * 한국 지역 인기 영상을 최대 `limit`개 가져와요 (한 번에 50개씩 페이지를 넘김).
 * categoryId 를 주면 그 카테고리 안에서의 인기 순위를 가져와요.
 */
async function fetchChart(apiKey: string, limit: number, categoryId?: string): Promise<YoutubeVideo[]> {
  const videos: YoutubeVideo[] = [];
  let pageToken: string | undefined;

  while (videos.length < limit) {
    const params = new URLSearchParams({
      part: 'snippet,statistics,contentDetails',
      chart: 'mostPopular',
      regionCode: 'KR',
      maxResults: String(Math.min(50, limit - videos.length)),
      key: apiKey,
    });
    if (categoryId) params.set('videoCategoryId', categoryId);
    if (pageToken) params.set('pageToken', pageToken);

    const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`);
    if (!res.ok) {
      const body = await res.text();
      // 일부 카테고리는 한국 차트가 없어서 404가 와요. 그런 카테고리는 건너뛰어요.
      if (categoryId && res.status === 404) return [];
      throw new Error(`유튜브 API 오류 ${res.status}: ${body.slice(0, 300)}`);
    }
    const page = ResponseSchema.parse(await res.json());
    videos.push(...page.items);
    if (!page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }

  return videos;
}

/**
 * 전체 인기 차트 + 카테고리별 인기 차트를 모두 모아 중복을 뺀 목록을 돌려줘요.
 * 전체 차트만 보면 K-pop·게임이 대부분이라 30대 이상 영상이 거의 없어서,
 * 뉴스·교육·노하우·여행 같은 카테고리 차트를 함께 가져와요. (호출당 할당량 1포인트)
 */
export async function fetchPopularVideos(apiKey: string, perChart = 50): Promise<YoutubeVideo[]> {
  const seen = new Map<string, YoutubeVideo>();
  const add = (list: YoutubeVideo[]) => {
    for (const v of list) if (!seen.has(v.id)) seen.set(v.id, v);
  };

  add(await fetchChart(apiKey, 100));
  for (const categoryId of Object.keys(CATEGORY_NAMES)) {
    const list = await fetchChart(apiKey, perChart, categoryId);
    if (list.length > 0) console.log(`  ${categoryName(categoryId)} ${list.length}개`);
    add(list);
  }
  return [...seen.values()];
}

/** "PT1H2M3S" 같은 ISO 8601 길이 표기를 "1:02:03" / "12:40" 으로 바꿔요 */
export function formatDuration(iso: string): string {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return '';
  const h = Number(m[1] ?? 0);
  const min = Number(m[2] ?? 0);
  const s = Number(m[3] ?? 0);
  const mm = h > 0 ? String(min).padStart(2, '0') : String(min);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 목록에 쓰기 좋은 썸네일 주소를 골라요 (high/medium 은 모든 영상에 항상 있어요) */
export function bestThumbnail(v: YoutubeVideo): string | undefined {
  const order = ['high', 'medium', 'standard', 'maxres', 'default'];
  for (const key of order) {
    const t = v.snippet.thumbnails[key];
    if (t) return t.url;
  }
  return undefined;
}
