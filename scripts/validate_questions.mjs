import fs from 'fs';
import path from 'path';

const VALID_BRANCHES = ['COMPS', 'CSE', 'ECS', 'MECH', 'AIDS', 'ALL'];
const VALID_CORRECT = ['A', 'B', 'C', 'D'];
const BRANCH_MINIMUMS = { 1: 12, 2: 12, 3: 8 };
const GENERAL_MINIMUMS = { 1: 15, 2: 15, 3: 10 };

// Parse CSV with quotes and commas support
export function parseCSV(content) {
  const lines = [];
  let currentLine = [];
  let currentField = '';
  let insideQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentField += '"';
        i++; // skip escaped quote
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      currentLine.push(currentField);
      currentField = '';
    } else if ((char === '\r' || char === '\n') && !insideQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++; // skip LF after CR
      }
      currentLine.push(currentField);
      if (currentLine.some((f) => f.trim().length > 0)) {
        lines.push(currentLine);
      }
      currentLine = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }

  if (currentField || currentLine.length > 0) {
    currentLine.push(currentField);
    if (currentLine.some((f) => f.trim().length > 0)) {
      lines.push(currentLine);
    }
  }

  return lines;
}

export function validateQuestionRows(rows) {
  const errors = [];
  const validQuestions = [];
  const seenTexts = new Map();

  rows.forEach((row, idx) => {
    const lineNum = idx + 2; // header is line 1
    if (row.length < 10) {
      errors.push(`Line ${lineNum}: Expected at least 10 columns, found ${row.length}`);
      return;
    }

    const [
      text,
      optA,
      optB,
      optC,
      optD,
      rawCorrect,
      rawBranches,
      rawYearMin,
      rawYearMax,
      rawDiff,
      explanation = '',
    ] = row.map((s) => s.trim());

    if (!text) errors.push(`Line ${lineNum}: Missing question text`);
    if (!optA || !optB || !optC || !optD) errors.push(`Line ${lineNum}: All 4 options (A-D) are required`);

    const correct = rawCorrect.toUpperCase();
    if (!VALID_CORRECT.includes(correct)) {
      errors.push(`Line ${lineNum}: Invalid correct option '${rawCorrect}'. Expected A, B, C, or D`);
    }

    const branches = rawBranches
      .split('|')
      .map((b) => b.trim().toUpperCase())
      .filter(Boolean);

    if (branches.length === 0) {
      errors.push(`Line ${lineNum}: Missing branches (must specify branches or ALL)`);
    }

    branches.forEach((b) => {
      if (!VALID_BRANCHES.includes(b)) {
        errors.push(`Line ${lineNum}: Unknown branch '${b}'. Valid: ${VALID_BRANCHES.join(', ')}`);
      }
    });

    const yearMin = parseInt(rawYearMin, 10);
    const yearMax = parseInt(rawYearMax, 10);
    if (isNaN(yearMin) || yearMin < 1 || yearMin > 4) {
      errors.push(`Line ${lineNum}: Invalid year_min '${rawYearMin}'. Must be 1-4`);
    }
    if (isNaN(yearMax) || yearMax < 1 || yearMax > 4) {
      errors.push(`Line ${lineNum}: Invalid year_max '${rawYearMax}'. Must be 1-4`);
    }
    if (!isNaN(yearMin) && !isNaN(yearMax) && yearMin > yearMax) {
      errors.push(`Line ${lineNum}: year_min (${yearMin}) > year_max (${yearMax})`);
    }

    // AIDS rule: AIDS-only questions cannot be tagged for years 1-3
    if (branches.length === 1 && branches[0] === 'AIDS' && (yearMin < 4 || yearMax < 4)) {
      errors.push(`Line ${lineNum}: AIDS-only question tagged for years ${yearMin}-${yearMax} (AIDS is 4th year only)`);
    }

    const difficulty = parseInt(rawDiff, 10);
    if (![1, 2, 3].includes(difficulty)) {
      errors.push(`Line ${lineNum}: Invalid difficulty '${rawDiff}'. Must be 1, 2, or 3`);
    }

    // Duplicate text check
    const normalizedText = text.toLowerCase().replace(/\s+/g, ' ');
    if (seenTexts.has(normalizedText)) {
      errors.push(`Line ${lineNum}: Duplicate question text (first seen at Line ${seenTexts.get(normalizedText)})`);
    } else {
      seenTexts.set(normalizedText, lineNum);
    }

    validQuestions.push({
      text,
      options: [optA, optB, optC, optD],
      correctIndex: ['A', 'B', 'C', 'D'].indexOf(correct),
      branches,
      yearMin,
      yearMax,
      difficulty,
      explanation,
    });
  });

  return { errors, validQuestions };
}

export function computeCoverage(questions) {
  const branches = ['COMPS', 'CSE', 'ECS', 'MECH', 'AIDS'];
  const years = [1, 2, 3, 4];
  const branchCoverage = {};

  branches.forEach((b) => {
    branchCoverage[b] = {};
    years.forEach((y) => {
      branchCoverage[b][y] = { 1: 0, 2: 0, 3: 0 };
    });
  });

  const generalCoverage = {
    1: { 1: 0, 2: 0, 3: 0 },
    2: { 1: 0, 2: 0, 3: 0 },
    3: { 1: 0, 2: 0, 3: 0 },
    4: { 1: 0, 2: 0, 3: 0 },
  };

  questions.forEach((q) => {
    const isGeneral = q.branches.includes('ALL');
    const diff = q.difficulty;

    for (let y = q.yearMin; y <= q.yearMax; y++) {
      if (isGeneral) {
        generalCoverage[y][diff]++;
      }
      branches.forEach((b) => {
        if (q.branches.includes(b)) {
          // If AIDS, only count for year 4
          if (b === 'AIDS' && y !== 4) return;
          branchCoverage[b][y][diff]++;
        }
      });
    }
  });

  return { branchCoverage, generalCoverage };
}

