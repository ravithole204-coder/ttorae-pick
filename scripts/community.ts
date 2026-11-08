/**
 * 커뮤니티 사이트의 "인기글" 목록 페이지에서 제목·링크·숫자(추천/댓글/조회)만 가져와요.
 *
 * 원칙:
 * - 사이트마다 한 번만 요청하고, 사이트 사이에 1.5초 쉬어요 (상대 서버에 부담을 주지 않기 위해).
 * - 글 본문은 절대 열지 않아요. 목록 한 페이지만 읽어요.
 * - 봇임을 숨기지 않아요 (브라우저인 척하는 User-Agent 금지). 막히면 그 사이트만 비우고 넘어가요.
 * - 한 사이트가 실패해도 전체 수집은 계속돼요.
 */
import { parse, type HTMLElement } from 'node-html-parser';
import type { AgeGroup, Gender } from '../src/types';

export interface CommunityPost {
  site: string;
  /** '인스티즈' 처럼 화면에 보여줄 이름 */
  siteLabel: string;
  /** `${site}-${글번호}` */
  id: string;
  /** HTML 엔티티 풀고, 앞뒤 공백·[말머리] 제거한 제목 */
  title: string;
  /** 절대 URL */
  url: string;
  /** 추천/좋아요 수 (목록에 있을 때만) */
  recommends?: number;
  /** 댓글 수 (목록에 있을 때만) */
  comments?: number;
  /** 조회수 (목록에 있을 때만) */
  views?: number;
  /** 목록에 작성 시각이 있으면 지금 기준 몇 시간 전인지, 없으면 undefined */
  hoursAgo?: number;
  /** 목록 페이지에 글 썸네일이 있을 때만 (절대 URL). 글 본문은 열지 않아요 */
  thumbnail?: string;
}

export interface SiteConfig {
  site: string;
  label: string;
  /** 이 사이트를 주로 쓰는 연령대 */
  ages: AgeGroup[];
  gender: Gender;
  /** 왜 이 연령대로 묶었는지 — 화면에 그대로 보여주는 문장. 공개 통계가 있으면 숫자를, 없으면 "사이트 성격 기준"이라고 솔직히 써요 */
  basis: string;
  /** 근거 출처 (공개 통계가 있을 때만) */
  basisUrl?: string;
}

/**
 * 사이트 → 주 이용 연령대·성별.
 * 글을 누가 봤는지는 알 수 없어요. 대신 "그 커뮤니티를 주로 쓰는 사람"을 기준으로 묶고, 근거를 화면에 밝혀요.
 * 루리웹·에펨코리아는 아직 안 넣었어요.
 */
export const SITES: readonly SiteConfig[] = [
  {
    site: 'instiz',
    label: '인스티즈',
    ages: ['20대'],
    gender: 'all',
    basis: '아이돌·학교 이야기 중심 커뮤니티로 10대 후반~20대 이용자가 주류예요. 공개 통계는 없어서 사이트 성격 기준이에요.',
  },
  {
    site: 'orbi',
    label: '오르비',
    ages: ['20대'],
    gender: 'all',
    basis: '수능 수험생 커뮤니티라 고등학생·재수생(10대 후반~20대 초반)이 이용해요. 사이트 성격 기준이에요.',
  },
  {
    site: 'theqoo',
    label: '더쿠',
    ages: ['20대', '30대'],
    gender: 'female',
    basis: '2024년 랭키파이 집계에서 20대 41%·30대 32%, 카카오데이터트렌드 기준 여성 비율 94%예요.',
    basisUrl: 'https://news.nate.com/view/20240409n19293',
  },
  {
    site: 'dcbest',
    label: '디시 실베',
    ages: ['20대', '30대'],
    gender: 'male',
    basis: '2023년 모바일인덱스·시밀러웹 기준 이용자의 약 80%가 10~30대, 남성 79%예요.',
    basisUrl: 'https://news.nate.com/view/20230821n20366',
  },
  {
    site: 'bobaedream',
    label: '보배드림',
    ages: ['40대', '50대+'],
    gender: 'male',
    basis: '자동차 커뮤니티로 남성 회원이 대다수이고 50~60대 비중이 높다고 알려져 있어요. 공개 통계는 없어서 사이트 성격 기준이에요.',
  },
  {
    site: 'todayhumor',
    label: '오늘의유머',
    ages: ['30대', '40대'],
    gender: 'all',
    basis: '2000년대 초 개설된 유머 커뮤니티로 30~40대 이용자가 많다고 알려져 있어요. 공개 통계는 없어서 사이트 성격 기준이에요.',
  },
  {
    site: '82cook',
    label: '82cook',
    ages: ['40대', '50대+'],
    gender: 'female',
    basis: '요리·살림 커뮤니티로 30~50대 기혼 여성이 주류이고, 2014년 이후 신규 가입을 받지 않아 연령대가 높아졌어요. 사이트 성격 기준이에요.',
  },
];

