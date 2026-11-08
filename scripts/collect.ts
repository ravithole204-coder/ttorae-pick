/**
 * 수집 프로그램. 실행하면:
 *   1. 유튜브 한국 인기 영상을 가져오고
 *   2. 이전 수집과 비교해 "최근 몇 시간 동안 얼마나 늘었는지"를 계산하고
 *   3. 새 영상은 AI로 연령대를 분류한 뒤
 *   4. 연령대별 순위를 public/data/feed.json 에 저장해요.
 *
 * 실행: npm run collect
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { AGE_GROUPS, type AgeGroup, type FeedFile, type FeedItem, type RankDelta } from '../src/types';
import { videoFormat, type VideoFormat } from '../src/format';
import { ClassificationSchema, classifyVideos, type ClassificationMap } from './classify';
import { SITES, fetchCommunityPosts, type CommunityPost } from './community';
import { fetchPostThumbnails, type ThumbnailCache } from './thumbnails';
import { bestThumbnail, categoryName, fetchPopularVideos, formatDuration, type YoutubeVideo } from './youtube';

const SNAPSHOT_PATH = 'data/snapshots.json';
const CLASSIFICATION_PATH = 'data/classifications.json';
const THUMBNAIL_PATH = 'data/thumbnails.json';
const FEED_PATH = 'public/data/feed.json';
const MAX_SNAPSHOTS = 48; // 3시간 간격이면 6일치
const PER_AGE = 20; // 연령대마다 보여줄 커뮤니티 글 수
// 유튜브는 화면에서 카테고리 칩으로 걸러 보기 때문에 넉넉히 저장해요
const PER_FORMAT: Record<VideoFormat, number> = { video: 60, shorts: 60 };

/** 커뮤니티 글 하나의 수치 기록 (v=조회, r=추천, c=댓글) */
const PostStatsSchema = z.object({ v: z.number().optional(), r: z.number().optional(), c: z.number().optional() });
type PostStats = z.infer<typeof PostStatsSchema>;

const SnapshotSchema = z.object({
  takenAt: z.string(),
  views: z.record(z.string(), z.number()),
  /** 커뮤니티 글 id → 수치. 예전 기록에는 없을 수 있어요 */
  posts: z.record(z.string(), PostStatsSchema).optional(),
});
type Snapshot = z.infer<typeof SnapshotSchema>;

