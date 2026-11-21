/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';

const TOKENS_PATH = 'src/styles/tokens.scss';

interface FileSystemModule {
  readFileSync(path: string | URL, encoding: 'utf8'): string;
}

interface NodeProcess {
  cwd(): string;
  getBuiltinModule?: (id: string) => unknown;
}

function isFileSystemModule(value: unknown): value is FileSystemModule {
  return (
    typeof value === 'object' &&
    value !== null &&
    'readFileSync' in value &&
    typeof value.readFileSync === 'function'
  );
}

function loadTokensSource(): string {
  const nodeProcess = (globalThis as typeof globalThis & { process?: NodeProcess }).process;
  if (!nodeProcess) {
    throw new Error('This test needs a Node runtime to read src/styles/tokens.scss');
  }
  const fs = nodeProcess.getBuiltinModule?.('fs');
  if (!isFileSystemModule(fs)) {
    throw new Error('This test needs Node\'s fs module to read src/styles/tokens.scss');
  }
  return fs.readFileSync(`${nodeProcess.cwd()}/src/styles/tokens.scss`, 'utf8');
}

const TOKENS_SOURCE = loadTokensSource();

type ThemeName = 'dark' | 'light';

const THEMES: readonly ThemeName[] = ['dark', 'light'];

const TEXT_TOKENS = ['--text', '--text2', '--link', '--accent-ink'] as const;
const RARITY_TOKENS = [
  '--tier-exotic',
  '--tier-legendary',
  '--tier-rare',
  '--tier-uncommon',
  '--tier-common',
] as const;
const SURFACES = ['--page', '--col', '--raised', '--chrome'] as const;
const RARITY_SURFACES = ['--page', '--col'] as const;
const EDGE_TOKENS = ['--ctl-edge', '--fld-edge'] as const;
const EDGE_SURFACES = ['--page', '--chrome', '--raised'] as const;

const AUDITED_TOKENS: readonly string[] = [
  ...TEXT_TOKENS,
  ...RARITY_TOKENS,
  ...SURFACES,
  ...EDGE_TOKENS,
  ...EDGE_SURFACES,
  '--stasis-text',
  '--stasis',
  '--warn',
  '--warn-bg',
  '--danger',
  '--alert-bg',
  '--on-accent',
  '--accent',
];

interface ContrastRequirement {
  foreground: string;
  background: string;
  minimum: number;
}

interface ContrastFailure extends ContrastRequirement {
  foregroundHex: string;
  backgroundHex: string;
  ratio: number;
}

function extractMixinBody(source: string, mixinName: string): string {
  const marker = `@mixin ${mixinName}`;
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error(`Could not find ${marker} in ${TOKENS_PATH}`);
  }

  const openIndex = source.indexOf('{', markerIndex);
  if (openIndex < 0) {
    throw new Error(`Could not find the opening brace for ${marker} in ${TOKENS_PATH}`);
  }

  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const character = source.charAt(index);
    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openIndex + 1, index);
      }
    }
  }

  throw new Error(`Unclosed ${marker} block in ${TOKENS_PATH}`);
}

function parseDeclarations(block: string): Map<string, string> {
  const tokens = new Map<string, string>();
  const pattern = /--([a-z0-9-]+)\s*:\s*([^;]+);/gi;

  let match: RegExpExecArray | null = pattern.exec(block);
  while (match !== null) {
    const name = match[1];
    const value = match[2];
    if (name && value) {
      tokens.set(`--${name}`, value.trim());
    }
    match = pattern.exec(block);
  }

  return tokens;
}

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const VAR_REFERENCE = /^var\(--([a-z0-9-]+)\)$/i;

function resolveHex(tokens: Map<string, string>, name: string): string {
  const value = tokens.get(name);
  if (value === undefined) {
    throw new Error(`Missing token ${name} in ${TOKENS_PATH}`);
  }
  if (HEX_COLOR.test(value)) {
    return value;
  }

  const reference = VAR_REFERENCE.exec(value);
  const referencedName = reference?.[1];
  if (referencedName) {
    return resolveHex(tokens, referencedName);
  }

  throw new Error(`Token ${name} is not an opaque hex colour: ${value}`);
}