/** 누가 왜 긁어가는지 상대 사이트가 알 수 있게 솔직하게 밝혀요. 브라우저인 척하지 않아요. */
const USER_AGENT = 'TodayIssue/0.1 (+https://github.com/ravithole204-coder/ttorae-pick; community popular-posts aggregator; title+link only)';
const TIMEOUT_MS = 15_000;
const GAP_MS = 1_500;
const PER_SITE_LIMIT = 30;

// ---------------------------------------------------------------------------
// 공통 도우미
// ---------------------------------------------------------------------------

/** "1,234" / "[34]" / "(10)" 같은 문자열에서 숫자만 뽑아요. 숫자가 없으면 undefined */
function toNumber(text: string | undefined | null): number | undefined {
  if (!text) return undefined;
  const digits = text.replace(/[^\d]/g, '');
  return digits ? Number(digits) : undefined;
}

/** 제목 정리: 공백 합치기, 앞의 [말머리] 떼기 */
function cleanTitle(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(\[[^\]]{1,12}\]\s*)+/, '')
    .trim();
}

/** 지금 시각을 한국 시간 기준 "YYYY-MM-DD" 로 (목록에 날짜 없이 시각만 있는 글의 날짜를 채우려고) */
function todayKst(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
}

/** "2026-11-08 00:35:02" 같은 한국 시간 문자열 → 지금 기준 몇 시간 전 (정수, 음수면 0) */
function hoursSinceKst(dateTime: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(dateTime.trim());
  if (!m) return undefined;
  const [, y, mo, d, hh = '00', mm = '00', ss = '00'] = m;
  const t = new Date(`${y}-${mo}-${d}T${hh}:${mm}:${ss}+09:00`).getTime();
  if (Number.isNaN(t)) return undefined;
  return Math.max(0, Math.floor((Date.now() - t) / 3_600_000));
}

/**
 * 게시판 목록에 흔한 축약 시각을 해석해요.
 *  - "00:35" → 오늘 그 시각
 *  - "11.07" / "11/06" → 올해 그 날짜
 *  - "24.04.09" / "26/11/06 12:16" → 그 연도(20xx)의 날짜
 */
function hoursFromListTime(text: string | undefined | null): number | undefined {
  if (!text) return undefined;
  const s = text.replace(/\s+/g, ' ').trim();
  const today = todayKst();
  const year = today.slice(0, 4);

  let m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (m) return hoursSinceKst(`${today} ${m[1].padStart(2, '0')}:${m[2]}:${m[3] ?? '00'}`);

  m = /^(\d{2})[./](\d{2})$/.exec(s);
  if (m) return hoursSinceKst(`${year}-${m[1]}-${m[2]} 00:00:00`);

  m = /^(\d{2})[./](\d{2})[./](\d{2})(?: (\d{2}):(\d{2}))?$/.exec(s);
  if (m) return hoursSinceKst(`20${m[1]}-${m[2]}-${m[3]} ${m[4] ?? '00'}:${m[5] ?? '00'}:00`);

  m = /^(\d{4})[-./](\d{2})[-./](\d{2})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (m) return hoursSinceKst(`${m[1]}-${m[2]}-${m[3]} ${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}`);

  return undefined;
}

