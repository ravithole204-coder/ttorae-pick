/**
 * 목록 페이지에 썸네일이 없는 커뮤니티 글은 글 페이지를 한 번 열어 대표 이미지 주소만 뽑아요.
 *
 * 원칙:
 * - 글마다 딱 한 번만 열어요. 결과(없으면 null 까지)를 캐시에 남겨 같은 글을 다시 열지 않아요.
 * - 사이트끼리는 동시에, 한 사이트 안에서는 1.5초 간격으로 차례로 열어요. 사이트당 한 번에 최대 40개.
 * - 이미지 주소만 읽어요. 본문은 저장하지도, 로그에 남기지도 않아요.
 * - 봇임을 숨기지 않아요 (community.ts 와 같은 User-Agent).
 */
import { parse, type HTMLElement } from 'node-html-parser';
import type { CommunityPost } from './community';

/** 글 id → 이미지 URL (없으면 null). null도 저장해서 같은 글을 다시 열지 않아요 */
export type ThumbnailCache = Record<string, string | null>;

const USER_AGENT = 'TtoraePick/0.1 (+https://github.com/haruzong1; community popular-posts aggregator; title+link only)';
const TIMEOUT_MS = 15_000;
const GAP_MS = 1_500;
const PER_SITE_LIMIT = 40;

const HEADERS = {
  'User-Agent': USER_AGENT,
  Accept: 'text/html, */*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// 이미지 주소 고르기
// ---------------------------------------------------------------------------

/** 아이콘·이모티콘·빈 gif·등급 배지·1x1 추적 픽셀 등 썸네일로 쓸 수 없는 주소 */
const JUNK_URL =
  /blank\.gif|transparent|spacer|pixel|1x1|\/ico_|icon|emoticon|emoji|\/level\/|badge|avatar|profile|loading|\.svg(\?|$)/i;

/** <img> 한 개에서 쓸 만한 절대 URL 을 뽑아요. 지연 로딩이면 data-original / data-src 가 진짜 주소예요 */
function imageUrl(img: HTMLElement, base: string): string | undefined {
  const raw = img.getAttribute('data-original') ?? img.getAttribute('data-src') ?? img.getAttribute('src');
  if (!raw || JUNK_URL.test(raw)) return undefined;
  // width="1" height="1" 같은 추적용 이미지는 걸러요
  const w = Number(img.getAttribute('width') ?? NaN);
  const h = Number(img.getAttribute('height') ?? NaN);
  if ((w > 0 && w <= 2) || (h > 0 && h <= 2)) return undefined;
  try {
    const url = new URL(raw, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

/** 컨테이너 안의 첫 번째 쓸 만한 이미지 */
function firstImage(container: HTMLElement | null | undefined, base: string): string | undefined {
  if (!container) return undefined;
  for (const img of container.querySelectorAll('img')) {
    const url = imageUrl(img, base);
    if (url) return url;
  }
  return undefined;
}

type Extractor = (root: HTMLElement, postUrl: string) => string | undefined;

/** 사이트별로 "글 본문 이미지"가 어디에 있는지 (글 페이지를 직접 확인해서 정한 규칙) */
const EXTRACTORS: Record<string, Extractor> = {
  // XE/Rhymix: 본문은 div.rhymix_content.xe_content, 이미지는 img-cdn.theqoo.net 의 .webp
  theqoo: (root, url) => firstImage(root.querySelector('.rhymix_content, .xe_content'), url),
  // 본문 div.bodyCont, 이미지는 file1.bobaedream.co.kr/...
  bobaedream: (root, url) => firstImage(root.querySelector('div.bodyCont'), url),
  // 본문 div.viewContent, 이미지는 http://thimg.todayhumor.co.kr/upfile/... (http 라서 아래에서 https 로 바꿔요)
  todayhumor: (root, url) => firstImage(root.querySelector('div.viewContent'), url),
  // 오르비는 업로드 이미지가 s3.orbi.kr/data/file/ 아래에만 있어요. 본문 영역을 먼저 보고, 못 찾으면 페이지 전체에서 찾아요
  orbi: (root, url) => {
    const isUpload = (u: string | undefined): u is string => !!u && u.startsWith('https://s3.orbi.kr/data/file/');
    const scopes = [root.querySelector('.content-body'), root];
    for (const scope of scopes) {
      if (!scope) continue;
      for (const img of scope.querySelectorAll('img')) {
        const u = imageUrl(img, url);
        if (isUpload(u)) return u;
      }
    }
    return undefined;
  },
  // 본문 #articleBody (대부분 글만 있어서 이미지가 없는 경우가 많아요)
  '82cook': (root, url) => firstImage(root.querySelector('#articleBody'), url),
  // 디시는 og:image 가 글의 첫 이미지예요 (viewimage.php?id=...&no=...)
  dcbest: (root, url) => {
    const content = root.querySelector('meta[property="og:image"]')?.getAttribute('content');
    if (!content || JUNK_URL.test(content)) return undefined;
    try {
      return new URL(content, url).toString();
    } catch {
      return undefined;
    }
  },
};

// ---------------------------------------------------------------------------
// 네트워크
// ---------------------------------------------------------------------------

/** 응답 헤더나 <meta charset> 에서 글자 인코딩을 알아내요 (옛날 게시판은 EUC-KR 인 경우가 있어요) */
function detectCharset(contentType: string | null, bytes: ArrayBuffer): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType ?? '')?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 4096));
  return (/charset=["']?([\w-]+)/i.exec(head)?.[1] ?? 'utf-8').toLowerCase();
}

/**
 * 네트워크 요청이 신호를 무시하고 멈춰 있어도(연결 단계에서 가끔 그래요) 정해진 시간 안에 반드시 끝내요.
 * 이게 없으면 글 하나가 5분 넘게 전체 수집을 붙잡을 수 있어요 (실제로 겪음).
 */
function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what}: ${ms / 1000}초 안에 응답 없음`)), ms);
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

/** 글 페이지를 열어 HTML 문자열로. 차단(4xx/5xx)이면 undefined */
async function fetchHtml(url: string): Promise<string | undefined> {
  return withTimeout(fetchHtmlInner(url), TIMEOUT_MS + 2_000, url);
}

async function fetchHtmlInner(url: string): Promise<string | undefined> {
  const res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) {
    console.warn(`  [thumb] HTTP ${res.status}: ${url}`);
    return undefined;
  }
  const bytes = await res.arrayBuffer();
  const charset = detectCharset(res.headers.get('content-type'), bytes);
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** 이미지 주소가 실제로 이미지로 응답하는지 (헤더만 보고 본문은 읽지 않아요) */
async function servesImage(url: string): Promise<boolean> {
  try {
    const res = await withTimeout(
      fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) }),
      TIMEOUT_MS + 2_000,
      url,
    );
    const type = res.headers.get('content-type') ?? '';
    await res.body?.cancel();
    return res.ok && type.startsWith('image/');
  } catch {
    return false;
  }
}

/**
 * 오늘의유머 이미지는 http:// 주소라 https 로 서비스되는 우리 화면에서는 브라우저가 막아요.
 * 같은 주소를 https 로 바꿔 열리는지 한 번만 확인하고(한 번 돌릴 때 1회), 안 열리면 쓰지 않아요.
 */
function makeHttpsUpgrader(): (url: string) => Promise<string | null> {
  let httpsWorks: boolean | undefined;
  return async (url) => {
    if (!url.startsWith('http://')) return url;
    const https = `https://${url.slice('http://'.length)}`;
    if (httpsWorks === undefined) {
      httpsWorks = await servesImage(https);
      if (!httpsWorks) console.warn('  [thumb] todayhumor 이미지를 https 로 열 수 없어 썸네일을 쓰지 않아요');
    }
    return httpsWorks ? https : null;
  };
}

