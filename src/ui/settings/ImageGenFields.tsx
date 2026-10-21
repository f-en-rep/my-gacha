// 그림 연결의 프롬프트·생성 설정. 비운 칸은 서비스 기본값을 쓴다.
import { DEFAULT_NEGATIVE_TAGS } from '../../game/portraits';
import type { ImageGenSettings, ImageProfile } from '../../types';
import { Field, NumberInput, Toggle } from './fields';

const NAI_SAMPLERS = [
  { value: 'k_euler_ancestral', label: 'Euler Ancestral (기본)' },
  { value: 'k_euler', label: 'Euler' },
  { value: 'k_dpmpp_2s_ancestral', label: 'DPM++ 2S Ancestral' },
  { value: 'k_dpmpp_2m_sde', label: 'DPM++ 2M SDE' },
  { value: 'k_dpmpp_2m', label: 'DPM++ 2M' },
  { value: 'k_dpmpp_sde', label: 'DPM++ SDE' },
];

const NAI_NOISE = [
  { value: 'karras', label: 'karras (기본)' },
  { value: 'exponential', label: 'exponential' },
  { value: 'polyexponential', label: 'polyexponential' },
];

export function ImageGenFields({ p, set }: { p: ImageProfile; set: (patch: Partial<ImageProfile>) => void }) {
  const gen = p.gen ?? {};
  const isNai = p.provider === 'novelai';
  const put = (patch: Partial<ImageGenSettings>) => set({ gen: { ...gen, ...patch } });
  const text = (v: string) => (v.trim() ? v : undefined);

  return (
    <>
      <div className="field field-wide gen-head">
        <span className="label">프롬프트</span>
        <p className="field-hint">
          그림마다 이 순서로 붙습니다: <b>메인 프롬프트</b> → 월드 화풍 → 초상화 구도. 캐릭터 태그는
          {isNai ? ' NovelAI V4 이상에서는 캐릭터마다 별도 슬롯' : ' 그 뒤'}에 들어가고, 캐릭터 화면에서 고칠 수 있습니다.
        </p>
      </div>
      <Field wide label="메인 프롬프트" hint="모든 그림 앞에 붙는 품질·화풍 태그 (영어, 쉼표로 구분)">
        {(id) => (
          <textarea
            id={id}
            rows={3}
            value={gen.positive ?? ''}
            onChange={(e) => put({ positive: text(e.target.value) })}
            placeholder="예: masterpiece, best quality, very aesthetic, absurdres"
            spellCheck={false}
          />
        )}
      </Field>
      <Field wide label="네거티브 프롬프트" hint="비우면 앱 기본 네거티브를 씁니다. 월드 네거티브는 여기에 더해집니다.">
        {(id) => (
          <textarea
            id={id}
            rows={3}
            value={gen.negative ?? ''}
            onChange={(e) => put({ negative: text(e.target.value) })}
            placeholder={DEFAULT_NEGATIVE_TAGS}
            spellCheck={false}
          />
        )}
      </Field>
      <Field label="프롬프트 가이던스" hint={isNai ? 'scale. 보통 5 ~ 7 (기본 5)' : 'cfgScale. 비우면 PixAI 기본'}>
        {(id) => <NumberInput id={id} value={gen.scale} onChange={(v) => put({ scale: v })} min={0} max={10} step={0.1} placeholder={isNai ? '5' : '기본'} />}
      </Field>
      <Field label="스텝" hint={isNai ? '보통 23 ~ 28 (기본 28). 28을 넘으면 Opus도 Anlas를 씁니다' : 'samplingSteps. 비우면 PixAI 기본'}>
        {(id) => <NumberInput id={id} value={gen.steps} onChange={(v) => put({ steps: v === undefined ? undefined : Math.round(v) })} min={1} max={50} step={1} placeholder={isNai ? '28' : '기본'} />}
      </Field>
      {isNai && (
        <>
          <Field label="샘플러">
            {(id) => (
              <select id={id} value={gen.sampler ?? ''} onChange={(e) => put({ sampler: e.target.value || undefined })}>
                <option value="">기본 (Euler Ancestral)</option>
                {NAI_SAMPLERS.slice(1).map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="노이즈 스케줄">
            {(id) => (
              <select id={id} value={gen.noiseSchedule ?? ''} onChange={(e) => put({ noiseSchedule: e.target.value || undefined })}>
                <option value="">기본 (karras)</option>
                {NAI_NOISE.slice(1).map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="가이던스 리스케일" hint="cfg rescale. 0 ~ 1 (기본 0)">
            {(id) => <NumberInput id={id} value={gen.cfgRescale} onChange={(v) => put({ cfgRescale: v })} min={0} max={1} step={0.02} placeholder="0" />}
          </Field>
        </>
      )}
      <Field label="시드" hint="비우면 매번 랜덤. 숫자를 넣으면 늘 같은 시드로 그립니다">
        {(id) => <NumberInput id={id} value={gen.seed} onChange={(v) => put({ seed: v === undefined ? undefined : Math.max(0, Math.round(v)) })} min={0} step={1} placeholder="랜덤" />}
      </Field>
      {isNai && (
        <div className="field field-wide">
          <Toggle checked={!!gen.varietyBoost} onChange={(v) => put({ varietyBoost: v || undefined })} label="Variety+" hint="구도가 더 다양해집니다 (초반 단계에서 가이던스를 건너뜀)" />
        </div>
      )}
    </>
  );
}
