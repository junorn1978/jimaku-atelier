/**
 * @file ui-languages.js
 * @description Everything about the three subtitle lines, in one place.
 *
 * Top — a matrix with one row per line (recognition / translation 1 /
 * translation 2). Each row carries that line's language AND its appearance:
 * text colour, stroke colour, size, stroke width. Language and appearance
 * describe the same object, so keeping them in separate tabs meant setting up
 * one line required switching back and forth; the appearance columns used to
 * live in ui-style.js. Rows are display:contents so their cells join the outer
 * grid and same-kind controls line up vertically.
 *
 * Bottom — two columns: HOW to translate (engine picker plus an .engine-detail
 * region that absorbs the rest of the column, so switching engines never
 * resizes the tab) and the Chrome-only offline recognition pack. The verbose
 * URL format help lives in a dialog (#dialog-url-format in index.html).
 *
 * What stayed in ui-style.js is everything global rather than per line: the
 * source wrap symbols, alignment, background colour, overflow mode.
 *
 * All form controls bind to the settings store via [data-bind].
 */

import { getAllLanguages } from './languages.js';
import { settings, subscribe } from './store.js';
import { applyTo, t } from './i18n.js';
import { isChrome } from './env.js';
import { setupLanguagePackButton } from './language-pack.js';
import { isPromptSupported, getPromptAvailability } from './translate-prompt.js';
import { isTranslatorSupported, prepareTranslators } from './translate-translator.js';

/* Ranges for the per-line appearance controls. They live here rather than in
   ui-style.js because the controls they drive moved into this tab. */
const SIZE_MIN   = 14;
const SIZE_MAX   = 48;
const STROKE_MIN = 0;
const STROKE_MAX = 10;

/**
 * The four appearance cells of one subtitle line, in the matrix's column order.
 * `prefix` is the settings-key middle part: source | target1 | target2.
 */
function styleCells(prefix) {
  const key = (suffix) => `sub${prefix.charAt(0).toUpperCase()}${prefix.slice(1)}${suffix}`;
  return `
          <span class="color-cell">
            <input type="color" class="color-input" data-bind="${key('Color')}">
            <output class="color-value"></output>
          </span>
          <span class="color-cell">
            <input type="color" class="color-input" data-bind="${key('Stroke')}">
            <output class="color-value"></output>
          </span>
          <div class="slider-group">
            <input type="range" min="${SIZE_MIN}" max="${SIZE_MAX}" data-bind="${key('Size')}">
            <output class="slider-value"></output>
          </div>
          <div class="slider-group">
            <input type="range" min="${STROKE_MIN}" max="${STROKE_MAX}" data-bind="${key('StrokeW')}">
            <output class="slider-value"></output>
          </div>`;
}

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
      <!-- One row per subtitle line, carrying BOTH its language and its
           appearance. They describe the same object, so splitting them across
           two tabs meant setting up a single line required switching back and
           forth. Column headers are written once; each row is a
           display:contents wrapper so its cells join the outer grid and every
           control of the same kind lines up vertically. -->
      <div class="lang-matrix">
        <div class="lang-matrix-head">
          <span></span>
          <span></span>
          <span data-i18n="style.textColor">文字色</span>
          <span data-i18n="style.strokeColor">縁取り色</span>
          <span data-i18n="style.fontSize">サイズ</span>
          <span data-i18n="style.strokeWidth">縁取り幅</span>
        </div>

        <div class="lang-matrix-row">
          <span class="lang-field-label" data-i18n="lang.source">音声認識</span>
          <div class="lang-control">
            <select class="select select-compact" data-bind="sourceLangId">${sourceOptions}</select>
            <label class="toggle" data-i18n-title="style.showSource" title="原文を表示">
              <input type="checkbox" data-bind="subShowSource">
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
            </label>
          </div>
          ${styleCells('source')}
        </div>

        <div class="lang-matrix-row">
          <span class="lang-field-label" data-i18n="lang.target1">翻訳 1</span>
          <div class="lang-control">
            <select class="select select-compact" data-bind="target1LangId">${targetOptions}</select>
          </div>
          ${styleCells('target1')}
        </div>

        <div class="lang-matrix-row">
          <span class="lang-field-label" data-i18n="lang.target2">翻訳 2</span>
          <div class="lang-control">
            <select class="select select-compact" data-bind="target2LangId">${targetOptions}</select>
          </div>
          ${styleCells('target2')}
        </div>
      </div>

      <div class="panel-cols cols-2">
        <!-- How to translate. The engine's own detail (status messages, the
             custom URL row) sits in a region that absorbs the rest of the
             column, so switching engines never resizes the tab. -->
        <section class="panel-col lang-engine">
          <h3 class="section-title" data-i18n="lang.engine">翻訳エンジン</h3>
          <div class="seg-switch" role="group">
            <label><input type="radio" name="translationMode" value="gtx"  data-bind="translationMode"><span data-i18n="lang.engine.gtx">Google 翻訳</span></label>
            <label id="engine-translator-label"><input type="radio" name="translationMode" value="translator" data-bind="translationMode"><span data-i18n="lang.engine.translator">ブラウザ翻訳</span></label>
            <label id="engine-prompt-label"><input type="radio" name="translationMode" value="prompt" data-bind="translationMode"><span data-i18n="lang.engine.prompt">ブラウザ AI</span></label>
            <label><input type="radio" name="translationMode" value="link" data-bind="translationMode"><span data-i18n="lang.engine.link">カスタム URL</span></label>
          </div>
          <div class="engine-detail">
            <p class="manual-status" id="engine-translator-status" role="status" aria-live="polite" hidden></p>
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

              <div class="help-popover url-popover" id="popover-url-examples" popover>
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
        </section>

        <!-- Offline recognition pack: belongs to the recognition language above,
             but is a Chrome-only, set-up-once concern, so it sits beside the
             engine rather than inside the matrix. -->
        <section class="panel-col lang-sub" id="offline-pack-row" hidden>
          <h3 class="section-title" data-i18n="lang.offline.label">オフライン音声認識パック</h3>
          <div class="offline-pack-head">
            <button type="button" class="btn" id="btn-offline-pack">ダウンロード</button>

            <!-- Removal instructions live in a popover rather than as standing
                 text: they only matter once a pack is installed, and as a
                 permanent paragraph they were the tallest thing in the tab.
                 A popover (not a tooltip) stays open while the user follows the
                 steps in the browser's own settings. -->
            <button type="button" class="btn offline-help-toggle" id="btn-offline-help"
                    popovertarget="popover-offline-help"
                    data-i18n="lang.offline.help" hidden>削除方法</button>

            <div class="help-popover offline-popover" id="popover-offline-help" popover>
              <p class="offline-pack-info" id="offline-pack-info"></p>
            </div>
          </div>
          <p class="manual-status offline-pack-status" id="offline-pack-status"
             role="status" aria-live="polite"></p>
        </section>
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
  setupTranslatorEngine(container);
  setupPromptEngine(container);
}

