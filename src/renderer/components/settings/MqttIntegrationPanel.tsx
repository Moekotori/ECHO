import { useCallback, useEffect, useState } from 'react';
import { Copy, HousePlug, RadioTower, RefreshCw, Save } from 'lucide-react';
import type {
  MqttIntegrationSettingsPatch,
  MqttIntegrationStatus,
} from '../../../shared/types/mqttIntegration';
import { useI18n } from '../../i18n/I18nProvider';
import type { Locale } from '../../i18n/locales';
import { getMqttIntegrationBridge } from '../../utils/echoBridge';
import '../../styles/mqtt-integration.css';

type CopyText = {
  title: string;
  description: string;
  enabled: string;
  disabled: string;
  connecting: string;
  error: string;
  unavailable: string;
  broker: string;
  username: string;
  password: string;
  passwordKeep: string;
  clientId: string;
  topicPrefix: string;
  discovery: string;
  discoveryDescription: string;
  discoveryPrefix: string;
  save: string;
  saving: string;
  refresh: string;
  topics: string;
  copy: string;
  copied: string;
  security: string;
};

const copies: Record<Locale, CopyText> = {
  'zh-CN': {
    title: 'MQTT 智能家居联动',
    description: '把 ECHO 的播放状态和安全控制接入 MQTT、Home Assistant 与 Node-RED。',
    enabled: '已连接',
    disabled: '已关闭',
    connecting: '连接中',
    error: '连接异常',
    unavailable: '当前不可用',
    broker: 'Broker 地址',
    username: '用户名',
    password: '密码',
    passwordKeep: '留空则保留已保存密码',
    clientId: 'MQTT Client ID',
    topicPrefix: 'Topic 前缀',
    discovery: 'Home Assistant Discovery',
    discoveryDescription: '自动发现为一个 ECHO 设备，包含播放状态、曲目、音量和基础控制。',
    discoveryPrefix: 'Discovery 前缀',
    save: '保存并应用',
    saving: '正在应用',
    refresh: '刷新状态',
    topics: '联动 Topics',
    copy: '复制',
    copied: '已复制',
    security: '默认关闭。密码由系统安全存储保护；消息不会包含本地文件路径、账号令牌或原始媒体。',
  },
  'zh-TW': {
    title: 'MQTT 智慧家庭聯動',
    description: '將 ECHO 播放狀態與安全控制接入 MQTT、Home Assistant 與 Node-RED。',
    enabled: '已連線', disabled: '已關閉', connecting: '連線中', error: '連線異常', unavailable: '目前無法使用',
    broker: 'Broker 位址', username: '使用者名稱', password: '密碼', passwordKeep: '留空則保留已儲存密碼',
    clientId: 'MQTT Client ID', topicPrefix: 'Topic 前綴', discovery: 'Home Assistant Discovery',
    discoveryDescription: '自動發現為一個 ECHO 裝置，包含播放狀態、曲目、音量與基本控制。',
    discoveryPrefix: 'Discovery 前綴', save: '儲存並套用', saving: '正在套用', refresh: '重新整理狀態',
    topics: '聯動 Topics', copy: '複製', copied: '已複製',
    security: '預設關閉。密碼由系統安全儲存保護；訊息不包含本機檔案路徑、帳號權杖或原始媒體。',
  },
  'ja-JP': {
    title: 'MQTT スマートホーム連携',
    description: 'ECHO の再生状態と安全な操作を MQTT、Home Assistant、Node-RED に接続します。',
    enabled: '接続済み', disabled: '無効', connecting: '接続中', error: '接続エラー', unavailable: '利用できません',
    broker: 'ブローカー URL', username: 'ユーザー名', password: 'パスワード', passwordKeep: '空欄の場合は保存済みパスワードを維持',
    clientId: 'MQTT Client ID', topicPrefix: 'トピック接頭辞', discovery: 'Home Assistant Discovery',
    discoveryDescription: '再生状態、曲、音量、基本操作を含む ECHO デバイスとして自動検出します。',
    discoveryPrefix: 'Discovery 接頭辞', save: '保存して適用', saving: '適用中', refresh: '状態を更新',
    topics: '連携トピック', copy: 'コピー', copied: 'コピー済み',
    security: '既定では無効です。パスワードは OS の安全なストレージで保護され、ローカルパスやトークン、メディア本体は送信しません。',
  },
  'en-US': {
    title: 'MQTT smart-home integration',
    description: 'Connect ECHO playback state and safe controls to MQTT, Home Assistant, and Node-RED.',
    enabled: 'Connected', disabled: 'Off', connecting: 'Connecting', error: 'Connection error', unavailable: 'Unavailable',
    broker: 'Broker URL', username: 'Username', password: 'Password', passwordKeep: 'Leave blank to keep the saved password',
    clientId: 'MQTT Client ID', topicPrefix: 'Topic prefix', discovery: 'Home Assistant Discovery',
    discoveryDescription: 'Discover one ECHO device with playback state, track, volume, and basic controls.',
    discoveryPrefix: 'Discovery prefix', save: 'Save and apply', saving: 'Applying', refresh: 'Refresh status',
    topics: 'Integration topics', copy: 'Copy', copied: 'Copied',
    security: 'Off by default. The password is protected by OS secure storage; messages exclude local paths, account tokens, and raw media.',
  },
  'ko-KR': {
    title: 'MQTT 스마트 홈 연동',
    description: 'ECHO 재생 상태와 안전한 제어를 MQTT, Home Assistant 및 Node-RED에 연결합니다.',
    enabled: '연결됨', disabled: '꺼짐', connecting: '연결 중', error: '연결 오류', unavailable: '사용할 수 없음',
    broker: '브로커 URL', username: '사용자 이름', password: '비밀번호', passwordKeep: '비워 두면 저장된 비밀번호 유지',
    clientId: 'MQTT Client ID', topicPrefix: '토픽 접두사', discovery: 'Home Assistant Discovery',
    discoveryDescription: '재생 상태, 트랙, 음량 및 기본 제어가 포함된 ECHO 장치로 자동 검색합니다.',
    discoveryPrefix: 'Discovery 접두사', save: '저장 및 적용', saving: '적용 중', refresh: '상태 새로고침',
    topics: '연동 토픽', copy: '복사', copied: '복사됨',
    security: '기본적으로 꺼져 있습니다. 비밀번호는 OS 보안 저장소로 보호되며 로컬 경로, 계정 토큰, 원본 미디어는 전송하지 않습니다.',
  },
};

