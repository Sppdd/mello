import { GeneratedChallenge, isPassing, type ChallengeResult } from '@mello/shared';
import { llm, MODEL } from './llm.ts';

const SYSTEM = `You write short reading-comprehension checks for children.
Given a passage the child just read, write 3 multiple-choice questions that can only be answered by someone who read it.
Rules:
- Ask about events, characters and details in the passage, never about outside knowledge.
- Use simple words suited to the child's age. Keep each question under 20 words.
- Exactly 4 choices per question; exactly one is correct; wrong choices must be plausible but clearly wrong to a reader.
- Vary the position of the correct answer.
Reply with JSON only, in this shape:
{"questions":[{"question":"...","choices":["...","...","...","..."],"answerIndex":0}]}`;

const MAX_PASSAGE_CHARS = 6000;

export async function generateChallenge(passage: string, age: number | null): Promise<GeneratedChallenge> {
  const user = `Child's age: ${age ?? 'about 9'}\n\nPassage:\n"""\n${passage.slice(-MAX_PASSAGE_CHARS)}\n"""`;
  let lastError: unknown;
  // Models occasionally return malformed JSON; one retry fixes almost all of it.
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await llm().chat.completions.create({
      model: MODEL,
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: user },
      ],
    });
    try {
      return GeneratedChallenge.parse(JSON.parse(extractJson(res.choices[0]?.message?.content ?? '')));
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`Model returned an invalid challenge: ${String(lastError)}`);
}

/** Strips ```json fences some models add even in JSON mode. */
export function extractJson(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

export function grade(challenge: GeneratedChallenge, answers: number[]): ChallengeResult {
  const correctAnswers = challenge.questions.map((q) => q.answerIndex);
  const correct = correctAnswers.filter((a, i) => answers[i] === a).length;
  return { passed: isPassing(correct, correctAnswers.length), correct, total: correctAnswers.length, correctAnswers };
}