function parseHex(hex: string): [number, number, number] {
  let value = hex.slice(1);

  if (value.length === 3 || value.length === 4) {
    value = value
      .slice(0, 3)
      .split('')
      .map((character) => character + character)
      .join('');
  }

  if (value.length === 8) {
    value = value.slice(0, 6);
  }

  if (value.length !== 6) {
    throw new Error(`Unsupported hex colour: ${hex}`);
  }

  const numeric = Number.parseInt(value, 16);
  return [(numeric >> 16) & 0xff, (numeric >> 8) & 0xff, numeric & 0xff];
}

function linearize(channel: number): number {
  const srgb = channel / 255;
  return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const [red, green, blue] = parseHex(hex);
  return 0.2126 * linearize(red) + 0.7152 * linearize(green) + 0.0722 * linearize(blue);
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function crossProduct(
  foregrounds: readonly string[],
  backgrounds: readonly string[],
  minimum: number,
): ContrastRequirement[] {
  return foregrounds.flatMap((foreground) =>
    backgrounds.map((background) => ({ foreground, background, minimum })),
  );
}

function statusRequirements(): ContrastRequirement[] {
  return [
    { foreground: '--stasis-text', background: '--stasis', minimum: 4.5 },
    { foreground: '--warn', background: '--warn-bg', minimum: 4.5 },
    { foreground: '--danger', background: '--alert-bg', minimum: 4.5 },
    { foreground: '--on-accent', background: '--accent', minimum: 4.5 },
  ];
}

function assertContrast(
  theme: ThemeName,
  tokens: Map<string, string>,
  category: string,
  requirements: readonly ContrastRequirement[],
): void {
  const failures: ContrastFailure[] = [];

  for (const requirement of requirements) {
    const foregroundHex = resolveHex(tokens, requirement.foreground);
    const backgroundHex = resolveHex(tokens, requirement.background);
    const ratio = contrastRatio(foregroundHex, backgroundHex);

    if (ratio + Number.EPSILON < requirement.minimum) {
      failures.push({ ...requirement, foregroundHex, backgroundHex, ratio });
    }
  }

  const report = [
    `${category} failures in the ${theme} token set:`,
    ...failures.map(
      (failure) =>
        `  ${failure.foreground} (${failure.foregroundHex}) on ${failure.background} (${failure.backgroundHex}): ${failure.ratio.toFixed(2)}:1, needs ${failure.minimum.toFixed(1)}:1`,
    ),
  ].join('\n');

  expect(
    failures.map((failure) => `${failure.foreground} on ${failure.background}`),
    report,
  ).toEqual([]);
}

describe('WCAG AA token contrast', () => {
  for (const theme of THEMES) {
    const tokens = parseDeclarations(extractMixinBody(TOKENS_SOURCE, `${theme}-tokens`));

    describe(`${theme} theme`, () => {
      it('defines every audited token as an opaque hex colour', () => {
        const missing = AUDITED_TOKENS.filter((token) => !tokens.has(token));
        expect(missing, `Missing ${theme} tokens in tokens.scss: ${missing.join(', ')}`).toEqual([]);

        for (const token of AUDITED_TOKENS) {
          expect(() => resolveHex(tokens, token), `${theme} ${token}`).not.toThrow();
        }
      });

      it('keeps text, links, and accent ink at 4.5:1 on every surface', () => {
        assertContrast(
          theme,
          tokens,
          'Text contrast',
          crossProduct(TEXT_TOKENS, SURFACES, 4.5),
        );
      });

      it('keeps rarity tier text at 4.5:1 on page and column surfaces', () => {
        assertContrast(
          theme,
          tokens,
          'Rarity text contrast',
          crossProduct(RARITY_TOKENS, RARITY_SURFACES, 4.5),
        );
      });

      it('keeps control and field edges at 3.0:1 (WCAG 1.4.11)', () => {
        assertContrast(
          theme,
          tokens,
          'Non-text contrast',
          crossProduct(EDGE_TOKENS, EDGE_SURFACES, 3),
        );
      });

      it('keeps status and accent text at 4.5:1', () => {
        assertContrast(theme, tokens, 'Status contrast', statusRequirements());
      });
    });
  }
});
