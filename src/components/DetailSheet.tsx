import { useState } from 'react';
import { ageLabel, type FeedItem } from '../types';
import { formatAgo, formatCount, formatDelta } from '../format';
import { BottomSheet } from './BottomSheet';
import { openExternal } from '../toss';

interface Props {
  item: FeedItem;
  onClose: () => void;
}

/** 왜 인기글로 뽑혔는지 — 나이대는 "누가 봤는지"가 아니라 "어느 커뮤니티인지" 기준이라는 걸 그대로 써요 */
function reasonText(item: FeedItem): string {
  if (item.kind === 'youtube') {
    const growth =
      item.viewsDelta !== undefined && item.viewsDelta > 0
        ? `최근 수집 간격 동안 전체 조회수가 ${formatDelta(item.viewsDelta)} 늘었어요.`
        : '유튜브 한국 인기 차트에 올라 있어요.';
    return `연령 구분 없는 전체 인기 순위예요. ${growth}`;
  }
  const age = item.age === 'all' ? '' : `${ageLabel(item.age)}가 많이 쓰는 `;
  const delta =
    item.viewsDelta !== undefined && item.viewsDelta > 0
      ? ` 최근 수집 간격 동안 조회수가 ${formatDelta(item.viewsDelta)} 늘었어요.`
      : item.recommendsDelta !== undefined && item.recommendsDelta > 0
        ? ` 최근 수집 간격 동안 추천이 ${formatDelta(item.recommendsDelta)} 늘었어요.`
        : '';
  const basis = item.basis ? ` ${item.basis}` : '';
  return `${age}${item.source}의 인기글이에요.${delta}${basis}`;
}

export function DetailSheet({ item, onClose }: Props) {
  const [notice, setNotice] = useState(false);
  const isYoutube = item.kind === 'youtube';

  const open = () => {
    if (item.url) void openExternal(item.url);
    else setNotice(true);
  };

  return (
    <BottomSheet onClose={onClose} label={item.title}>
      {item.thumbnail && item.kind === 'youtube' && <img className="sheet-thumb" src={item.thumbnail} alt="" />}
      <span className={`kind-badge ${item.kind}`}>{isYoutube ? '유튜브' : '커뮤니티'}</span>
      <h2>{item.title}</h2>
      <p className="sheet-meta">
        {[
          <b key="src">{item.source}</b>,
          item.recommends !== undefined ? `추천 ${formatCount(item.recommends)}` : null,
          item.views > 0 ? `조회 ${formatCount(item.views)}` : null,
          item.comments > 0 ? `댓글 ${formatCount(item.comments)}` : null,
          formatAgo(item.hoursAgo) || null,
        ]
          .filter((part) => part !== null)
          .map((part, i) => (
            <span key={i}>
              {i > 0 && ' · '}
              {part}
            </span>
          ))}
      </p>

      {item.summary && (
        <section className="box">
          <h3>한 줄 요약</h3>
          <p>{item.summary}</p>
        </section>
      )}

      <section className="box reason">
        <h3>{item.age === 'all' ? '왜 인기글인가요?' : `왜 ${ageLabel(item.age)} 인기글인가요?`}</h3>
        <p>{reasonText(item)}</p>
      </section>

      <button type="button" className="cta" onClick={open}>
        {isYoutube ? '유튜브에서 보기' : '원문 보러가기'}
      </button>
      {notice && <p className="hint">화면 시안이라 아직 원문으로 연결되지 않아요</p>}
    </BottomSheet>
  );
}
