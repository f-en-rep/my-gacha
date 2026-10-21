// 새 월드 만들기 마법사 (입력 → 초안 → 생성 시작)
import { useState, type FormEvent } from 'react';
import { createWorldDraft, type WorldInput } from '../../gen/world';
import { Field } from '../settings/fields';
import { navigate } from '../router';
import { startGeneration } from './runner';
import { errorText, LANGUAGES, NeedTextConnection, useTextReady, worldPaths } from './shared';

const DESC_MAX = 4000;
const TEXT_MAX = 4000;

interface Form {
  description: string;
  scenario: string;
  directives: string;
  name: string;
  language: string;
  artStyle: string;
}

const EMPTY: Form = { description: '', scenario: '', directives: '', name: '', language: 'ko', artStyle: '' };

// 패널을 닫았다 열어도 쓰던 글이 남게 (이 탭 안에서만)
let memo: Form = EMPTY;

export function WorldWizard() {
  const [form, setFormState] = useState<Form>(memo);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [touched, setTouched] = useState(false);
  const text = useTextReady();

  const set = (patch: Partial<Form>) =>
    setFormState((f) => {
      memo = { ...f, ...patch };
      return memo;
    });

  const descMissing = !form.description.trim();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (descMissing || busy || !text?.ready) return;
    setBusy(true);
    setErr(undefined);
    try {
      const input: WorldInput = {
        language: form.language,
        description: form.description.trim(),
        scenario: form.scenario.trim(),
        directives: form.directives.trim(),
        ...(form.name.trim() && { name: form.name.trim() }),
        ...(form.artStyle.trim() && { artStyle: form.artStyle.trim() }),
      };
      const id = await createWorldDraft(input);
      memo = EMPTY;
      navigate(worldPaths.of(id), { replace: true });
      void startGeneration(id);
    } catch (e) {
      setErr(errorText(e));
      setBusy(false);
    }
  }

  return (
    <form className="wz stack" onSubmit={submit} noValidate>
      <header className="wz-head">
        <span className="kicker">NEW WORLD</span>
        <h2>새 월드 만들기</h2>
        <p className="muted small">세계관만 적으면 나머지(이름, 태그, 재화, 캐릭터 13명, 상시 배너)는 AI가 채웁니다. 그림은 처음 뽑을 때 그립니다.</p>
      </header>

      <div className="form-grid">
        <Field
          wide
          label="세계관 *"
          error={touched && descMissing ? '세계관을 적어 주세요.' : undefined}
          hint={
            <span className="wz-count">
              <span>어떤 세계인지, 어떤 세력과 사람들이 있는지 자유롭게.</span>
              <span className="mono" aria-live="polite">
                {form.description.length}/{DESC_MAX}
              </span>
            </span>
          }
        >
          {(id) => (
            <textarea
              id={id}
              rows={7}
              maxLength={DESC_MAX}
              required
              aria-invalid={touched && descMissing ? true : undefined}
              value={form.description}
              onChange={(e) => set({ description: e.target.value })}
              placeholder="예: 하늘에 떠 있는 섬들 사이를 비행선으로 오가는 세계. 섬마다 다른 원소의 정령과 계약한 기사단이 있다…"
            />
          )}
        </Field>

        <Field wide label="시나리오 / 시작 상황" hint="플레이어가 어떤 입장에서 시작하는지. 비워도 됩니다.">
          {(id) => (
            <textarea
              id={id}
              rows={4}
              maxLength={TEXT_MAX}
              value={form.scenario}
              onChange={(e) => set({ scenario: e.target.value })}
              placeholder="예: 막 창설된 기사단의 지휘관으로 부임한 첫날"
            />
          )}
        </Field>

        <Field wide label="작가 지시문 (선택)" hint="AI가 글을 쓸 때 늘 지킬 규칙. 분위기, 피하고 싶은 것, 문체 등.">
          {(id) => (
            <textarea
              id={id}
              rows={3}
              maxLength={TEXT_MAX}
              value={form.directives}
              onChange={(e) => set({ directives: e.target.value })}
              placeholder="예: 밝고 유쾌하게. 잔인한 묘사는 피한다."
            />
          )}
        </Field>

        <Field label="월드 이름 (선택)" hint="비우면 AI가 짓습니다.">
          {(id) => <input id={id} value={form.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} placeholder="예: 부유섬 연대기" />}
        </Field>

        <Field label="언어" hint="캐릭터 시트와 대사를 쓸 언어">
          {(id) => (
            <select id={id} value={form.language} onChange={(e) => set({ language: e.target.value })}>
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field wide label="화풍 태그 (선택)" hint="그림에 공통으로 붙는 영어 태그. 비우면 세계관에 맞게 AI가 정합니다.">
          {(id) => (
            <input
              id={id}
              value={form.artStyle}
              maxLength={1000}
              onChange={(e) => set({ artStyle: e.target.value })}
              placeholder="watercolor, soft lighting, pastel colors"
              autoCapitalize="off"
              spellCheck={false}
            />
          )}
        </Field>
      </div>

      {err && <p className="form-errors">{err}</p>}

      {text && !text.ready ? (
        <NeedTextConnection hasProfile={text.hasProfile} />
      ) : (
        <div className="form-actions">
          <button type="submit" className="btn btn-accent" disabled={busy || !text}>
            {busy ? '시작하는 중…' : '월드 만들기 시작'}
          </button>
          <span className="small muted">글 연결로 10번 넘게 호출합니다. 몇 분 걸릴 수 있어요.</span>
        </div>
      )}
    </form>
  );
}
