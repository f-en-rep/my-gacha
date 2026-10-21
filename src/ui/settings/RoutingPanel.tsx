import { useId } from 'react';
import { Section } from '../common';
import { updateSettings, useProfiles, useSettings } from '../hooks';
import type { ConnectionProfile, JobRouting } from '../../types';
import { Toggle } from './fields';

function RouteSelect({
  label,
  hint,
  value,
  options,
  emptyLabel,
  onChange,
}: {
  label: string;
  hint: string;
  value?: string;
  options: ConnectionProfile[];
  emptyLabel: string;
  onChange: (v: string | undefined) => void;
}) {
  const id = useId();
  const missing = value && !options.some((o) => o.id === value);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={missing ? '' : value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">{emptyLabel}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label} · {o.model}
          </option>
        ))}
      </select>
      <p className="field-hint">{hint}</p>
    </div>
  );
}

export function RoutingPanel() {
  const profiles = useProfiles() ?? [];
  const settings = useSettings();
  const text = profiles.filter((p) => p.type === 'text');
  const image = profiles.filter((p) => p.type === 'image');

  const setRoute = (key: keyof JobRouting, v: string | undefined) =>
    updateSettings((s) => {
      const routing = { ...s.routing };
      if (v) routing[key] = v;
      else delete routing[key];
      return { ...s, routing };
    });

  return (
    <Section title="작업별 연결" icon="route">
      <div className="stack">
        <RouteSelect
          label="구조화 작업"
          hint="캐릭터 시트·계획처럼 JSON이 필요한 일. 똑똑한 모델 추천."
          value={settings.routing.structured}
          options={text}
          emptyLabel={text.length ? '선택하세요' : '글 연결을 먼저 추가하세요'}
          onChange={(v) => void setRoute('structured', v)}
        />
        <RouteSelect
          label="문장 작업"
          hint="스토리 대사 등. 더 싼 모델로 따로 정할 수 있어요."
          value={settings.routing.prose}
          options={text}
          emptyLabel="구조화 작업과 같은 연결"
          onChange={(v) => void setRoute('prose', v)}
        />
        <RouteSelect
          label="그림"
          hint="초상화 생성에 쓸 NovelAI / PixAI 연결."
          value={settings.routing.image}
          options={image}
          emptyLabel={image.length ? '선택하세요' : '그림 연결을 먼저 추가하세요'}
          onChange={(v) => void setRoute('image', v)}
        />
        <Toggle
          checked={settings.autoPaintLowRarity}
          onChange={(v) => void updateSettings((s) => ({ ...s, autoPaintLowRarity: v }))}
          label="3★·4★ 초상화도 자동으로 그리기"
          hint="끄면 낮은 등급은 '그리기' 버튼을 눌렀을 때만 그려요 (비용 절약)."
        />
      </div>
    </Section>
  );
}
