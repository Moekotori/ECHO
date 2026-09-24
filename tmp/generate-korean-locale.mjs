/**
 * Generate ko-KR dictionary + inject ko-KR into multi-locale maps.
 * Source: en-US strings + phrase dictionary (longest-first replacement).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @type {Array<[string, string]>} */
const PHRASES = [
  // multi-word first
  ['Skip to main content', '본문으로 건너뛰기'],
  ['Audio Route Flight Recorder', '오디오 경로 비행 기록기'],
  ['DAC Capability Atlas', 'DAC 기능 아틀라스'],
  ['Current track', '현재 트랙'],
  ['Route memory', '경로 기록'],
  ['Sample-rate conversion', '샘플 레이트 변환'],
  ['Route changed', '경로 변경됨'],
  ['DAC takeover succeeded', 'DAC 전용 모드 성공'],
  ['Open failed', '열기 실패'],
  ['Returned to shared output', '공유 출력으로 복귀'],
  ['No route events yet', '아직 경로 이벤트 없음'],
  ['Reason not reported', '사유 미보고'],
  ['Recent route', '최근 경로'],
  ['Previous route', '이전 경로'],
  ['rate pending', '레이트 대기 중'],
  ['Device atlas', '장치 아틀라스'],
  ['Last issue', '최근 문제'],
  ['No errors yet', '아직 오류 없음'],
  ['Native proof', '네이티브 증명'],
  ['Observed output', '관측된 출력'],
  ['Waiting to observe', '관측 대기 중'],
  ['Not observed yet', '아직 관측되지 않음'],
  ['Collapse', '접기'],
  ['Expand', '펼치기'],
  ['Apply to form', '양식에 적용'],
  ['Choose cover', '커버 선택'],
  ['Close tag editor', '태그 편집기 닫기'],
  ['Delete album', '앨범 삭제'],
  ['Reload embedded tags', '임베디드 태그 다시 로드'],
  ['Load from network', '네트워크에서 불러오기'],
  ['Open in Explorer', '탐색기에서 열기'],
  ['Save tags', '태그 저장'],
  ['Search candidates', '후보 검색'],
  ['Current album', '현재 앨범'],
  ['Keep editing', '계속 편집'],
  ['Discard changes', '변경 취소'],
  ['You have unsaved changes. Close and discard them?', '저장되지 않은 변경 사항이 있습니다. 닫고 버리시겠습니까?'],
  ['Use English for menus, guides, and settings.', '메뉴, 가이드 및 설정에 영어를 사용합니다.'],
  ['Use Korean for menus, guides, and settings.', '메뉴, 가이드 및 설정에 한국어를 사용합니다.'],
  ['Choose', '선택'],
  ['Current', '현재'],
  ['Open sponsor channel', '후원 채널 열기'],
  ['Restore', '복원'],
  ['Minimize', '최소화'],
  ['Maximize', '최대화'],
  ['Close', '닫기'],
  ['Cancel', '취소'],
  ['Confirm', '확인'],
  ['Save', '저장'],
  ['Delete', '삭제'],
  ['Remove', '제거'],
  ['Add', '추가'],
  ['Edit', '편집'],
  ['Search', '검색'],
  ['Refresh', '새로고침'],
  ['Reload', '다시 로드'],
  ['Loading', '로딩 중'],
  ['Saving', '저장 중'],
  ['Searching', '검색 중'],
  ['Play', '재생'],
  ['Pause', '일시정지'],
  ['Stop', '정지'],
  ['Next', '다음'],
  ['Previous', '이전'],
  ['Shuffle', '셔플'],
  ['Repeat', '반복'],
  ['Volume', '볼륨'],
  ['Mute', '음소거'],
  ['Unmute', '음소거 해제'],
  ['Queue', '대기열'],
  ['Playlist', '플레이리스트'],
  ['Playlists', '플레이리스트'],
  ['Library', '라이브러리'],
  ['Settings', '설정'],
  ['Appearance', '모양'],
  ['Theme', '테마'],
  ['Language', '언어'],
  ['About', '정보'],
  ['Help', '도움말'],
  ['Error', '오류'],
  ['Warning', '경고'],
  ['Success', '성공'],
  ['Failed', '실패'],
  ['Retry', '다시 시도'],
  ['Enable', '사용'],
  ['Disable', '사용 안 함'],
  ['Enabled', '사용 중'],
  ['Disabled', '사용 안 함'],
  ['On', '켜짐'],
  ['Off', '꺼짐'],
  ['Yes', '예'],
  ['No', '아니요'],
  ['OK', '확인'],
  ['Apply', '적용'],
  ['Reset', '재설정'],
  ['Clear', '지우기'],
  ['Import', '가져오기'],
  ['Export', '내보내기'],
  ['Download', '다운로드'],
  ['Upload', '업로드'],
  ['Install', '설치'],
  ['Uninstall', '제거'],
  ['Update', '업데이트'],
  ['Version', '버전'],
  ['Status', '상태'],
  ['Unknown', '알 수 없음'],
  ['None', '없음'],
  ['All', '전체'],
  ['More', '더보기'],
  ['Less', '접기'],
  ['Back', '뒤로'],
  ['Forward', '앞으로'],
  ['Home', '홈'],
  ['Artist', '아티스트'],
  ['Artists', '아티스트'],
  ['Album', '앨범'],
  ['Albums', '앨범'],
  ['Track', '트랙'],
  ['Tracks', '트랙'],
  ['Song', '곡'],
  ['Songs', '곡'],
  ['Genre', '장르'],
  ['Year', '연도'],
  ['Duration', '길이'],
  ['Bitrate', '비트레이트'],
  ['Sample rate', '샘플 레이트'],
  ['Sample Rate', '샘플 레이트'],
  ['Channels', '채널'],
  ['Format', '형식'],
  ['Codec', '코덱'],
  ['Lyrics', '가사'],
  ['Cover', '커버'],
  ['Metadata', '메타데이터'],
  ['Tags', '태그'],
  ['Folder', '폴더'],
  ['File', '파일'],
  ['Files', '파일'],
  ['Path', '경로'],
  ['Name', '이름'],
  ['Title', '제목'],
  ['Description', '설명'],
  ['Details', '세부 정보'],
  ['Options', '옵션'],
  ['Advanced', '고급'],
  ['Basic', '기본'],
  ['General', '일반'],
  ['Playback', '재생'],
  ['Output', '출력'],
  ['Input', '입력'],
  ['Device', '장치'],
  ['Devices', '장치'],
  ['Driver', '드라이버'],
  ['Buffer', '버퍼'],
  ['Latency', '지연'],
  ['Equalizer', '이퀄라이저'],
  ['Equaliser', '이퀄라이저'],
  ['Preset', '프리셋'],
  ['Presets', '프리셋'],
  ['Profile', '프로필'],
  ['Profiles', '프로필'],
  ['Bypass', '바이패스'],
  ['Gain', '게인'],
  ['Frequency', '주파수'],
  ['Filter', '필터'],
  ['Filters', '필터'],
  ['Band', '밴드'],
  ['Bands', '밴드'],
  ['Preamp', '프리앰프'],
  ['Headroom', '헤드룸'],
  ['Limiter', '리미터'],
  ['Compressor', '컴프레서'],
  ['Crossfade', '크로스페이드'],
  ['Gapless', '갭리스'],
  ['ReplayGain', 'ReplayGain'],
  ['Normalization', '정규화'],
  ['Loudness', '음량'],
  ['Balance', '밸런스'],
  ['Mono', '모노'],
  ['Stereo', '스테레오'],
  ['Exclusive', '독점'],
  ['Shared', '공유'],
  ['Wasapi', 'WASAPI'],
  ['ASIO', 'ASIO'],
  ['DirectSound', 'DirectSound'],
  ['Plugin', '플러그인'],
  ['Plugins', '플러그인'],
  ['Permission', '권한'],
  ['Permissions', '권한'],
  ['Network', '네트워크'],
  ['Proxy', '프록시'],
  ['Connection', '연결'],
  ['Connected', '연결됨'],
  ['Disconnected', '연결 끊김'],
  ['Offline', '오프라인'],
  ['Online', '온라인'],
  ['Remote', '원격'],
  ['Local', '로컬'],
  ['Cloud', '클라우드'],
  ['Account', '계정'],
  ['Accounts', '계정'],
  ['Login', '로그인'],
  ['Log in', '로그인'],
  ['Log out', '로그아웃'],
  ['Sign in', '로그인'],
  ['Sign out', '로그아웃'],
  ['Password', '비밀번호'],
  ['Username', '사용자 이름'],
  ['Email', '이메일'],
  ['Token', '토큰'],
  ['Key', '키'],
  ['Secret', '시크릿'],
  ['API', 'API'],
  ['URL', 'URL'],
  ['URI', 'URI'],
  ['Port', '포트'],
  ['Host', '호스트'],
  ['Server', '서버'],
  ['Client', '클라이언트'],
  ['Timeout', '시간 초과'],
  ['Cache', '캐시'],
  ['Database', '데이터베이스'],
  ['Backup', '백업'],
  ['Restore from backup', '백업에서 복원'],
  ['Scan', '스캔'],
  ['Scanning', '스캔 중'],
  ['Rescan', '다시 스캔'],
  ['Import folders', '폴더 가져오기'],
  ['Add folder', '폴더 추가'],
  ['Remove folder', '폴더 제거'],
  ['Watch folders', '폴더 감시'],
  ['Auto scan', '자동 스캔'],
  ['Quality', '품질'],
  ['Health', '상태'],
  ['Diagnostics', '진단'],
  ['Safe mode', '안전 모드'],
  ['Safe Mode', '안전 모드'],
  ['Debug', '디버그'],
  ['Log', '로그'],
  ['Logs', '로그'],
  ['History', '기록'],
  ['Favorites', '즐겨찾기'],
  ['Liked', '좋아요'],
  ['Like', '좋아요'],
  ['Unlike', '좋아요 취소'],
  ['Recently played', '최근 재생'],
  ['Recently added', '최근 추가'],
  ['Most played', '많이 재생'],
  ['Random', '랜덤'],
  ['Sort', '정렬'],
  ['Sort by', '정렬 기준'],
  ['Filter by', '필터'],
  ['Group by', '그룹'],
  ['View', '보기'],
  ['Grid', '그리드'],
  ['List', '목록'],
  ['Compact', '간결'],
  ['Comfortable', '여유'],
  ['Density', '밀도'],
  ['Font', '글꼴'],
  ['Font size', '글꼴 크기'],
  ['Font Size', '글꼴 크기'],
  ['Line height', '줄 간격'],
  ['Line Height', '줄 간격'],
  ['Color', '색상'],
  ['Colors', '색상'],
  ['Dark', '다크'],
  ['Light', '라이트'],
  ['System', '시스템'],
  ['Ambient', '앰비언트'],
  ['Wallpaper', '배경화면'],
  ['Background', '배경'],
  ['Transparency', '투명도'],
  ['Opacity', '불투명도'],
  ['Blur', '블러'],
  ['Acrylic', '아크릴'],
  ['Window', '창'],
  ['Sidebar', '사이드바'],
  ['Player bar', '플레이어 바'],
  ['Player Bar', '플레이어 바'],
  ['Mini player', '미니 플레이어'],
  ['Mini Player', '미니 플레이어'],
  ['Desktop lyrics', '데스크톱 가사'],
  ['Desktop Lyrics', '데스크톱 가사'],
  ['Fullscreen', '전체 화면'],
  ['Full screen', '전체 화면'],
  ['Always on top', '항상 위'],
  ['Close to tray', '트레이로 닫기'],
  ['Launch at login', '시작 시 실행'],
  ['Start with system', '시스템 시작 시 실행'],
  ['Notifications', '알림'],
  ['Shortcuts', '단축키'],
  ['Hotkeys', '단축키'],
  ['Keyboard', '키보드'],
  ['Mouse', '마우스'],
  ['Gesture', '제스처'],
  ['Accessibility', '접근성'],
  ['Performance', '성능'],
  ['Low load', '저부하'],
  ['Low Load', '저부하'],
  ['Experimental', '실험적'],
  ['Beta', '베타'],
  ['Pro', 'Pro'],
  ['Free', '무료'],
  ['Premium', '프리미엄'],
  ['Activate', '활성화'],
  ['Activation', '활성화'],
  ['License', '라이선스'],
  ['Subscription', '구독'],
  ['Purchase', '구매'],
  ['Sponsor', '후원'],
  ['Donate', '후원'],
  ['Feedback', '피드백'],
  ['Report a bug', '버그 신고'],
  ['Check for updates', '업데이트 확인'],
  ['Up to date', '최신 상태'],
  ['New version available', '새 버전 사용 가능'],
  ['Download complete', '다운로드 완료'],
  ['Install update', '업데이트 설치'],
  ['Restart', '다시 시작'],
  ['Quit', '종료'],
  ['Exit', '종료'],
  ['Open', '열기'],
  ['Open folder', '폴더 열기'],
  ['Show in folder', '폴더에서 보기'],
  ['Copy', '복사'],
  ['Copied', '복사됨'],
  ['Paste', '붙여넣기'],
  ['Cut', '잘라내기'],
  ['Select all', '모두 선택'],
  ['Select All', '모두 선택'],
  ['Deselect', '선택 해제'],
  ['Move up', '위로 이동'],
  ['Move down', '아래로 이동'],
  ['Reorder', '순서 변경'],
  ['Duplicate', '복제'],
  ['Rename', '이름 변경'],
  ['Create', '만들기'],
  ['New playlist', '새 플레이리스트'],
  ['Add to playlist', '플레이리스트에 추가'],
  ['Add to queue', '대기열에 추가'],
  ['Play next', '다음에 재생'],
  ['Play now', '지금 재생'],
  ['Clear queue', '대기열 비우기'],
  ['Remove from queue', '대기열에서 제거'],
  ['Empty queue', '대기열이 비어 있음'],
  ['Now playing', '지금 재생 중'],
  ['Now Playing', '지금 재생 중'],
  ['Up next', '다음 곡'],
  ['Up Next', '다음 곡'],
  ['No results', '결과 없음'],
  ['No results found', '결과를 찾을 수 없음'],
  ['Nothing here yet', '아직 항목이 없습니다'],
  ['Try again', '다시 시도'],
  ['Something went wrong', '문제가 발생했습니다'],
  ['Unavailable', '사용할 수 없음'],
  ['Available', '사용 가능'],
  ['Required', '필수'],
  ['Optional', '선택'],
  ['Recommended', '권장'],
  ['Default', '기본값'],
  ['Custom', '사용자 지정'],
  ['Automatic', '자동'],
  ['Manual', '수동'],
  ['Auto', '자동'],
  ['Never', '안 함'],
  ['Always', '항상'],
  ['Ask', '묻기'],
  ['Continue', '계속'],
  ['Skip', '건너뛰기'],
  ['Finish', '완료'],
  ['Done', '완료'],
  ['Finished', '완료됨'],
  ['Cancelled', '취소됨'],
  ['Canceled', '취소됨'],
  ['Pending', '대기 중'],
  ['Running', '실행 중'],
  ['Idle', '유휴'],
  ['Active', '활성'],
  ['Inactive', '비활성'],
  ['Connected devices', '연결된 장치'],
  ['Paired devices', '페어링된 장치'],
  ['Pair device', '장치 페어링'],
  ['Revoke', '취소'],
  ['Regenerate', '다시 생성'],
  ['Expires', '만료'],
  ['Expired', '만료됨'],
  ['Valid', '유효'],
  ['Invalid', '유효하지 않음'],
  ['Not found', '찾을 수 없음'],
  ['Access denied', '액세스 거부됨'],
  ['Permission denied', '권한 거부됨'],
  ['Network error', '네트워크 오류'],
  ['Timeout exceeded', '시간 초과'],
  ['Please wait', '잠시 기다려 주세요'],
  ['Working', '작업 중'],
  ['Processing', '처리 중'],
  ['Preparing', '준비 중'],
  ['Installing', '설치 중'],
  ['Updating', '업데이트 중'],
  ['Downloading', '다운로드 중'],
  ['Uploading', '업로드 중'],
  ['Connecting', '연결 중'],
  ['Disconnecting', '연결 해제 중'],
  ['Authenticating', '인증 중'],
  ['Authorized', '승인됨'],
  ['Unauthorized', '승인되지 않음'],
  ['Trusted', '신뢰됨'],
  ['Untrusted', '신뢰되지 않음'],
  ['High risk', '고위험'],
  ['Medium risk', '중위험'],
  ['Low risk', '저위험'],
  ['Security', '보안'],
  ['Privacy', '개인정보'],
  ['Danger zone', '위험 구역'],
  ['Danger Zone', '위험 구역'],
  ['Irreversible', '되돌릴 수 없음'],
  ['This cannot be undone', '이 작업은 되돌릴 수 없습니다'],
  ['Are you sure?', '계속하시겠습니까?'],
  ['Open sponsor channel', '후원 채널 열기'],
  ['First-run setup', '최초 실행 설정'],
  ['Welcome to ECHO', 'ECHO에 오신 것을 환영합니다'],
  ['Get started', '시작하기'],
  ['Next step', '다음 단계'],
  ['Previous step', '이전 단계'],
  ['Complete setup', '설정 완료'],
  ['Select language', '언어 선택'],
  ['Select output device', '출력 장치 선택'],
  ['Add music folders', '음악 폴더 추가'],
  ['Import music', '음악 가져오기'],
  ['No sound', '소리 없음'],
  ['No Sound', '소리 없음'],
  ['Troubleshoot', '문제 해결'],
  ['Troubleshooting', '문제 해결'],
  ['Recover', '복구'],
  ['Recovery', '복구'],
  ['Reset audio engine', '오디오 엔진 재설정'],
  ['Restart audio service', '오디오 서비스 다시 시작'],
  ['Output mode', '출력 모드'],
  ['Output Mode', '출력 모드'],
  ['Output device', '출력 장치'],
  ['Output Device', '출력 장치'],
  ['Audio backend', '오디오 백엔드'],
  ['Audio Backend', '오디오 백엔드'],
  ['Bit depth', '비트 깊이'],
  ['Bit Depth', '비트 깊이'],
  ['Channel layout', '채널 레이아웃'],
  ['Channel Layout', '채널 레이아웃'],
  ['Dither', '디더'],
  ['Resampler', '리샘플러'],
  ['Resampling', '리샘플링'],
  ['Native rate', '네이티브 레이트'],
  ['Source rate', '소스 레이트'],
  ['Device rate', '장치 레이트'],
  ['Exclusive mode', '독점 모드'],
  ['Shared mode', '공유 모드'],
  ['Event driven', '이벤트 기반'],
  ['Push mode', '푸시 모드'],
  ['Pull mode', '풀 모드'],
  ['Buffer size', '버퍼 크기'],
  ['Buffer Size', '버퍼 크기'],
  ['Period size', '기간 크기'],
  ['Fade in', '페이드 인'],
  ['Fade out', '페이드 아웃'],
  ['Fade duration', '페이드 길이'],
  ['Transport fade', '전송 페이드'],
  ['Fixed volume', '고정 볼륨'],
  ['Fixed Volume', '고정 볼륨'],
  ['Segment loop', '구간 반복'],
  ['Segment Loop', '구간 반복'],
  ['A-B loop', 'A-B 반복'],
  ['Automix', '오토믹스'],
  ['Gapless playback', '갭리스 재생'],
  ['Gapless Playback', '갭리스 재생'],
  ['Crossfade duration', '크로스페이드 길이'],
  ['Seek', '탐색'],
  ['Seeking', '탐색 중'],
  ['Position', '위치'],
  ['Progress', '진행'],
  ['Elapsed', '경과'],
  ['Remaining', '남은 시간'],
  ['Total', '합계'],
  ['Count', '개수'],
  ['Size', '크기'],
  ['Speed', '속도'],
  ['Pitch', '피치'],
  ['Tempo', '템포'],
  ['Rate', '레이트'],
  ['Mode', '모드'],
  ['Type', '유형'],
  ['Kind', '종류'],
  ['Level', '레벨'],
  ['Range', '범위'],
  ['Minimum', '최소'],
  ['Maximum', '최대'],
  ['Average', '평균'],
  ['Peak', '피크'],
  ['RMS', 'RMS'],
  ['Spectrum', '스펙트럼'],
  ['Visualizer', '시각화'],
  ['Visualization', '시각화'],
  ['Waveform', '파형'],
  ['Oscilloscope', '오실로스코프'],
  ['Meter', '미터'],
  ['Meters', '미터'],
  ['Monitor', '모니터'],
  ['Analysis', '분석'],
  ['Analyzer', '분석기'],
  ['Headphone', '헤드폰'],
  ['Headphones', '헤드폰'],
  ['Correction', '보정'],
  ['Compensation', '보상'],
  ['Room correction', '룸 보정'],
  ['Room Correction', '룸 보정'],
  ['Channel mixer', '채널 믹서'],
  ['Channel Mixer', '채널 믹서'],
  ['Safety limiter', '안전 리미터'],
  ['Safety Limiter', '안전 리미터'],
  ['DSP', 'DSP'],
  ['Signal path', '신호 경로'],
  ['Signal Path', '신호 경로'],
  ['Audio chain', '오디오 체인'],
  ['Audio Chain', '오디오 체인'],
  ['Processing chain', '처리 체인'],
  ['Module', '모듈'],
  ['Modules', '모듈'],
  ['Workbench', '작업대'],
  ['Editor', '편집기'],
  ['Inspector', '검사기'],
  ['Preview', '미리보기'],
  ['Live', '라이브'],
  ['Realtime', '실시간'],
  ['Real-time', '실시간'],
  ['Offline processing', '오프라인 처리'],
  ['Undo', '실행 취소'],
  ['Redo', '다시 실행'],
  ['History stack', '기록 스택'],
  ['A/B compare', 'A/B 비교'],
  ['A/B Compare', 'A/B 비교'],
  ['Store A', 'A에 저장'],
  ['Store B', 'B에 저장'],
  ['Apply A', 'A 적용'],
  ['Apply B', 'B 적용'],
  ['Match loudness', '음량 맞춤'],
  ['Loudness matched', '음량 맞춤됨'],
  ['Empty slot', '빈 슬롯'],
  ['Overwrite', '덮어쓰기'],
  ['Save as', '다른 이름으로 저장'],
  ['Save As', '다른 이름으로 저장'],
  ['Save profile', '프로필 저장'],
  ['Save Profile', '프로필 저장'],
  ['Delete profile', '프로필 삭제'],
  ['Delete Profile', '프로필 삭제'],
  ['Bind profile', '프로필 바인딩'],
  ['Bind Profile', '프로필 바인딩'],
  ['Apply profile', '프로필 적용'],
  ['Apply Profile', '프로필 적용'],
  ['Duplicate preset', '프리셋 복제'],
  ['Duplicate Preset', '프리셋 복제'],
  ['Reset all gains', '모든 게인 재설정'],
  ['Reset All Gains', '모든 게인 재설정'],
  ['Reset frequencies', '주파수 재설정'],
  ['Reset Frequencies', '주파수 재설정'],
  ['Reset selected', '선택 항목 재설정'],
  ['Reset Selected', '선택 항목 재설정'],
  ['Standard bands', '표준 밴드'],
  ['Standard Bands', '표준 밴드'],
  ['Unlock frequency', '주파수 잠금 해제'],
  ['Unlock Frequency', '주파수 잠금 해제'],
  ['Fine adjust', '미세 조정'],
  ['Fine Adjust', '미세 조정'],
  ['Filter type', '필터 유형'],
  ['Filter Type', '필터 유형'],
  ['Q factor', 'Q 팩터'],
  ['Q Factor', 'Q 팩터'],
  ['Slope', '슬로프'],
  ['Order', '차수'],
  ['Phase', '위상'],
  ['Linear phase', '선형 위상'],
  ['Minimum phase', '최소 위상'],
  ['IIR', 'IIR'],
  ['FIR', 'FIR'],
  ['Low shelf', '로우 셸프'],
  ['High shelf', '하이 셸프'],
  ['Low pass', '로우패스'],
  ['High pass', '하이패스'],
  ['Band pass', '밴드패스'],
  ['Notch', '노치'],
  ['Peaking', '피킹'],
  ['Bell', '벨'],
  ['All pass', '올패스'],
  ['Tilt', '틸트'],
  ['Dynamic EQ', '다이내믹 EQ'],
  ['Parametric EQ', '파라메트릭 EQ'],
  ['Graphic EQ', '그래픽 EQ'],
  ['Convolution', '컨볼루션'],
  ['Impulse response', '임펄스 응답'],
  ['Impulse Response', '임펄스 응답'],
  ['IR', 'IR'],
  ['Wet', 'Wet'],
  ['Dry', 'Dry'],
  ['Mix', '믹스'],
  ['Width', '폭'],
  ['Depth', '깊이'],
  ['Pan', '팬'],
  ['Left', '왼쪽'],
  ['Right', '오른쪽'],
  ['Center', '중앙'],
  ['Front', '전면'],
  ['Rear', '후면'],
  ['Surround', '서라운드'],
  ['LFE', 'LFE'],
  ['Subwoofer', '서브우퍼'],
  ['Crossover', '크로스오버'],
  ['Delay', '딜레이'],
  ['ms', 'ms'],
  ['Hz', 'Hz'],
  ['kHz', 'kHz'],
  ['dB', 'dB'],
  ['bits', '비트'],
  ['bit', '비트'],
  ['channels', '채널'],
  ['channel', '채널'],
  ['tracks', '트랙'],
  ['track', '트랙'],
  ['songs', '곡'],
  ['song', '곡'],
  ['albums', '앨범'],
  ['album', '앨범'],
  ['artists', '아티스트'],
  ['artist', '아티스트'],
  ['playlists', '플레이리스트'],
  ['playlist', '플레이리스트'],
  ['folders', '폴더'],
  ['folder', '폴더'],
  ['files', '파일'],
  ['file', '파일'],
  ['items', '항목'],
  ['item', '항목'],
  ['results', '결과'],
  ['result', '결과'],
  ['issues', '문제'],
  ['issue', '문제'],
  ['errors', '오류'],
  ['error', '오류'],
  ['warnings', '경고'],
  ['warning', '경고'],
  ['seconds', '초'],
  ['second', '초'],
  ['minutes', '분'],
  ['minute', '분'],
  ['hours', '시간'],
  ['hour', '시간'],
  ['days', '일'],
  ['day', '일'],
  ['times', '회'],
  ['time', '시간'],
  ['unknown', '알 수 없음'],
  ['loading', '로딩 중'],
  ['empty', '비어 있음'],
  ['optional', '선택'],
  ['required', '필수'],
  ['enabled', '사용 중'],
  ['disabled', '사용 안 함'],
  ['selected', '선택됨'],
  ['available', '사용 가능'],
  ['unavailable', '사용할 수 없음'],
  ['success', '성공'],
  ['failure', '실패'],
  ['failed', '실패'],
  ['complete', '완료'],
  ['completed', '완료됨'],
  ['cancelled', '취소됨'],
  ['canceled', '취소됨'],
  ['pending', '대기 중'],
  ['running', '실행 중'],
  ['ready', '준비됨'],
  ['busy', '사용 중'],
  ['idle', '유휴'],
  ['active', '활성'],
  ['inactive', '비활성'],
  ['open', '열기'],
  ['close', '닫기'],
  ['show', '표시'],
  ['hide', '숨기기'],
  ['start', '시작'],
  ['stop', '정지'],
  ['pause', '일시정지'],
  ['resume', '재개'],
  ['play', '재생'],
  ['seek', '탐색'],
  ['skip', '건너뛰기'],
  ['repeat', '반복'],
  ['shuffle', '셔플'],
  ['mute', '음소거'],
  ['unmute', '음소거 해제'],
  ['save', '저장'],
  ['load', '불러오기'],
  ['import', '가져오기'],
  ['export', '내보내기'],
  ['create', '만들기'],
  ['delete', '삭제'],
  ['remove', '제거'],
  ['add', '추가'],
  ['edit', '편집'],
  ['rename', '이름 변경'],
  ['copy', '복사'],
  ['paste', '붙여넣기'],
  ['cut', '잘라내기'],
  ['undo', '실행 취소'],
  ['redo', '다시 실행'],
  ['apply', '적용'],
  ['reset', '재설정'],
  ['clear', '지우기'],
  ['refresh', '새로고침'],
  ['reload', '다시 로드'],
  ['retry', '다시 시도'],
  ['cancel', '취소'],
  ['confirm', '확인'],
  ['submit', '제출'],
  ['send', '보내기'],
  ['receive', '받기'],
  ['connect', '연결'],
  ['disconnect', '연결 해제'],
  ['pair', '페어링'],
  ['unpair', '페어링 해제'],
  ['authorize', '승인'],
  ['revoke', '취소'],
  ['install', '설치'],
  ['uninstall', '제거'],
  ['update', '업데이트'],
  ['upgrade', '업그레이드'],
  ['downgrade', '다운그레이드'],
  ['download', '다운로드'],
  ['upload', '업로드'],
  ['scan', '스캔'],
  ['analyze', '분석'],
  ['analyse', '분석'],
  ['configure', '구성'],
  ['manage', '관리'],
  ['settings', '설정'],
  ['preferences', '환경설정'],
  ['options', '옵션'],
  ['advanced', '고급'],
  ['basic', '기본'],
  ['general', '일반'],
  ['appearance', '모양'],
  ['theme', '테마'],
  ['language', '언어'],
  ['locale', '로케일'],
  ['about', '정보'],
  ['help', '도움말'],
  ['support', '지원'],
  ['documentation', '문서'],
  ['changelog', '변경 로그'],
  ['license', '라이선스'],
  ['privacy', '개인정보'],
  ['terms', '약관'],
  ['credits', '크레딧'],
  ['version', '버전'],
  ['build', '빌드'],
  ['release', '릴리스'],
  ['channel', '채널'],
  ['stable', '안정'],
  ['beta', '베타'],
  ['alpha', '알파'],
  ['nightly', '나이틀리'],
  ['experimental', '실험적'],
  ['legacy', '레거시'],
  ['deprecated', '지원 중단'],
  ['new', '새'],
  ['old', '이전'],
  ['latest', '최신'],
  ['current', '현재'],
  ['default', '기본값'],
  ['custom', '사용자 지정'],
  ['automatic', '자동'],
  ['manual', '수동'],
  ['auto', '자동'],
  ['on', '켜짐'],
  ['off', '꺼짐'],
  ['yes', '예'],
  ['no', '아니요'],
  ['true', '참'],
  ['false', '거짓'],
  ['and', '및'],
  ['or', '또는'],
  ['with', '포함'],
  ['without', '제외'],
  ['from', '에서'],
  ['to', '로'],
  ['for', '용'],
  ['of', '의'],
  ['in', '에서'],
  ['by', '기준'],
  ['per', '당'],
  ['via', '통해'],
  ['using', '사용'],
  ['based on', '기반'],
  ['not', '아님'],
  ['no ', '없음 '],
  ['Not ', '아님 '],
  ['No ', '없음 '],
];

