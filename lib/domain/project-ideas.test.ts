import { describe, expect, it } from 'vitest';
import { validateProjectIdeaInput } from './project-ideas';

describe('LUUFI-3 Projektideen-Eingabe', () => {
  it.each([
    null,
    [],
    'Idee',
    {},
    { text: 2 },
    { text: ' ' },
    { text: 'Idee', detail: 7 },
    { text: 'x'.repeat(281) },
    { text: 'Idee', detail: 'x'.repeat(4001) },
  ])('weist ungültige Eingaben zurück: %j', (input) => {
    expect(validateProjectIdeaInput(input)).toMatchObject({
      ok: false,
      error: expect.any(String),
    });
  });
  it('normalisiert neue Inhalte und akzeptiert beide Grenzen', () => {
    expect(validateProjectIdeaInput({ text: '  Idee  ' })).toEqual({
      ok: true,
      value: { text: 'Idee', detail: '' },
    });
    expect(
      validateProjectIdeaInput({
        text: 'x'.repeat(280),
        detail: 'd'.repeat(4000),
      }),
    ).toMatchObject({ ok: true });
    expect(
      validateProjectIdeaInput({ text: ' Idee ', detail: ' Detail ' }),
    ).toEqual({ ok: true, value: { text: 'Idee', detail: 'Detail' } });
  });
});