/** 한 사이트의 글들을 차례로 열어 캐시에 채워요 (사이트당 최대 PER_SITE_LIMIT 개) */
async function fillSite(
  site: string,
  posts: CommunityPost[],
  out: ThumbnailCache,
  upgradeHttps: (url: string) => Promise<string | null>,
): Promise<void> {
  const extract = EXTRACTORS[site];
  if (!extract) return;
  const todo = posts.slice(0, PER_SITE_LIMIT);
  for (const [i, post] of todo.entries()) {
    if (i > 0) await sleep(GAP_MS);
    try {
      const html = await fetchHtml(post.url);
      const found = html ? extract(parse(html), post.url) : undefined;
      if (!found) {
        out[post.id] = null;
        continue;
      }
      const url = new URL(found);
      // "//host/..." 같은 프로토콜 생략 주소는 new URL 단계에서 글 주소의 https 를 따라요.
      // 남은 http:// 주소는 https 로 바꿀 수 있을 때만 써요
      out[post.id] = url.protocol === 'http:' ? await upgradeHttps(url.toString()) : url.toString();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`  [thumb] ${post.id} 실패: ${reason}`);
      out[post.id] = null;
    }
  }
  if (posts.length > todo.length) {
    console.warn(`  [thumb] ${site}: ${posts.length - todo.length}개는 이번에 안 열었어요 (사이트당 ${PER_SITE_LIMIT}개 제한)`);
  }
}

/**
 * 캐시에 없는 글만 글 페이지를 열어 썸네일 주소를 찾고, 기존 캐시에 결과를 합친 새 캐시를 돌려줘요.
 * 못 찾은 글도 null 로 기록해서 다음번엔 다시 열지 않아요.
 */
export async function fetchPostThumbnails(posts: CommunityPost[], cache: ThumbnailCache): Promise<ThumbnailCache> {
  const bySite = new Map<string, CommunityPost[]>();
  for (const post of posts) {
    if (post.id in cache || !(post.site in EXTRACTORS)) continue;
    const list = bySite.get(post.site) ?? [];
    if (!list.some((p) => p.id === post.id)) list.push(post);
    bySite.set(post.site, list);
  }

  const results: ThumbnailCache = {};
  const upgradeHttps = makeHttpsUpgrader();
  // 사이트끼리는 동시에 (서로 다른 서버라 부담이 안 겹쳐요), 한 사이트 안에서는 차례로
  await Promise.all([...bySite.entries()].map(([site, list]) => fillSite(site, list, results, upgradeHttps)));

  const found = Object.values(results).filter((v) => v !== null).length;
  console.log(`  글 썸네일: ${Object.keys(results).length}개 열어서 ${found}개 찾음`);
  return { ...cache, ...results };
}