async function readJson<T>(path: string, schema: z.ZodType<T>, fallback: T): Promise<T> {
  try {
    return schema.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    return fallback;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} 가 .env 에 없어요. .env.example 을 참고해 주세요.`);
  return value;
}

function hoursBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 3_600_000;
}

/** 조회수 증가량 계산 기준으로 삼을 간격 (TubeTen처럼 약 4시간) */
const TARGET_INTERVAL_HOURS = 4;
/** 이보다 최근 기록은 너무 짧아서 비교에 안 써요 */
const MIN_INTERVAL_HOURS = 0.5;

/** 지금으로부터 약 4시간 전에 가장 가까운 기록을 골라요. 30분 안 된 기록만 있으면 null */
function pickBaseline(snapshots: Snapshot[], now: string): Snapshot | null {
  let best: Snapshot | null = null;
  let bestGap = Infinity;
  for (const s of snapshots) {
    const age = hoursBetween(s.takenAt, now);
    if (age < MIN_INTERVAL_HOURS) continue;
    const gap = Math.abs(age - TARGET_INTERVAL_HOURS);
    if (gap < bestGap) {
      best = s;
      bestGap = gap;
    }
  }
  return best;
}

/** 한국 시청자용 영상인지 — 제목·설명에 한글이 있거나 음성 언어가 한국어면 통과 */
function isKorean(v: YoutubeVideo): boolean {
  const hangul = /[가-힣]/;
  return (
    hangul.test(v.snippet.title) ||
    hangul.test(v.snippet.channelTitle) ||
    hangul.test(v.snippet.description) ||
    (v.snippet.defaultAudioLanguage ?? '').startsWith('ko') ||
    (v.snippet.defaultLanguage ?? '').startsWith('ko')
  );
}

/** 이전 feed.json 에서 연령대·종류별 순위를 꺼내 순위 변동 계산에 써요 */
function previousRanks(feed: FeedFile | null): Map<string, number> {
  const ranks = new Map<string, number>();
  if (!feed) return ranks;
  const counters = new Map<string, number>();
  for (const item of feed.items) {
    const key = `${item.age}-${item.kind}-${item.kind === 'youtube' ? videoFormat(item.duration) : ''}`;
    const rank = (counters.get(key) ?? 0) + 1;
    counters.set(key, rank);
    ranks.set(item.id, rank);
  }
  return ranks;
}

function rankDelta(prev: Map<string, number>, id: string, rank: number): RankDelta {
  const before = prev.get(id);
  return before === undefined ? 'new' : before - rank;
}

/** 썸네일이 없는 글에 보여줄 사이트 로고 (구글 파비콘 서비스) */
const SITE_DOMAIN: Record<string, string> = {
  instiz: 'instiz.net',
  orbi: 'orbi.kr',
  theqoo: 'theqoo.net',
  dcbest: 'dcinside.com',
  bobaedream: 'bobaedream.co.kr',
  todayhumor: 'todayhumor.co.kr',
  '82cook': '82cook.com',
};

/** 구글 파비콘 서비스에 없는 사이트는 사이트가 직접 제공하는 아이콘을 써요 */
const SITE_LOGO_OVERRIDE: Record<string, string> = {
  orbi: 'https://s3.orbi.kr/images/apple-touch-icon.png',
};

function siteLogo(site: string): string | undefined {
  if (SITE_LOGO_OVERRIDE[site]) return SITE_LOGO_OVERRIDE[site];
  const domain = SITE_DOMAIN[site];
  return domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=128` : undefined;
}

const SITE_EMOJI: Record<string, string> = {
  instiz: '💬',
  orbi: '📚',
  theqoo: '🎀',
  dcbest: '🔥',
  bobaedream: '🚗',
  todayhumor: '😄',
  '82cook': '🏡',
};

/**
 * 연령대마다 그 연령대가 많이 쓰는 사이트들의 인기글을 번갈아 섞어요.
 * 한 사이트가 목록을 독차지하지 않도록 1위끼리, 2위끼리… 순서로 돌아가며 뽑아요.
 */
/** 이전 기록과 비교해 조회·추천·댓글이 얼마나 늘었는지 */
function postDeltas(post: CommunityPost, before: PostStats | undefined): Pick<FeedItem, 'viewsDelta' | 'recommendsDelta' | 'commentsDelta'> {
  if (!before) return {};
  const diff = (now: number | undefined, prev: number | undefined) =>
    now !== undefined && prev !== undefined ? now - prev : undefined;
  return {
    viewsDelta: diff(post.views, before.v),
    recommendsDelta: diff(post.recommends, before.r),
    commentsDelta: diff(post.comments, before.c),
  };
}

interface RankedCommunity {
  items: FeedItem[];
  /** 화면에 오르는 글만 (썸네일을 가져올 대상) — 글 id → 글 */
  shown: Map<string, CommunityPost>;
}

