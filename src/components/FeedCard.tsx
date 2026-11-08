import { useState } from 'react';
import type { FeedItem, RankDelta } from '../types';
import { formatAgo, formatCount, formatDelta, isShorts, thumbColor } from '../format';

interface Props {
  item: FeedItem;
  rank: number;
  /** 조회수 변화를 잰 간격(시간). 없으면 "최근" */
  intervalHours: number | null;
  onOpen: (item: FeedItem) => void;
}

/** "▲ 6 계단 상승" 배지 */
function RankBadge({ value }: { value: RankDelta }) {
  if (value === 'new') return <span className="badge new">NEW</span>;
  if (value > 0) return <span className="badge up">▲ {value} 계단 상승</span>;
  if (value < 0) return <span className="badge down">▼ {Math.abs(value)} 계단 하락</span>;
  return <span className="badge same">유지</span>;
}

/** 조회·추천·댓글 중 변화가 있는 것 하나를 골라 "+1.2만 조회" 형태로 */
function growthText(item: FeedItem): { label: string; value: number } | null {
  if (item.viewsDelta !== undefined && item.viewsDelta > 0) return { label: '조회', value: item.viewsDelta };
  if (item.recommendsDelta !== undefined && item.recommendsDelta > 0) return { label: '추천', value: item.recommendsDelta };
  if (item.commentsDelta !== undefined && item.commentsDelta > 0) return { label: '댓글', value: item.commentsDelta };
  return null;
}

export function FeedCard({ item, rank, intervalHours, onOpen }: Props) {
  const [failed, setFailed] = useState(false);
  const growth = growthText(item);
  const interval = intervalHours ? `${Math.round(intervalHours)}시간` : '최근';

  const counts = [
    item.recommends !== undefined ? `추천 ${formatCount(item.recommends)}` : null,
    item.views > 0 ? `조회 ${formatCount(item.views)}` : null,
    item.recommends === undefined && item.views === 0 && item.comments > 0 ? `댓글 ${formatCount(item.comments)}` : null,
    formatAgo(item.hoursAgo) || null,
  ].filter((part): part is string => part !== null);

  return (
    <li>
      <button type="button" className="card" onClick={() => onOpen(item)}>
        <div className="rank">{rank}</div>

        <div className={`thumb ${item.kind}`} style={{ background: thumbColor(item.id) }} aria-hidden="true">
          {item.thumbnail && !failed ? (
            // 일부 커뮤니티 CDN은 다른 사이트에서 불러오면 막아요 → 출처를 안 보내고, 그래도 실패하면 로고로
            <img src={item.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
          ) : item.logo ? (
            <img className="logo" src={item.logo} alt="" loading="lazy" />
          ) : (
            item.emoji
          )}
          {item.duration && (
            <span className={`dur${isShorts(item.duration) ? ' shorts' : ''}`}>
              {isShorts(item.duration) ? '쇼츠' : item.duration}
            </span>
          )}
        </div>

        <div className="body">
          <p className="title">{item.title}</p>
          <p className="meta">
            <span className="src">{item.source}</span>
            {counts.map((c) => (
              <span key={c}> · {c}</span>
            ))}
          </p>
          <div className="growth-row">
            {growth ? (
              <span className="growth-line">
                {interval} {growth.label} 증가 <b className="growth">{formatDelta(growth.value)}</b>
              </span>
            ) : (
              <span className="growth-line muted">변화 측정 중</span>
            )}
            <RankBadge value={item.rankDelta} />
          </div>
        </div>
      </button>
    </li>
  );
}