/** 같은 글이 두 번 나오면 하나만 남기고, 제목 없는 글은 버리고, 최대 개수만큼만 */
function finalize(posts: CommunityPost[], limit = PER_SITE_LIMIT): CommunityPost[] {
  const seen = new Set<string>();
  const out: CommunityPost[] = [];
  for (const p of posts) {
    if (!p.title || seen.has(p.url)) continue;
    seen.add(p.url);
    out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * 개수 제한 때문에 일부를 버려야 할 때, 썸네일 있는 글을 먼저 살려요 (그 안에서는 원래 순서 유지).
 * 제한에 안 걸리면 순서 그대로 돌려줘요.
 */
function capPreferThumbnails(posts: CommunityPost[], limit: number): CommunityPost[] {
  if (posts.length <= limit) return posts;
  const withThumb = posts.filter((p) => p.thumbnail);
  const withoutThumb = posts.filter((p) => !p.thumbnail);
  return [...withThumb, ...withoutThumb].slice(0, limit);
}

function siteLabel(site: string): string {
  return SITES.find((s) => s.site === site)?.label ?? site;
}

/**
 * <img> 에서 진짜 썸네일 주소만 골라 절대 URL 로 돌려줘요.
 * 지연 로딩(lazy) 이미지는 src 가 빈 gif 이고 진짜 주소가 data-original / data-src 에 있어요.
 * 사이트 아이콘·등급 배지·첨부파일 종류 아이콘 같은 건 제외해요.
 */
function thumbnailOf(img: HTMLElement | null | undefined, base: string): string | undefined {
  if (!img) return undefined;
  const raw = img.getAttribute('data-original') ?? img.getAttribute('data-src') ?? img.getAttribute('src');
  if (!raw) return undefined;
  if (/blank\.gif|transparent\.gif|\/ico_|icon_|list_icon|\/newimg\/|\/level\/|\.svg(\?|$)/i.test(raw)) return undefined;
  try {
    const url = new URL(raw, base);
    // "//host/..." 처럼 프로토콜이 빠진 주소는 https 로 맞춰요
    if (url.protocol === 'http:') url.protocol = 'https:';
    return url.toString();
  } catch {
    return undefined;
  }
}

/** 링크 안의 아이콘(<i>, <img>, <em>) 등을 뺀 순수 글 제목 텍스트 */
function textWithout(el: HTMLElement, selectorsToDrop: string[]): string {
  const clone = parse(el.outerHTML);
  for (const sel of selectorsToDrop) for (const junk of clone.querySelectorAll(sel)) junk.remove();
  return clone.text;
}

// ---------------------------------------------------------------------------
// 사이트별 파서 — 입력은 HTML 문자열, 출력은 글 목록. 네트워크를 쓰지 않아서 테스트하기 쉬워요.
// ---------------------------------------------------------------------------

/**
 * 인스티즈 HOT (https://www.instiz.net/hot.htm)
 * 실시간 차트 영역: div.realchart_item_a.sbj > a[href] > span.post_title + span.cmt(댓글)
 * 추천/조회/시각은 목록에 없어요.
 * 같은 페이지 아래쪽의 카드 영역(div.result_search)도 인기글이라 함께 읽어요:
 *   a[href] > div.thumb > img.lazy[data-original](썸네일), h3.search_title(제목), span.cmt2(댓글),
 *   span.minitext3 에 "시각 | 조회 N | 추천 N"
 * 차트 글을 먼저, 카드 글을 뒤에 두고 주소가 같으면 하나만 남겨요. 30개 제한에 걸리면 썸네일 있는 글을 우선 살려요.
 */
export function parseInstiz(html: string): CommunityPost[] {
  const root = parse(html);
  const base = 'https://www.instiz.net/';
  const posts: CommunityPost[] = [];

  for (const box of root.querySelectorAll('.realchart_item_a.sbj')) {
    const a = box.querySelector('a[href]');
    const titleEl = box.querySelector('.post_title');
    if (!a || !titleEl) continue;
    const href = a.getAttribute('href') ?? '';
    const url = new URL(href, base).toString();
    const postId = url.split('/').pop() ?? '';
    if (!/^\d+$/.test(postId)) continue;
    posts.push({
      site: 'instiz',
      siteLabel: siteLabel('instiz'),
      id: `instiz-${postId}`,
      title: cleanTitle(textWithout(titleEl, ['i', 'img'])),
      url,
      comments: toNumber(box.querySelector('.cmt')?.text),
    });
  }

  // 카드 영역은 <a> 안에 <div> 가 들어 있는 구조라 node-html-parser 가 트리를 평평하게 만들어 버려요.
  // 그래서 카드 시작 태그로 문자열을 잘라 카드 하나씩 따로 파싱해요 (각 카드 정보는 </article> 앞에 다 있어요).
  const CARD_START = '<div class="result_search">';
  for (const chunk of html.split(CARD_START).slice(1)) {
    const end = chunk.indexOf('</article>');
    const card = parse(end >= 0 ? chunk.slice(0, end) : chunk);
    const a = card.querySelector('a[href]');
    const titleEl = card.querySelector('.search_title');
    if (!a || !titleEl) continue;
    const url = new URL(a.getAttribute('href') ?? '', base).toString();
    const postId = url.split('/').pop() ?? '';
    if (!/^\d+$/.test(postId)) continue;
    // minitext3 는 "0:15" 또는 "2026/11/07", "조회 9211", "추천 1" 순서로 와요
    const metas = card.querySelectorAll('.minitext3').map((el) => el.text.trim());
    const views = metas.find((t) => t.startsWith('조회'));
    const recommends = metas.find((t) => t.startsWith('추천'));
    const when = metas.find((t) => /^\d{1,2}:\d{2}$|^\d{4}\/\d{2}\/\d{2}$/.test(t));
    posts.push({
      site: 'instiz',
      siteLabel: siteLabel('instiz'),
      id: `instiz-${postId}`,
      title: cleanTitle(titleEl.text),
      url,
      recommends: toNumber(recommends),
      comments: toNumber(card.querySelector('.cmt2')?.text),
      views: toNumber(views),
      hoursAgo: hoursFromListTime(when),
      thumbnail: thumbnailOf(card.querySelector('.thumb img'), base),
    });
  }

  // 중복 제거는 제한 없이 먼저 하고, 30개 제한은 썸네일 우선으로 적용해요
  return capPreferThumbnails(finalize(posts, Number.POSITIVE_INFINITY), PER_SITE_LIMIT);
}

/**
 * 오르비 HOT (https://orbi.kr/list/hot)
 * ul.post-list > li[data-post-id] > .list-text > p.title > a[href="/000NNNN/slug?type=hot"]
 * p.title 안의 abbr[title=숫자] 가 "안테나"(추천) 수, p.date abbr[title="@YYYY-MM-DD HH:mm:ss"] 가 작성 시각.
 * 댓글 수는 목록에 없어요.
 */
export function parseOrbi(html: string): CommunityPost[] {
  const root = parse(html);
  const posts: CommunityPost[] = [];
  for (const li of root.querySelectorAll('ul.post-list > li[data-post-id]')) {
    if (li.classList.contains('notice')) continue;
    const postId = li.getAttribute('data-post-id') ?? '';
    const a = li.querySelector('p.title a[href]');
    if (!postId || !a) continue;
    const recommendAttr = li.querySelector('p.title abbr')?.getAttribute('title');
    const dateAttr = li.querySelector('p.date abbr')?.getAttribute('title')?.replace(/^@/, '');
    posts.push({
      site: 'orbi',
      siteLabel: siteLabel('orbi'),
      id: `orbi-${postId}`,
      title: cleanTitle(textWithout(a, ['span', 'i'])),
      // 글 번호는 11자리로 0을 채운 형태예요 (/00080038783). 슬러그·쿼리는 떼고 짧은 주소만 써요.
      url: `https://orbi.kr/${postId.padStart(11, '0')}`,
      recommends: toNumber(recommendAttr),
      hoursAgo: dateAttr ? hoursSinceKst(dateAttr) : undefined,
    });
  }
  return finalize(posts);
}

/**
 * 더쿠 HOT (https://theqoo.net/hot)
 * table > tr (공지는 tr.notice) > td.title > a[href="/hot/NNN"], a.replyNum(댓글), td.m_no(조회), td.time
 * 추천 수는 목록에 없어요.
 */
export function parseTheqoo(html: string): CommunityPost[] {
  const root = parse(html);
  const posts: CommunityPost[] = [];
  for (const tr of root.querySelectorAll('table tr')) {
    if (tr.classList.contains('notice') || tr.classList.contains('notice_expand')) continue;
    const a = tr.querySelector('td.title > a[href^="/hot/"]');
    if (!a) continue;
    const href = a.getAttribute('href') ?? '';
    const postId = /\/hot\/(\d+)/.exec(href)?.[1];
    if (!postId) continue;
    posts.push({
      site: 'theqoo',
      siteLabel: siteLabel('theqoo'),
      id: `theqoo-${postId}`,
      title: cleanTitle(a.text),
      url: `https://theqoo.net/hot/${postId}`,
      comments: toNumber(tr.querySelector('a.replyNum')?.text),
      views: toNumber(tr.querySelector('td.m_no')?.text),
      hoursAgo: hoursFromListTime(tr.querySelector('td.time')?.text),
    });
  }
  return finalize(posts);
}

/**
 * 디시인사이드 실시간 베스트 (https://gall.dcinside.com/board/lists/?id=dcbest)
 * tr.ub-content.us-post > td.gall_tit > a[href="/board/view/?id=dcbest&no=N..."], span.reply_num "[34]",
 * td.gall_count(조회), td.gall_recommend(추천), td.gall_date[title="YYYY-MM-DD HH:mm:ss"]
 * 썸네일은 제목 링크 안의 div.thumimg > img[src] (대부분의 글에 있어요).
 * 맨 위 설문 공지는 a[href="javascript:;"] 라서 자연스럽게 걸러져요. 제목 앞 <strong>[갤이름]</strong> 은 말머리라 빼요.
 */
export function parseDcbest(html: string): CommunityPost[] {
  const root = parse(html);
  const posts: CommunityPost[] = [];
  for (const tr of root.querySelectorAll('tr.ub-content.us-post')) {
    const titleCell = tr.querySelector('td.gall_tit');
    const a = titleCell?.querySelector('a[href*="/board/view/"]');
    if (!titleCell || !a) continue;
    const href = a.getAttribute('href') ?? '';
    const postId = /[?&]no=(\d+)/.exec(href)?.[1];
    if (!postId) continue;
    posts.push({
      site: 'dcbest',
      siteLabel: siteLabel('dcbest'),
      id: `dcbest-${postId}`,
      title: cleanTitle(textWithout(a, ['strong', 'em', 'img', 'div.thumimg'])),
      url: `https://gall.dcinside.com/board/view/?id=dcbest&no=${postId}`,
      recommends: toNumber(tr.querySelector('td.gall_recommend')?.text),
      comments: toNumber(tr.querySelector('span.reply_num')?.text),
      views: toNumber(tr.querySelector('td.gall_count')?.text),
      hoursAgo: hoursFromListTime(tr.querySelector('td.gall_date')?.getAttribute('title')),
      thumbnail: thumbnailOf(titleCell.querySelector('div.thumimg img'), 'https://gall.dcinside.com/'),
    });
  }
  return finalize(posts);
}

/**
 * 보배드림 베스트글 (https://www.bobaedream.co.kr/list?code=best)
 * tr[itemtype$="Article"] > td.pl14 > a.bsubject[href="/view?code=best&No=N..."], strong.totreply(댓글),
 * td.recomm(추천), td.count(조회), td.date("11/06" 또는 "HH:MM")
 * 목록에는 글 썸네일이 없고 첨부파일 종류 아이콘(newimg/jpg.gif 등)만 있어서 thumbnail 은 비워 둬요.
 */
export function parseBobaedream(html: string): CommunityPost[] {
  const root = parse(html);
  const posts: CommunityPost[] = [];
  for (const tr of root.querySelectorAll('tr[itemtype]')) {
    const a = tr.querySelector('a.bsubject[href]');
    if (!a) continue;
    const href = a.getAttribute('href') ?? '';
    const postId = /[?&]No=(\d+)/i.exec(href)?.[1];
    if (!postId) continue;
    posts.push({
      site: 'bobaedream',
      siteLabel: siteLabel('bobaedream'),
      id: `bobaedream-${postId}`,
      title: cleanTitle(a.getAttribute('title') ?? a.text),
      url: `https://www.bobaedream.co.kr/view?code=best&No=${postId}`,
      recommends: toNumber(tr.querySelector('td.recomm')?.text),
      comments: toNumber(tr.querySelector('strong.totreply')?.text),
      views: toNumber(tr.querySelector('td.count')?.text),
      hoursAgo: hoursFromListTime(tr.querySelector('td.date')?.text),
    });
  }
  return finalize(posts);
}

/**
 * 오늘의유머 베스트오브베스트 (https://www.todayhumor.co.kr/board/list.php?table=bestofbest)
 * tr.view > td.subject > a[href="/board/view.php?table=bestofbest&no=N..."], span.list_memo_count_span "[19]",
 * td.oknok(추천), td.hits(조회), td.date("26/11/06 12:16")
 * 목록에는 글 썸네일이 없고 "사진 있음" 아이콘(list_icon_photo.gif)만 있어서 thumbnail 은 비워 둬요.
 */
export function parseTodayhumor(html: string): CommunityPost[] {
  const root = parse(html);
  const posts: CommunityPost[] = [];
  for (const tr of root.querySelectorAll('tr.view')) {
    const a = tr.querySelector('td.subject > a[href]');
    if (!a) continue;
    const href = a.getAttribute('href') ?? '';
    const postId = /[?&]no=(\d+)/.exec(href)?.[1];
    if (!postId) continue;
    posts.push({
      site: 'todayhumor',
      siteLabel: siteLabel('todayhumor'),
      id: `todayhumor-${postId}`,
      title: cleanTitle(a.text),
      url: `https://www.todayhumor.co.kr/board/view.php?table=bestofbest&no=${postId}`,
      recommends: toNumber(tr.querySelector('td.oknok')?.text),
      comments: toNumber(tr.querySelector('.list_memo_count_span')?.text),
      views: toNumber(tr.querySelector('td.hits')?.text),
      hoursAgo: hoursFromListTime(tr.querySelector('td.date')?.text),
    });
  }
  return finalize(posts);
}

/**
 * 82cook 자유게시판 (https://www.82cook.com/entiz/enti.php?bn=15)
 * 베스트 게시판이 따로 없어서 최신 목록을 가져온 뒤 조회수 순으로 정렬해요 (추천 열이 없어요).
 * tr (공지는 tr.noticeList) > td.title > a[href="read.php?bn=15&num=N..."] + em(댓글),
 * td.regdate[title="YYYY-MM-DD HH:mm:ss"], 마지막 td.numbers(조회)
 */
export function parse82cook(html: string): CommunityPost[] {
  const root = parse(html);
  const posts: CommunityPost[] = [];
  for (const tr of root.querySelectorAll('table tbody tr')) {
    if (tr.classList.contains('noticeList')) continue;
    const titleCell = tr.querySelector('td.title');
    const a = titleCell?.querySelector('a[href]');
    if (!titleCell || !a) continue;
    const href = a.getAttribute('href') ?? '';
    const postId = /[?&]num=(\d+)/.exec(href)?.[1];
    if (!postId) continue;
    const numberCells = tr.querySelectorAll('td.numbers').filter((td) => !td.classList.contains('regdate'));
    posts.push({
      site: '82cook',
      siteLabel: siteLabel('82cook'),
      id: `82cook-${postId}`,
      title: cleanTitle(a.text),
      url: `https://www.82cook.com/entiz/read.php?bn=15&num=${postId}`,
      comments: toNumber(titleCell.querySelector('em')?.text),
      views: toNumber(numberCells.at(-1)?.text),
      hoursAgo: hoursFromListTime(tr.querySelector('td.regdate')?.getAttribute('title')),
    });
  }
  posts.sort((x, y) => (y.views ?? 0) - (x.views ?? 0));
  return finalize(posts);
}

// ---------------------------------------------------------------------------
// 네트워크
// ---------------------------------------------------------------------------

interface SiteSource {
  site: string;
  url: string;
  parse: (html: string) => CommunityPost[];
}

const SOURCES: readonly SiteSource[] = [
  { site: 'instiz', url: 'https://www.instiz.net/hot.htm', parse: parseInstiz },
  { site: 'orbi', url: 'https://orbi.kr/list/hot', parse: parseOrbi },
  { site: 'theqoo', url: 'https://theqoo.net/hot', parse: parseTheqoo },
  { site: 'dcbest', url: 'https://gall.dcinside.com/board/lists/?id=dcbest', parse: parseDcbest },
  { site: 'bobaedream', url: 'https://www.bobaedream.co.kr/list?code=best', parse: parseBobaedream },
  {
    site: 'todayhumor',
    url: 'https://www.todayhumor.co.kr/board/list.php?table=bestofbest',
    parse: parseTodayhumor,
  },
  { site: '82cook', url: 'https://www.82cook.com/entiz/enti.php?bn=15', parse: parse82cook },
];

/** 응답 헤더나 <meta charset> 에서 글자 인코딩을 알아내요. 옛날 게시판은 EUC-KR 인 경우가 있어요. */
function detectCharset(contentType: string | null, bytes: ArrayBuffer): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType ?? '')?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  // 메타 태그는 보통 앞부분에 있으니 처음 4KB 만 ASCII 로 훑어봐요
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 4096));
  const fromMeta = /charset=["']?([\w-]+)/i.exec(head)?.[1];
  return (fromMeta ?? 'utf-8').toLowerCase();
}

