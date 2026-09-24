/**
 * Fix SettingsPage ko-KR entries: remove broken ones, re-inject with full-string map + safe fallback (en).
 * Also patch high-visibility local copy maps.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Full English → Korean for Settings local maps and common UI. */
const FULL = new Map([
  ['Basics', '기본'],
  ['Audio And Playback', '오디오 및 재생'],
  ['Content And Media', '콘텐츠 및 미디어'],
  ['Connections And Extensions', '연결 및 확장'],
  ['Advanced', '고급'],
  ['Performance And Resource Usage', '성능 및 리소스 사용'],
  ['A safe, reversible one-click load reduction for lower-end devices.', '저사양 기기를 위한 안전하고 되돌릴 수 있는 원클릭 부하 감소.'],
  ['Language, Guide, Pro', '언어, 가이드, Pro'],
  ['First-run, notices, and Pro entry points stay up front.', '최초 실행, 안내, Pro 진입점을 맨 앞에 둡니다.'],
  ['Window And Startup', '창 및 시작'],
  ['Feature Entry Points', '기능 진입점'],
  ['Advanced Customization', '고급 사용자 지정'],
  ['Window And Visuals', '창 및 시각 효과'],
  ['Performance And Playback', '성능 및 재생'],
  ['Experimental Features', '실험 기능'],
  ['Interface And Interaction Density', '인터페이스 및 조작 밀도'],
  ['Scan And Resource Strategy', '스캔 및 리소스 전략'],
  ['Window, Visuals, And Graphics Protection', '창, 시각 효과 및 그래픽 보호'],
  ['Notifications, Guidance, And Startup', '알림, 안내 및 시작'],
  ['Data Protection And Analysis', '데이터 보호 및 분석'],
  ['Data And Backups', '데이터 및 백업'],
  ['Quick Setup And Output Devices', '빠른 설정 및 출력 장치'],
  ['Choose the output mode, backend, and device, with quick access to no-sound help.', '출력 모드, 백엔드, 장치를 선택하고 무음 문제 도움말로 빠르게 이동할 수 있습니다.'],
  ['Performance And Low-Load Strategy', '성능 및 저부하 전략'],
  ['More Playback Settings', '추가 재생 설정'],
  ['Recovery, compatibility, and fine playback controls stay collapsed by default.', '복구, 호환성, 세부 재생 제어는 기본적으로 접혀 있습니다.'],
  ['Troubleshooting And Recovery', '문제 해결 및 복구'],
  ['Recover the audio engine or system service and capture issue diagnostics.', '오디오 엔진·시스템 서비스를 복구하고 문제 진단을 기록합니다.'],
  ['Format And Device Compatibility', '형식 및 장치 호환성'],
  ['Current Audio Status', '현재 오디오 상태'],
  ['Shortcut Profiles', '단축키 프로필'],
  ['Function Key Bindings', '기능 키 바인딩'],
  ['Configure in-app and system-wide shortcuts separately.', '앱 내부와 시스템 전역 단축키를 각각 설정합니다.'],
  ['Lyrics Display And Behavior', '가사 표시 및 동작'],
  ['MV Basics', 'MV 기본'],
  ['Network Match And Immersive Background', '네트워크 매칭 및 몰입형 배경'],
  ['Network Proxy', '네트워크 프록시'],
  ['Advanced Accounts And Credentials', '고급 계정 및 자격 증명'],
  ['Third-party keys, developer apps, and service sign-ins stay collapsed by default.', '타사 키, 개발자 앱, 서비스 로그인은 기본적으로 접혀 있습니다.'],
  ['Online Album And Artist Metadata', '온라인 앨범 및 아티스트 메타데이터'],
  ['Presence And Broadcast Output', '상태 표시 및 방송 출력'],
  ['Send playback state to Discord, OBS, or the stage API.', '재생 상태를 Discord, OBS 또는 스테이지 API로 보냅니다.'],
  ['Windows Media And Taskbar', 'Windows 미디어 및 작업 표시줄'],
  ['Last.fm Scrobbling', 'Last.fm 스크로블'],
  ['Account Startup Behavior', '계정 시작 동작'],
  ['Developer App Credentials', '개발자 앱 자격 증명'],
  ['Music Service Accounts', '음악 서비스 계정'],
  ['Mobile Device Integration', '모바일 기기 연동'],
  ['Runtime Status And Safety Boundaries', '런타임 상태 및 안전 경계'],
  ['Management And Developer Tools', '관리 및 개발 도구'],
  ['Remote Music Sources', '원격 음악 소스'],
  ['Audio Processing Entry', '오디오 처리 진입점'],
  ['Theme And Layout', '테마 및 레이아웃'],
  ['Player Bar', '플레이어 바'],
  ['Wallpaper And Covers', '배경화면 및 커버'],
  ['Import And Scan', '가져오기 및 스캔'],
  ['Quality, Backfill, Health', '품질, 보완, 상태'],
  ['Organization And Cache', '정리 및 캐시'],
  ['Network Metadata', '네트워크 메타데이터'],
  ['Version And Updates', '버전 및 업데이트'],
  ['Diagnostics And Safe Mode', '진단 및 안전 모드'],
  ['Database Recovery', '데이터베이스 복구'],
  ['Cleanup And Reset', '정리 및 재설정'],
  ['Use the system acrylic material after the next launch so the desktop can show through.', '다음 실행부터 시스템 아크릴 재질을 사용해 바탕 화면이 비치도록 합니다.'],
  ['Reduce live visuals, frequent refreshes, analysis, and preloading while music is playing.', '음악 재생 중 실시간 시각 효과, 잦은 새로고침, 분석, 미리 로드를 줄입니다.'],
  ['Album Wall Virtualization', '앨범 벽 가상화'],
  ['Render only visible albums in large libraries to reduce cover decoding and page load.', '대규모 라이브러리에서는 보이는 앨범만 렌더링해 커버 디코딩과 페이지 부하를 줄입니다.'],
  ['Direct Local Playback', '로컬 직접 재생'],
  ['Let the native host read local audio directly with EQ and speed support, falling back on failure.', '네이티브 host가 로컬 오디오를 직접 읽고 EQ·재생 속도를 지원하며, 실패 시 자동 폴백합니다.'],
  ['Find audio with an isolated C++ process without reading metadata, extracting covers, or writing the database.', '독립 C++ 프로세스로 오디오를 찾으며 메타데이터·커버·데이터베이스에는 쓰지 않습니다.'],
  ['Read basic tags for common formats in an isolated C++ process, returning embedded covers only when requested and never writing the database.', '독립 C++ 프로세스로 일반 형식의 기본 태그를 읽고, 요청 시에만 임베디드 커버를 반환하며 데이터베이스에는 쓰지 않습니다.'],
]);

