declare module 'kuroshiro' {
  type KuroshiroConvertOptions = {
    to: 'hiragana' | 'katakana' | 'romaji';
    mode?: 'normal' | 'spaced' | 'okurigana' | 'furigana';
    romajiSystem?: 'nippon' | 'passport' | 'hepburn';
  };

  export default class Kuroshiro {
    init(analyzer: unknown): Promise<void>;
    convert(text: string, options: KuroshiroConvertOptions): Promise<string>;
  }
}

declare module 'kuroshiro-analyzer-kuromoji' {
  export default class KuromojiAnalyzer {
    constructor(options?: { dictPath?: string });
  }
}
