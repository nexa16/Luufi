export const projectIdeaTextLimit = 280;
export const projectIdeaDetailLimit = 4_000;

export type ProjectIdea = {
  id: string;
  text: string;
  detail: string;
  createdAt: string;
  revision: number;
};

export type ProjectIdeaInput = Pick<ProjectIdea, 'text' | 'detail'>;
export type ProjectIdeaPage = {
  items: ProjectIdea[];
  nextCursor: string | null;
};
export type ProjectIdeaInputResult =
  | { ok: true; value: ProjectIdeaInput }
  | { ok: false; error: string };

export function validateProjectIdeaInput(
  input: unknown,
): ProjectIdeaInputResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Bitte gib eine Projektidee ein.' };
  }
  const candidate = input as { text?: unknown; detail?: unknown };
  if (typeof candidate.text !== 'string' || !candidate.text.trim()) {
    return { ok: false, error: 'Bitte gib eine Projektidee ein.' };
  }
  if (candidate.detail !== undefined && typeof candidate.detail !== 'string') {
    return { ok: false, error: 'Die Beschreibung muss ein Text sein.' };
  }
  const text = candidate.text.trim();
  const detail = (candidate.detail ?? '').trim();
  if (text.length > projectIdeaTextLimit) {
    return {
      ok: false,
      error: 'Die Projektidee darf höchstens 280 Zeichen enthalten.',
    };
  }
  if (detail.length > projectIdeaDetailLimit) {
    return {
      ok: false,
      error: 'Die Beschreibung darf höchstens 4.000 Zeichen enthalten.',
    };
  }
  return { ok: true, value: { text, detail } };
}
