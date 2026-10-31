import { describe, expect, it } from 'vitest';
import { rankSettingsSearch } from './settingsSearch';

describe('settings search title ranking', () => {
  it('puts the short lyrics entry before an incidental graphics guard or library alias', () => {
    const main = rankSettingsSearch('歌词', ['歌词设置', '歌词偏好设置', '歌词']);
    expect(main).toBeGreaterThan(rankSettingsSearch('歌词', ['歌词/MV 图形内存保护', '降低图形内存占用', '歌词']));
    expect(main).toBeGreaterThan(rankSettingsSearch('歌词', ['媒体库', '导入、扫描与清理', '歌词']));
  });

  it('ranks exact titles first and direct title words before aliases', () => {
    expect(rankSettingsSearch('翻译', ['翻译'])).toBeGreaterThan(rankSettingsSearch('翻译', ['显示中文翻译']));
    expect(rankSettingsSearch('翻译', ['显示中文翻译'])).toBeGreaterThan(rankSettingsSearch('翻译', ['歌词设置', '翻译']));
    expect(rankSettingsSearch('ui scale', ['UI Scale'])).toBe(200);
  });

  it('preserves useful alias matches without generating empty or unrelated matches', () => {
    expect(rankSettingsSearch('status', ['Discord', 'Rich presence'])).toBeGreaterThan(0);
    expect(rankSettingsSearch('zzzz', ['显示语言', '语言设置'])).toBe(0);
    expect(rankSettingsSearch('  ', ['显示语言'])).toBe(0);
  });
});
