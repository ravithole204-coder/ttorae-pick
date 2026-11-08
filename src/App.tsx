import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AGE_GROUPS,
  ageLabel,
  ageSubject,
  isAgeGroup,
  type AgeGroup,
  type CommunitySort,
  type FeedFile,
  type FeedItem,
  type FeedKind,
  type GenderFilter,
} from './types';
import { MOCK_FEED } from './data/mockFeed';
import { videoFormat, type VideoFormat } from './format';
import { FeedCard } from './components/FeedCard';
import { DetailSheet } from './components/DetailSheet';
import { Player } from './components/Player';
import { ExternalLink } from './components/ExternalLink';
import { inToss } from './toss';

const STORAGE_KEY = 'ttorae-pick:age';
/** 수집 결과 주소. 토스용 빌드는 GitHub Pages 주소를, 웹 배포는 같은 사이트의 파일을 읽어요 */
const FEED_URL: string = import.meta.env.VITE_FEED_URL ?? 'data/feed.json';
/** 토스 앱 안에서는 테마가 화이트로 고정이에요 (심사 기준: 라이트 모드만) */
const IN_TOSS = inToss();
const THEME_KEY = 'ttorae-pick:theme';
type Theme = 'light' | 'dark';

function loadTheme(): Theme {
  if (IN_TOSS) return 'light';
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}
/** 처음 방문했을 때 보여줄 연령대 (토스 로그인 연동 후에는 사용자 연령으로 대체) */
const DEFAULT_AGE: AgeGroup = '20대';
/** 카테고리로 거른 뒤 보여줄 최대 개수 */
const LIST_LIMIT = 20;

// 브라우저 저장소는 사생활 보호 모드 등에서 막힐 수 있어서 실패해도 앱이 멈추지 않게 감싸요.
function loadAge(): AgeGroup {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return isAgeGroup(saved) ? saved : DEFAULT_AGE;
  } catch {
    return DEFAULT_AGE;
  }
}

function saveAge(age: AgeGroup): void {
  try {
    localStorage.setItem(STORAGE_KEY, age);
  } catch {
    // 저장 실패해도 이번 방문에서는 정상 동작
  }
}

const TABS: { key: FeedKind; label: string }[] = [
  { key: 'youtube', label: '유튜브' },
  { key: 'community', label: '커뮤니티' },
];

const FORMATS: { key: VideoFormat; label: string }[] = [
  { key: 'video', label: '영상' },
  { key: 'shorts', label: '쇼츠' },
];

const SORTS: { key: CommunitySort; label: string }[] = [
  { key: 'popular', label: '인기순' },
  { key: 'views', label: '조회수순' },
  { key: 'recent', label: '최신순' },
];

/** 연령대가 올라갈수록 글자·버튼을 키워요 (노안 대비). 40대부터 눈에 띄게 커져요 */
const AGE_SCALE: Record<AgeGroup, number> = {
  '20대': 1,
  '30대': 1.04,
  '40대': 1.12,
  '50대+': 1.22,
};

const GENDERS: { key: GenderFilter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'male', label: '남성' },
  { key: 'female', label: '여성' },
];

/** 커뮤니티 정렬. 모르는 값(조회수 0, 시각 없음)은 뒤로 보내요 */
function sortCommunity(items: FeedItem[], sort: CommunitySort): FeedItem[] {
  if (sort === 'popular') return items;
  const sorted = [...items];
  if (sort === 'views') sorted.sort((a, b) => b.views - a.views);
  if (sort === 'recent') {
    const key = (it: FeedItem) => (it.hoursAgo < 0 ? Number.POSITIVE_INFINITY : it.hoursAgo);
    sorted.sort((a, b) => key(a) - key(b));
  }
  return sorted;
}

/** 수집 프로그램이 만든 feed.json. 없으면(아직 수집 전) 예시 데이터를 써요 */
function isFeedFile(value: unknown): value is FeedFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    'items' in value &&
    Array.isArray((value as { items: unknown }).items) &&
    'updatedAt' in value
  );
}

interface ChipProps<K extends string> {
  options: { key: K; label: string }[];
  value: K;
  onChange: (key: K) => void;
}

