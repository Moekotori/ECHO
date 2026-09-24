/**
 * Regenerate koKR.ts with safe translations:
 * - exact full-string EN→KO map (high quality)
 * - key-suffix heuristics for common actions
 * - keep English (not mangled) for remaining strings
 * - native descriptions for firstRun language cards
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @type {Record<string, string>} */
const EXACT = {
  'Skip to main content': '본문으로 건너뛰기',
  Choose: '선택',
  Current: '현재',
  Cancel: '취소',
  Confirm: '확인',
  Save: '저장',
  Delete: '삭제',
  Remove: '제거',
  Add: '추가',
  Edit: '편집',
  Search: '검색',
  Refresh: '새로고침',
  Reload: '다시 로드',
  Loading: '로딩 중',
  Saving: '저장 중',
  Searching: '검색 중',
  Play: '재생',
  Pause: '일시정지',
  Stop: '정지',
  Next: '다음',
  Previous: '이전',
  Shuffle: '셔플',
  Repeat: '반복',
  Volume: '볼륨',
  Mute: '음소거',
  Unmute: '음소거 해제',
  Queue: '대기열',
  Playlist: '플레이리스트',
  Playlists: '플레이리스트',
  Library: '라이브러리',
  Settings: '설정',
  Appearance: '모양',
  Theme: '테마',
  Language: '언어',
  About: '정보',
  Help: '도움말',
  Error: '오류',
  Warning: '경고',
  Success: '성공',
  Failed: '실패',
  Retry: '다시 시도',
  Enable: '사용',
  Disable: '사용 안 함',
  Enabled: '사용 중',
  Disabled: '사용 안 함',
  On: '켜짐',
  Off: '꺼짐',
  Yes: '예',
  No: '아니요',
  Apply: '적용',
  Reset: '재설정',
  Clear: '지우기',
  Import: '가져오기',
  Export: '내보내기',
  Download: '다운로드',
  Upload: '업로드',
  Update: '업데이트',
  Version: '버전',
  Status: '상태',
  Unknown: '알 수 없음',
  None: '없음',
  All: '전체',
  More: '더보기',
  Back: '뒤로',
  Home: '홈',
  Artist: '아티스트',
  Artists: '아티스트',
  Album: '앨범',
  Albums: '앨범',
  Track: '트랙',
  Tracks: '트랙',
  Song: '곡',
  Songs: '곡',
  Genre: '장르',
  Year: '연도',
  Duration: '길이',
  Lyrics: '가사',
  Cover: '커버',
  Metadata: '메타데이터',
  Tags: '태그',
  Folder: '폴더',
  File: '파일',
  Files: '파일',
  Name: '이름',
  Title: '제목',
  Description: '설명',
  Details: '세부 정보',
  Options: '옵션',
  Advanced: '고급',
  Basic: '기본',
  General: '일반',
  Playback: '재생',
  Output: '출력',
  Input: '입력',
  Device: '장치',
  Devices: '장치',
  Plugin: '플러그인',
  Plugins: '플러그인',
  Network: '네트워크',
  Proxy: '프록시',
  Connection: '연결',
  Connected: '연결됨',
  Disconnected: '연결 끊김',
  Offline: '오프라인',
  Online: '온라인',
  Remote: '원격',
  Local: '로컬',
  Account: '계정',
  Accounts: '계정',
  Login: '로그인',
  Password: '비밀번호',
  Cache: '캐시',
  Database: '데이터베이스',
  Backup: '백업',
  Scan: '스캔',
  Scanning: '스캔 중',
  Quality: '품질',
  Diagnostics: '진단',
  'Safe mode': '안전 모드',
  'Safe Mode': '안전 모드',
  Logs: '로그',
  History: '기록',
  Favorites: '즐겨찾기',
  Liked: '좋아요',
  Like: '좋아요',
  Unlike: '좋아요 취소',
  Sort: '정렬',
  Filter: '필터',
  View: '보기',
  Grid: '그리드',
  List: '목록',
  Font: '글꼴',
  Dark: '다크',
  Light: '라이트',
  System: '시스템',
  Wallpaper: '배경화면',
  Background: '배경',
  Window: '창',
  Sidebar: '사이드바',
  'Player Bar': '플레이어 바',
  'Player bar': '플레이어 바',
  'Mini player': '미니 플레이어',
  'Mini Player': '미니 플레이어',
  Fullscreen: '전체 화면',
  Notifications: '알림',
  Shortcuts: '단축키',
  Accessibility: '접근성',
  Performance: '성능',
  Experimental: '실험적',
  Free: '무료',
  Activate: '활성화',
  Activation: '활성화',
  Restart: '다시 시작',
  Quit: '종료',
  Exit: '종료',
  Open: '열기',
  'Open folder': '폴더 열기',
  'Show in folder': '폴더에서 보기',
  Copy: '복사',
  Copied: '복사됨',
  Paste: '붙여넣기',
  Cut: '잘라내기',
  'Select all': '모두 선택',
  'Select All': '모두 선택',
  Duplicate: '복제',
  Rename: '이름 변경',
  Create: '만들기',
  'New playlist': '새 플레이리스트',
  'Add to playlist': '플레이리스트에 추가',
  'Add to queue': '대기열에 추가',
  'Play next': '다음에 재생',
  'Play now': '지금 재생',
  'Clear queue': '대기열 비우기',
  'Remove from queue': '대기열에서 제거',
  'Now playing': '지금 재생 중',
  'Now Playing': '지금 재생 중',
  'Up next': '다음 곡',
  'Up Next': '다음 곡',
  'No results': '결과 없음',
  'No results found': '결과를 찾을 수 없음',
  'Try again': '다시 시도',
  'Something went wrong': '문제가 발생했습니다',
  Unavailable: '사용할 수 없음',
  Available: '사용 가능',
  Required: '필수',
  Optional: '선택',
  Recommended: '권장',
  Default: '기본값',
  Custom: '사용자 지정',
  Automatic: '자동',
  Manual: '수동',
  Auto: '자동',
  Never: '안 함',
  Always: '항상',
  Continue: '계속',
  Skip: '건너뛰기',
  Finish: '완료',
  Done: '완료',
  Finished: '완료됨',
  Cancelled: '취소됨',
  Canceled: '취소됨',
  Pending: '대기 중',
  Running: '실행 중',
  Idle: '유휴',
  Active: '활성',
  Inactive: '비활성',
  Revoke: '취소',
  Regenerate: '다시 생성',
  Expired: '만료됨',
  Valid: '유효',
  Invalid: '유효하지 않음',
  'Not found': '찾을 수 없음',
  'Access denied': '액세스 거부됨',
  'Permission denied': '권한 거부됨',
  'Network error': '네트워크 오류',
  'Please wait': '잠시 기다려 주세요',
  Processing: '처리 중',
  Preparing: '준비 중',
  Downloading: '다운로드 중',
  Connecting: '연결 중',
  Trusted: '신뢰됨',
  Untrusted: '신뢰되지 않음',
  Security: '보안',
  Privacy: '개인정보',
  'Are you sure?': '계속하시겠습니까?',
  Restore: '복원',
  Minimize: '최소화',
  Maximize: '최대화',
  Close: '닫기',
  Undo: '실행 취소',
  Redo: '다시 실행',
  Bypass: '바이패스',
  Gain: '게인',
  Frequency: '주파수',
  Preset: '프리셋',
  Presets: '프리셋',
  Profile: '프로필',
  Profiles: '프로필',
  Equalizer: '이퀄라이저',
  Preamp: '프리앰프',
  Headroom: '헤드룸',
  Limiter: '리미터',
  Crossfade: '크로스페이드',
  Gapless: '갭리스',
  Balance: '밸런스',
  Mono: '모노',
  Stereo: '스테레오',
  Exclusive: '독점',
  Shared: '공유',
  Buffer: '버퍼',
  Latency: '지연',
  Format: '형식',
  Codec: '코덱',
  Channels: '채널',
  Bitrate: '비트레이트',
  'Sample rate': '샘플 레이트',
  'Sample Rate': '샘플 레이트',
  'Bit depth': '비트 깊이',
  'Bit Depth': '비트 깊이',
  'Output device': '출력 장치',
  'Output Device': '출력 장치',
  'Output mode': '출력 모드',
  'Output Mode': '출력 모드',
  'Audio backend': '오디오 백엔드',
  'No sound': '소리 없음',
  'No Sound': '소리 없음',
  Troubleshooting: '문제 해결',
  Recovery: '복구',
  'Check for updates': '업데이트 확인',
  'Up to date': '최신 상태',
  'New version available': '새 버전 사용 가능',
  'Download complete': '다운로드 완료',
  'Install update': '업데이트 설치',
  'Close to tray': '트레이로 닫기',
  'Launch at login': '시작 시 실행',
  'Always on top': '항상 위',
  'Desktop lyrics': '데스크톱 가사',
  'Desktop Lyrics': '데스크톱 가사',
  'Font size': '글꼴 크기',
  'Font Size': '글꼴 크기',
  'Line height': '줄 간격',
  'Line Height': '줄 간격',
  'Use English for menus, guides, and settings.': '메뉴, 가이드 및 설정에 영어를 사용합니다.',
  'Open sponsor channel': '후원 채널 열기',
  'Apply to form': '양식에 적용',
  'Choose cover': '커버 선택',
  'Close tag editor': '태그 편집기 닫기',
  'Delete album': '앨범 삭제',
  'Reload embedded tags': '임베디드 태그 다시 로드',
  'Load from network': '네트워크에서 불러오기',
  'Open in Explorer': '탐색기에서 열기',
  'Save tags': '태그 저장',
  'Search candidates': '후보 검색',
  'Current album': '현재 앨범',
  'Keep editing': '계속 편집',
  'Discard changes': '변경 취소',
  'Current track': '현재 트랙',
  'No route events yet': '아직 경로 이벤트 없음',
  Collapse: '접기',
  Expand: '펼치기',
  Idle: '유휴',
  'Testing connection': '연결 테스트 중',
  'Scanning files': '파일 스캔 중',
  'Reading metadata': '메타데이터 읽는 중',
  'Writing index': '인덱스 쓰는 중',
  'Marking missing': '누락 표시 중',
  Finished: '완료됨',
  Cancelled: '취소됨',
  Failed: '실패',
  'Direct disc track playback': '디스크 트랙 직접 재생',
  Drive: '드라이브',
  'CD input': 'CD 입력',
  Reading: '읽는 중',
  Direct: '직접',
  'Unknown length': '길이 알 수 없음',
  'Desktop bridge unavailable.': '데스크톱 브리지를 사용할 수 없습니다.',
  'No playable tracks could be read.': '재생 가능한 트랙을 읽을 수 없습니다.',
  'FFmpeg is unavailable.': 'FFmpeg를 사용할 수 없습니다.',
  'The current FFmpeg build does not support CD input.': '현재 FFmpeg 빌드는 CD 입력을 지원하지 않습니다.',
  'No CD drive detected.': 'CD 드라이브를 찾을 수 없습니다.',
  'Select a CD drive.': 'CD 드라이브를 선택하세요.',
  'No loaded Audio CD detected.': '로드된 Audio CD를 찾을 수 없습니다.',
  'Opening track...': '트랙을 여는 중...',
  'Pair device': '장치 페어링',
  'Paired devices': '페어링된 장치',
  'No paired devices yet': '아직 페어링된 장치 없음',
  'Running address': '실행 주소',
  'Last connected': '최근 연결',
  'Never connected': '연결한 적 없음',
  'Pair a new device': '새 장치 페어링',
  'Copy pairing URI': '페어링 URI 복사',
  '{seconds} seconds left': '{seconds}초 남음',
  'Could not load ECHO Link Basic status': 'ECHO Link Basic 상태를 불러올 수 없습니다',
  'Share playback status and events, and run basic controls on a trusted local network.':
    '신뢰할 수 있는 로컬 네트워크에서 재생 상태와 이벤트를 공유하고 기본 제어를 실행합니다.',
  'Library, queue, media streaming, cloud, and advanced automation remain ECHO Link Pro / v1 features.':
    '라이브러리, 대기열, 미디어 스트리밍, 클라우드, 고급 자동화는 ECHO Link Pro / v1 기능입니다.',
  'Scan with your phone camera within two minutes to open ECHO Link Remote. Compatible clients can also copy the pairing URI.':
    '2분 안에 휴대폰 카메라로 스캔해 ECHO Link Remote를 여세요. 호환 클라이언트는 페어링 URI를 복사할 수도 있습니다.',
  Scopes: '범위',
  Created: '생성됨',
  Running: '실행 중',
};