type FormState = {
  brokerUrl: string;
  username: string;
  password: string;
  clientId: string;
  topicPrefix: string;
  homeAssistantDiscoveryEnabled: boolean;
  homeAssistantDiscoveryPrefix: string;
};

const formFromStatus = (status: MqttIntegrationStatus): FormState => ({
  brokerUrl: status.settings.brokerUrl,
  username: status.settings.username ?? '',
  password: '',
  clientId: status.settings.clientId,
  topicPrefix: status.settings.topicPrefix,
  homeAssistantDiscoveryEnabled: status.settings.homeAssistantDiscoveryEnabled,
  homeAssistantDiscoveryPrefix: status.settings.homeAssistantDiscoveryPrefix,
});

type MqttIntegrationPanelProps = {
  bridgeOverride?: NonNullable<Window['echo']>['mqttIntegration'] | null;
};

export const MqttIntegrationPanel = ({ bridgeOverride }: MqttIntegrationPanelProps = {}): JSX.Element => {
  const { locale } = useI18n();
  const copy = copies[locale];
  const bridge = bridgeOverride === undefined ? getMqttIntegrationBridge() : bridgeOverride;
  const [status, setStatus] = useState<MqttIntegrationStatus | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedTopic, setCopiedTopic] = useState<string | null>(null);

  const refresh = useCallback(async (replaceForm = false): Promise<void> => {
    if (!bridge) {
      setError(copy.unavailable);
      return;
    }
    try {
      const next = await bridge.getStatus();
      setStatus(next);
      setError(next.error);
      setForm((current) => replaceForm || !current ? formFromStatus(next) : current);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }, [bridge, copy.unavailable]);

  useEffect(() => {
    void refresh(true);
  }, [refresh]);

  useEffect(() => {
    if (!status?.settings.enabled) return undefined;
    const timer = window.setInterval(() => void refresh(false), 2500);
    return () => window.clearInterval(timer);
  }, [refresh, status?.settings.enabled]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((current) => current ? { ...current, [key]: value } : current);
  };

  const apply = async (patch: MqttIntegrationSettingsPatch): Promise<void> => {
    if (!bridge) return;
    setBusy(true);
    setError(null);
    try {
      const next = await bridge.updateSettings(patch);
      setStatus(next);
      setForm(formFromStatus(next));
      setError(next.error);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  };

  const save = (): void => {
    if (!form) return;
    void apply({
      brokerUrl: form.brokerUrl,
      username: form.username || null,
      clientId: form.clientId,
      topicPrefix: form.topicPrefix,
      homeAssistantDiscoveryEnabled: form.homeAssistantDiscoveryEnabled,
      homeAssistantDiscoveryPrefix: form.homeAssistantDiscoveryPrefix,
      ...(form.password ? { password: form.password } : {}),
    });
  };

  const toggle = (): void => {
    if (!status) return;
    void apply({ enabled: !status.settings.enabled });
  };

  const copyTopic = async (topic: string): Promise<void> => {
    await navigator.clipboard.writeText(topic);
    setCopiedTopic(topic);
    window.setTimeout(() => setCopiedTopic((current) => current === topic ? null : current), 1500);
  };

  const phaseLabel = !bridge
    ? copy.unavailable
    : status?.phase === 'connected'
      ? copy.enabled
      : status?.phase === 'connecting'
        ? copy.connecting
        : status?.phase === 'error'
          ? copy.error
          : copy.disabled;

  return (
    <section className="mqtt-integration-panel" aria-labelledby="mqtt-integration-title">
      <div className="mqtt-integration-panel__header">
        <span className="settings-integrations-service-icon mqtt-integration-panel__icon"><RadioTower size={20} /></span>
        <div>
          <h3 id="mqtt-integration-title">{copy.title}</h3>
          <p>{copy.description}</p>
        </div>
        <span className="mqtt-integration-panel__phase" data-phase={status?.phase ?? 'disabled'}>{phaseLabel}</span>
        <button
          className="echo-link-basic-panel__switch"
          type="button"
          role="switch"
          aria-checked={status?.settings.enabled === true}
          disabled={!status || busy}
          onClick={toggle}
        ><span /></button>
      </div>

      {form && (
        <div className="mqtt-integration-panel__form">
          <label><span>{copy.broker}</span><input value={form.brokerUrl} placeholder="mqtt://192.168.1.2:1883" onChange={(event) => update('brokerUrl', event.target.value)} /></label>
          <label><span>{copy.username}</span><input value={form.username} autoComplete="username" onChange={(event) => update('username', event.target.value)} /></label>
          <label><span>{copy.password}</span><input value={form.password} type="password" autoComplete="new-password" placeholder={status?.passwordConfigured ? copy.passwordKeep : ''} onChange={(event) => update('password', event.target.value)} /></label>
          <label><span>{copy.clientId}</span><input value={form.clientId} onChange={(event) => update('clientId', event.target.value)} /></label>
          <label><span>{copy.topicPrefix}</span><input value={form.topicPrefix} onChange={(event) => update('topicPrefix', event.target.value)} /></label>
          <label><span>{copy.discoveryPrefix}</span><input value={form.homeAssistantDiscoveryPrefix} disabled={!form.homeAssistantDiscoveryEnabled} onChange={(event) => update('homeAssistantDiscoveryPrefix', event.target.value)} /></label>
          <label className="mqtt-integration-panel__discovery">
            <HousePlug size={18} />
            <span><strong>{copy.discovery}</strong><small>{copy.discoveryDescription}</small></span>
            <input type="checkbox" checked={form.homeAssistantDiscoveryEnabled} onChange={(event) => update('homeAssistantDiscoveryEnabled', event.target.checked)} />
          </label>
          <div className="mqtt-integration-panel__actions">
            <button className="settings-action-button" type="button" disabled={busy} onClick={save}><Save size={15} />{busy ? copy.saving : copy.save}</button>
            <button className="settings-action-button" type="button" disabled={busy} onClick={() => void refresh(false)}><RefreshCw size={15} />{copy.refresh}</button>
          </div>
        </div>
      )}

      {error && <p className="mqtt-integration-panel__error" role="alert">{error}</p>}

      {status && (
        <div className="mqtt-integration-panel__topics">
          <strong>{copy.topics}</strong>
          {[
            status.topics.state,
            status.topics.event,
            status.topics.command,
            `${status.topics.result}/+/+`,
            status.topics.availability,
          ].map((topic) => (
            <div key={topic}><code>{topic}</code><button type="button" onClick={() => void copyTopic(topic)}><Copy size={13} />{copiedTopic === topic ? copy.copied : copy.copy}</button></div>
          ))}
        </div>
      )}

      <p className="mqtt-integration-panel__security">{copy.security}</p>
    </section>
  );
};

