import { useEffect } from 'react';
import type { FeedItem } from '../types';
import { formatCount } from '../format';
import { ExternalLink } from './ExternalLink';

interface Props {
  item: FeedItem;
  onClose: () => void;
}

/**
 * 앱 안에서 유튜브 영상을 바로 재생하는 화면.
 * 유튜브가 공식으로 제공하는 끼워넣기(embed) 플레이어를 써요.
 */
export function Player({ item, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  if (!item.videoId) return null;
  const src = `https://www.youtube.com/embed/${item.videoId}?autoplay=1&playsinline=1&rel=0`;

  return (
    <div className="player" role="dialog" aria-modal="true" aria-label={item.title}>
      <div className="player-top">
        <button type="button" className="back" onClick={onClose}>
          ← 이전 화면
        </button>
      </div>

      <div className="player-frame">
        <iframe
          src={src}
          title={item.title}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>

      <div className="player-info">
        <h2>{item.title}</h2>
        <p className="player-channel">{item.source}</p>
        <div className="stat-chips">
          <span className="stat">👁 조회수 {item.views.toLocaleString('ko-KR')}회</span>
          {item.likes !== undefined && item.likes > 0 && <span className="stat">👍 좋아요 {formatCount(item.likes)}</span>}
          {item.comments > 0 && <span className="stat">💬 댓글 {formatCount(item.comments)}</span>}
          {item.url && (
            <ExternalLink className="stat link" href={item.url}>
              ▶ YouTube에서 보기
            </ExternalLink>
          )}
        </div>
        {item.summary && <p className="player-summary">{item.summary}</p>}
      </div>
    </div>
  );
}
