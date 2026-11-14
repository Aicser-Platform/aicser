import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(__dirname, '../messages');
const load = (file: string) => JSON.parse(readFileSync(join(dir, file), 'utf8'));

function flatten(value: Record<string, unknown>, prefix = ''): Record<string, string> {
  return Object.entries(value).reduce<Record<string, string>>((out, [key, item]) => {
    if (item && typeof item === 'object') Object.assign(out, flatten(item as Record<string, unknown>, `${prefix}${key}.`));
    else out[`${prefix}${key}`] = String(item);
    return out;
  }, {});
}

/** Values a message reads. Braces alternate: a value, then the text of its plural or select branch. */
function args(text: string): Set<string> {
  const names = new Set<string>();
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '{') {
      const name = depth % 2 === 0 ? /^\{\s*(\w+)\s*[,}]/.exec(text.slice(i))?.[1] : undefined;
      if (name) names.add(name);
      depth += 1;
    } else if (text[i] === '}') {
      depth = Math.max(0, depth - 1);
    }
  }
  return names;
}

describe('translated messages', () => {
  const english = flatten(load('en.json'));
  const locales = readdirSync(dir).filter((file) => file.endsWith('.json') && file !== 'en.json');

  it.each(locales)('%s only uses the values the app passes, and uses them all', (file) => {
    const translated = flatten(load(file));
    const wrong = Object.keys(english).filter((key) => {
      if (!(key in translated)) return false;
      const want = args(english[key]);
      const got = args(translated[key]);
      return [...got].some((name) => !want.has(name)) || [...want].some((name) => !got.has(name));
    });
    expect(wrong).toEqual([]);
  });
});
