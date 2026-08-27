import assert from 'node:assert/strict';
import { parseQuizCsv, validateQuiz } from '../src/quiz.js';

function expectError(label, csv, message) {
  assert.throws(() => {
    const quiz = parseQuizCsv(csv);
    validateQuiz(quiz);
  }, new RegExp(message));
  console.log(`ok: ${label}`);
}

const header = '"#","Question","Hint","Option A","Option B","Option C","Option D","Correct Answer","Rationale"';
const row = (values) => values.map(v => `"${String(v).replaceAll('"', '""')}"`).join(',');
const good = row(['1', 'Question', 'Hint', 'A', 'B', 'C', 'D', 'C. C', 'Reason']);

{
  const quiz = parseQuizCsv(`\uFEFF${header}\n${good}\r\n`);
  validateQuiz(quiz);
  assert.equal(quiz.questions[0].question, 'Question');
}

{
  const quiz = parseQuizCsv(`${header}\n${row(['1', 'A, B?', 'Use the comma.', 'A', 'B', 'C', 'D', 'A. A', 'Because'])}`);
  validateQuiz(quiz);
  assert.equal(quiz.questions[0].question, 'A, B?');
}

{
  const quiz = parseQuizCsv(`${header}\n${row(['1', 'A "quoted" question', 'Hint', 'A', 'B', 'C', 'D', 'A. A', 'A "reason"'])}`);
  validateQuiz(quiz);
  assert.equal(quiz.questions[0].question, 'A "quoted" question');
}

expectError('empty CSV', '', 'CSV is empty');
expectError('bad header', 'Question,Answer', 'Invalid header');
expectError('missing question', `${header}\n${row(['1', '', 'Hint', 'A', 'B', 'C', 'D', 'A. A', 'Reason'])}`, 'Question is empty');
expectError('missing hint', `${header}\n${row(['1', 'Q', '', 'A', 'B', 'C', 'D', 'A. A', 'Reason'])}`, 'Hint is empty');
expectError('missing rationale', `${header}\n${row(['1', 'Q', 'H', 'A', 'B', 'C', 'D', 'A. A', ''])}`, 'Rationale is empty');
expectError('missing option A', `${header}\n${row(['1', 'Q', 'H', '', 'B', 'C', 'D', 'B. B', 'R'])}`, 'Option A is empty');
expectError('missing option B', `${header}\n${row(['1', 'Q', 'H', 'A', '', 'C', 'D', 'A. A', 'R'])}`, 'Option B is empty');
expectError('missing option C', `${header}\n${row(['1', 'Q', 'H', 'A', 'B', '', 'D', 'A. A', 'R'])}`, 'Option C is empty');
expectError('missing option D', `${header}\n${row(['1', 'Q', 'H', 'A', 'B', 'C', '', 'A. A', 'R'])}`, 'Option D is empty');
expectError('bad answer', `${header}\n${row(['1', 'Q', 'H', 'A', 'B', 'C', 'D', 'E. E', 'R'])}`, 'must be in the format');

{
  const rows = Array.from({ length: 20 }, (_, i) => row([String(i + 1), `Q${i}`, 'H', 'A', 'B', 'C', 'D', 'A. A', 'R']));
  const quiz = parseQuizCsv([header, ...rows].join('\n'));
  validateQuiz(quiz);
  assert.equal(quiz.questions.length, 20);
  assert.equal(quiz.questions[19].number, '20');
}

{
  const quiz = parseQuizCsv([header, good, '', '   '].join('\n'));
  validateQuiz(quiz);
  assert.equal(quiz.questions.length, 1);
}

console.log('edge cases passed');
