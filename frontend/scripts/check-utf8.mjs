import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { TextDecoder } from 'node:util';

const decoder = new TextDecoder('utf-8', { fatal: true });
const allowedExt = /\.(ts|tsx|js|jsx|css|json|py|sql|md|html|jsonl)$/i;

function listFiles() {
  const output = execSync('git ls-files frontend/src backend/app', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    cwd: process.cwd().endsWith('frontend') ? '..' : process.cwd(),
  });
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((path) => allowedExt.test(path));
}

function main() {
  const baseCwd = process.cwd().endsWith('frontend') ? '..' : process.cwd();
  const badEncoding = [];
  const replacementChar = [];

  for (const relativePath of listFiles()) {
    const absolutePath = `${baseCwd}/${relativePath}`;
    let decoded = '';
    try {
      const buffer = readFileSync(absolutePath);
      decoded = decoder.decode(buffer);
    } catch {
      badEncoding.push(relativePath);
      continue;
    }
    if (decoded.includes('\uFFFD')) {
      replacementChar.push(relativePath);
    }
  }

  if (badEncoding.length || replacementChar.length) {
    if (badEncoding.length) {
      console.error('Invalid UTF-8 encoding detected:');
      for (const file of badEncoding) console.error(`- ${file}`);
    }
    if (replacementChar.length) {
      console.error('Replacement character (\\uFFFD) detected:');
      for (const file of replacementChar) console.error(`- ${file}`);
    }
    process.exit(1);
  }

  console.log('UTF-8 check passed.');
}

main();
