import assert from 'node:assert/strict';
import { parseQuizCsv, validateQuiz } from '../src/quiz.js';

const header = `"#","Question","Hint","Option A","Option B","Option C","Option D","Correct Answer","Rationale"`;

{
  const csv = `${header}\n"1","What is 2 + 2?","Add the two numbers.","3","4","5","6","B. 4","Two plus two is four."`;
  const quiz = parseQuizCsv(csv);
  assert.equal(quiz.questions.length, 1);
  assert.equal(quiz.questions[0].correctAnswer, 'B');
  assert.equal(quiz.questions[0].options.B, '4');
  validateQuiz(quiz);
}

assert.throws(
  () => validateQuiz({ questions: [{ question: 'Q', hint: '', rationale: 'R', options: { A: 'a', B: 'b', C: 'c', D: 'd' }, correctAnswer: 'A' }] }),
  /Hint is empty/
);

assert.throws(
  () => parseQuizCsv(`${header}\n"1","Capital of France?","Think Europe","London","Paris","Berlin","Rome","B. London","Paris is the capital of France."`),
  /does not match Option B/
);

assert.throws(
  () => parseQuizCsv(`${header}\n"1","Capital of France?","Think Europe","London","Paris","Berlin","Rome","B","Paris is the capital of France."`),
  /must be in the format/
);

console.log('quiz parser tests passed');
