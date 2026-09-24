import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Link2, QrCode, RefreshCw, ShieldCheck, Trash2, X } from 'lucide-react';
import type { EchoLinkBasicStatus, EchoLinkPairingSession } from '../../../shared/types/echoLink';
import { useI18n } from '../../i18n/I18nProvider';
import type { Locale } from '../../i18n/locales';
import { getEchoLinkBridge } from '../../utils/echoBridge';
import '../../styles/echo-link-basic.css';

type Copy = {
  title: string;
  free: string;
  description: string;
  enabled: string;
  disabled: string;
  unavailable: string;
  enable: string;
  disable: string;
  pair: string;
  address: string;
  devices: string;
  noDevices: string;
  revoke: string;
  scopes: string;
  created: string;
  lastSeen: string;
  never: string;
  advanced: string;
  pairingTitle: string;
  pairingDescription: string;
  expiresIn: string;
  copyUri: string;
  copied: string;
  cancel: string;
  regenerate: string;
  retry: string;
  loadFailed: string;
};

const copies: Record<Locale, Copy> = {
  'zh-CN': {
    title: 'ECHO Link Basic', free: '免费', description: '在可信局域网内同步播放状态、接收实时事件并控制基础播放。',
    enabled: '运行中', disabled: '已关闭', unavailable: '当前不可用', enable: '启用', disable: '关闭', pair: '扫码配对',
    address: '运行地址', devices: '已配对设备', noDevices: '还没有已配对设备', revoke: '撤销', scopes: '权限',
    created: '创建于', lastSeen: '最近连接', never: '尚未连接',
    advanced: '曲库、队列、媒体串流、云端与高级自动化仍属于 ECHO Link Pro / v1。',
    pairingTitle: '配对新设备', pairingDescription: '请在两分钟内使用手机相机扫码打开 ECHO Link Remote；兼容客户端也可复制配对 URI。', expiresIn: '剩余 {seconds} 秒',
    copyUri: '复制配对 URI', copied: '已复制', cancel: '取消', regenerate: '重新生成', retry: '重试', loadFailed: '无法读取 ECHO Link Basic 状态',
  },
  'zh-TW': {
    title: 'ECHO Link Basic', free: '免費', description: '在可信區域網路內同步播放狀態、接收即時事件並控制基本播放。',
    enabled: '執行中', disabled: '已關閉', unavailable: '目前無法使用', enable: '啟用', disable: '關閉', pair: '掃碼配對',
    address: '執行位址', devices: '已配對裝置', noDevices: '尚無已配對裝置', revoke: '撤銷', scopes: '權限',
    created: '建立於', lastSeen: '最近連線', never: '尚未連線',
    advanced: '曲庫、佇列、媒體串流、雲端與進階自動化仍屬於 ECHO Link Pro / v1。',
    pairingTitle: '配對新裝置', pairingDescription: '請在兩分鐘內使用手機相機掃碼開啟 ECHO Link Remote；相容用戶端也可複製配對 URI。', expiresIn: '剩餘 {seconds} 秒',
    copyUri: '複製配對 URI', copied: '已複製', cancel: '取消', regenerate: '重新產生', retry: '重試', loadFailed: '無法讀取 ECHO Link Basic 狀態',
  },
  'ja-JP': {
    title: 'ECHO Link Basic', free: '無料', description: '信頼できる LAN 内で再生状態とリアルタイムイベントを共有し、基本操作を行います。',
    enabled: '実行中', disabled: '無効', unavailable: '利用できません', enable: '有効化', disable: '無効化', pair: 'QR でペアリング',
    address: '実行アドレス', devices: 'ペアリング済みデバイス', noDevices: 'ペアリング済みデバイスはありません', revoke: '取り消す', scopes: '権限',
    created: '作成日時', lastSeen: '最終接続', never: '未接続',
    advanced: 'ライブラリ、キュー、メディア配信、クラウド、高度な自動化は ECHO Link Pro / v1 の機能です。',
    pairingTitle: '新しいデバイスをペアリング', pairingDescription: '2 分以内にスマートフォンのカメラでスキャンして ECHO Link Remote を開きます。対応クライアント向け URI もコピーできます。', expiresIn: '残り {seconds} 秒',
    copyUri: 'ペアリング URI をコピー', copied: 'コピー済み', cancel: 'キャンセル', regenerate: '再生成', retry: '再試行', loadFailed: 'ECHO Link Basic の状態を取得できません',
  },
  'en-US': {
    title: 'ECHO Link Basic', free: 'Free', description: 'Share playback status and events, and run basic controls on a trusted local network.',
    enabled: 'Running', disabled: 'Off', unavailable: 'Unavailable', enable: 'Enable', disable: 'Disable', pair: 'Pair device',
    address: 'Running address', devices: 'Paired devices', noDevices: 'No paired devices yet', revoke: 'Revoke', scopes: 'Scopes',
    created: 'Created', lastSeen: 'Last connected', never: 'Never connected',
    advanced: 'Library, queue, media streaming, cloud, and advanced automation remain ECHO Link Pro / v1 features.',
    pairingTitle: 'Pair a new device', pairingDescription: 'Scan with your phone camera within two minutes to open ECHO Link Remote. Compatible clients can also copy the pairing URI.', expiresIn: '{seconds} seconds left',
    copyUri: 'Copy pairing URI', copied: 'Copied', cancel: 'Cancel', regenerate: 'Regenerate', retry: 'Retry', loadFailed: 'Could not load ECHO Link Basic status',
  },
  'ko-KR': {
    title: 'ECHO Link Basic', free: '무료', description: '신뢰할 수 있는 로컬 네트워크에서 재생 상태와 이벤트를 공유하고 기본 제어를 실행합니다.',
    enabled: '실행 중', disabled: '꺼짐', unavailable: '사용할 수 없음', enable: '사용', disable: '사용 안 함', pair: '장치 페어링',
    address: '실행 주소', devices: '페어링된 장치', noDevices: '아직 페어링된 장치 없음', revoke: '취소', scopes: '범위',
    created: '생성됨', lastSeen: '최근 연결', never: '연결한 적 없음',
    advanced: '라이브러리, 대기열, 미디어 스트리밍, 클라우드, 고급 자동화는 ECHO Link Pro / v1 기능입니다.',
    pairingTitle: '새 장치 페어링', pairingDescription: '2분 안에 휴대폰 카메라로 스캔해 ECHO Link Remote를 여세요. 호환 클라이언트는 페어링 URI를 복사할 수도 있습니다.', expiresIn: '{seconds}초 남음',
    copyUri: '페어링 URI 복사', copied: '복사됨', cancel: '취소', regenerate: '다시 생성', retry: '다시 시도', loadFailed: 'ECHO Link Basic 상태를 불러올 수 없습니다',
  },
};

