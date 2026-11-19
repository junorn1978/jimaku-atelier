/**
 * @file plamo-store.js
 * @description The PLaMo 3 Translate models (js/translate-plamo.js): which
 * files make up each one, and their download into, reading from and removal
 * from this origin's private file system (OPFS).
 *
 * The models are community ONNX conversions for onnxruntime-web on WebGPU
 * (chiro0318, q4f16), not releases of Preferred Networks itself. The
 * tokenizer is TeamFlaxia's tokenizer.json, shared by both sizes: the two
 * original tokenizer files are identical. Every URL is pinned to a commit so
 * an upstream change can never put the files out of step with this code.
 * Hugging Face answers this page's origin with CORS and honours Range on the
 * redirect target (checked 2026-11-17 from junorn1978.github.io).
 *
 * Why OPFS and not the Cache API HY-MT goes through: the 2B weights are one
 * 1.6 GB file. A cache entry is all or nothing, so a download broken off at
 * 90% would start over. Here each file is stored as fixed 32 MB parts, one
 * OPFS file per part — createWritable() only swaps a file in on close(), so
 * a part either is complete or is not there — and a broken-off download
 * resumes from the first missing part with an HTTP Range request.
 *   Layout: plamo/<model>/<file>.part0000, .part0001, …
 *
 * Origins are separate stores: the GitHub Pages build and a localhost run
 * each download their own copy, as with HY-MT.
 *
 * License: PLaMo Community License (docs/plamo/). Commercial use needs prior
 * registration with PFN and annual revenue of at most 1 billion yen; offering
 * the model to others means attaching the license and showing "Built with
 * PLaMo". Published translations need no notice (art. 5 para. 2).
 *
 * Checked 2026-11-17.
 */

const HF = 'https://huggingface.co';

const TOKENIZER_REPO = 'TeamFlaxia/plamo-3-translate-0.8b-onnx';
const TOKENIZER_REV  = '1c8417ee1a72442440ad515b02f99186c81fd08a';

const tokenizerFiles = [
  { name: 'tokenizer.json',        size: 2568421, url: `${HF}/${TOKENIZER_REPO}/resolve/${TOKENIZER_REV}/tokenizer.json` },
  { name: 'tokenizer_config.json', size: 5442,    url: `${HF}/${TOKENIZER_REPO}/resolve/${TOKENIZER_REV}/tokenizer_config.json` },
];

function onnxFiles(repo, rev, graphSize, dataSize) {
  return [
    { name: 'model_q4f16.onnx',      size: graphSize, url: `${HF}/${repo}/resolve/${rev}/onnx/model_q4f16.onnx` },
    { name: 'model_q4f16.onnx_data', size: dataSize,  url: `${HF}/${repo}/resolve/${rev}/onnx/model_q4f16.onnx_data` },
  ];
}

/* kvHeads / headDim shape the empty KV cache the first step is fed. */
export const PLAMO_MODELS = [
  {
    value: 'plamo-3-translate-2b',
    label: '2B',
    kvHeads: 4,
    headDim: 128,
    files: [
      ...onnxFiles('chiro0318/plamo-3-translate-2b-onnx-webgpu', '598dca5f070b5f57cb3c28432941685d3ea3879d', 124079, 1621660672),
      ...tokenizerFiles,
    ],
  },
  {
    value: 'plamo-3-translate-0.8b',
    label: '0.8B',
    kvHeads: 1,
    headDim: 128,
    files: [
      ...onnxFiles('chiro0318/plamo-3-translate-0.8b-onnx-webgpu', '8bfacd0680cc464ebba538454352d6d554095f4c', 82976, 503057408),
      ...tokenizerFiles,
    ],
  },
];

/* The 2B reads streaming speech more naturally than the 0.8B; measured on
   an RTX 20-series card at 0.3–0.5s per line in the sister project. */
export const PLAMO_DEFAULT_MODEL = 'plamo-3-translate-2b';

export function getPlamoModel(value) {
  return PLAMO_MODELS.find(m => m.value === value)
      ?? PLAMO_MODELS.find(m => m.value === PLAMO_DEFAULT_MODEL);
}

export function plamoModelBytes(model) {
  return model.files.reduce((sum, f) => sum + f.size, 0);
}

/** Bytes as the status line shows them: "1.6 GB", "480 MB". */
export function formatBytes(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  return `${Math.round(n / 1e6)} MB`;
}

/* ---------------------------------------------------------------- storage */

const ROOT_DIR  = 'plamo';
const CHUNK     = 32 * 1024 * 1024;
/* One download at a time across tabs, so two tabs cannot write the same part. */
const LOCK_NAME = 'plamo-model-download';

