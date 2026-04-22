/**
 * Keep ui/src/lib/utils/book-names-by-language.json in sync with src/data/book-names-by-language.json
 * and verify each non-comment language has 66 books.
 *
 * Run: node scripts/generate-book-names-by-language.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const canonical = path.join(root, 'src/data/book-names-by-language.json');
const uiCopy = path.join(root, 'ui/src/lib/utils/book-names-by-language.json');

function main() {
  const data = JSON.parse(fs.readFileSync(canonical, 'utf8'));
  for (const [lang, table] of Object.entries(data)) {
    if (lang === '_comment') continue;
    const n = Object.keys(table).length;
    if (n !== 66) {
      throw new Error(`Language "${lang}" has ${n} entries, expected 66`);
    }
  }
  fs.mkdirSync(path.dirname(uiCopy), { recursive: true });
  fs.writeFileSync(uiCopy, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log('OK: validated 66 books per language; synced', uiCopy);
}

main();