function rankCommunity(posts: CommunityPost[], prevRanks: Map<string, number>, previous: Snapshot | null): RankedCommunity {
  const bySite = new Map<string, CommunityPost[]>();
  for (const p of posts) {
    const list = bySite.get(p.site) ?? [];
    list.push(p);
    bySite.set(p.site, list);
  }

  const items: FeedItem[] = [];
  const shown = new Map<string, CommunityPost>();
  for (const age of AGE_GROUPS) {
    const sites = SITES.filter((s) => s.ages.includes(age) && (bySite.get(s.site)?.length ?? 0) > 0);
    const picked: { post: CommunityPost; gender: FeedItem['gender'] }[] = [];
    for (let round = 0; picked.length < PER_AGE; round++) {
      let added = false;
      for (const s of sites) {
        const post = bySite.get(s.site)?.[round];
        if (!post || picked.length >= PER_AGE) continue;
        picked.push({ post, gender: s.gender });
        added = true;
      }
      if (!added) break;
    }

    picked.forEach(({ post, gender }, i) => {
      const id = `${age}-community-${post.id}`;
      shown.set(post.id, post);
      items.push({
        id,
        age,
        kind: 'community',
        title: post.title,
        source: post.siteLabel,
        gender,
        views: post.views ?? 0,
        comments: post.comments ?? 0,
        recommends: post.recommends,
        hoursAgo: post.hoursAgo ?? -1,
        emoji: SITE_EMOJI[post.site] ?? '💬',
        summary: '',
        rankDelta: rankDelta(prevRanks, id, i + 1),
        ...postDeltas(post, previous?.posts?.[post.id]),
        url: post.url,
        // 목록에 썸네일이 있으면 그대로, 없으면 아래에서 글 페이지의 대표 이미지를 채워요
        // (디시 목록 썸네일은 외부에서 403이라 제외하고, 글 페이지의 og:image를 대신 써요)
        thumbnail: post.site === 'dcbest' ? undefined : post.thumbnail,
        logo: siteLogo(post.site),
      });
    });
  }
  return { items, shown };
}

/** 목록에 썸네일이 없던 글은 글 페이지를 한 번 열어 대표 이미지를 가져와요 (한 번 본 글은 기억) */
async function fillThumbnails(ranked: RankedCommunity, cache: ThumbnailCache): Promise<ThumbnailCache> {
  const need = [...ranked.shown.values()].filter((p) => !(p.site !== 'dcbest' && p.thumbnail));
  const next = await fetchPostThumbnails(need, cache);
  for (const it of ranked.items) {
    if (it.thumbnail) continue;
    const postId = it.id.replace(/^[^-]+-community-/, '');
    const found = next[postId];
    if (found) it.thumbnail = found;
  }
  return next;
}