const formatDate = (value: string | null, locale: Locale, fallback: string): string => {
  if (!value) return fallback;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return fallback;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp);
};

type EchoLinkBasicPanelProps = {
  bridgeOverride?: NonNullable<Window['echo']>['echoLink'] | null;
};

export const EchoLinkBasicPanel = ({ bridgeOverride }: EchoLinkBasicPanelProps = {}): JSX.Element => {
  const { locale } = useI18n();
  const copy = copies[locale];
  const bridge = bridgeOverride === undefined ? getEchoLinkBridge() : bridgeOverride;
  const [status, setStatus] = useState<EchoLinkBasicStatus | null>(null);
  const [pairing, setPairing] = useState<EchoLinkPairingSession | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    if (!bridge) {
      setError(copy.unavailable);
      return;
    }
    try {
      const next = await bridge.getStatus();
      setStatus(next);
      setError(next.error);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : copy.loadFailed);
    }
  }, [bridge, copy.loadFailed, copy.unavailable]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!pairing) return undefined;
    const update = (): void => {
      const seconds = Math.max(0, Math.ceil((Date.parse(pairing.expiresAt) - Date.now()) / 1000));
      setRemainingSeconds(seconds);
      if (seconds === 0) {
        setPairing(null);
        void bridge?.cancelPairing().then(setStatus).catch(() => undefined);
      }
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [bridge, pairing]);

  const run = useCallback(async <T,>(name: string, action: () => Promise<T>): Promise<T | null> => {
    setBusy(name);
    setError(null);
    try {
      return await action();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      return null;
    } finally {
      setBusy(null);
    }
  }, []);

  const handleToggle = async (): Promise<void> => {
    if (!bridge) return;
    const next = await run('toggle', () => bridge.setEnabled(status?.enabled !== true));
    if (next) {
      setStatus(next);
      if (!next.enabled) setPairing(null);
    }
  };

  const handleStartPairing = async (): Promise<void> => {
    if (!bridge) return;
    const next = await run('pair', () => bridge.startPairing());
    if (next) {
      setPairing(next);
      setCopied(false);
      void refresh();
    }
  };

  const handleCancelPairing = async (): Promise<void> => {
    setPairing(null);
    if (!bridge) return;
    const next = await run('cancel', () => bridge.cancelPairing());
    if (next) setStatus(next);
  };

  const handleRevoke = async (clientId: string): Promise<void> => {
    if (!bridge) return;
    const next = await run(`revoke:${clientId}`, () => bridge.revokeClient(clientId));
    if (next) setStatus(next);
  };

  const handleCopy = async (): Promise<void> => {
    if (!pairing) return;
    try {
      await navigator.clipboard.writeText(pairing.pairingUri);
      setCopied(true);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  };

  const runningAddress = useMemo(() => {
    if (!status?.running) return null;
    const host = status.addresses[0] ?? status.host;
    return `http://${host}:${status.port}`;
  }, [status]);

  const statusLabel = !bridge
    ? copy.unavailable
    : status?.enabled && status.running
      ? copy.enabled
      : copy.disabled;

  return (
    <section className="settings-integrations-mobile echo-link-basic-panel" id="settings-row-mobile-integration" aria-labelledby="echo-link-basic-title">
      <div className="echo-link-basic-panel__header">
        <span className="settings-integrations-service-icon echo-link-basic-panel__icon"><Link2 size={20} /></span>
        <div className="echo-link-basic-panel__heading">
          <div><h3 id="echo-link-basic-title">{copy.title}</h3><span className="echo-link-basic-panel__free">{copy.free}</span></div>
          <p>{copy.description}</p>
        </div>
        <span className={`echo-link-basic-panel__status${status?.running ? ' is-running' : ''}`}>{statusLabel}</span>
        <button
          className="echo-link-basic-panel__switch"
          type="button"
          role="switch"
          aria-checked={status?.enabled === true}
          aria-label={status?.enabled ? copy.disable : copy.enable}
          disabled={!bridge || busy !== null}
          onClick={() => void handleToggle()}
        ><span /></button>
        <button className="settings-action-button" type="button" disabled={!status?.enabled || !status.running || busy !== null} onClick={() => void handleStartPairing()}>
          <QrCode size={15} />{copy.pair}
        </button>
      </div>

      {(runningAddress || error) && (
        <div className="echo-link-basic-panel__runtime">
          {runningAddress && <span><strong>{copy.address}</strong><code>{runningAddress}</code></span>}
          {error && <span className="echo-link-basic-panel__error" role="alert">{error}<button type="button" disabled={busy !== null} onClick={() => void refresh()}><RefreshCw size={12} />{copy.retry}</button></span>}
        </div>
      )}

      <div className="echo-link-basic-panel__clients">
        <div className="echo-link-basic-panel__section-title"><ShieldCheck size={16} /><strong>{copy.devices}</strong><span>{status?.clients.length ?? 0}</span></div>
        {status?.clients.length ? status.clients.map((client) => (
          <article className="echo-link-basic-client" key={client.id}>
            <div className="echo-link-basic-client__identity"><strong>{client.name}</strong><small>{client.platform ?? client.id}</small></div>
            <div className="echo-link-basic-client__meta">
              <span><b>{copy.scopes}</b>{client.scopes.join(' · ')}</span>
              <span><b>{copy.created}</b>{formatDate(client.createdAt, locale, copy.never)}</span>
              <span><b>{copy.lastSeen}</b>{formatDate(client.lastSeenAt, locale, copy.never)}</span>
            </div>
            <button className="settings-action-button" type="button" disabled={busy !== null} onClick={() => void handleRevoke(client.id)}>
              <Trash2 size={14} />{copy.revoke}
            </button>
          </article>
        )) : <p className="echo-link-basic-panel__empty">{copy.noDevices}</p>}
      </div>

      <p className="echo-link-basic-panel__advanced">{copy.advanced}</p>

      {pairing && (
        <div className="echo-link-pairing-backdrop" role="presentation">
          <div className="echo-link-pairing-dialog" role="dialog" aria-modal="true" aria-labelledby="echo-link-pairing-title">
            <button className="echo-link-pairing-dialog__close" type="button" aria-label={copy.cancel} onClick={() => void handleCancelPairing()}><X size={18} /></button>
            <div className="echo-link-pairing-dialog__copy"><h3 id="echo-link-pairing-title">{copy.pairingTitle}</h3><p>{copy.pairingDescription}</p></div>
            <img src={pairing.qrDataUrl} alt={copy.pairingTitle} />
            <strong className="echo-link-pairing-dialog__timer">{copy.expiresIn.replace('{seconds}', String(remainingSeconds))}</strong>
            <div className="echo-link-pairing-dialog__actions">
              <button className="settings-action-button" type="button" onClick={() => void handleCopy()}><Copy size={15} />{copied ? copy.copied : copy.copyUri}</button>
              <button className="settings-action-button" type="button" disabled={busy !== null} onClick={() => void handleStartPairing()}><RefreshCw size={15} />{copy.regenerate}</button>
              <button className="settings-action-button" type="button" onClick={() => void handleCancelPairing()}>{copy.cancel}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
