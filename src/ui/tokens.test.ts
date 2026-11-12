import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Colour tokens meet WCAG AA in both themes (NFR-7, task 9.4): 4.5:1 for text, 3:1 for
 * control edges and focus rings.
 */
const css = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8');

/** `--name: #hex` pairs of the first block whose selector matches. */
function block(selector: RegExp): Record<string, string> {
  const m = selector.exec(css);
  if (!m) throw new Error(`no block ${selector}`);
  const body = css.slice(m.index + m[0].length, css.indexOf('}', m.index + m[0].length));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((x) => [x[1]!, x[2]!]));
}

const light = block(/^:root \{/m);
const darkMedia = block(/:root:not\(\[data-theme='light'\]\) \{/);
const darkExplicit = block(/:root\[data-theme='dark'\] \{/);
const dark = { ...light, ...darkExplicit };

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

const TEXT = ['ink', 'ink-muted', 'margin', 'accent', 'error', 'warning'];
const EDGES = ['control-border', 'focus'];
const BACKGROUNDS = ['paper', 'paper-raised'];

describe.each([
  ['light', light],
  ['dark', dark],
])('%s theme', (_name, t) => {
  it.each(TEXT.flatMap((fg) => BACKGROUNDS.map((bg) => [fg, bg])))('text --%s on --%s ≥ 4.5', (fg, bg) => {
    expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
  });
  it.each(EDGES.flatMap((fg) => BACKGROUNDS.map((bg) => [fg, bg])))('--%s on --%s ≥ 3', (fg, bg) => {
    expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(3);
  });
  it('button text on --accent ≥ 4.5', () => {
    expect(contrast(t['accent-ink']!, t.accent!)).toBeGreaterThanOrEqual(4.5);
  });
});

it('the two dark blocks (system and chosen) define the same colours', () => {
  expect(darkMedia).toEqual(darkExplicit);
  // Every colour the light theme sets is overridden for dark.
  expect(Object.keys(darkExplicit).sort()).toEqual(Object.keys(light).sort());
});