// Sort longest first for replacement quality
PHRASES.sort((a, b) => b[0].length - a[0].length);

/** Exact full-string overrides for high-visibility UI (optional). */
const EXACT = new Map([
  ['Use English for menus, guides, and settings.', '메뉴, 가이드 및 설정에 영어를 사용합니다.'],
  ['メニュー、ガイド、設定を日本語で表示します。', 'メニュー、ガイド、設定を日本語で表示します。'],
  ['菜单、教程和设置使用简体中文。', '菜单、教程和设置使用简体中文。'],
  ['選單、教學和設定使用繁體中文。', '選單、教學和設定使用繁體中文。'],
]);

/**
 * @param {string} text
 * @returns {string}
 */
function translateText(text) {
  if (EXACT.has(text)) return EXACT.get(text);

  // Keep pure CJK / Japanese / already-Korean as-is
  if (/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(text) && !/[A-Za-z]{3,}/.test(text)) {
    return text;
  }

  // Brand / pure symbols / placeholders only
  if (!/[A-Za-z]/.test(text)) return text;

  let out = text;
  // Protect placeholders {foo}
  /** @type {string[]} */
  const placeholders = [];
  out = out.replace(/\{[a-zA-Z0-9_]+\}/g, (m) => {
    const i = placeholders.length;
    placeholders.push(m);
    return `\uE000${i}\uE001`;
  });

  for (const [en, ko] of PHRASES) {
    if (!en) continue;
    // case-sensitive whole-ish replace; avoid partial mid-word for short tokens
    if (en.length <= 3) {
      const re = new RegExp(`\\b${escapeReg(en)}\\b`, 'g');
      out = out.replace(re, ko);
    } else {
      out = out.split(en).join(ko);
      // also try capitalized variants if phrase starts lower
    }
  }

  // restore placeholders
  out = out.replace(/\uE000(\d+)\uE001/g, (_, i) => placeholders[Number(i)] ?? _);
  return out;
}

