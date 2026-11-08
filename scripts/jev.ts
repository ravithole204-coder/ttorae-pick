/**
 * Jev(TypeSafe)로 영상의 연령대·성별을 판단해요.
 * Jev는 글을 쓰지 않고 "객관식 답 + 확률"만 돌려주는 빠른 모델이라
 * 분류에는 딱 맞고 비용은 거의 안 들어요. (어필리에잇 프로젝트와 같은 키 사용)
 */
import { TypeSafeClient, choice, type ChoiceQuestion, type ChoiceResponse } from '@typesafe-ai/sdk';
import { AGE_GROUPS, type AgeGroup, type Gender } from '../src/types';

export interface VideoBrief {
  id: string;
  title: string;
  channel: string;
  category: string;
  description: string;
  tags?: string[];
}

export interface AudienceGuess {
  /** 확률이 높은 순. 첫 번째가 가장 유력한 연령대 */
  ages: AgeGroup[];
  ageProbabilities: Record<AgeGroup, number>;
  gender: Gender;
  genderProbabilities: Record<'male' | 'female' | 'both', number>;
}

/** 이 확률 이상이면 그 연령대 순위에도 올려요 (가장 유력한 연령대는 항상 포함) */
const AGE_THRESHOLD = 0.25;
/** 성별이 이 확률 이상 쏠릴 때만 남성/여성으로 표시 */
const GENDER_THRESHOLD = 0.6;
/** 한 번 요청에 보낼 영상 수 (영상당 질문 2개) */
const BATCH = 25;

const STATE =
  'A Korean YouTube video from the Korea (KR) trending chart. Estimate which Korean age group and gender watches it most, judging from the title, channel name, category, tags and description. Korean cultural context: 수능/급식/학교/아이돌 → teens; 자취/취업/면접/대학/연애 → 20s; 육아/내집마련/이직/결혼 → 30s; 자녀 입시/노후 준비/건강 → 40s; 트로트/은퇴/손주/건강 정보 → 50s and older.';

const AGE_CRITERIA: Record<AgeGroup, string> = {
  '10대': 'Teenagers (13-19): students, school life, exams, idols, games, memes, short comedy',
  '20대': 'Twenties: university, first job, dating, living alone, fashion, K-pop, travel, sports highlights',
  '30대': 'Thirties: career, marriage, parenting young kids, housing, finance, fitness, cooking',
  '40대': 'Forties: raising teens, education, health, mid-career, cars, golf, news and politics',
  '50대+': 'Fifties and older: retirement, health, trot music, grandchildren, nature, long-form news and talk',
};

const GENDER_CRITERIA = {
  male: 'Mostly men watch this (sports, cars, games, military, politics, tech)',
  female: 'Mostly women watch this (beauty, fashion, idols, dramas, parenting, cooking)',
  both: 'Men and women watch this about equally',
};

type AgeQuestion = ChoiceQuestion<typeof AGE_CRITERIA>;
type GenderQuestion = ChoiceQuestion<typeof GENDER_CRITERIA>;

function brief(v: VideoBrief): Record<string, string> {
  return {
    title: v.title,
    channel: v.channel,
    category: v.category,
    tags: (v.tags ?? []).slice(0, 8).join(', '),
    description: v.description.replace(/\s+/g, ' ').slice(0, 200),
  };
}

function fromAnswer(answer: ChoiceResponse<typeof AGE_CRITERIA>): Pick<AudienceGuess, 'ages' | 'ageProbabilities'> {
  const probs = answer.probabilities;
  const sorted = [...AGE_GROUPS].sort((a, b) => probs[b] - probs[a]);
  const ages = sorted.filter((age, i) => i === 0 || probs[age] >= AGE_THRESHOLD);
  return { ages, ageProbabilities: { ...probs } };
}

function genderFrom(answer: ChoiceResponse<typeof GENDER_CRITERIA>): Pick<AudienceGuess, 'gender' | 'genderProbabilities'> {
  const p = answer.probabilities;
  const gender: Gender = p.male >= GENDER_THRESHOLD ? 'male' : p.female >= GENDER_THRESHOLD ? 'female' : 'all';
  return { gender, genderProbabilities: { ...p } };
}

export async function guessAudience(videos: VideoBrief[]): Promise<Map<string, AudienceGuess>> {
  const client = new TypeSafeClient();
  const result = new Map<string, AudienceGuess>();

  for (let start = 0; start < videos.length; start += BATCH) {
    const chunk = videos.slice(start, start + BATCH);
    const questions: Record<string, AgeQuestion | GenderQuestion> = {};
    chunk.forEach((v, i) => {
      questions[`age_${i}`] = choice(
        { video: brief(v), question: 'Which age group watches this video the most?' },
        AGE_CRITERIA,
      );
      questions[`gender_${i}`] = choice(
        { video: brief(v), question: 'Which gender watches this video more?' },
        GENDER_CRITERIA,
      );
    });

    const res = await client.systemOne({ model: 'jev-latest', state: STATE, questions });

    chunk.forEach((v, i) => {
      const age = res.answers[`age_${i}`];
      const gender = res.answers[`gender_${i}`];
      if (age?.type !== 'choice' || gender?.type !== 'choice') return;
      result.set(v.id, {
        ...fromAnswer(age as ChoiceResponse<typeof AGE_CRITERIA>),
        ...genderFrom(gender as ChoiceResponse<typeof GENDER_CRITERIA>),
      });
    });
    console.log(`Jev 분류 ${Math.min(start + BATCH, videos.length)}/${videos.length}`);
  }

  return result;
}
