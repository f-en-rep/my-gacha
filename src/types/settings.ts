import type { Id } from './world';

/** 텍스트 생성 서비스 */
export type TextProviderKind = 'openrouter' | 'openai' | 'anthropic' | 'gemini' | 'vertex' | 'nanogpt' | 'openai-compatible';

/** 그림 생성 서비스 */
export type ImageProviderKind = 'novelai' | 'pixai';

interface ProfileBase {
  id: Id;
  /** 사용자가 붙인 이름 */
  label: string;
  /** API 키. 브라우저 밖(월드 팩, 백업)으로 절대 내보내지 않는다 */
  apiKey: string;
  /** 비우면 서비스 기본 주소 */
  baseUrl?: string;
  /** CORS로 막힌 서비스면 같은 사이트의 /api/relay 를 거친다 */
  useRelay: boolean;
}

export interface VertexOptions {
  /** apiKey: Vertex AI API 키 (express mode) / serviceAccount: 서비스 계정 JSON 키 파일. 둘 다 apiKey 칸에 저장 */
  auth: 'apiKey' | 'serviceAccount';
  /** 서비스 계정 방식에서 필수. 비우면 JSON의 project_id */
  projectId?: string;
  /** 예: global, us-central1. 비우면 global */
  location?: string;
}

export interface TextProfile extends ProfileBase {
  type: 'text';
  provider: TextProviderKind;
  model: string;
  maxTokens?: number;
  temperature?: number;
  /** provider가 'vertex'일 때만 */
  vertex?: VertexOptions;
}

/** 그림 생성 설정. 비운 값은 서비스 기본값 */
export interface ImageGenSettings {
  /** 메인 프롬프트: 모든 그림 앞에 붙는 태그 (품질·화풍) */
  positive?: string;
  /** 네거티브 프롬프트. 비우면 앱 기본 네거티브 */
  negative?: string;
  /** 이하 NovelAI 전용 */
  steps?: number;
  /** 프롬프트 가이던스 (scale) */
  scale?: number;
  sampler?: string;
  noiseSchedule?: string;
  /** 프롬프트 가이던스 리스케일 (cfg_rescale) */
  cfgRescale?: number;
  /** Variety+ */
  varietyBoost?: boolean;
  /** 고정 시드. 비우면 매번 랜덤 */
  seed?: number;
}

export interface ImageProfile extends ProfileBase {
  type: 'image';
  provider: ImageProviderKind;
  /** 서비스별 모델 이름 (NovelAI: nai-diffusion-4-5-full 등, PixAI: 모델 id) */
  model: string;
  /** 그림 요청 사이 최소 간격 (밀리초). NovelAI 밴 방지. 기본 10000 */
  minIntervalMs: number;
  width: number;
  height: number;
  gen?: ImageGenSettings;
  /** 서비스별 추가 옵션 (요청 parameters에 그대로 덮어씀) */
  extra?: Record<string, unknown>;
}

export type ConnectionProfile = TextProfile | ImageProfile;

/** 작업 종류별로 쓸 연결 */
export interface JobRouting {
  /** JSON이 필요한 구조화 작업 (캐릭터 시트, 계획) */
  structured?: Id;
  /** 문장 작업 (스토리 대사). 비우면 structured를 씀 */
  prose?: Id;
  image?: Id;
}

export interface AppSettings {
  id: 'app';
  routing: JobRouting;
  /** 3★·4★ 초상화를 자동으로 그릴지. false면 "그리기" 버튼으로만 */
  autoPaintLowRarity: boolean;
  /** 마지막 백업 내보내기 시각 */
  lastBackupAt?: string;
  /** 지금 플레이 중인 월드와 세이브 */
  activeWorldId?: Id;
  activeSaveId?: Id;
  /** 사용자가 고친 글 프롬프트: 프롬프트 id → 칸 key → 글. 없는 칸은 기본 글. 백업·월드 팩에 넣지 않는다 */
  prompts?: Record<string, Record<string, string>>;
}
