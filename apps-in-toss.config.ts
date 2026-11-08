import { defineConfig } from '@apps-in-toss/web-framework/config';

/**
 * 앱인토스 설정. appName 은 콘솔에 등록한 값과 글자 하나까지 같아야 해요 (등록 뒤에는 바꿀 수 없어요).
 * `npm run build:toss` 를 실행하면 dist/ 를 묶어 콘솔에 올릴 .ait 파일을 만들어요.
 */
export default defineConfig({
  appName: 'mailmail2',
  webView: {
    // 유튜브 플레이어가 iOS에서 전체화면으로 튀지 않고 화면 안에서 재생되도록
    allowsInlineMediaPlayback: true,
    // 당겨서 새로고침은 쓰지 않아요 (목록이 3시간마다 갱신되는 서비스라 불필요)
    pullToRefreshEnabled: false,
  },
  permissions: [],
  webBundleDir: 'dist',
});
