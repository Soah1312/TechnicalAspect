import fs from 'fs';
import path from 'path';
import { parseCSV, validateQuestionRows } from './validate_questions.mjs';

function escapeSql(str) {
  if (!str) return '';
  return str.replace(/'/g, "''");
}

function generateSeedSql() {
  const defaultPath = path.resolve(process.cwd(), 'public', 'crescendo-questions.csv');
  const targetPath = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : defaultPath;

  if (!fs.existsSync(targetPath)) {
    console.error(`CSV file not found: ${targetPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(targetPath, 'utf-8');
  const rows = parseCSV(raw);
  const [header, ...dataRows] = rows;

  const { errors, validQuestions } = validateQuestionRows(dataRows);
  if (errors.length > 0) {
    console.error(`Cannot generate seed SQL: CSV has ${errors.length} validation errors.`);
    process.exit(1);
  }

  console.log(`Generating seed SQL from ${validQuestions.length} valid questions...`);

  let sql = `-- ============================================================\n`;
  sql += `-- Crescendo Fuel Rush: Question Bank Seed\n`;
  sql += `-- Auto-generated from: ${path.basename(targetPath)}\n`;
  sql += `-- Total Questions: ${validQuestions.length}\n`;
  sql += `-- Safe to re-run at any time (truncates or replaces active pool)\n`;
  sql += `-- ============================================================\n\n`;

  sql += `-- 1. Add columns to questions table if not already present\n`;
  sql += `ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS branches text[] NOT NULL DEFAULT ARRAY['ALL']::text[];\n`;
  sql += `ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS year_min smallint NOT NULL DEFAULT 1;\n`;
  sql += `ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS year_max smallint NOT NULL DEFAULT 4;\n`;
  sql += `ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS difficulty smallint NOT NULL DEFAULT 1;\n`;
  sql += `ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS explanation text;\n\n`;

  sql += `-- 2. Clear old question bank and re-seed\n`;
  sql += `TRUNCATE TABLE public.issued_questions CASCADE;\n`;
  sql += `TRUNCATE TABLE public.questions CASCADE;\n\n`;

  sql += `INSERT INTO public.questions (\n`;
  sql += `  text, options, correct_index, active, branches, year_min, year_max, difficulty, explanation\n`;
  sql += `) VALUES\n`;

  const valueStrings = validQuestions.map((q) => {
    const textEscaped = escapeSql(q.text);
    const optionsJson = JSON.stringify(q.options).replace(/'/g, "''");
    const branchesArray = `ARRAY[${q.branches.map((b) => `'${b}'`).join(',')}]::text[]`;
    const explanationEscaped = escapeSql(q.explanation || '');

    return `  ('${textEscaped}', '${optionsJson}'::jsonb, ${q.correctIndex}, true, ${branchesArray}, ${q.yearMin}, ${q.yearMax}, ${q.difficulty}, '${explanationEscaped}')`;
  });

  sql += valueStrings.join(',\n') + ';\n\n';

  sql += `SELECT\n`;
  sql += `  count(*) as total_seeded_questions,\n`;
  sql += `  count(CASE WHEN 'ALL' = ANY(branches) THEN 1 END) as general_tech_count,\n`;
  sql += `  count(CASE WHEN 'ALL' != ALL(branches) THEN 1 END) as branch_specific_count\n`;
  sql += `FROM public.questions;\n`;

  const outputPath = path.resolve(process.cwd(), 'supabase', 'seed_questions_from_csv.sql');
  fs.writeFileSync(outputPath, sql, 'utf-8');
  console.log(`✔ Successfully generated: ${outputPath}`);
}

generateSeedSql();