/** key suffix → KO when value is short English action label */
const SUFFIX = {
  '.cancel': '취소',
  '.confirm': '확인',
  '.save': '저장',
  '.delete': '삭제',
  '.remove': '제거',
  '.add': '추가',
  '.edit': '편집',
  '.search': '검색',
  '.refresh': '새로고침',
  '.reload': '다시 로드',
  '.loading': '로딩 중',
  '.saving': '저장 중',
  '.close': '닫기',
  '.open': '열기',
  '.play': '재생',
  '.pause': '일시정지',
  '.stop': '정지',
  '.next': '다음',
  '.previous': '이전',
  '.retry': '다시 시도',
  '.reset': '재설정',
  '.clear': '지우기',
  '.apply': '적용',
  '.enable': '사용',
  '.disable': '사용 안 함',
  '.import': '가져오기',
  '.export': '내보내기',
  '.download': '다운로드',
  '.upload': '업로드',
  '.copy': '복사',
  '.paste': '붙여넣기',
  '.undo': '실행 취소',
  '.redo': '다시 실행',
  '.expand': '펼치기',
  '.collapse': '접기',
  '.back': '뒤로',
  '.more': '더보기',
  '.none': '없음',
  '.unknown': '알 수 없음',
  '.error': '오류',
  '.success': '성공',
  '.failed': '실패',
  '.empty': '비어 있음',
  '.title': null, // keep
};

