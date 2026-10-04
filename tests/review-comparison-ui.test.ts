import { describe, expect, it } from 'vitest';
import {
  comparisonControlsCSS,
  comparisonControlsScript,
  renderComparisonControls,
  type ComparisonControlsInput,
} from '../src/review/comparison-ui.js';

const onePixelPNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jI9sAAAAASUVORK5CYII=';

function input(overrides: Partial<ComparisonControlsInput> = {}): ComparisonControlsInput {
  return {
    id: 'visual-comparison-123',
    baselinePNG: onePixelPNG,
    candidatePNG: onePixelPNG,
    heatmapPNG: onePixelPNG,
    ...overrides,
  };
}

describe('offline visual comparison controls', () => {
  it('renders side-by-side first with optional overlay opacity and separate existing heatmap views', () => {
    const html = renderComparisonControls(input());
    expect(html).toContain('data-view="side-by-side"');
    expect(html).toContain('<option value="side-by-side" selected>Side by side</option>');
    expect(html).toContain('<option value="overlay">Overlay</option>');
    expect(html).toContain('<option value="heatmap">Heatmap</option>');
    expect(html).toContain('type="range" min="0" max="100" step="1" value="50" disabled');
    expect(html).toContain('Candidate overlay opacity');
    expect(html).toContain('data-gds-comparison-panel="heatmap" hidden');
    expect(html).toContain('does not recalculate metrics, change the verdict, or modify the baseline');

    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['visual-comparison-123', 'visual-comparison-123-mode', 'visual-comparison-123-opacity', 'visual-comparison-123-overlay']);
    expect(comparisonControlsCSS).toContain('.gds-comparison__pair');
    expect(comparisonControlsScript).toContain("opacity.addEventListener('input', update)");
    expect(comparisonControlsScript).toContain("mode.addEventListener('change', update)");
    expect(comparisonControlsScript).not.toMatch(/\b(?:fetch|XMLHttpRequest|setTimeout|setInterval)\b/);
  });

  it('omits heatmap mode when no heatmap counterpart is supplied', () => {
    const html = renderComparisonControls(input({ heatmapPNG: undefined }));
    expect(html).not.toContain('<option value="heatmap">');
    expect(html).not.toContain('data-gds-comparison-panel="heatmap"');
    expect(html).toContain('data-gds-comparison-panel="side-by-side"');
    expect(html).toContain('data-gds-comparison-panel="overlay"');
  });

  it('escapes caller labels and refuses malformed labels, image sources, and unsafe IDs', () => {
    const maliciousLabel = `<img src=x onerror="alert('x')">`;
    const html = renderComparisonControls(input({ baselineLabel: maliciousLabel }));
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;');
    expect(html).not.toContain(maliciousLabel);

    expect(() => renderComparisonControls(input({ baselineLabel: '   ' }))).toThrow('Baseline label');
    expect(() => renderComparisonControls(input({ candidateLabel: 'x'.repeat(161) }))).toThrow('Candidate label');
    expect(() => renderComparisonControls(input({ id: 'bad" autofocus onfocus="alert(1)' }))).toThrow('DOM id');
    expect(() => renderComparisonControls(input({ baselinePNG: 'data:image/png;base64,AAAA' }))).toThrow('PNG bytes');
    expect(() => renderComparisonControls(input({ candidatePNG: 'data:image/png;base64,iVBORw0KGgo" onerror="alert(1)' }))).toThrow('PNG bytes');
    expect(() => renderComparisonControls(input({ heatmapPNG: 'data:text/html;base64,PHNjcmlwdD4=' }))).toThrow('embedded PNG data URL');
  });

  it('refuses missing baseline or candidate evidence instead of rendering a partial comparison', () => {
    expect(() => renderComparisonControls(input({ baselinePNG: '' }))).toThrow('Baseline image');
    const missingCandidate = { id: 'comparison-missing-candidate', baselinePNG: onePixelPNG } as ComparisonControlsInput;
    expect(() => renderComparisonControls(missingCandidate)).toThrow('Candidate image');
  });
});
