import { useState } from 'react';
import type { AgeGroup } from '../types';
import { AgePicker } from './AgePicker';

interface Props {
  onDone: (age: AgeGroup) => void;
}

export function Onboarding({ onDone }: Props) {
  const [age, setAge] = useState<AgeGroup | null>(null);

  return (
    <main className="onboard">
      <p className="onboard-eyebrow">오늘의 이슈</p>
      <h1>
        내 또래는 요즘
        <br />
        뭘 보고 있을까요?
      </h1>
      <p className="onboard-desc">연령대를 고르면 또래가 많이 본 유튜브와 커뮤니티 인기글을 모아드려요.</p>
      <AgePicker value={age} onChange={setAge} />
      <div className="spacer" />
      <button type="button" className="cta" disabled={!age} onClick={() => age && onDone(age)}>
        시작하기
      </button>
      <p className="hint">토스 앱에서는 로그인 정보로 자동 설정될 예정이에요</p>
    </main>
  );
}
