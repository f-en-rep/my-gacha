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
    <Section title="작업별 연결">
      <div className="stack">
        <RouteSelect
          label="구조화 작업"
          hint="캐릭터 시트, 챕터 계획"
          value={settings.routing.structured}
          options={text}
          emptyLabel={text.length ? '선택 안 함' : '글 연결 없음'}
          onChange={(v) => void setRoute('structured', v)}
        />
        <RouteSelect
          label="문장 작업"
          hint="스토리 대사. 싼 모델을 따로 써도 됩니다"
          value={settings.routing.prose}
          options={text}
          emptyLabel="구조화 작업과 같게"
          onChange={(v) => void setRoute('prose', v)}
        />
        <RouteSelect
          label="그림"
          hint="초상화, 배경"
          value={settings.routing.image}
          options={image}
          emptyLabel={image.length ? '선택 안 함' : '그림 연결 없음'}
          onChange={(v) => void setRoute('image', v)}
        />
        <Toggle
          checked={settings.autoPaintLowRarity}
          onChange={(v) => void updateSettings((s) => ({ ...s, autoPaintLowRarity: v }))}
          label="3★·4★ 초상화 자동 생성"
          hint="끄면 직접 눌러야 그립니다"
        />
      </div>
    </Section>
  );
}
