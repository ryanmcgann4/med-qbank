import { writeFileSync } from 'node:fs';
import { buildJsonSchema } from '../src/schema';

writeFileSync(new URL('../public/qbank-schema.json', import.meta.url), JSON.stringify(buildJsonSchema(), null, 2) + '\n');
console.log('wrote public/qbank-schema.json');