const partName   = (fileName, i) => `${fileName}.part${String(i).padStart(4, '0')}`;
const chunkCount = (size) => Math.max(1, Math.ceil(size / CHUNK));
const chunkSize  = (size, i) => Math.min(CHUNK, size - i * CHUNK);

async function modelDir(value, create) {
  const root = await navigator.storage.getDirectory();
  const base = await root.getDirectoryHandle(ROOT_DIR, { create });
  return base.getDirectoryHandle(value, { create });
}

async function existingSize(dir, name) {
  try { return (await (await dir.getFileHandle(name)).getFile()).size; }
  catch { return -1; }
}

/**
 * How much of a model is stored. No directory means nothing downloaded yet.
 * @returns {Promise<{downloaded: number, total: number, complete: boolean}>}
 */
export async function getPlamoStatus(value) {
  const model = getPlamoModel(value);
  const total = plamoModelBytes(model);
  let dir;
  try { dir = await modelDir(model.value, false); }
  catch { return { downloaded: 0, total, complete: false }; }
  let downloaded = 0;
  for (const f of model.files) {
    for (let i = 0; i < chunkCount(f.size); i++) {
      const want = chunkSize(f.size, i);
      if (await existingSize(dir, partName(f.name, i)) === want) downloaded += want;
    }
  }
  return { downloaded, total, complete: downloaded === total };
}

/**
 * Download a model, or resume one. Throws an error with code 'busy' when a
 * download is already running (in this tab or another); an AbortError when
 * `signal` aborts — the parts written so far stay.
 * @param {string} value
 * @param {{onProgress?: (downloaded: number, total: number) => void, signal?: AbortSignal}} [opts]
 */
export async function downloadPlamo(value, { onProgress, signal } = {}) {
  const model = getPlamoModel(value);
  const total = plamoModelBytes(model);
  /* Asks the browser not to evict the files under storage pressure. Granted
     or not, the download goes ahead. */
  try { await navigator.storage.persist?.(); } catch { /* ignore */ }

  return navigator.locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
    if (!lock) throw Object.assign(new Error('busy'), { code: 'busy' });
    const dir = await modelDir(model.value, true);

    let downloaded = 0;
    const report = () => onProgress?.(downloaded, total);

    for (const f of model.files) {
      const n = chunkCount(f.size);
      for (let i = 0; i < n; i++) {
        const name = partName(f.name, i);
        const want = chunkSize(f.size, i);
        if (await existingSize(dir, name) === want) { downloaded += want; report(); continue; }

        const start = i * CHUNK;
        const res = await fetch(f.url, {
          headers: n > 1 ? { Range: `bytes=${start}-${start + want - 1}` } : {},
          signal,
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`${f.name}: HTTP ${res.status}`);
        if (n > 1 && res.status !== 206) throw new Error(`${f.name}: server ignored Range`);

        const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
        let got = 0;
        try {
          const reader = res.body.getReader();
          for (;;) {
            const { done, value: buf } = await reader.read();
            if (done) break;
            got += buf.byteLength;
            await writable.write(buf);
            downloaded += buf.byteLength;
            report();
          }
          if (got !== want) throw new Error(`${f.name}: expected ${want} bytes, got ${got}`);
          await writable.close();
        } catch (e) {
          downloaded -= got;
          try { await writable.abort(); } catch { /* ignore */ }
          throw e;
        }
      }
    }
    report();
  });
}

/** Remove every file of a model. Throws code 'busy' while a download runs. */
export async function deletePlamo(value) {
  const model = getPlamoModel(value);
  return navigator.locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
    if (!lock) throw Object.assign(new Error('busy'), { code: 'busy' });
    try {
      const base = await (await navigator.storage.getDirectory()).getDirectoryHandle(ROOT_DIR);
      await base.removeEntry(model.value, { recursive: true });
    } catch (e) {
      if (e?.name !== 'NotFoundError') throw e;
    }
  });
}

/** One file of a model, its parts joined back into a Blob. Throws on a missing part. */
export async function readPlamoFile(value, fileName) {
  const model = getPlamoModel(value);
  const f = model.files.find(x => x.name === fileName);
  if (!f) throw new Error(`unknown file ${fileName}`);
  const dir = await modelDir(model.value, false);
  const parts = [];
  for (let i = 0; i < chunkCount(f.size); i++) {
    const file = await (await dir.getFileHandle(partName(f.name, i))).getFile();
    if (file.size !== chunkSize(f.size, i)) throw new Error(`${fileName} incomplete`);
    parts.push(file);
  }
  return new Blob(parts);
}