/**
 * @param {string} s
 */
function escapeReg(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parse TS object entries: 'key': 'value'
 * @param {string} source
 * @returns {Array<{key: string, value: string, rawKey: string, rawValue: string}>}
 */
function parseEntries(source) {
  const re = /^  ('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"):\s*('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/gm;
  /** @type {Array<{key: string, value: string, rawKey: string, rawValue: string}>} */
  const entries = [];
  let m;
  while ((m = re.exec(source))) {
    const rawKey = m[1];
    const rawValue = m[2];
    try {
      const key = JSON.parse(rawKey.replace(/^'/, '"').replace(/'$/, '"').replace(/\\'/g, "'"));
      // values use single quotes with escapes
      const value = eval(rawValue); // controlled source file
      entries.push({ key, value, rawKey, rawValue });
    } catch {
      // skip unparsable
    }
  }
  return entries;
}

/**
 * Load full en-US dictionary by evaluating a temporary module-less extract.
 */
function loadEnUSFlat() {
  // Use dynamic import of the built approach: parse all locale TS that contribute
  const enUSPath = join(root, 'src/renderer/i18n/locales/enUS.ts');
  const enFamilyPath = join(root, 'src/renderer/i18n/locales/enFamily.ts');
  const enUS = readFileSync(enUSPath, 'utf8');
  const enFamily = readFileSync(enFamilyPath, 'utf8');

  const map = new Map();
  for (const e of parseEntries(enFamily)) map.set(e.key, e.value);
  for (const e of parseEntries(enUS)) map.set(e.key, e.value);
  return map;
}

function jsString(s) {
  return `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`;
}

function generateKoKR() {
  const map = loadEnUSFlat();
  // Inject firstRun ko description into source map if missing
  map.set(
    'firstRun.language.ko-KR.description',
    '메뉴, 가이드 및 설정에 한국어를 사용합니다.',
  );

  const lines = [
    "import type { TranslationDictionary } from '../locales';",
    '',
    'export const koKR: TranslationDictionary = {',
  ];

  const keys = [...map.keys()].sort((a, b) => a.localeCompare(b));
  for (const key of keys) {
    let value = map.get(key) ?? '';
    // firstRun language descriptions: keep native language for other locales' descriptions
    if (key === 'firstRun.language.ko-KR.description') {
      value = '메뉴, 가이드 및 설정에 한국어를 사용합니다.';
    } else if (key === 'firstRun.language.en-US.description') {
      value = '메뉴, 가이드 및 설정에 영어를 사용합니다.';
    } else if (key === 'firstRun.language.zh-CN.description') {
      value = '메뉴, 가이드 및 설정에 중국어 간체를 사용합니다.';
    } else if (key === 'firstRun.language.zh-TW.description') {
      value = '메뉴, 가이드 및 설정에 중국어 번체를 사용합니다.';
    } else if (key === 'firstRun.language.ja-JP.description') {
      value = '메뉴, 가이드 및 설정에 일본어를 사용합니다.';
    } else {
      value = translateText(value);
    }
    lines.push(`  ${jsString(key)}: ${jsString(value)},`);
  }
  lines.push('};', '', 'export default koKR;', '');
  const outPath = join(root, 'src/renderer/i18n/locales/koKR.ts');
  writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log(`Wrote ${outPath} with ${keys.length} keys`);
  return keys.length;
}

/**
 * Inject 'ko-KR': '...' into SettingsPage-style maps that end with 'en-US': '...'
 */
function injectSettingsLocaleMaps() {
  const path = join(root, 'src/renderer/pages/SettingsPage.tsx');
  let src = readFileSync(path, 'utf8');
  if (src.includes("'ko-KR':")) {
    console.log('SettingsPage already has some ko-KR entries');
  }

  // Match compact maps: 'zh-CN': '...', 'zh-TW': '...', 'ja-JP': '...', 'en-US': '...'
  // Also multi-line with ja-JP only multi-line occasionally
  const re =
    /('zh-CN':\s*'(?:\\.|[^'\\])*',\s*'zh-TW':\s*'(?:\\.|[^'\\])*',\s*'ja-JP':\s*'(?:\\.|[^'\\])*',\s*'en-US':\s*')((?:\\.|[^'\\])*)(')/g;

  let count = 0;
  src = src.replace(re, (full, prefix, enVal, suffix) => {
    // if already has ko nearby skip - but pattern is exact 4 locales
    count += 1;
    const ko = translateText(enVal);
    return `${prefix}${enVal}', 'ko-KR': '${ko.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}${suffix}`;
  });

  // Multi-line ja-JP blocks (description spanning lines)
  // Pattern: 'en-US': '...' at end of object without ko-KR
  // Safer second pass for objects like:
  // title: { 'zh-CN': ..., 'zh-TW': ..., 'ja-JP': ..., 'en-US': ... },
  // already handled by first re if single line.

  // Handle multiline description blocks that have en-US alone on a line after ja-JP
  const multiRe =
    /('ja-JP':\s*'(?:\\.|[^'\\])*',\s*\n\s*'en-US':\s*')((?:\\.|[^'\\])*)(')/g;
  src = src.replace(multiRe, (full, prefix, enVal, suffix) => {
    if (full.includes("'ko-KR'")) return full;
    count += 1;
    const ko = translateText(enVal);
    return `${prefix}${enVal}',\n      'ko-KR': '${ko.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}${suffix}`;
  });

  // Another pattern from experimentalLabCopy - each locale on its own line
  const blockRe =
    /(\{\s*\n\s*'zh-CN':\s*'(?:\\.|[^'\\])*',\s*\n\s*'zh-TW':\s*'(?:\\.|[^'\\])*',\s*\n\s*'ja-JP':\s*'(?:\\.|[^'\\])*',\s*\n\s*'en-US':\s*')((?:\\.|[^'\\])*)(',\s*\n\s*\})/g;
  src = src.replace(blockRe, (full, prefix, enVal, suffix) => {
    count += 1;
    const ko = translateText(enVal);
    return `${prefix}${enVal}',\n    'ko-KR': '${ko.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}${suffix}`;
  });

  writeFileSync(path, src, 'utf8');
  console.log(`SettingsPage: injected/updated ~${count} ko-KR entries`);
}

function main() {
  const n = generateKoKR();
  injectSettingsLocaleMaps();
  console.log('Done. keys=', n);
}

main();
