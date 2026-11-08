/**
 * 토스 앱(앱인토스) 안에서 열렸는지 판단하고, 그에 맞게 외부 링크를 열어요.
 *
 * 토스 심사 기준: 미니앱 안에서 다른 사이트로 화면을 옮기면 안 되고,
 * 꼭 필요한 외부 링크는 SDK의 Device.openURL 로 기기 브라우저에서 열어야 해요.
 * 일반 브라우저(웹 배포)에서는 평소처럼 새 탭으로 열어요.
 */
import { Device } from '@apps-in-toss/web-framework';

interface BridgeWindow {
  ReactNativeWebView?: unknown;
}

/** 토스 앱 웹뷰 안이면 true. SDK도 같은 방법(window.ReactNativeWebView 유무)으로 판단해요 */
export function inToss(): boolean {
  if (typeof window === 'undefined') return false;
  return (window as unknown as BridgeWindow).ReactNativeWebView != null;
}

/** 외부 링크 열기: 토스 안에서는 기기 브라우저로, 밖에서는 새 탭으로 */
export async function openExternal(url: string): Promise<void> {
  if (inToss()) {
    try {
      await Device.openURL(url);
      return;
    } catch {
      // 브리지가 실패하면 아래 일반 방식으로 한 번 더 시도해요
    }
  }
  window.open(url, '_blank', 'noopener');
}