async function main(): Promise<void> {
  const youtubeKey = requireEnv('YOUTUBE_API_KEY');
  requireEnv('TYPESAFE_API_KEY');

  console.log('유튜브 인기 영상 가져오는 중…');
  const fetched = await fetchPopularVideos(youtubeKey, 50);
  const videos = fetched.filter(isKorean);
  console.log(`${fetched.length}개 가져옴, 한국어 영상 ${videos.length}개`);

  const now = new Date().toISOString();
  const snapshots = await readJson<Snapshot[]>(SNAPSHOT_PATH, z.array(SnapshotSchema), []);
  const previous = pickBaseline(snapshots, now);
  const intervalHours = previous ? hoursBetween(previous.takenAt, now) : null;
  if (previous) console.log(`${intervalHours?.toFixed(1)}시간 전 기록과 비교해요`);

  console.log('연령대 분류 중…');
  const cached = await readJson<ClassificationMap>(CLASSIFICATION_PATH, z.record(z.string(), ClassificationSchema), {});
  const classifications = await classifyVideos(videos, cached);

  const prevFeed = await readJson<FeedFile | null>(
    FEED_PATH,
    z.object({ updatedAt: z.string(), intervalHours: z.number().nullable(), items: z.array(z.custom<FeedItem>()) }),
    null,
  );
  const prevRanks = previousRanks(prevFeed);

  const views = (v: YoutubeVideo) => Number(v.statistics.viewCount ?? 0);
  const growth = (v: YoutubeVideo): number | undefined => {
    const before = previous?.views[v.id];
    return before === undefined ? undefined : views(v) - before;
  };

  const items: FeedItem[] = [];
  for (const age of AGE_GROUPS) {
    const forAge = videos.filter((v) => classifications[v.id]?.ages.includes(age));
    // 조회수 많은 순. (증가량은 화면에 "+12만"으로만 보여줘요)
    forAge.sort((a, b) => views(b) - views(a));

    // 쇼츠 / 클립 / 영상을 따로 뽑아요 — 차트가 짧은 영상으로 가득 차서 섞으면 긴 영상이 묻혀요
    const formatOf = (v: YoutubeVideo) => videoFormat(formatDuration(v.contentDetails.duration));
    const groups: Record<VideoFormat, YoutubeVideo[]> = { shorts: [], video: [] };
    for (const v of forAge) groups[formatOf(v)].push(v);
    const chosen = (Object.keys(groups) as VideoFormat[]).flatMap((f) => groups[f].slice(0, PER_FORMAT[f]));
    const rankIn = (v: YoutubeVideo) => groups[formatOf(v)].indexOf(v) + 1;

    chosen.forEach((v) => {
      const rank = rankIn(v);
      const c = classifications[v.id];
      const id = `${age}-youtube-${v.id}`;
      items.push({
        id,
        age: age as AgeGroup,
        kind: 'youtube',
        title: v.snippet.title,
        source: v.snippet.channelTitle,
        gender: c.gender,
        views: views(v),
        comments: Number(v.statistics.commentCount ?? 0),
        hoursAgo: Math.round(hoursBetween(v.snippet.publishedAt, now)),
        emoji: c.emoji,
        summary: c.summary,
        rankDelta: rankDelta(prevRanks, id, rank),
        duration: formatDuration(v.contentDetails.duration),
        url: `https://www.youtube.com/watch?v=${v.id}`,
        thumbnail: bestThumbnail(v),
        viewsDelta: growth(v),
        videoId: v.id,
        category: categoryName(v.snippet.categoryId),
        likes: Number(v.statistics.likeCount ?? 0),
      });
    });
  }

  console.log('커뮤니티 인기글 가져오는 중…');
  let communityItems: FeedItem[];
  let postStats: Record<string, PostStats> = previous?.posts ?? {};
  try {
    const posts = await fetchCommunityPosts();
    const ranked = rankCommunity(posts, prevRanks, previous);
    postStats = Object.fromEntries(posts.map((p) => [p.id, { v: p.views, r: p.recommends, c: p.comments }]));

    console.log('커뮤니티 글 썸네일 가져오는 중…');
    const thumbCache = await readJson<ThumbnailCache>(THUMBNAIL_PATH, z.record(z.string(), z.string().nullable()), {});
    const nextCache = await fillThumbnails(ranked, thumbCache);
    await mkdir('data', { recursive: true });
    await writeFile(THUMBNAIL_PATH, JSON.stringify(nextCache));
    communityItems = ranked.items;
  } catch (err: unknown) {
    // 커뮤니티 쪽이 실패해도 유튜브 결과는 저장되도록, 이전 커뮤니티 결과를 유지해요
    console.warn('커뮤니티 수집 실패, 이전 결과 유지:', err instanceof Error ? err.message : err);
    communityItems = prevFeed?.items.filter((it) => it.kind === 'community') ?? [];
  }

  const feed: FeedFile = { updatedAt: now, intervalHours, items: [...items, ...communityItems] };

  const nextSnapshots = [
    ...snapshots,
    { takenAt: now, views: Object.fromEntries(videos.map((v) => [v.id, views(v)])), posts: postStats },
  ].slice(-MAX_SNAPSHOTS);

  await mkdir('data', { recursive: true });
  await mkdir('public/data', { recursive: true });
  await writeFile(SNAPSHOT_PATH, JSON.stringify(nextSnapshots));
  await writeFile(CLASSIFICATION_PATH, JSON.stringify(classifications, null, 2));
  await writeFile(FEED_PATH, JSON.stringify(feed, null, 2));

  const count = (age: AgeGroup, f: VideoFormat) => items.filter((it) => it.age === age && videoFormat(it.duration) === f).length;
  const perAge = AGE_GROUPS.map(
    (age) =>
      `${age} 영상 ${count(age, 'video')}·쇼츠 ${count(age, 'shorts')}·커뮤니티 ${communityItems.filter((it) => it.age === age).length}`,
  ).join(', ');
  console.log(`저장 완료 → ${FEED_PATH} (${perAge})`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