/** 접근 차단·봇 검사 페이지인지 (제목이 있는 진짜 목록이 아닌지) 간단히 판별해요 */
function looksBlocked(html: string): boolean {
  return /Just a moment|cf-chl-|challenge-form|접근이 차단|차단되었습니다|Access Denied/i.test(html.slice(0, 20_000));
}

async function fetchSite(source: SiteSource): Promise<CommunityPost[]> {
  const res = await fetch(source.url, {
    headers: {
      'User-Agent': USER_AGENT,
      // 보배드림은 Accept 값이 딱 "text/html,..." 이면 406 을 돌려줘요. 뒤에 */* 를 붙이면 정상 응답해요.
      Accept: 'text/html, */*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    console.warn(`  [${source.site}] 차단 또는 오류: HTTP ${res.status} — 우회하지 않고 건너뛰어요`);
    return [];
  }
  const bytes = await res.arrayBuffer();
  const charset = detectCharset(res.headers.get('content-type'), bytes);
  let html: string;
  try {
    html = new TextDecoder(charset).decode(bytes);
  } catch {
    // 모르는 인코딩 이름이면 UTF-8 로 시도해요
    html = new TextDecoder('utf-8').decode(bytes);
  }
  if (looksBlocked(html)) {
    console.warn(`  [${source.site}] 봇 검사 페이지로 보여서 건너뛰어요 (우회하지 않아요)`);
    return [];
  }
  const posts = source.parse(html);
  if (posts.length === 0) console.warn(`  [${source.site}] 목록에서 글을 하나도 못 읽었어요 (HTML 구조가 바뀌었을 수 있어요)`);
  return posts;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 모든 사이트의 인기글을 모아요 (사이트당 최대 30개).
 * 사이트 하나가 실패해도 경고만 남기고 나머지는 계속 모아요.
 */
export async function fetchCommunityPosts(): Promise<CommunityPost[]> {
  const all: CommunityPost[] = [];
  for (const [i, source] of SOURCES.entries()) {
    if (i > 0) await sleep(GAP_MS);
    try {
      const posts = await fetchSite(source);
      console.log(`  ${siteLabel(source.site)} ${posts.length}개`);
      all.push(...posts);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`  [${source.site}] 실패: ${reason}`);
    }
  }
  return all;
}
