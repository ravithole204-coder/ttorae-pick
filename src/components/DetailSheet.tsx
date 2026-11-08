import { useState } from 'react';
import { ageLabel, type FeedItem } from '../types';
import { formatAgo, formatCount, formatDelta } from '../format';
import { BottomSheet } from './BottomSheet';

interface Props {
  item: FeedItem;
  onClose: () => void;
}

/** 왜 이 연령대 인기글로 뽑혔는지 설명 (실제 서비스에서는 수집 근거를 그대로 보여줄 예정) */
function reasonText(item: FeedItem): string {
  const age = ageLabel(item.age);
  if (item.kind === 'youtube') {
    const growth =
      item.viewsDelta !== undefined && item.viewsDelta > 0
        ? `최근 수집 간격 동안 조회수가 ${formatDelta(item.viewsDelta)} 늘었어요.`
        : '최근 조회수가 빠르게 늘고 있어요.';
    return `영상 내용과 채널 성격으로 볼 때 ${age} 시청자가 많이 볼 영상이에요. ${growth}`;
  }
  const delta =
    item.viewsDelta !== undefined && item.viewsDelta > 0
      ? ` 최근 수집 간격 동안 조회수가 ${formatDelta(item.viewsDelta)} 늘었어요.`
      : item.recommendsDelta !== undefined && item.recommendsDelta > 0
        ? ` 최근 수집 간격 동안 추천이 ${formatDelta(item.recommendsDelta)} 늘었어요.`
        : '';
  return `${age} 이용자가 많은 ${item.source}에서 추천·댓글 반응이 높은 글이에요.${delta}`;
}

export function DetailSheet({ item, onClose }: Props) {
  const [notice, setNotice] = useState(false);
  const isYoutube = item.kind === 'youtube';

  const open = () => {
    if (item.url) window.open(item.url, '_blank', 'noopener');
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
        <h3>왜 {ageLabel(item.age)} 인기글인가요?</h3>
        <p>{reasonText(item)}</p>
      </section>

      <button type="button" className="cta" onClick={open}>
        {isYoutube ? '유튜브에서 보기' : '원문 보러가기'}
      </button>
      {notice && <p className="hint">화면 시안이라 아직 원문으로 연결되지 않아요</p>}
    </BottomSheet>
  );
}
