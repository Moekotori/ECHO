export const parseFilterYearDraft = (draft: string): number | null | undefined => {
  const trimmed = draft.normalize('NFKC').trim();
  if (!trimmed) {
    return null;
  }

  if (!/^\d{4}$/u.test(trimmed)) {
    return undefined;
  }

  const year = Number(trimmed);
  return year >= 1000 && year <= 2100 ? year : undefined;
};
