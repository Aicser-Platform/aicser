import { describe, expect, it } from 'vitest';
import { formForStep } from '../StepForm';
import { stepSentence } from '../stepText';

const t = (key: string, values?: Record<string, string | number>) => `${key}${values ? JSON.stringify(values) : ''}`;

describe('prediction and AI answer steps', () => {
  it('open their own forms when edited', () => {
    expect(formForStep({ predict: { model_id: 'm1' } })).toBe('predict');
    expect(formForStep({ ai_answer: { decision_id: 'd1', columns: ['note'] } })).toBe('ai_answer');
  });

  it('read as a sentence in the step list', () => {
    expect(stepSentence({ predict: { model_id: 'm1', into: 'churn_risk' } }, t)).toBe('s_predict{"name":"churn_risk"}');
    expect(stepSentence({ ai_answer: { decision_id: 'd1', columns: ['note', 'subject'] } }, t)).toBe('s_ai_answer{"columns":"note, subject"}');
  });
});