function Chips<K extends string>({ options, value, onChange }: ChipProps<K>) {
  return (
    <>
      {options.map((o) => (
        <button key={o.key} type="button" className="chip" aria-pressed={value === o.key} onClick={() => onChange(o.key)}>
          {o.label}
        </button>
      ))}
    </>
  );
}

export function App() {
  const [age, setAge] = useState<AgeGroup>(loadAge);
  const [tab, setTab] = useState<FeedKind>('youtube');
  const [gender, setGender] = useState<GenderFilter>('all');
  const [format, setFormat] = useState<VideoFormat>('video');
  const [category, setCategory] = useState<string>('전체');
  const [sort, setSort] = useState<CommunitySort>('popular');
  const [selected, setSelected] = useState<FeedItem | null>(null);
  const [playing, setPlaying] = useState<FeedItem | null>(null);
  const [feed, setFeed] = useState<FeedFile | null>(null);
  const [theme, setTheme] = useState<Theme>(loadTheme);

  // 테마는 <html data-theme> 속성으로 적용돼요 (CSS 변수가 바뀜)
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // 저장 실패해도 이번 방문에서는 정상 동작
    }
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    fetch(FEED_URL, { cache: 'no-cache' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: unknown) => {
        if (!cancelled && isFeedFile(json)) setFeed(json);
      })
      .catch(() => {
        // 파일이 없으면 예시 데이터 그대로
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 실제 데이터가 있는 종류(유튜브/커뮤니티)는 실제 데이터를, 없는 종류는 예시 데이터를 보여줘요
  const allItems = useMemo(() => {
    if (!feed) return MOCK_FEED;
    const realKinds = new Set(feed.items.map((it) => it.kind));
    return [...feed.items, ...MOCK_FEED.filter((it) => !realKinds.has(it.kind))];
  }, [feed]);

  const isLive = feed !== null && feed.items.some((it) => it.kind === tab);

  // 유튜브는 연령 구분이 없어요 (영상별 시청자 나이는 공개되지 않아요). 형식(영상/쇼츠)으로만 걸러요
  const videoPool = useMemo(
    () => allItems.filter((it) => it.kind === 'youtube' && videoFormat(it.duration) === format),
    [allItems, format],
  );

  // 카테고리 칩: 영상이 많은 순으로, 2개 이상인 카테고리만
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const it of videoPool) if (it.category) counts.set(it.category, (counts.get(it.category) ?? 0) + 1);
    const sorted = [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);
    return [{ key: '전체', label: '전체' }, ...sorted.map(([c]) => ({ key: c, label: c }))];
  }, [videoPool]);

  const activeCategory = categories.some((c) => c.key === category) ? category : '전체';

  const items = useMemo(() => {
    if (tab === 'youtube') {
      return videoPool.filter((it) => activeCategory === '전체' || it.category === activeCategory).slice(0, LIST_LIMIT);
    }
    const posts = allItems.filter(
      (it) => it.age === age && it.kind === 'community' && (gender === 'all' || it.gender === gender || it.gender === 'all'),
    );
    return sortCommunity(posts, sort);
  }, [tab, videoPool, activeCategory, allItems, age, gender, sort]);

  // 이 연령대 목록에 쓰인 커뮤니티들과, 왜 이 연령대로 묶었는지 (수집 데이터에만 있어요)
  const bases = useMemo(() => {
    if (tab !== 'community') return [];
    const seen = new Map<string, { source: string; basis: string; url?: string }>();
    for (const it of items) {
      if (it.basis && !seen.has(it.source)) seen.set(it.source, { source: it.source, basis: it.basis, url: it.basisUrl });
    }
    return [...seen.values()];
  }, [tab, items]);

  const chooseAge = (next: AgeGroup) => {
    setAge(next);
    saveAge(next);
  };

  const open = useCallback((item: FeedItem) => {
    if (item.kind === 'youtube' && item.videoId) setPlaying(item);
    else setSelected(item);
  }, []);

  // 플레이어·시트가 열리면 브라우저 기록을 한 칸 쌓아서, 안드로이드 뒤로가기(토스 앱 포함)로 닫히게 해요.
  // 첫 화면에서 뒤로가기를 누르면 기록이 없으니 토스 미니앱이 그대로 종료돼요 (심사 기준).
  const overlayOpen = playing !== null || selected !== null;
  useEffect(() => {
    if (!overlayOpen) return;
    window.history.pushState({ overlay: true }, '');
    const onPop = () => {
      setPlaying(null);
      setSelected(null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [overlayOpen]);

  // 닫기 버튼은 기록을 되돌리는 방식으로 닫아요 (뒤로가기와 같은 길)
  const closeOverlay = useCallback(() => {
    if (window.history.state && typeof window.history.state === 'object' && 'overlay' in window.history.state) {
      window.history.back();
    } else {
      setPlaying(null);
      setSelected(null);
    }
  }, []);
  const closeDetail = closeOverlay;
  const closePlayer = closeOverlay;

  return (
    // 연령별 글자 키우기는 연령을 고르는 커뮤니티 탭에서만 — 유튜브 탭엔 연령 탭이 없어서 큰 글자를 되돌릴 방법이 없었어요
    <div className="app" style={{ zoom: tab === 'community' ? AGE_SCALE[age] : 1 }}>
      <header className="top">
        <span className="brand">매일매일</span>
        {!IN_TOSS && (
          <button
            type="button"
            className="theme-btn"
            aria-label={theme === 'dark' ? '화이트 모드로 전환' : '다크 모드로 전환'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        )}
      </header>

      <section className="hero">
        {tab === 'youtube' ? (
          <h1>
            지금 한국에서
            <br />
            많이 보는 영상
          </h1>
        ) : (
          <h1>
            <em>{ageSubject(age)}</em> 많이 쓰는
            <br />
            커뮤니티 인기글
          </h1>
        )}
      </section>

      <div className="sticky-nav">
        <nav className="tabs" role="tablist" aria-label="콘텐츠 종류">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" className="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </nav>

        {tab === 'community' && (
          <div className="age-tabs" role="tablist" aria-label="연령대">
            {AGE_GROUPS.map((a) => (
              <button key={a} type="button" role="tab" className="age-tab" aria-selected={age === a} onClick={() => chooseAge(a)}>
                {a}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="chips">
        {tab === 'youtube' ? (
          <Chips options={FORMATS} value={format} onChange={setFormat} />
        ) : (
          <>
            <Chips options={SORTS} value={sort} onChange={setSort} />
            <span className="chip-gap" aria-hidden="true" />
            <Chips options={GENDERS} value={gender} onChange={setGender} />
          </>
        )}
      </div>

      {tab === 'youtube' && categories.length > 1 && (
        <div className="chips categories">
          <Chips options={categories} value={activeCategory} onChange={setCategory} />
        </div>
      )}

      {items.length > 0 ? (
        <ol className="list">
          {items.map((it, i) => (
            <FeedCard key={it.id} item={it} rank={i + 1} intervalHours={feed?.intervalHours ?? null} onOpen={open} />
          ))}
        </ol>
      ) : (
        <p className="empty">아직 모인 글이 없어요</p>
      )}

      {bases.length > 0 && (
        <details className="basis">
          <summary>왜 {ageLabel(age)} 커뮤니티인가요?</summary>
          <ul>
            {bases.map((b) => (
              <li key={b.source}>
                <b>{b.source}</b> · {b.basis}
                {b.url && (
                  <>
                    {' '}
                    <ExternalLink href={b.url}>출처</ExternalLink>
                  </>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="note">
        {!isLive
          ? '지금 보이는 글은 화면 확인용 예시 데이터예요.'
          : tab === 'youtube'
            ? '유튜브 공식 인기 차트(한국) 기준이에요. 영상별 시청자 나이는 공개되지 않아서 연령 구분 없이 보여줘요. 증가량은 이전 수집과 비교한 전체 조회수예요.'
            : '연령대는 글이 아니라 "그 커뮤니티를 주로 쓰는 사람" 기준이에요. 글을 누가 봤는지는 측정하지 않아요. 증가량은 이전 수집과 비교한 전체 조회수예요.'}
      </p>

      {selected && <DetailSheet item={selected} onClose={closeDetail} />}
      {playing && <Player item={playing} onClose={closePlayer} />}
    </div>
  );
}