function runCLI() {
  const defaultPath = path.resolve(process.cwd(), 'questions', 'crescendo-questions.csv');
  const targetPath = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : defaultPath;

  console.log(`\n======================================================`);
  console.log(`CRESCENDO FUEL RUSH - QUESTION CSV VALIDATOR`);
  console.log(`Target: ${targetPath}`);
  console.log(`======================================================\n`);

  if (!fs.existsSync(targetPath)) {
    console.error(`ERROR: Question CSV file not found at: ${targetPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(targetPath, 'utf-8');
  const allRows = parseCSV(raw);

  if (allRows.length === 0) {
    console.error('ERROR: CSV file is empty.');
    process.exit(1);
  }

  const [header, ...dataRows] = allRows;
  console.log(`Parsed ${dataRows.length} question rows.\n`);

  const { errors, validQuestions } = validateQuestionRows(dataRows);

  if (errors.length > 0) {
    console.error(`[VALIDATION FAILED] ${errors.length} error(s) found:`);
    errors.forEach((err) => console.error(`  ✖ ${err}`));
    console.log('');
  } else {
    console.log(`✔ All ${validQuestions.length} questions passed syntax and constraint validation.\n`);
  }

  // Coverage Matrix
  const { branchCoverage, generalCoverage } = computeCoverage(validQuestions);

  console.log(`--------------------------------------------------------------------------------`);
  console.log(`COVERAGE MATRIX: GENERAL TECH ('ALL') [Req: 15 Easy, 15 Med, 10 Hard]`);
  console.log(`--------------------------------------------------------------------------------`);
  console.log(`Year | Easy (d=1) | Med (d=2) | Hard (d=3) | Status`);
  console.log(`-----+------------+-----------+------------+-------`);
  let allGeneralOk = true;
  for (let y = 1; y <= 4; y++) {
    const c = generalCoverage[y];
    const eOk = c[1] >= GENERAL_MINIMUMS[1];
    const mOk = c[2] >= GENERAL_MINIMUMS[2];
    const hOk = c[3] >= GENERAL_MINIMUMS[3];
    const ok = eOk && mOk && hOk;
    if (!ok) allGeneralOk = false;
    const status = ok ? '✔ OK' : '⚠ SHORT';
    console.log(
      ` ${y}   | ${String(c[1]).padStart(5)}/${GENERAL_MINIMUMS[1]}  | ${String(c[2]).padStart(4)}/${GENERAL_MINIMUMS[2]}  | ${String(c[3]).padStart(5)}/${GENERAL_MINIMUMS[3]}  | ${status}`
    );
  }

  console.log(`\n--------------------------------------------------------------------------------`);
  console.log(`COVERAGE MATRIX: BRANCH SPECIFIC [Req: 12 Easy, 12 Med, 8 Hard]`);
  console.log(`--------------------------------------------------------------------------------`);
  console.log(`Branch | Year | Easy (d=1) | Med (d=2) | Hard (d=3) | Status`);
  console.log(`-------+------+------------+-----------+------------+-------`);

  let allBranchOk = true;
  ['COMPS', 'CSE', 'ECS', 'MECH', 'AIDS'].forEach((b) => {
    const years = b === 'AIDS' ? [4] : [1, 2, 3, 4];
    years.forEach((y) => {
      const c = branchCoverage[b][y];
      const eOk = c[1] >= BRANCH_MINIMUMS[1];
      const mOk = c[2] >= BRANCH_MINIMUMS[2];
      const hOk = c[3] >= BRANCH_MINIMUMS[3];
      const ok = eOk && mOk && hOk;
      if (!ok) allBranchOk = false;
      const status = ok ? '✔ OK' : '⚠ SHORT';
      console.log(
        `${b.padEnd(6)} |  ${y}   | ${String(c[1]).padStart(5)}/${BRANCH_MINIMUMS[1]}  | ${String(c[2]).padStart(4)}/${BRANCH_MINIMUMS[2]}  | ${String(c[3]).padStart(5)}/${BRANCH_MINIMUMS[3]}  | ${status}`
      );
    });
  });

  console.log(`\n======================================================`);
  if (errors.length > 0) {
    console.error(`RESULT: FAILED (${errors.length} format/rule errors)`);
    process.exit(1);
  } else if (!allGeneralOk || !allBranchOk) {
    console.warn(`RESULT: SYNTAX VALID, BUT CELLS ARE BELOW RECOMMENDED MINIMUMS.`);
    console.warn(`Fallback algorithm will gracefully borrow from adjacent difficulties/pools.`);
    process.exit(0);
  } else {
    console.log(`RESULT: FULL COVERAGE ACHIEVED! READY FOR EVENT DAY.`);
    process.exit(0);
  }
}

if (process.argv[1] && process.argv[1].endsWith('validate_questions.mjs')) {
  runCLI();
}
