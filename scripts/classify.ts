/**
 * 영상 소개 = Claude 한 줄 요약·이모지 (선택).
 * 연령대 분류는 하지 않아요 — 영상별 시청자 나이는 유튜브가 공개하지 않아서, 추정으로 나누면 근거가 없기 때문이에요.
 * 한 번 요약한 영상은 data/classifications.json 에 저장해서 다시 돈 들이지 않아요.
 * Claude 키가 없으면 유튜브 설명 첫 줄과 카테고리 이모지로 대신해요.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { categoryName, type YoutubeVideo } from './youtube';

export const ClassificationSchema = z.object({
  id: z.string(),
  summary: z.string(),
  emoji: z.string(),
});

export type Classification = z.infer<typeof ClassificationSchema>;
export type ClassificationMap = Record<string, Classification>;

// ---------- Claude: 한 줄 요약 + 이모지 ----------

const SummarySchema = z.object({
  results: z.array(z.object({ id: z.string(), summary: z.string(), emoji: z.string() })),
});

const SUMMARY_PROMPT = `당신은 한국 유튜브 영상 소개 문구를 쓰는 에디터입니다. 영상 목록을 받으면 각 영상에 대해:
- summary: 영상 내용을 한국어 한 문장(40자 안팎)으로 요약. "~해요" 체로 끝내세요. 제목과 설명에 없는 내용을 지어내지 마세요.
- emoji: 영상 내용을 대표하는 이모지 1개.
받은 id 그대로, 빠짐없이 돌려주세요.`;

function describe(v: YoutubeVideo): string {
  return [
    `id: ${v.id}`,
    `제목: ${v.snippet.title}`,
    `채널: ${v.snippet.channelTitle}`,
    `카테고리: ${categoryName(v.snippet.categoryId)}`,
    `설명: ${v.snippet.description.replace(/\s+/g, ' ').slice(0, 200)}`,
  ].join('\n');
}

async function summarizeWithClaude(videos: YoutubeVideo[]): Promise<Map<string, { summary: string; emoji: string }>> {
  const client = new Anthropic();
  const out = new Map<string, { summary: string; emoji: string }>();
  const CHUNK = 25;

  for (let i = 0; i < videos.length; i += CHUNK) {
    const chunk = videos.slice(i, i + CHUNK);
    const response = await client.messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      system: SUMMARY_PROMPT,
      output_config: { effort: 'low', format: zodOutputFormat(SummarySchema) },
      messages: [{ role: 'user', content: `다음 ${chunk.length}개 영상을 요약해 주세요.\n\n${chunk.map(describe).join('\n\n')}` }],
    });
    if (response.stop_reason === 'refusal') {
      throw new Error(`AI가 요약을 거부했어요: ${response.stop_details?.explanation ?? ''}`);
    }
    const parsed = response.parsed_output;
    if (!parsed) throw new Error('AI 응답을 읽을 수 없어요');
    for (const r of parsed.results) out.set(r.id, { summary: r.summary, emoji: r.emoji });
    console.log(`Claude 요약 ${Math.min(i + CHUNK, videos.length)}/${videos.length}`);
  }
  return out;
}

// ---------- Claude 없을 때 대체 ----------

const CATEGORY_EMOJI: Record<string, string> = {
  '1': '🎬', '2': '🚗', '10': '🎵', '15': '🐾', '17': '⚽', '19': '✈️', '20': '🎮',
  '22': '📹', '23': '😂', '24': '📺', '25': '📰', '26': '💡', '27': '📚', '28': '🔬', '29': '🤝',
};

function fallbackSummary(v: YoutubeVideo): { summary: string; emoji: string } {
  const firstLine = v.snippet.description
    .split('\n')
    .map((l) => l.trim())
    .find(
      (l) =>
        l.length >= 8 &&
        !/^https?:\/\//.test(l) &&
        !l.startsWith('#') &&
        !/^Provided to YouTube/i.test(l) && // 자동 생성 음악 영상의 상투 문구
        /[가-힣]/.test(l),
    );
  return {
    summary: firstLine ? firstLine.slice(0, 80) : `${v.snippet.channelTitle} 채널의 ${categoryName(v.snippet.categoryId)} 영상이에요.`,
    emoji: CATEGORY_EMOJI[v.snippet.categoryId] ?? '🎞️',
  };
}

// ---------- 합치기 ----------

/**
 * 아직 요약되지 않은 영상만 골라 Claude(있을 때)에 묻고, 결과를 기존 지도에 합쳐 돌려줘요.
 */
export async function classifyVideos(videos: YoutubeVideo[], cached: ClassificationMap): Promise<ClassificationMap> {
  const pending = videos.filter((v) => !cached[v.id]);
  if (pending.length === 0) return cached;

  const hasClaude = Boolean(process.env.ANTHROPIC_API_KEY);
  if (!hasClaude) console.log('ANTHROPIC_API_KEY 가 없어서 요약은 유튜브 설명 첫 줄로 대신해요.');
  const summaries = hasClaude ? await summarizeWithClaude(pending) : new Map<string, { summary: string; emoji: string }>();

  const result: ClassificationMap = { ...cached };
  for (const v of pending) {
    const s = summaries.get(v.id) ?? fallbackSummary(v);
    result[v.id] = { id: v.id, summary: s.summary, emoji: s.emoji };
  }
  return result;
}
