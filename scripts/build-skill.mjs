// Packages claude-skill/qbank-generator into public/qbank-skill.zip for the Add page.
// The skill ships the same JSON Schema the app validates against.
import { execFileSync } from 'node:child_process';
import { copyFileSync, rmSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
copyFileSync(`${root}public/qbank-schema.json`, `${root}claude-skill/qbank-generator/reference/qbank-schema.json`);
rmSync(`${root}public/qbank-skill.zip`, { force: true });
execFileSync('zip', ['-qrX', `${root}public/qbank-skill.zip`, 'qbank-generator', '-x', '*.DS_Store', '*__pycache__*'], { cwd: `${root}claude-skill` });
console.log('wrote public/qbank-skill.zip');