/* Built-in Translator API engine. Unlike the Prompt API we do download models
   here — they are per language pair and downloading on demand is the intended
   flow — but create() only downloads while a user gesture is live. So the
   warm-up runs exactly on the gestures that can trigger it: picking this
   engine, and changing a source/target language while it is picked. */
function setupTranslatorEngine(container) {
  const label  = container.querySelector('#engine-translator-label');
  const radio  = label?.querySelector('input[value="translator"]');
  const status = container.querySelector('#engine-translator-status');
  if (!label || !radio || !status) return;

  /* Keep the message as a key (+ percentage) so a UI language switch can
     re-render it without redoing the work that produced it. */
  let messageKey = null;
  let percent    = null;

  const render = () => {
    if (!messageKey) { status.hidden = true; status.textContent = ''; return; }
    const suffix = percent == null ? '' : ` ${percent}%`;
    status.hidden = false;
    status.textContent = t(messageKey) + suffix;
  };

  const setMessage = (key, pct = null) => { messageKey = key; percent = pct; render(); };
  subscribe('uiLang', render);

  if (!isTranslatorSupported()) {
    radio.disabled = true;
    label.classList.add('is-disabled');
    setMessage('lang.engine.translator.unsupported');
    label.title = t('lang.engine.translator.unsupported');
    if (settings.translationMode === 'translator') settings.translationMode = 'gtx';
    return;
  }

  const REASON_KEYS = {
    unavailable: 'lang.engine.translator.unavailable',
    blocked:     'lang.engine.translator.blocked',
    failed:      'lang.engine.translator.failed',
    unsupported: 'lang.engine.translator.unsupported',
  };

  /* Only one warm-up runs at a time; a language change during a download is
     remembered and re-run afterwards rather than dropped. */
  let warming = false;
  let restart = false;

  const warmUp = async () => {
    if (settings.translationMode !== 'translator') return;
    if (warming) { restart = true; return; }
    warming = true;

    /* A download only reports progress once it actually starts; if the models
       are already there the user just sees "preparing" blink past. */
    let downloaded = false;
    setMessage('lang.engine.translator.preparing');

    try {
      const result = await prepareTranslators(
        settings.sourceLangId,
        [settings.target1LangId, settings.target2LangId],
        (loaded) => {
          downloaded = true;
          setMessage('lang.engine.translator.downloading', Math.floor(loaded * 100));
        },
      );
      if (result.ok) setMessage(downloaded ? 'lang.engine.translator.ready' : null);
      else           setMessage(REASON_KEYS[result.reason] ?? REASON_KEYS.failed);
    } finally {
      warming = false;
    }

    /* The selection changed mid-download. The gesture is long gone, so this
       only completes silently when the new pair is already downloaded — the
       user is told to re-pick the engine otherwise. */
    if (restart) { restart = false; await warmUp(); }
  };

  subscribe('translationMode', (mode) => {
    if (mode === 'translator') warmUp();
    else setMessage(null);
  });
  ['sourceLangId', 'target1LangId', 'target2LangId'].forEach(key => subscribe(key, warmUp));

  /* Restored from a previous session: the models may already be downloaded, in
     which case create() needs no gesture and this simply succeeds. */
  if (settings.translationMode === 'translator') warmUp();
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

  /* Availability changes asynchronously, while the UI language can change at
     any time. Keep the message key so the current state can be translated
     again without repeating the availability check. */
  let currentMessageKey = null;

  const renderMessage = () => {
    if (!currentMessageKey) return;
    const message = t(currentMessageKey);
    label.title = message;
    status.textContent = message;
  };

  subscribe('uiLang', renderMessage);

  /* `fallback` is only set once we KNOW the engine is unusable; during the
     async "checking" phase we just disable the radio without stranding a valid
     prompt selection. */
  const disable = (msgKey, fallback) => {
    currentMessageKey = msgKey;
    radio.disabled = true;
    label.classList.add('is-disabled');
    status.hidden = false;
    renderMessage();
    if (fallback && settings.translationMode === 'prompt') settings.translationMode = 'gtx';
  };

  const enable = () => {
    currentMessageKey = null;
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
  const help   = container.querySelector('#btn-offline-help');
  if (!row || !button || !status || !info) return;
  /* The whole block — button, name, status and info — lives below the source
     row and stays hidden on browsers without on-device packs. */
  row.hidden = false;
  setupLanguagePackButton({ button, status, info, help });
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
