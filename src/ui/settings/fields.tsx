// 폼 조각들
import { useId, useState, type ReactNode } from 'react';
import { Icon } from '../Icon';

export function Field({ label, hint, children, error, wide }: { label: string; hint?: ReactNode; children: (id: string) => ReactNode; error?: string; wide?: boolean }) {
  const id = useId();
  return (
    <div className={wide ? 'field field-wide' : 'field'}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <p className="field-hint">{hint}</p>}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

export function SecretInput({ id, value, onChange, placeholder }: { id: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="input-group">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
      />
      <button type="button" className="icon-btn" onClick={() => setShow((s) => !s)} aria-pressed={show} aria-label={show ? '키 숨기기' : '키 보기'}>
        <Icon name={show ? 'eyeOff' : 'eye'} size={20} />
      </button>
    </div>
  );
}

/** 숫자 입력. 입력 중 빈 칸을 허용하고, 비우면 undefined */
export function NumberInput({
  id,
  value,
  onChange,
  min,
  max,
  step,
  placeholder,
}: {
  id: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  return (
    <input
      id={id}
      type="number"
      inputMode="decimal"
      value={text}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        const n = e.target.value === '' ? undefined : Number(e.target.value);
        onChange(n === undefined || Number.isNaN(n) ? undefined : n);
      }}
    />
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className="toggle-row">
      <label htmlFor={id} className="toggle-text">
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </label>
      <input id={id} type="checkbox" role="switch" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </div>
  );
}
