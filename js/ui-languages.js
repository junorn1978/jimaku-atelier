/**
 * @file ui-languages.js
 * @description Renders the language controls as two side-by-side blocks: the
 * source side (recognition language + show-source toggle + offline download
 * button on one line, its download messages stacked below) and the translation
 * side (the two target selects on one line, with the engine picker stacked
 * below). Selects are a fixed compact width. The custom-URL input appears under
 * the engine picker in "link" mode; the verbose URL format help lives in a
 * dialog (#dialog-url-format in index.html). All form controls bind to the
 * settings store via [data-bind].
 */

import { getAllLanguages } from './languages.js';
import { settings, subscribe } from './store.js';
import { applyTo, t } from './i18n.js';
import { isChrome } from './env.js';
import { setupLanguagePackButton } from './language-pack.js';
import { isPromptSupported, getPromptAvailability } from './translate-prompt.js';

export function mountLanguagesTab(container) {
  if (!container) return;

  const langs = getAllLanguages();
  const targetOptions =
    `<option value="none" data-i18n="lang.none">翻訳しない</option>` +
    langs.map(l => `<option value="${l.id}" data-i18n="lang.name.${l.id}">${escapeAttr(l.label)}</option>`).join('');
  const sourceOptions =
    `<option value="" data-i18n="lang.choose">言語を選択</option>` +
    langs.map(l => `<option value="${l.id}" data-i18n="lang.name.${l.id}">${escapeAttr(l.label)}</option>`).join('');

  container.innerHTML = `
    <div class="lang-grid">
      <!-- source side: the recognition language row, with its download
           messages stacked below it -->
      <div class="lang-side lang-side-source">
        <div class="lang-field">
          <span class="lang-field-label" data-i18n="lang.source">音声認識</span>
          <select class="select select-compact" data-bind="sourceLangId">${sourceOptions}</select>
          <label class="toggle" data-i18n-title="style.showSource" title="原文を表示">
            <input type="checkbox" data-bind="subShowSource">
            <span class="toggle-track"><span class="toggle-thumb"></span></span>
          </label>
          <button type="button" class="btn" id="btn-offline-pack"
                  data-i18n-title="lang.offline.label" title="オフライン認識パック" hidden>ダウンロード</button>
        </div>
        <div class="lang-sub" id="offline-pack-row" hidden>
          <p class="manual-status" id="offline-pack-status" role="status" aria-live="polite"></p>
          <p class="offline-pack-info" id="offline-pack-info"></p>
        </div>
      </div>

      <!-- translation side: the two target rows on one line, with the engine
           picker stacked below them -->
      <div class="lang-side lang-side-translate">
        <div class="lang-targets">
          <div class="lang-field">
            <span class="lang-field-label" data-i18n="lang.target1">翻訳 1</span>
            <select class="select select-compact" data-bind="target1LangId">${targetOptions}</select>
          </div>
          <div class="lang-field">
            <span class="lang-field-label" data-i18n="lang.target2">翻訳 2</span>
            <select class="select select-compact" data-bind="target2LangId">${targetOptions}</select>
          </div>
        </div>

        <div class="lang-engine">
          <span class="section-title" data-i18n="lang.engine">翻訳エンジン</span>
          <div class="seg-switch" role="group">
            <label><input type="radio" name="translationMode" value="gtx"  data-bind="translationMode"><span data-i18n="lang.engine.gtx">Google 翻訳</span></label>
            <label id="engine-prompt-label"><input type="radio" name="translationMode" value="prompt" data-bind="translationMode"><span data-i18n="lang.engine.prompt">ブラウザ AI</span></label>
            <label><input type="radio" name="translationMode" value="link" data-bind="translationMode"><span data-i18n="lang.engine.link">カスタム URL</span></label>
          </div>
          <p class="manual-status" id="engine-prompt-status" role="status" aria-live="polite" hidden></p>

          <div class="lang-url-row" id="custom-url-row" hidden>
            <input type="url" class="text-input" placeholder="https://..." data-bind="customTranslateUrl"
                   autocomplete="off" spellcheck="false">

            <button type="button" class="btn url-examples-toggle" id="btn-url-examples"
                    popovertarget="popover-url-examples">
              <span data-i18n="lang.engine.link.help.more">範例與說明</span>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="m6 9 6 6 6-6"/>
              </svg>
            </button>

            <div class="url-popover" id="popover-url-examples" popover>
              <div class="format-help-examples">
                <span data-i18n="lang.engine.link.help.examples">可直接使用的範例：</span>
                <button type="button" class="btn" data-example="minimal" data-i18n="lang.engine.link.example.btn.minimal">最小</button>
                <button type="button" class="btn" data-example="openai">OpenAI</button>
                <button type="button" class="btn" data-example="gemini">Gemini</button>
                <button type="button" class="btn" id="btn-url-format" data-i18n="lang.engine.link.help.btn">格式說明</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  /* Style the radios as a segmented switch by overlaying span as the visible
     button. The styling lives in CSS (.seg-switch label / input). */

  const urlRow = container.querySelector('#custom-url-row');
  const syncUrlVisibility = (mode) => { urlRow.hidden = mode !== 'link'; };
  syncUrlVisibility(settings.translationMode);
  subscribe('translationMode', syncUrlVisibility);

  /* "格式說明" opens the URL-format help dialog (static markup in index.html). */
  container.querySelector('#btn-url-format')?.addEventListener('click', (e) => {
    e.target.closest('[popover]')?.hidePopover();
    document.getElementById('dialog-url-format')?.showModal();
  });

  wireExampleButtons(container);
  setupOfflinePack(container);
  setupPromptEngine(container);
}

/* Chrome Prompt API engine: usable only when the model reports 'available'.
   We never download it — that is the browser's job — so any other state is
   surfaced as "unavailable": the radio is disabled, and if it was the selected
   engine we fall back to gtx. */
function setupPromptEngine(container) {
  const label  = container.querySelector('#engine-prompt-label');
  const radio  = label?.querySelector('input[value="prompt"]');
  const status = container.querySelector('#engine-prompt-status');
  if (!label || !radio || !status) return;

  /* `fallback` is only set once we KNOW the engine is unusable; during the
     async "checking" phase we just disable the radio without stranding a valid
     prompt selection. */
  const disable = (msgKey, fallback) => {
    radio.disabled = true;
    label.classList.add('is-disabled');
    label.title = t('lang.engine.prompt.unavailable');
    status.hidden = false;
    status.textContent = t(msgKey);
    if (fallback && settings.translationMode === 'prompt') settings.translationMode = 'gtx';
  };

  const enable = () => {
    radio.disabled = false;
    label.classList.remove('is-disabled');
    label.removeAttribute('title');
    status.hidden = true;
    status.textContent = '';
  };

  if (!isPromptSupported()) {
    disable('lang.engine.prompt.unsupported', true);
    return;
  }

  /* Disable (no fallback yet) until the async availability check resolves. */
  disable('lang.engine.prompt.checking', false);
  getPromptAvailability().then((avail) => {
    if (avail === 'available') enable();
    else disable('lang.engine.prompt.unavailable', true);
  }).catch(() => disable('lang.engine.prompt.unavailable', true));
}

function setupOfflinePack(container) {
  /* On-device packs are Chrome-only — leave the row hidden elsewhere. */
  if (!isChrome) return;
  const row    = container.querySelector('#offline-pack-row');
  const button = container.querySelector('#btn-offline-pack');
  const status = container.querySelector('#offline-pack-status');
  const info   = container.querySelector('#offline-pack-info');
  if (!row || !button || !status || !info) return;
  /* The button lives inline in the source row (hidden by default); the status
     and info messages sit in their own row below. Reveal both on Chrome. */
  button.hidden = false;
  row.hidden = false;
  setupLanguagePackButton({ button, status, info });
}

function wireExampleButtons(container) {
  const dialog = document.getElementById('dialog-link-example');
  const titleEl = document.getElementById('dialog-link-example-title');
  const codeEl  = document.getElementById('dialog-link-example-code');
  const stepsEl = document.getElementById('dialog-link-example-steps');
  const copyBtn = document.getElementById('dialog-link-example-copy');
  if (!dialog || !titleEl || !codeEl || !stepsEl || !copyBtn) return;

  const samples = {
    minimal: {
      titleKey: 'lang.engine.link.dialog.title.minimal',
      deps:     'pip install flask flask-cors',
      build:    buildMinimalExample,
    },
    openai: {
      titleKey: 'lang.engine.link.dialog.title.openai',
      deps:     'pip install flask flask-cors openai',
      build:    buildOpenAiExample,
    },
    gemini: {
      titleKey: 'lang.engine.link.dialog.title.gemini',
      deps:     'pip install flask flask-cors google-genai',
      build:    buildGeminiExample,
    },
  };

  container.querySelectorAll('[data-example]').forEach(btn => {
    btn.addEventListener('click', () => {
      const sample = samples[btn.dataset.example];
      if (!sample) return;
      btn.closest('[popover]')?.hidePopover();
      titleEl.textContent = t(sample.titleKey);
      buildSteps(stepsEl, sample.deps);
      codeEl.textContent  = sample.build();
      resetCopyBtn(copyBtn);
      dialog.showModal();
    });
  });

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(codeEl.textContent);
      copyBtn.textContent = t('lang.engine.link.help.copied');
      copyBtn.classList.add('is-copied');
      clearTimeout(copyBtn._resetTimer);
      copyBtn._resetTimer = setTimeout(() => resetCopyBtn(copyBtn), 1500);
    } catch {
      /* clipboard may be blocked (insecure context, no permission) — leave label untouched. */
    }
  });
}

function resetCopyBtn(btn) {
  btn.textContent = t('lang.engine.link.help.copy');
  btn.classList.remove('is-copied');
}

/* Render the 3 setup steps for the dialog. Only `deps` differs per engine;
   the run command and URL are the same. */
function buildSteps(el, deps) {
  el.innerHTML = `
    <p class="example-steps-title">${t('lang.engine.link.steps.title')}</p>
    <ol>
      <li>${t('lang.engine.link.steps.install')}<code>${deps}</code></li>
      <li>${t('lang.engine.link.steps.run')}<code>python server.py</code></li>
      <li>${t('lang.engine.link.steps.url')}<code>http://localhost:5000</code></li>
    </ol>`;
}

function escapeAttr(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* 範例內的程式碼註解依目前 UI 語言顯示（送給 AI 的 prompt 固定用日文）。 */
function exampleComments() {
  return {
    apiKey:       t('lang.engine.link.example.cmt.apiKey'),
    prompt:       t('lang.engine.link.example.cmt.prompt'),
    translateOne: t('lang.engine.link.example.cmt.translateOne'),
    parse:        t('lang.engine.link.example.cmt.parse'),
    align:        t('lang.engine.link.example.cmt.align'),
    callEngine:   t('lang.engine.link.example.cmt.callEngine'),
  };
}

function buildMinimalExample() {
  const c = exampleComments();
  return `from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

@app.post('/translate')
def translate():
    data = request.get_json()
    text = data['text']
    targets = data['targetLangs']
    # ${c.callEngine}
    translations = [f'[{lang}] {text}' for lang in targets]
    return jsonify({'translations': translations})


if __name__ == '__main__':
    app.run(port=5000)`;
}

const SYSTEM_PROMPT_JA = `あなたはリアルタイム字幕の翻訳エンジンです。
入力テキストを指定された言語へ自然に翻訳してください。

出力ルール：
- JSON のみを出力：{"translation": "..."}
- 他のキー、Markdown、説明文は一切出力しない。
- 原文に主語が明示されていない場合、主語を補わない。`;

function buildOpenAiExample() {
  const c = exampleComments();
  return `from flask import Flask, request, jsonify
from flask_cors import CORS
from openai import OpenAI
import json

# ${c.apiKey}
API_KEY = 'YOUR_API_KEY'
MODEL = 'gpt-4.1-mini'

app = Flask(__name__)
CORS(app)
client = OpenAI(api_key=API_KEY)

# ${c.prompt}
SYSTEM_PROMPT = """${SYSTEM_PROMPT_JA}"""


# ${c.parse}
def safe_parse_translation(raw):
    data = json.loads(raw or '{}')
    text = data.get('translation', '')
    return text if isinstance(text, str) else ''


# ${c.translateOne}
def translate_one(text, lang):
    resp = client.chat.completions.create(
        model=MODEL,
        messages=[
            {'role': 'system', 'content': SYSTEM_PROMPT},
            {'role': 'user', 'content': f"翻訳先の言語: {lang}\\n原文:\\n{text}"},
        ],
        response_format={'type': 'json_object'},
        temperature=0.2,
    )
    return safe_parse_translation(resp.choices[0].message.content)


@app.post('/translate')
def translate():
    data = request.get_json(silent=True) or {}
    text = (data.get('text') or '').strip()
    targets = data.get('targetLangs') or []
    sequence_id = data.get('sequenceId')

    if not text or not isinstance(targets, list):
        return jsonify({'error': 'Invalid parameters', 'sequenceId': sequence_id}), 400

    try:
        # ${c.align}
        translations = [translate_one(text, lang) for lang in targets]
    except Exception as e:
        app.logger.error('[translate] %s', e)
        return jsonify({'error': 'Translation failed', 'sequenceId': sequence_id}), 500

    return jsonify({'translations': translations, 'sequenceId': sequence_id})


if __name__ == '__main__':
    app.run(port=5000)`;
}

function buildGeminiExample() {
  const c = exampleComments();
  return `from flask import Flask, request, jsonify
from flask_cors import CORS
from google import genai
import json

# ${c.apiKey}
API_KEY = 'YOUR_API_KEY'
MODEL = 'gemini-3.1-flash-lite'

app = Flask(__name__)
CORS(app)
client = genai.Client(api_key=API_KEY)

# ${c.prompt}
SYSTEM_PROMPT = """${SYSTEM_PROMPT_JA}"""


# ${c.parse}
def safe_parse_translation(raw):
    data = json.loads(raw or '{}')
    text = data.get('translation', '')
    return text if isinstance(text, str) else ''


# ${c.translateOne}
def translate_one(text, lang):
    resp = client.models.generate_content(
        model=MODEL,
        contents=f"翻訳先の言語: {lang}\\n原文:\\n{text}",
        config={
            'system_instruction': SYSTEM_PROMPT,
            'response_mime_type': 'application/json',
            'temperature': 0.3,
        },
    )
    return safe_parse_translation(resp.text)


@app.post('/translate')
def translate():
    data = request.get_json(silent=True) or {}
    text = (data.get('text') or '').strip()
    targets = data.get('targetLangs') or []
    sequence_id = data.get('sequenceId')

    if not text or not isinstance(targets, list):
        return jsonify({'error': 'Invalid parameters', 'sequenceId': sequence_id}), 400

    try:
        # ${c.align}
        translations = [translate_one(text, lang) for lang in targets]
    except Exception as e:
        app.logger.error('[translate] %s', e)
        return jsonify({'error': 'Translation failed', 'sequenceId': sequence_id}), 500

    return jsonify({'translations': translations, 'sequenceId': sequence_id})


if __name__ == '__main__':
    app.run(port=5000)`;
}
