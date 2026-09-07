const REQUIRED = [
  "#",
  "Question",
  "Hint",
  "Option A",
  "Option B",
  "Option C",
  "Option D",
  "Correct Answer",
  "Rationale",
];

function parseCsvLine(line) {
  const cells = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      cells.push(value);
      value = "";
    } else value += ch;
  }
  if (quoted) throw new Error("CSV contains an unclosed quote.");
  cells.push(value);
  return cells;
}

function parseCsv(text) {
  const normalized = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const lines = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === '"') {
      if (quoted && normalized[i + 1] === '"') {
        current += '""';
        i++;
      } else {
        quoted = !quoted;
        current += ch;
      }
    } else if (ch === "\n" && !quoted) {
      if (current.trim()) lines.push(current);
      current = "";
    } else current += ch;
  }
  if (quoted) throw new Error("CSV contains an unclosed quote.");
  if (current.trim()) lines.push(current);
  if (!lines.length) throw new Error("CSV is empty.");
  return lines.map(parseCsvLine);
}

function clean(value) {
  return String(value ?? "").trim();
}

export function parseQuizCsv(text) {
  const rows = parseCsv(text);
  const header = rows[0].map(clean);
  const missing = REQUIRED.filter((h, i) => header[i] !== h);
  if (missing.length)
    throw new Error(`Invalid header. Expected exactly: ${REQUIRED.join(",")}`);
  const questions = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.every((cell) => !clean(cell))) continue;
    if (row.length < REQUIRED.length)
      throw new Error(`Row ${r + 1} has too few columns.`);
    const correctAnswerRaw = clean(row[7]);
    const match = correctAnswerRaw.match(/^([ABCD])\.\s*(.+)$/i);
    if (!match)
      throw new Error(
        `Row ${r + 1}: Correct Answer must be in the format \"B. Paris\" (A-D followed by a period and the answer text).`,
      );
    const answerLetter = match[1].toUpperCase();
    const answerText = clean(match[2]);
    const options = {
      A: clean(row[3]),
      B: clean(row[4]),
      C: clean(row[5]),
      D: clean(row[6]),
    };
    if (answerText !== options[answerLetter]) {
      throw new Error(
        `Row ${r + 1}: Correct Answer \"${correctAnswerRaw}\" does not match Option ${answerLetter} \"${options[answerLetter]}\".`,
      );
    }
    questions.push({
      number: clean(row[0]) || String(questions.length + 1),
      question: clean(row[1]),
      hint: clean(row[2]),
      options,
      correctAnswer: answerLetter,
      rationale: clean(row[8]),
    });
  }
  return {
    title: questions[0]?.question ? "NotebookLM Quiz" : "Quiz",
    questions,
  };
}

export function validateQuiz(quiz) {
  if (!quiz.questions.length) throw new Error("The CSV contains no questions.");
  if (quiz.questions.length > 500)
    throw new Error("Maximum 500 questions per quiz.");
  quiz.questions.forEach((q, i) => {
    const n = i + 1;
    if (!q.question) throw new Error(`Question ${n}: Question is empty.`);
    if (!q.hint) throw new Error(`Question ${n}: Hint is empty.`);
    if (!q.rationale) throw new Error(`Question ${n}: Rationale is empty.`);
    for (const key of ["A", "B", "C", "D"])
      if (!q.options[key])
        throw new Error(`Question ${n}: Option ${key} is empty.`);
    if (!["A", "B", "C", "D"].includes(q.correctAnswer))
      throw new Error(`Question ${n}: Correct Answer must be A, B, C, or D.`);
  });
}
