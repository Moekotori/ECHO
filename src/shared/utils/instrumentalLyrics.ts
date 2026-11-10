const instrumentalPlaceholderPatterns = [
  /\u6b64\u6b4c\u66f2\u4e3a\u6ca1\u6709\u586b\u8bcd\u7684\u7eaf\u97f3\u4e50/u,
  /\u6b64\u6b4c\u66f2\u4e3a\u7eaf\u97f3\u4e50/u,
  /\u7eaf\u97f3\u4e50[\s,，。.!！?？]*\u8bf7(?:\u60a8)?\u6b23\u8d4f/u,
  /\u7d14\u97f3\u6a02[\s,，。.!！?？]*\u8acb(?:\u60a8)?\u6b23\u8cde/u,
  /\binstrumental\s+track\b/iu,
  /^(?:\u7eaf\u97f3\u4e50|\u7d14\u97f3\u6a02|\u7d14\u97f3\u697d|instrumental(?:track|version)?|inst)$/iu,
];

const normalizeInstrumentalPlaceholderLine = (value: string): string =>
  value
    .replace(/\s+/g, ' ')
    .replace(/[，。,.!！?？:：;；"“”'‘’()[\]{}<>]/g, '')
    .trim()
    .toLowerCase();

export const isInstrumentalPlaceholderLine = (value: string | null | undefined): boolean => {
  if (!value) {
    return false;
  }

  const normalized = normalizeInstrumentalPlaceholderLine(value);
  return normalized.length > 0 && instrumentalPlaceholderPatterns.some((pattern) => pattern.test(normalized));
};
