const descriptorPattern =
  /\s*(?:\((?:tv size|anime size|short ver(?:sion)?\.?|live(?: ver(?:sion)?\.?)?|cover(?: ver(?:sion)?\.?)?|instrumental|inst\.?|karaoke|off[\s-]?vocal|remix|mix|radio edit|remaster(?:ed)?|acoustic|unplugged|demo|from .*?)\)|\[(?:tv size|anime size|short ver(?:sion)?\.?|live(?: ver(?:sion)?\.?)?|cover(?: ver(?:sion)?\.?)?|instrumental|inst\.?|karaoke|off[\s-]?vocal|remix|mix|radio edit|remaster(?:ed)?|acoustic|unplugged|demo)\])\s*/giu;

const trailingDescriptorPattern =
  /\s+-\s+(?:tv size|anime size|short ver(?:sion)?\.?|live(?: ver(?:sion)?\.?)?|cover(?: ver(?:sion)?\.?)?|instrumental|inst\.?|karaoke|off[\s-]?vocal|remix|mix|radio edit|remaster(?:ed)?|acoustic|unplugged|demo)\s*$/iu;

export const normalizeTextForSearch = (value: string | null | undefined): string =>
  (value ?? '')
    .normalize('NFKC')
    .replace(descriptorPattern, ' ')
    .replace(trailingDescriptorPattern, ' ')
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const normalizeTextForIdentity = (value: string | null | undefined): string =>
  (value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const normalizeText = normalizeTextForSearch;
