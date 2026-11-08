/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 수집 결과(feed.json)를 가져올 주소. 토스용 빌드에서는 GitHub Pages 주소를 넣어요. 없으면 같은 사이트의 data/feed.json */
  readonly VITE_FEED_URL?: string;
}