function parseEntries(source) {
  const re = /^  ('(?:\\.|[^'\\])*'):\s*('(?:\\.|[^'\\])*')/gm;
  const map = new Map();
  let m;
  while ((m = re.exec(source))) {
    try {
      const key = eval(m[1]);
      const value = eval(m[2]);
      map.set(key, value);
    } catch {
      /* skip */
    }
  }
  return map;
}

function loadEnUS() {
  const enUS = readFileSync(join(root, 'src/renderer/i18n/locales/enUS.ts'), 'utf8');
  const enFamily = readFileSync(join(root, 'src/renderer/i18n/locales/enFamily.ts'), 'utf8');
  const map = parseEntries(enFamily);
  for (const [k, v] of parseEntries(enUS)) map.set(k, v);
  return map;
}

function jsString(s) {
  return `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`;
}

function translate(key, value) {
  if (key === 'firstRun.language.ko-KR.description') {
    return '메뉴, 가이드 및 설정에 한국어를 사용합니다.';
  }
  if (key === 'firstRun.language.en-US.description') {
    return '메뉴, 가이드 및 설정에 영어를 사용합니다.';
  }
  if (key === 'firstRun.language.zh-CN.description') {
    return '메뉴, 가이드 및 설정에 중국어 간체를 사용합니다.';
  }
  if (key === 'firstRun.language.zh-TW.description') {
    return '메뉴, 가이드 및 설정에 중국어 번체를 사용합니다.';
  }
  if (key === 'firstRun.language.ja-JP.description') {
    return '메뉴, 가이드 및 설정에 일본어를 사용합니다.';
  }

  // Keep pure CJK / Hangul / Japanese strings as-is
  if (/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(value) && !/[A-Za-z]{4,}/.test(value)) {
    return value;
  }

  if (Object.prototype.hasOwnProperty.call(EXACT, value)) {
    return EXACT[value];
  }

  // short exact-ish via suffix when value is single word / short label
  if (value.length <= 24 && !value.includes('{')) {
    for (const [suffix, ko] of Object.entries(SUFFIX)) {
      if (ko && key.endsWith(suffix) && /^[A-Za-z][A-Za-z0-9 ./-]*$/.test(value)) {
        // only if exact map would apply similarly - skip if multi-word complex
        if (!value.includes(' ') || value.split(' ').length <= 2) {
          // prefer EXACT if available
          if (EXACT[value]) return EXACT[value];
        }
      }
    }
  }

  return value;
}

const map = loadEnUS();
map.set('firstRun.language.ko-KR.description', '메뉴, 가이드 및 설정에 한국어를 사용합니다.');

const keys = [...map.keys()].sort((a, b) => a.localeCompare(b));
let translated = 0;
const lines = [
  "import type { TranslationDictionary } from '../locales';",
  '',
  '/** Korean (ko-KR) — exact UI strings translated; remaining keys keep English until filled. */',
  'export const koKR: TranslationDictionary = {',
];

for (const key of keys) {
  const src = map.get(key) ?? '';
  const out = translate(key, src);
  if (out !== src) translated += 1;
  lines.push(`  ${jsString(key)}: ${jsString(out)},`);
}
lines.push('};', '', 'export default koKR;', '');

const outPath = join(root, 'src/renderer/i18n/locales/koKR.ts');
writeFileSync(outPath, lines.join('\n'), 'utf8');
console.log(`Wrote ${keys.length} keys, translated ${translated}`);
