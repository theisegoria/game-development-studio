/**
 * Portable controls for inspecting already-verified visual comparison images.
 * This module only renders a static fragment; it does not load evidence or
 * recalculate, approve, or otherwise change a comparison.
 */

export interface ComparisonControlsInput {
  /** Must be unique within the containing HTML document. */
  id: string;
  baselinePNG: string;
  candidatePNG: string;
  heatmapPNG?: string;
  baselineLabel?: string;
  candidateLabel?: string;
  heatmapLabel?: string;
}

const idPattern = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const pngSignatureBase64 = 'iVBORw0KGgo';

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function escapeHTML(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function requirePNGDataURL(value: string, name: string): string {
  const prefix = 'data:image/png;base64,';
  invariant(typeof value === 'string' && value.startsWith(prefix), `${name} must be an embedded PNG data URL`);
  const payload = value.slice(prefix.length);
  invariant(payload.length > 0 && payload.length % 4 === 0 && base64Pattern.test(payload)
    && payload.startsWith(pngSignatureBase64), `${name} must contain canonical base64 PNG bytes`);
  return value;
}

function labelOrDefault(value: string | undefined, fallback: string, name: string): string {
  if (value === undefined) return fallback;
  invariant(typeof value === 'string' && value.trim().length > 0 && value.length <= 160,
    `${name} must be a non-empty label of at most 160 characters`);
  return value;
}

/**
 * Static stylesheet to include once in the containing offline dashboard.
 * The layout stacks naturally on narrow windows and keeps images contained.
 */
export const comparisonControlsCSS = `
.gds-comparison{border:1px solid #40536c;border-radius:8px;padding:1rem;margin:1rem 0;color:inherit}
.gds-comparison__controls{display:flex;flex-wrap:wrap;align-items:center;gap:.6rem 1rem;margin-bottom:1rem}
.gds-comparison__controls label{font-weight:600}
.gds-comparison__controls select,.gds-comparison__controls input[type=range]{min-height:2.5rem}
.gds-comparison__controls input[type=range]{min-width:12rem;accent-color:#91caff}
.gds-comparison :focus-visible{outline:3px solid #91caff;outline-offset:3px}
.gds-comparison__pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem;align-items:start}
.gds-comparison figure{min-width:0;margin:0}
.gds-comparison img{display:block;width:100%;height:auto;max-height:75vh;object-fit:contain;background:#0d1420}
.gds-comparison figcaption{margin-top:.5rem;overflow-wrap:anywhere}
.gds-comparison__overlay{position:relative;max-width:100%;width:max-content;margin:0 auto;background:#0d1420}
.gds-comparison__overlay img{max-height:75vh}
.gds-comparison__overlay-candidate{position:absolute;inset:0;width:100%!important;height:100%!important;opacity:var(--gds-comparison-opacity,.5);object-fit:contain}
.gds-comparison__note{color:#aebed4;font-size:.9rem;margin:.8rem 0 0}
.gds-comparison [hidden]{display:none!important}
@media(max-width:640px){.gds-comparison__pair{grid-template-columns:minmax(0,1fr)}}
`;

/** Static, offline-only behavior shared by all rendered comparison controls. */
export const comparisonControlsScript = `
for (const root of document.querySelectorAll('[data-gds-comparison]')) {
  const mode = root.querySelector('[data-gds-comparison-mode]');
  const opacity = root.querySelector('[data-gds-comparison-opacity]');
  if (!mode || !opacity) continue;
  const panels = root.querySelectorAll('[data-gds-comparison-panel]');
  const panelModes = new Set(Array.from(panels, panel => panel.dataset.gdsComparisonPanel));
  const update = () => {
    if (!panelModes.has(mode.value)) mode.value = 'side-by-side';
    root.dataset.view = mode.value;
    for (const panel of panels) panel.hidden = panel.dataset.gdsComparisonPanel !== mode.value;
    opacity.disabled = mode.value !== 'overlay';
    const parsed = Number(opacity.value);
    const percent = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 50;
    opacity.value = String(percent);
    opacity.setAttribute('aria-valuetext', String(Math.round(percent)) + ' percent');
    root.style.setProperty('--gds-comparison-opacity', String(percent / 100));
  };
  mode.addEventListener('change', update);
  opacity.addEventListener('input', update);
  update();
}
`;

/** Render a side-by-side-first fragment over sealed, verified PNG data URLs. */
export function renderComparisonControls(input: ComparisonControlsInput): string {
  invariant(typeof input.id === 'string' && idPattern.test(input.id),
    'Comparison DOM id must start with a letter and contain only letters, numbers, underscores or hyphens (up to 64 characters)');
  const baselinePNG = requirePNGDataURL(input.baselinePNG, 'Baseline image');
  const candidatePNG = requirePNGDataURL(input.candidatePNG, 'Candidate image');
  const heatmapPNG = input.heatmapPNG === undefined ? undefined : requirePNGDataURL(input.heatmapPNG, 'Heatmap image');
  const baselineLabel = labelOrDefault(input.baselineLabel, 'Baseline', 'Baseline label');
  const candidateLabel = labelOrDefault(input.candidateLabel, 'Candidate', 'Candidate label');
  const heatmapLabel = labelOrDefault(input.heatmapLabel, 'Heatmap', 'Heatmap label');
  const id = escapeHTML(input.id);
  const baselineSrc = escapeHTML(baselinePNG);
  const candidateSrc = escapeHTML(candidatePNG);
  const heatmapOption = heatmapPNG ? '<option value="heatmap">Heatmap</option>' : '';
  const heatmapPanel = heatmapPNG
    ? `<figure data-gds-comparison-panel="heatmap" hidden><img src="${escapeHTML(heatmapPNG)}" alt="${escapeHTML(heatmapLabel)}"><figcaption>${escapeHTML(heatmapLabel)} · existing comparison evidence</figcaption></figure>`
    : '';

  return `<section id="${id}" class="gds-comparison" data-gds-comparison data-view="side-by-side" aria-label="Visual comparison evidence">
  <div class="gds-comparison__controls">
    <label for="${id}-mode">View</label>
    <select id="${id}-mode" data-gds-comparison-mode aria-label="Comparison view">
      <option value="side-by-side" selected>Side by side</option><option value="overlay">Overlay</option>${heatmapOption}
    </select>
    <label for="${id}-opacity">Candidate overlay opacity</label>
    <input id="${id}-opacity" data-gds-comparison-opacity type="range" min="0" max="100" step="1" value="50" disabled aria-valuetext="50 percent" aria-controls="${id}-overlay">
  </div>
  <p class="gds-comparison__note">These views inspect the same sealed images. Changing the view does not recalculate metrics, change the verdict, or modify the baseline.</p>
  <div class="gds-comparison__pair" data-gds-comparison-panel="side-by-side">
    <figure><img src="${baselineSrc}" alt="${escapeHTML(baselineLabel)}"><figcaption>${escapeHTML(baselineLabel)}</figcaption></figure>
    <figure><img src="${candidateSrc}" alt="${escapeHTML(candidateLabel)}"><figcaption>${escapeHTML(candidateLabel)}</figcaption></figure>
  </div>
  <figure data-gds-comparison-panel="overlay" hidden>
    <div id="${id}-overlay" class="gds-comparison__overlay" role="img" aria-label="${escapeHTML(`${baselineLabel} with ${candidateLabel} overlaid`)}">
      <img src="${baselineSrc}" alt="" aria-hidden="true">
      <img class="gds-comparison__overlay-candidate" src="${candidateSrc}" alt="" aria-hidden="true">
    </div>
    <figcaption>${escapeHTML(`${baselineLabel} with ${candidateLabel} overlaid; adjust the opacity slider.`)}</figcaption>
  </figure>
  ${heatmapPanel}
</section>`;
}