function esc(s) {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function toKo(en) {
  if (FULL.has(en)) return FULL.get(en);
  return en; // keep English rather than mangling
}

function fixSettingsPage() {
  const path = join(root, 'src/renderer/pages/SettingsPage.tsx');
  let src = readFileSync(path, 'utf8');

  // Remove all existing ko-KR entries (broken / duplicated)
  src = src.replace(/,?\s*'ko-KR':\s*'(?:\\.|[^'\\])*'/g, '');

  // Inject after each en-US in compact 4-locale maps
  const re =
    /('zh-CN':\s*'(?:\\.|[^'\\])*',\s*'zh-TW':\s*'(?:\\.|[^'\\])*',\s*'ja-JP':\s*'(?:\\.|[^'\\])*',\s*'en-US':\s*')((?:\\.|[^'\\])*)(')/g;

  let n = 0;
  src = src.replace(re, (_, prefix, enVal, suffix) => {
    n += 1;
    const ko = toKo(enVal);
    return `${prefix}${enVal}', 'ko-KR': '${esc(ko)}'${suffix === "'" ? '' : ''}`;
  });
  // fix: suffix is the closing quote of en-US value - we already closed en and added ko with its own quotes
  // Wait - original: prefix includes opening quote of en-US value, enVal is content, suffix is closing '
  // We want: prefix + enVal + "', 'ko-KR': '" + ko + "'"
  // So we should NOT keep suffix as separate if we already close. Let me redo:

  // Re-read after first pass may have broken - regenerate from clean removal
  src = readFileSync(path, 'utf8');
  src = src.replace(/,?\s*'ko-KR':\s*'(?:\\.|[^'\\])*'/g, '');

  src = src.replace(re, (_, prefix, enVal) => {
    n += 1;
    const ko = toKo(enVal);
    return `${prefix}${enVal}', 'ko-KR': '${esc(ko)}'`;
  });

  // Multiline block pattern (experimentalLabCopy style)
  const blockRe =
    /(\n\s*'ja-JP':\s*'(?:\\.|[^'\\])*',\s*\n\s*'en-US':\s*')((?:\\.|[^'\\])*)(',)/g;
  src = src.replace(blockRe, (_, prefix, enVal, suffix) => {
    n += 1;
    const ko = toKo(enVal);
    return `${prefix}${enVal}',\n    'ko-KR': '${esc(ko)}'${suffix}`;
  });

  writeFileSync(path, src, 'utf8');
  console.log('SettingsPage fixed, entries~', n);

  // verify no duplicate ko-KR on same line
  const dups = (src.match(/'ko-KR':[^\\n]*'ko-KR':/g) || []).length;
  console.log('duplicate-on-line', dups);
}

function fixSettingsAgainClean() {
  // More robust: parse each { 'zh-CN': ..., 'en-US': ... } and rebuild with ko-KR
  const path = join(root, 'src/renderer/pages/SettingsPage.tsx');
  let src = readFileSync(path, 'utf8');
  src = src.replace(/,?\s*'ko-KR':\s*'(?:\\.|[^'\\])*'/g, '');

  // Match locale map objects that have all four locales (possibly multiline)
  const objRe =
    /\{\s*'zh-CN':\s*'((?:\\.|[^'\\])*)',\s*'zh-TW':\s*'((?:\\.|[^'\\])*)',\s*'ja-JP':\s*'((?:\\.|[^'\\])*)',\s*'en-US':\s*'((?:\\.|[^'\\])*)'\s*\}/g;

  let count = 0;
  src = src.replace(objRe, (_, zh, tw, ja, en) => {
    count += 1;
    const ko = toKo(en);
    return `{ 'zh-CN': '${zh}', 'zh-TW': '${tw}', 'ja-JP': '${ja}', 'en-US': '${en}', 'ko-KR': '${esc(ko)}' }`;
  });

  // Multiline objects
  const multiRe =
    /\{\s*\n\s*'zh-CN':\s*'((?:\\.|[^'\\])*)',\s*\n\s*'zh-TW':\s*'((?:\\.|[^'\\])*)',\s*\n\s*'ja-JP':\s*'((?:\\.|[^'\\])*)',\s*\n\s*'en-US':\s*'((?:\\.|[^'\\])*)',\s*\n\s*\}/g;
  src = src.replace(multiRe, (_, zh, tw, ja, en) => {
    count += 1;
    const ko = toKo(en);
    return `{\n    'zh-CN': '${zh}',\n    'zh-TW': '${tw}',\n    'ja-JP': '${ja}',\n    'en-US': '${en}',\n    'ko-KR': '${esc(ko)}',\n  }`;
  });

  writeFileSync(path, src, 'utf8');
  console.log('Settings rebuild count', count);
  const en = (src.match(/'en-US':/g) || []).length;
  const ko = (src.match(/'ko-KR':/g) || []).length;
  console.log({ en, ko });
}

fixSettingsAgainClean();
