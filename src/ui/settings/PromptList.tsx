// 설정 → 프롬프트: AI에게 보내는 글 프롬프트 목록. 고친 프롬프트에는 "수정됨"
import { Icon } from '../Icon';
import { Section } from '../common';
import { useSettings } from '../hooks';
import { paths } from '../router';
import { PROMPT_TEMPLATES, cleanOverrides } from '../../gen/prompts';
import './prompts.css';

export function PromptList() {
  const settings = useSettings();
  return (
    <Section title="프롬프트">
      <div className="stack">
        <p className="muted small">
          AI에게 보내는 글을 보고 고칠 수 있어요. 답의 형식을 정하는 부분은 잠겨 있어요. 고친 글은 이 브라우저에만 저장되고 백업·월드 팩에는 들어가지 않아요.
        </p>
        <ul className="menu-list">
          {PROMPT_TEMPLATES.map((t) => (
            <li key={t.id}>
              <a className="menu-row" href={'#' + paths.prompt(t.id)}>
                <span className="menu-row-text">
                  <strong>{t.title}</strong>
                  <small>{t.description}</small>
                </span>
                {cleanOverrides(t, settings.prompts?.[t.id]) && <span className="pe-badge">수정됨</span>}
                <Icon name="chevron" size={16} />
              </a>
            </li>
          ))}
        </ul>
        <p className="muted small">그림 프롬프트는 그림 연결 설정과 캐릭터 화면에서 고쳐요.</p>
      </div>
    </Section>
  );
}
