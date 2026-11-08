import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { inToss, openExternal } from '../toss';

type Props = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

/**
 * 바깥 사이트로 가는 링크. 브라우저에서는 보통 링크(새 탭)로 동작하고,
 * 토스 앱 안에서는 심사 규칙대로 SDK를 통해 기기 브라우저로 열어요.
 */
export function ExternalLink({ href, onClick, children, ...rest }: Props) {
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || !inToss()) return;
    e.preventDefault();
    void openExternal(href);
  };
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}
