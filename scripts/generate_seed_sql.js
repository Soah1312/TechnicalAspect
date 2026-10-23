// Generate supabase/seed/seed_questions.sql from questions.seed.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const seedData = JSON.parse(fs.readFileSync(path.join(__dirname, '../questions.seed.json'), 'utf8'));

let sql = `-- Crescendo Fuel Rush: Questions Seed Script
-- Populates the questions table from questions.seed.json
-- Can be re-run safely on event day to reset or update questions.

-- Clean or reset questions if desired (optional)
-- DELETE FROM public.issued_questions;
-- DELETE FROM public.questions;

INSERT INTO public.questions (text, options, correct_index, active) VALUES
`;

const rows = seedData.map((q) => {
  const textEscaped = q.text.replace(/'/g, "''");
  const optionsJson = JSON.stringify(q.options).replace(/'/g, "''");
  const correctIdx = Number(q.correct_index !== undefined ? q.correct_index : q.correctIndex);
  return `  ('${textEscaped}', '${optionsJson}'::jsonb, ${correctIdx}, true)`;
});

sql += rows.join(',\n') + ';\n';

fs.writeFileSync(path.join(__dirname, '../supabase/seed/seed_questions.sql'), sql, 'utf8');
console.log(`Generated supabase/seed/seed_questions.sql with ${seedData.length} questions.`);
