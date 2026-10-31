import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../styles/dsp.css';
import { Activity, AudioWaveform, CheckCircle2, Clock3, FileAudio, Gauge, Headphones, Info, Pencil, RadioTower, RotateCcw, Route, Save, ShieldCheck, SlidersHorizontal, Trash2, Waves, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AudioStatus, ChannelBalanceBandId, ChannelBalanceMonoMode, ChannelBalanceState } from '../../shared/types/audio';
import type { EqState, RoomCorrectionState } from '../../shared/types/eq';
import { channelBalanceBandIds, channelBalanceBandMaxGainDb, channelBalanceBandMinGainDb, channelBalanceMaxDelayMs, channelBalanceMaxGainDb, channelBalanceMinDelayMs, channelBalanceMinGainDb } from '../../shared/types/audio';
import { dspHeadroomMaxDb, dspHeadroomMinDb, roomCorrectionMaxTrimDb, roomCorrectionMinTrimDb } from '../../shared/types/eq';
import { EqPanel } from '../components/audio/EqPanel';
import { HeadphoneCorrectionPanel } from '../components/audio/HeadphoneCorrectionPanel';
import { DspRackPanel } from '../components/audio/DspRackPanel';
import { CompressorPanel } from '../components/audio/CompressorPanel';
import { ChannelMatrixPanel, CrossfeedPanel, StereoFieldPanel } from '../components/audio/SpatialDspPanel';
import {
  defaultDspRackState,
  type ChannelMatrixState,
  type CompressorState,
  type CrossfeedState,
  type StereoFieldState,
} from '../../shared/types/dspRack';
import { useI18n } from '../i18n/I18nProvider';
import type { TranslationKey } from '../i18n/locales';
import { refreshPlaybackStatus, useThrottledSharedPlaybackStatus } from '../stores/playbackStatusStore';
import { dispatchAudioErrorNotice } from '../utils/audioErrorNotice';
import { getEqBridge } from '../utils/echoBridge';
import { formatUserFacingError } from '../utils/userFacingError';

type DspModuleId = 'rack' | 'headroom' | 'eq' | 'compressor' | 'crossfeed' | 'stereoField' | 'channelMatrix' | 'headphone' | 'room' | 'channel' | 'safety';

const dspPlaybackStatusUiIntervalMs = 250;
const dspSelectedModuleStorageKey = 'echo-next.dsp.selected-module';
const dspModuleIds: readonly DspModuleId[] = ['rack', 'headroom', 'eq', 'compressor', 'crossfeed', 'stereoField', 'channelMatrix', 'headphone', 'room', 'channel', 'safety'];

const isDspModuleId = (value: unknown): value is DspModuleId =>
  typeof value === 'string' && (dspModuleIds as readonly string[]).includes(value);

const formatDspActionError = (error: unknown): string =>
  formatUserFacingError(error, { context: 'audio' });

const readStoredDspModuleId = (): DspModuleId => {
  if (typeof window === 'undefined') {
    return 'eq';
  }

  try {
    const storage = window.localStorage;
    if (!storage) {
      return 'eq';
    }

    const stored = storage.getItem(dspSelectedModuleStorageKey);
    return isDspModuleId(stored) ? stored : 'eq';
  } catch {
    return 'eq';
  }
};

const writeStoredDspModuleId = (moduleId: DspModuleId): void => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage?.setItem(dspSelectedModuleStorageKey, moduleId);
  } catch {
    // UI-only memory; localStorage failures should never block DSP controls.
  }
};

type DspModule = {
  id: DspModuleId;
  stageKey: string;
  title: string;
  subtitle: string;
  description: string;
  icon: LucideIcon;
  enabled: boolean;
  accent: 'blue' | 'violet' | 'green' | 'amber';
};

const fallbackEqState: EqState = {
  enabled: false,
  preampDb: 0,
  dspHeadroomDb: 0,
  dspSafetyLimiterEnabled: true,
  presetId: 'flat',
  presetName: 'Flat',
  clippingRisk: false,
  bands: [],
};

const fallbackRoomCorrection: RoomCorrectionState = {
  enabled: false,
  status: 'empty',
  irId: null,
  irName: null,
  channelMode: 'none',
  sampleRate: null,
  tapCount: 0,
  trimDb: 0,
  latencySamples: 0,
  clippingRisk: false,
  error: null,
};

const fallbackChannelBalance: ChannelBalanceState = {
  enabled: false,
  balance: 0,
  leftGainDb: 0,
  rightGainDb: 0,
  bandGains: {
    low: { leftGainDb: 0, rightGainDb: 0 },
    mid: { leftGainDb: 0, rightGainDb: 0 },
    high: { leftGainDb: 0, rightGainDb: 0 },
  },
  leftDelayMs: 0,
  rightDelayMs: 0,
  swapLeftRight: false,
  monoMode: 'off',
  invertLeft: false,
  invertRight: false,
  constantPower: true,
  clippingRisk: false,
};

const monoModeKeyMap: Record<ChannelBalanceMonoMode, string> = {
  off: 'dsp.panel.channel.mono.off',
  sum: 'dsp.panel.channel.mono.sum',
  left: 'dsp.panel.channel.mono.left',
  right: 'dsp.panel.channel.mono.right',
};

const channelTrimSteps = [0.25, 0.5, 1] as const;
const electrostaticTrimSteps = [0.1, 0.25] as const;
const channelPresetStorageKey = 'echo:dsp-channel-presets:v1';
const maxChannelPresetCount = 6;
const defaultBandGains: NonNullable<ChannelBalanceState['bandGains']> = {
  low: { leftGainDb: 0, rightGainDb: 0 },
  mid: { leftGainDb: 0, rightGainDb: 0 },
  high: { leftGainDb: 0, rightGainDb: 0 },
};
const channelBandLabels: Record<ChannelBalanceBandId, { titleKey: string; range: string }> = {
  low: { titleKey: 'dsp.panel.channel.bandLow', range: '20-200 Hz' },
  mid: { titleKey: 'dsp.panel.channel.bandMid', range: '200 Hz-2 kHz' },
  high: { titleKey: 'dsp.panel.channel.bandHigh', range: '2 kHz-10 kHz' },
};
type ChannelPanelMode = 'simple' | 'pro';

type ChannelBalancePreset = {
  id: string;
  name: string;
  state: ChannelBalanceState;
  createdAt: string;
};

const dspLocalTextZhCN: Record<string, string> = {
  'dsp.action.clear': '清除',
  'dsp.action.disableChannel': '关闭声道补偿',
  'dsp.action.disableFir': '关闭 FIR',
  'dsp.action.enableChannel': '开启声道补偿',
  'dsp.action.enableFir': '启用 FIR',
  'dsp.action.enableFirSafely': '安全启用',
  'dsp.action.importIr': '导入 IR',
  'dsp.action.refresh': '刷新状态',
  'dsp.action.reset': '重置',
  'dsp.action.save': '保存',
  'dsp.aria.chain': 'DSP 模块链',
  'dsp.aria.modules': 'DSP 模块',
  'dsp.aria.pipeline': 'DSP 路径',
  'dsp.aria.workspace': 'DSP 工作区',
  'dsp.brand.subtitle': 'Signal Control',
  'dsp.stage.src': '采样率',
  'dsp.error.channelBridge': '声道工具不可用。',
  'dsp.error.desktopBridge': '桌面桥接不可用。',
  'dsp.error.dspBridge': 'DSP 桥接不可用。',
  'dsp.error.firBridge': 'FIR 桥接不可用。',
  'dsp.label.bitPerfect': 'Bit-perfect',
  'dsp.label.currentModule': '当前模块',
  'dsp.label.module': 'DSP 模块',
  'dsp.label.moduleStatus': '模块状态',
  'dsp.label.output': '输出',
  'dsp.metric.bitPerfect': 'Bit-perfect',
  'dsp.metric.clipping': '削波',
  'dsp.metric.dsp': 'DSP',
  'dsp.metric.inputPeak': '输入峰值',
  'dsp.metric.ir': 'IR',
  'dsp.metric.latency': '延迟',
  'dsp.metric.liveHeadroom': '实时余量',
  'dsp.metric.truePeak': 'True Peak',
  'dsp.metric.mode': '模式',
  'dsp.metric.outputEstimate': '输出估算',
  'dsp.metric.reason': '原因',
  'dsp.metric.sampleRate': '采样率',
  'dsp.metric.taps': 'Taps',
  'dsp.module.channel.description': '平衡、延迟、Mono',
  'dsp.module.channel.title': '声道工具',
  'dsp.module.eq.description': '频段、前级、预设',
  'dsp.module.eq.title': '参数 EQ',
  'dsp.module.headroom.description': 'DSP 前余量预留',
  'dsp.module.headroom.title': 'Headroom',
  'dsp.module.headphone.description': 'OPRA 耳机曲线',
  'dsp.module.headphone.title': '耳机校正',
  'dsp.module.room.description': '只处理 IR 卷积',
  'dsp.module.room.title': 'FIR / 房间校正',
  'dsp.module.safety.description': '只监控输出链',
  'dsp.module.safety.title': '输出安全',
  'dsp.panel.channel.advanced': '高级声道',
  'dsp.panel.channel.balance': '声像平衡',
  'dsp.panel.channel.bandCompensation': '分频段左右补偿',
  'dsp.panel.channel.bandHigh': '高频',
  'dsp.panel.channel.bandLow': '低频',
  'dsp.panel.channel.bandMid': '中频',
  'dsp.panel.channel.centered': '中心稳定',
  'dsp.panel.channel.compensationDetail': '默认只降低偏响一侧，适合不可维修的耳机偏音补偿。',
  'dsp.panel.channel.compensationOff': '已关闭',
  'dsp.panel.channel.compensationOn': '已开启',
  'dsp.panel.channel.compensationTitle': '偏音补偿',
  'dsp.panel.channel.constantPower': '恒功率',
  'dsp.panel.channel.delaySkew': '延迟差',
  'dsp.panel.channel.he90Hint': '建议从 0.25 dB 开始，边听居中人声边微调。',
  'dsp.panel.channel.invertLeft': '左声道反相',
  'dsp.panel.channel.invertRight': '右声道反相',
  'dsp.panel.channel.kicker': '声道工具',
  'dsp.panel.channel.leansLeft': '偏左 {value}',
  'dsp.panel.channel.leansRight': '偏右 {value}',
  'dsp.panel.channel.leftDelay': '左声道延迟',
  'dsp.panel.channel.leftGain': '左声道增益',
  'dsp.panel.channel.leftOutput': '左输出',
  'dsp.panel.channel.leftTooLoud': '左侧偏响',
  'dsp.panel.channel.monoTools': 'Mono / 检查',
  'dsp.panel.channel.mono.left': '只听左声道',
  'dsp.panel.channel.mono.off': '关闭 Mono',
  'dsp.panel.channel.mono.right': '只听右声道',
  'dsp.panel.channel.mono.sum': '合并 Mono',
  'dsp.panel.channel.note': '声道工具已从参数 EQ 中分离，适合检查声像、左右耳差异和单声道兼容。',
  'dsp.panel.channel.modePro': 'Pro',
  'dsp.panel.channel.modeSimple': 'Simple',
  'dsp.panel.channel.presetDefaultName': '耳机偏音补偿',
  'dsp.panel.channel.presetEmpty': '还没有保存的声道方案。',
  'dsp.panel.channel.presetName': '方案名称',
  'dsp.panel.channel.presetPrompt': '给这个耳机方案起个名字',
  'dsp.panel.channel.presets': '耳机方案',
  'dsp.panel.channel.phaseTools': '相位 / 路由',
  'dsp.panel.channel.removePreset': '移除',
  'dsp.panel.channel.saveCurrent': '保存当前参数',
  'dsp.panel.channel.selectPreset': '选择方案',
  'dsp.panel.channel.switchPreset': '切换',
  'dsp.panel.channel.renamePreset': '重命名',
  'dsp.panel.channel.renamePrompt': '重命名这个耳机方案',
  'dsp.panel.channel.rightDelay': '右声道延迟',
  'dsp.panel.channel.rightGain': '右声道增益',
  'dsp.panel.channel.rightOutput': '右输出',
  'dsp.panel.channel.rightTooLoud': '右侧偏响',
  'dsp.panel.channel.step': '步进',
  'dsp.panel.channel.swap': '交换左右',
  'dsp.panel.channel.swapCompensation': '交换补偿方向',
  'dsp.panel.channel.safeAttenuation': '静电耳机建议使用衰减补偿，避免提高输出电平。',
  'dsp.panel.channel.compare': 'A/B 对比',
  'dsp.panel.channel.compareActive': '正在旁路',
  'dsp.panel.channel.compareHint': '临时关闭声道处理，用来对比补偿前后的声像。',
  'dsp.panel.channel.monoHint': '合并 Mono 会两边都响；只听左/右会静音另一边。',
  'dsp.panel.channel.trimCenter': '偏音清零',
  'dsp.panel.headroom.applyRecommended': '应用建议',
  'dsp.panel.headroom.budgetAria': 'Headroom 预算',
  'dsp.panel.headroom.clipCount': '削波次数',
  'dsp.panel.headroom.clipCountValue': '{count} 次',
  'dsp.panel.headroom.guardActive': '已启用',
  'dsp.panel.headroom.guardDirect': '直通',
  'dsp.panel.headroom.guardStandby': '待命',
  'dsp.panel.headroom.guardState': '保护状态',
  'dsp.panel.headroom.kicker': 'Headroom 管理',
  'dsp.panel.headroom.lastClip': '最近削波',
  'dsp.panel.headroom.makeConservative': '设为 -6 dB',
  'dsp.panel.headroom.makeSafe': '设为 {value}',
  'dsp.panel.headroom.modeAria': 'Headroom 模式',
  'dsp.panel.headroom.modeDaily': '日常',
  'dsp.panel.headroom.modeDailyDetail': '轻量 DSP 预留。',
  'dsp.panel.headroom.modeDirect': '直通',
  'dsp.panel.headroom.modeDirectDetail': '不额外降低电平。',
  'dsp.panel.headroom.modeDsp': 'DSP',
  'dsp.panel.headroom.modeDspDetail': '给 EQ/FIR 留出安全空间。',
  'dsp.panel.headroom.nextDirect': '保持直通',
  'dsp.panel.headroom.nextDirectDetail': '当前没有需要预留的 DSP 风险。',
  'dsp.panel.headroom.nextHoldRisk': '先降低余量',
  'dsp.panel.headroom.nextHoldRiskDetail': '检测到削波风险，建议先预留 Headroom。',
  'dsp.panel.headroom.nextProtect': '应用保护余量',
  'dsp.panel.headroom.nextProtectDetail': '当前输出接近满幅，建议立即降低。',
  'dsp.panel.headroom.nextReady': '继续监听',
  'dsp.panel.headroom.nextReadyDetail': 'DSP 已有安全余量。',
  'dsp.panel.headroom.nextStandby': '保持待命',
  'dsp.panel.headroom.nextStandbyDetail': '有 DSP 模块开启，但暂未检测到风险。',
  'dsp.panel.headroom.nextStep': '下一步',
  'dsp.panel.headroom.nextWatch': '观察输出',
  'dsp.panel.headroom.nextWatchDetail': '输出接近上限，建议留意削波。',
  'dsp.panel.headroom.noClip': '无记录',
  'dsp.panel.headroom.note': 'Headroom 只负责预留电平空间，不再混进 EQ 或 FIR 的具体调音。',
  'dsp.panel.headroom.presetsAria': 'Headroom 预设',
  'dsp.panel.headroom.primaryAction': '应用 {value}',
  'dsp.panel.headroom.reasonChannel': '声道工具可能提高电平。',
  'dsp.panel.headroom.reasonClipping': '检测到削波。',
  'dsp.panel.headroom.reasonDirect': 'Headroom 只在 DSP 路径生效；当前 EQ / FIR / 声道工具都未启用，原生直通不会被它处理。',
  'dsp.panel.headroom.reasonEq': 'EQ 曲线可能提高电平。',
  'dsp.panel.headroom.reasonLive': '实时余量偏低。',
  'dsp.panel.headroom.reasonOutput': '输出估算接近满幅。',
  'dsp.panel.headroom.reasonSrcTruePeak': 'ECHO SRC / FIR 可能暴露 intersample peak，建议至少预留 -3 dB。',
  'dsp.panel.headroom.reasonRoom': 'FIR / 房间校正可能提高电平。',
  'dsp.panel.headroom.reasonSafe': '当前信号安全。',
  'dsp.panel.headroom.recommendation': '建议',
  'dsp.panel.headroom.recommendationSafe': '安全',
  'dsp.panel.headroom.reserve': '预留余量',
  'dsp.panel.headroom.safePolicy': '安全优先',
  'dsp.panel.headroom.safetyActions': '快速保护',
  'dsp.panel.headroom.status': '状态',
  'dsp.panel.headroom.statusClose': '接近上限',
  'dsp.panel.headroom.statusRisk': '存在风险',
  'dsp.panel.headroom.statusSafe': '安全',
  'dsp.panel.room.future.recent': '最近 IR',
  'dsp.panel.room.future.response': '响应预览',
  'dsp.panel.room.hero.activeDetail': '卷积正在参与输出链。',
  'dsp.panel.room.hero.activeTitle': 'FIR 已启用',
  'dsp.panel.room.hero.emptyDetail': '导入 IR 后才能启用房间校正。',
  'dsp.panel.room.hero.emptyTitle': '未载入 IR',
  'dsp.panel.room.hero.loadedDetail': 'IR 已载入，可以启用。',
  'dsp.panel.room.hero.loadedTitle': 'IR 已载入',
  'dsp.panel.room.hero.state': '状态',
  'dsp.panel.room.kicker': '空间处理',
  'dsp.panel.room.nextEnable': '启用 FIR',
  'dsp.panel.room.nextEnableDetail': 'IR 已准备好，可以试听。',
  'dsp.panel.room.nextImport': '导入 IR',
  'dsp.panel.room.nextImportDetail': '先选择一个卷积文件。',
  'dsp.panel.room.nextListen': '继续试听',
  'dsp.panel.room.nextListenDetail': '确认校正后音量和相位正常。',
  'dsp.panel.room.nextTrim': '降低 Trim',
  'dsp.panel.room.nextTrimDetail': 'FIR 输出存在削波风险。',
  'dsp.panel.room.note': 'FIR / 房间校正只处理卷积和 IR，不再和 EQ 预设混在一起。',
  'dsp.panel.room.quickTrim': '快速 Trim',
  'dsp.panel.room.routeTitle': '路径',
  'dsp.panel.room.safeEnableHint': '先预留 -6 dB Headroom，再启用 FIR。',
  'dsp.panel.room.safetyRisk': '请降低 Trim 或 Headroom。',
  'dsp.panel.room.safetySafe': '输出链当前安全。',
  'dsp.panel.room.safetyTitle': '安全',
  'dsp.panel.room.trim': 'Trim',
  'dsp.panel.safety.kicker': '输出安全',
  'dsp.panel.safety.heroProtectedTitle': '输出链路受保护',
  'dsp.panel.safety.heroProtectedDetail': 'DSP 正在参与播放，输出安全会持续监控削波、余量和 bit-perfect 路径。',
  'dsp.panel.safety.heroRiskTitle': '检测到输出风险',
  'dsp.panel.safety.heroRiskDetail': '当前链路有削波或余量风险，先降低 Headroom、EQ 增益或 FIR Trim。',
  'dsp.panel.safety.heroDirectTitle': '原生直通',
  'dsp.panel.safety.heroDirectDetail': '没有启用 DSP 模块时，播放保持 bit-perfect 候选路径，输出安全只做状态观察。',
  'dsp.panel.safety.chainTitle': '当前链路',
  'dsp.panel.safety.checkTitle': '安全检查',
  'dsp.panel.safety.nextTitle': '建议动作',
  'dsp.panel.safety.nextRisk': '先处理余量',
  'dsp.panel.safety.nextRiskDetail': '有风险时不要继续叠加 EQ / FIR 增益，优先降 Headroom 或相关模块 Trim。',
  'dsp.panel.safety.nextProtected': '继续监听',
  'dsp.panel.safety.nextProtectedDetail': '链路处于 DSP 路径但没有发现削波风险，可以继续观察实时输出。',
  'dsp.panel.safety.nextDirect': '保持直通',
  'dsp.panel.safety.nextDirectDetail': '当前没有 DSP 处理，适合确认原始输出、设备采样率和 bit-perfect 候选状态。',
  'dsp.panel.safety.routeInput': '输入',
  'dsp.panel.safety.routeHeadroom': '余量',
  'dsp.panel.safety.routeProcess': '处理',
  'dsp.panel.safety.routeOutput': '输出',
  'dsp.panel.safety.checkBitPerfect': 'Bit-perfect',
  'dsp.panel.safety.checkLimiter': '保护限制器',
  'dsp.panel.safety.disableLimiter': '关闭保护限制器',
  'dsp.panel.safety.enableLimiter': '启用保护限制器',
  'dsp.panel.safety.limiterBypassed': '已旁路',
  'dsp.panel.safety.limiterBypassedDetail': '最终保护限制器已关闭，热输出可能削波或失真。',
  'dsp.panel.safety.limiterToggleTitle': '保护限制器',
  'dsp.panel.safety.checkRoom': 'FIR',
  'dsp.panel.safety.checkChannel': '声道工具',
  'dsp.panel.safety.note': '削波保护显示仅供参考；最终仍要用耳朵听是否失真、刺耳或压缩感过强。',
  'dsp.room.status.active': '已启用',
  'dsp.room.status.empty': '未载入',
  'dsp.room.status.error': '错误',
  'dsp.room.status.loaded': '已载入',
  'dsp.stage.input': '输入',
  'dsp.stage.output': '输出',
  'dsp.stage.shape': '塑形',
  'dsp.stage.space': '空间',
  'dsp.stage.stereo': '声道',
  'dsp.status.active': '已启用',
  'dsp.status.auto': '自动',
  'dsp.status.balanceActive': '声道处理中',
  'dsp.status.bypassed': '已旁路',
  'dsp.status.candidate': '候选',
  'dsp.status.clear': '正常',
  'dsp.status.direct': '直通',
  'dsp.status.disabledByDsp': 'DSP 路径',
  'dsp.status.dspPath': 'DSP 路径',
  'dsp.status.flat': 'Flat',
  'dsp.status.headroomRisk': '余量风险',
  'dsp.status.limiterArmed': '待命',
  'dsp.status.limiting': '正在限幅',
  'dsp.status.modulesActive': '{count} 个模块启用',
  'dsp.status.nativeDirect': 'Bit-perfect 路径',
  'dsp.status.noIr': '无 IR',
  'dsp.status.none': '无',
  'dsp.status.protected': '已保护',
  'dsp.status.ready': '就绪',
  'dsp.status.risk': '风险',
  'dsp.status.riskDetected': '检测到风险',
  'dsp.status.shared': 'shared',
  'dsp.status.signalProtected': '信号安全',
  'dsp.status.stereoDirect': '立体声直通',
  'dsp.status.systemOutput': '系统输出',
};

const dspLocalTextEnUS: Record<string, string> = {
  ...dspLocalTextZhCN,
  'dsp.action.clear': 'Clear',
  'dsp.action.disableChannel': 'Disable channel compensation',
  'dsp.action.disableFir': 'Disable FIR',
  'dsp.action.enableChannel': 'Enable channel compensation',
  'dsp.action.enableFir': 'Enable FIR',
  'dsp.action.enableFirSafely': 'Enable safely',
  'dsp.action.importIr': 'Import IR',
  'dsp.action.refresh': 'Refresh status',
  'dsp.action.reset': 'Reset',
  'dsp.action.save': 'Save',
  'dsp.aria.chain': 'DSP module chain',
  'dsp.aria.modules': 'DSP modules',
  'dsp.aria.pipeline': 'DSP pipeline',
  'dsp.aria.workspace': 'DSP workspace',
  'dsp.brand.subtitle': 'Signal Control',
  'dsp.stage.src': 'Sample rate',
  'dsp.error.channelBridge': 'Channel tools are unavailable.',
  'dsp.error.desktopBridge': 'Desktop bridge is unavailable.',
  'dsp.error.dspBridge': 'DSP bridge is unavailable.',
  'dsp.error.firBridge': 'FIR bridge is unavailable.',
  'dsp.label.bitPerfect': 'Bit-perfect',
  'dsp.label.currentModule': 'Current module',
  'dsp.label.module': 'DSP module',
  'dsp.label.moduleStatus': 'Module status',
  'dsp.label.output': 'Output',
  'dsp.metric.bitPerfect': 'Bit-perfect',
  'dsp.metric.clipping': 'Clipping',
  'dsp.metric.dsp': 'DSP',
  'dsp.metric.inputPeak': 'Input peak',
  'dsp.metric.ir': 'IR',
  'dsp.metric.latency': 'Latency',
  'dsp.metric.liveHeadroom': 'Live headroom',
  'dsp.metric.truePeak': 'True Peak',
  'dsp.metric.mode': 'Mode',
  'dsp.metric.outputEstimate': 'Output estimate',
  'dsp.metric.reason': 'Reason',
  'dsp.metric.sampleRate': 'Sample rate',
  'dsp.metric.taps': 'Taps',
  'dsp.module.channel.description': 'Balance, delay, mono',
  'dsp.module.channel.title': 'Channel tools',
  'dsp.module.eq.description': 'Bands, preamp, presets',
  'dsp.module.eq.title': 'Parametric EQ',
  'dsp.module.headroom.description': 'Reserve DSP headroom',
  'dsp.module.headroom.title': 'Headroom',
  'dsp.module.headphone.description': 'OPRA headphone curves',
  'dsp.module.headphone.title': 'Headphone correction',
  'dsp.module.room.description': 'IR convolution only',
  'dsp.module.room.title': 'FIR / Room correction',
  'dsp.module.safety.description': 'Final output monitor',
  'dsp.module.safety.title': 'Output safety',
  'dsp.panel.channel.advanced': 'Advanced channel',
  'dsp.panel.channel.balance': 'Stereo balance',
  'dsp.panel.channel.bandCompensation': 'Band compensation',
  'dsp.panel.channel.bandHigh': 'High',
  'dsp.panel.channel.bandLow': 'Low',
  'dsp.panel.channel.bandMid': 'Mid',
  'dsp.panel.channel.centered': 'Centered',
  'dsp.panel.channel.compare': 'A/B compare',
  'dsp.panel.channel.compareActive': 'Bypassing',
  'dsp.panel.channel.compareHint': 'Temporarily bypass channel processing to compare the stereo image before and after compensation.',
  'dsp.panel.channel.compensationDetail': 'Defaults to attenuating the louder side, useful for headphone channel imbalance that cannot be repaired.',
  'dsp.panel.channel.compensationOff': 'Off',
  'dsp.panel.channel.compensationOn': 'On',
  'dsp.panel.channel.compensationTitle': 'Imbalance compensation',
  'dsp.panel.channel.constantPower': 'Constant power',
  'dsp.panel.channel.delaySkew': 'Delay skew',
  'dsp.panel.channel.he90Hint': 'Start from 0.25 dB and fine tune while listening to centered vocals.',
  'dsp.panel.channel.invertLeft': 'Invert left',
  'dsp.panel.channel.invertRight': 'Invert right',
  'dsp.panel.channel.kicker': 'Channel tools',
  'dsp.panel.channel.leansLeft': 'Left {value}',
  'dsp.panel.channel.leansRight': 'Right {value}',
  'dsp.panel.channel.leftDelay': 'Left delay',
  'dsp.panel.channel.leftGain': 'Left gain',
  'dsp.panel.channel.leftOutput': 'Left output',
  'dsp.panel.channel.leftTooLoud': 'Left side louder',
  'dsp.panel.channel.modePro': 'Pro',
  'dsp.panel.channel.modeSimple': 'Simple',
  'dsp.panel.channel.mono.left': 'Left only',
  'dsp.panel.channel.mono.off': 'Mono off',
  'dsp.panel.channel.mono.right': 'Right only',
  'dsp.panel.channel.mono.sum': 'Sum mono',
  'dsp.panel.channel.monoHint': 'Sum mono plays both sides; left-only or right-only mutes the other side.',
  'dsp.panel.channel.monoTools': 'Mono / Check',
  'dsp.panel.channel.note': 'Channel tools are separated from Parametric EQ, for checking stereo image, left/right differences, and mono compatibility.',
  'dsp.panel.channel.phaseTools': 'Phase / Routing',
  'dsp.panel.channel.presetDefaultName': 'Headphone imbalance compensation',
  'dsp.panel.channel.presetEmpty': 'No saved channel profiles yet.',
  'dsp.panel.channel.presetName': 'Profile name',
  'dsp.panel.channel.presetPrompt': 'Name this headphone profile',
  'dsp.panel.channel.presets': 'Headphone profiles',
  'dsp.panel.channel.removePreset': 'Remove',
  'dsp.panel.channel.renamePreset': 'Rename',
  'dsp.panel.channel.renamePrompt': 'Rename this headphone profile',
  'dsp.panel.channel.rightDelay': 'Right delay',
  'dsp.panel.channel.rightGain': 'Right gain',
  'dsp.panel.channel.rightOutput': 'Right output',
  'dsp.panel.channel.rightTooLoud': 'Right side louder',
  'dsp.panel.channel.safeAttenuation': 'For electrostatic headphones, prefer attenuation compensation to avoid raising output level.',
  'dsp.panel.channel.saveCurrent': 'Save current settings',
  'dsp.panel.channel.selectPreset': 'Select profile',
  'dsp.panel.channel.step': 'Step',
  'dsp.panel.channel.swap': 'Swap left/right',
  'dsp.panel.channel.swapCompensation': 'Swap compensation direction',
  'dsp.panel.channel.switchPreset': 'Switch',
  'dsp.panel.channel.trimCenter': 'Clear imbalance',
  'dsp.panel.headroom.applyRecommended': 'Apply recommendation',
  'dsp.panel.headroom.budgetAria': 'Headroom budget',
  'dsp.panel.headroom.clipCount': 'Clip count',
  'dsp.panel.headroom.clipCountValue': '{count} times',
  'dsp.panel.headroom.guardActive': 'Active',
  'dsp.panel.headroom.guardDirect': 'Direct',
  'dsp.panel.headroom.guardStandby': 'Standby',
  'dsp.panel.headroom.guardState': 'Guard state',
  'dsp.panel.headroom.kicker': 'Headroom management',
  'dsp.panel.headroom.lastClip': 'Last clip',
  'dsp.panel.headroom.makeConservative': 'Set to -6 dB',
  'dsp.panel.headroom.makeSafe': 'Set to {value}',
  'dsp.panel.headroom.modeAria': 'Headroom mode',
  'dsp.panel.headroom.modeDaily': 'Daily',
  'dsp.panel.headroom.modeDailyDetail': 'Light DSP reserve.',
  'dsp.panel.headroom.modeDirect': 'Direct',
  'dsp.panel.headroom.modeDirectDetail': 'No extra level reduction.',
  'dsp.panel.headroom.modeDsp': 'DSP',
  'dsp.panel.headroom.modeDspDetail': 'Leave safe space for EQ/FIR.',
  'dsp.panel.headroom.nextDirect': 'Keep direct',
  'dsp.panel.headroom.nextDirectDetail': 'No DSP reserve risk is currently needed.',
  'dsp.panel.headroom.nextHoldRisk': 'Reduce headroom first',
  'dsp.panel.headroom.nextHoldRiskDetail': 'Clipping risk detected. Reserve headroom first.',
  'dsp.panel.headroom.nextProtect': 'Apply protection headroom',
  'dsp.panel.headroom.nextProtectDetail': 'Output is near full scale. Reduce level immediately.',
  'dsp.panel.headroom.nextReady': 'Keep monitoring',
  'dsp.panel.headroom.nextReadyDetail': 'DSP already has safe headroom.',
  'dsp.panel.headroom.nextStandby': 'Keep standby',
  'dsp.panel.headroom.nextStandbyDetail': 'DSP modules are enabled, but no risk is detected yet.',
  'dsp.panel.headroom.nextStep': 'Next step',
  'dsp.panel.headroom.nextWatch': 'Watch output',
  'dsp.panel.headroom.nextWatchDetail': 'Output is close to the limit. Watch for clipping.',
  'dsp.panel.headroom.noClip': 'No record',
  'dsp.panel.headroom.note': 'Headroom only reserves level space; it no longer mixes specific EQ or FIR tuning here.',
  'dsp.panel.headroom.presetsAria': 'Headroom presets',
  'dsp.panel.headroom.primaryAction': 'Apply {value}',
  'dsp.panel.headroom.reasonChannel': 'Channel tools may increase level.',
  'dsp.panel.headroom.reasonClipping': 'Clipping detected.',
  'dsp.panel.headroom.reasonDirect': 'Headroom only works in the DSP path; when EQ, FIR, and channel tools are all off, native direct is not processed by it.',
  'dsp.panel.headroom.reasonEq': 'EQ curves may increase level.',
  'dsp.panel.headroom.reasonLive': 'Live headroom is low.',
  'dsp.panel.headroom.reasonOutput': 'Estimated output is near full scale.',
  'dsp.panel.headroom.reasonSrcTruePeak': 'ECHO SRC / FIR can reveal intersample peaks; reserve at least -3 dB.',
  'dsp.panel.headroom.reasonRoom': 'FIR / room correction may increase level.',
  'dsp.panel.headroom.reasonSafe': 'Current signal is safe.',
  'dsp.panel.headroom.recommendation': 'Recommendation',
  'dsp.panel.headroom.recommendationSafe': 'Safe',
  'dsp.panel.headroom.reserve': 'Reserve headroom',
  'dsp.panel.headroom.safePolicy': 'Safety first',
  'dsp.panel.headroom.safetyActions': 'Quick protection',
  'dsp.panel.headroom.status': 'Status',
  'dsp.panel.headroom.statusClose': 'Near limit',
  'dsp.panel.headroom.statusRisk': 'Risk detected',
  'dsp.panel.headroom.statusSafe': 'Safe',
  'dsp.panel.room.future.recent': 'Recent IR',
  'dsp.panel.room.future.response': 'Response preview',
  'dsp.panel.room.hero.activeDetail': 'Convolution is participating in the output chain.',
  'dsp.panel.room.hero.activeTitle': 'FIR enabled',
  'dsp.panel.room.hero.emptyDetail': 'Import an IR before enabling room correction.',
  'dsp.panel.room.hero.emptyTitle': 'No IR loaded',
  'dsp.panel.room.hero.loadedDetail': 'IR is loaded and ready to enable.',
  'dsp.panel.room.hero.loadedTitle': 'IR loaded',
  'dsp.panel.room.hero.state': 'State',
  'dsp.panel.room.kicker': 'Spatial processing',
  'dsp.panel.room.nextEnable': 'Enable FIR',
  'dsp.panel.room.nextEnableDetail': 'IR is ready. Try listening.',
  'dsp.panel.room.nextImport': 'Import IR',
  'dsp.panel.room.nextImportDetail': 'Choose a convolution file first.',
  'dsp.panel.room.nextListen': 'Keep listening',
  'dsp.panel.room.nextListenDetail': 'Confirm volume and phase are normal after correction.',
  'dsp.panel.room.nextTrim': 'Lower trim',
  'dsp.panel.room.nextTrimDetail': 'FIR output has clipping risk.',
  'dsp.panel.room.note': 'FIR / room correction only handles convolution and IR; it is no longer mixed with EQ presets.',
  'dsp.panel.room.quickTrim': 'Quick trim',
  'dsp.panel.room.routeTitle': 'Route',
  'dsp.panel.room.safeEnableHint': 'Reserve -6 dB headroom before enabling FIR.',
  'dsp.panel.room.safetyRisk': 'Lower Trim or Headroom.',
  'dsp.panel.room.safetySafe': 'The output chain is currently safe.',
  'dsp.panel.room.safetyTitle': 'Safety',
  'dsp.panel.room.trim': 'Trim',
  'dsp.panel.safety.kicker': 'Output safety',
  'dsp.panel.safety.heroProtectedTitle': 'Output chain protected',
  'dsp.panel.safety.heroProtectedDetail': 'DSP is participating in playback, so output safety continues monitoring clipping, headroom, and bit-perfect route status.',
  'dsp.panel.safety.heroRiskTitle': 'Output risk detected',
  'dsp.panel.safety.heroRiskDetail': 'The current chain has clipping or headroom risk. Lower Headroom, EQ gain, or FIR Trim first.',
  'dsp.panel.safety.heroDirectTitle': 'Native direct',
  'dsp.panel.safety.heroDirectDetail': 'When no DSP module is enabled, playback stays on the bit-perfect candidate route and output safety only observes status.',
  'dsp.panel.safety.chainTitle': 'Current chain',
  'dsp.panel.safety.checkTitle': 'Safety check',
  'dsp.panel.safety.nextTitle': 'Suggested action',
  'dsp.panel.safety.nextRisk': 'Handle headroom first',
  'dsp.panel.safety.nextRiskDetail': 'Do not keep stacking EQ / FIR gain while risk exists. Lower Headroom or the related module Trim first.',
  'dsp.panel.safety.nextProtected': 'Keep monitoring',
  'dsp.panel.safety.nextProtectedDetail': 'The chain is in the DSP path and no clipping risk was found. Continue watching live output.',
  'dsp.panel.safety.nextDirect': 'Keep direct',
  'dsp.panel.safety.nextDirectDetail': 'No DSP processing is active. This is suitable for checking original output, device sample rate, and bit-perfect candidate status.',
  'dsp.panel.safety.routeInput': 'Input',
  'dsp.panel.safety.routeHeadroom': 'Headroom',
  'dsp.panel.safety.routeProcess': 'Process',
  'dsp.panel.safety.routeOutput': 'Output',
  'dsp.panel.safety.checkBitPerfect': 'Bit-perfect',
  'dsp.panel.safety.checkLimiter': 'Protection limiter',
  'dsp.panel.safety.disableLimiter': 'Disable protection limiter',
  'dsp.panel.safety.enableLimiter': 'Enable protection limiter',
  'dsp.panel.safety.limiterBypassed': 'Bypassed',
  'dsp.panel.safety.limiterBypassedDetail': 'The final protection limiter is off. Hot output may clip or distort.',
  'dsp.panel.safety.limiterToggleTitle': 'Protection limiter',
  'dsp.panel.safety.checkRoom': 'FIR',
  'dsp.panel.safety.checkChannel': 'Channel tools',
  'dsp.panel.safety.note': 'Clipping-protection readouts are only a reference; trust your ears for distortion, harshness, or excessive compression.',
  'dsp.room.status.active': 'Active',
  'dsp.room.status.empty': 'Not loaded',
  'dsp.room.status.error': 'Error',
  'dsp.room.status.loaded': 'Loaded',
  'dsp.stage.input': 'Input',
  'dsp.stage.output': 'Output',
  'dsp.stage.shape': 'Shape',
  'dsp.stage.space': 'Space',
  'dsp.stage.stereo': 'Stereo',
  'dsp.status.active': 'Enabled',
  'dsp.status.auto': 'Auto',
  'dsp.status.balanceActive': 'Channel processing',
  'dsp.status.bypassed': 'Bypassed',
  'dsp.status.candidate': 'Candidate',
  'dsp.status.clear': 'Clear',
  'dsp.status.direct': 'Direct',
  'dsp.status.disabledByDsp': 'DSP path',
  'dsp.status.dspPath': 'DSP path',
  'dsp.status.flat': 'Flat',
  'dsp.status.headroomRisk': 'Headroom risk',
  'dsp.status.limiterArmed': 'Armed',
  'dsp.status.limiting': 'Limiting',
  'dsp.status.modulesActive': '{count} modules active',
  'dsp.status.nativeDirect': 'Bit-perfect path',
  'dsp.status.noIr': 'No IR',
  'dsp.status.none': 'None',
  'dsp.status.protected': 'Protected',
  'dsp.status.ready': 'Ready',
  'dsp.status.risk': 'Risk',
  'dsp.status.riskDetected': 'Risk detected',
  'dsp.status.shared': 'shared',
  'dsp.status.signalProtected': 'Signal protected',
  'dsp.status.stereoDirect': 'Stereo direct',
  'dsp.status.systemOutput': 'System output',
};

const dspLocalTextZhTW: Record<string, string> = {
  // Traditional Chinese (OpenCC from zh-CN)
  'dsp.action.clear': '清除',
  'dsp.action.disableChannel': '關閉聲道補償',
  'dsp.action.disableFir': '關閉 FIR',
  'dsp.action.enableChannel': '開啟聲道補償',
  'dsp.action.enableFir': '啟用 FIR',
  'dsp.action.enableFirSafely': '安全啟用',
  'dsp.action.importIr': '匯入 IR',
  'dsp.action.refresh': '重新整理狀態',
  'dsp.action.reset': '重置',
  'dsp.action.save': '儲存',
  'dsp.aria.chain': 'DSP 模組鏈',
  'dsp.aria.modules': 'DSP 模組',
  'dsp.aria.pipeline': 'DSP 路徑',
  'dsp.aria.workspace': 'DSP 工作區',
  'dsp.brand.subtitle': 'Signal Control',
  'dsp.stage.src': '取樣率',
  'dsp.error.channelBridge': '聲道工具不可用。',
  'dsp.error.desktopBridge': '桌面橋接不可用。',
  'dsp.error.dspBridge': 'DSP 橋接不可用。',
  'dsp.error.firBridge': 'FIR 橋接不可用。',
  'dsp.label.bitPerfect': 'Bit-perfect',
  'dsp.label.currentModule': '當前模組',
  'dsp.label.module': 'DSP 模組',
  'dsp.label.moduleStatus': '模組狀態',
  'dsp.label.output': '輸出',
  'dsp.metric.bitPerfect': 'Bit-perfect',
  'dsp.metric.clipping': '削波',
  'dsp.metric.dsp': 'DSP',
  'dsp.metric.inputPeak': '輸入峰值',
  'dsp.metric.ir': 'IR',
  'dsp.metric.latency': '延遲',
  'dsp.metric.liveHeadroom': '即時餘量',
  'dsp.metric.truePeak': 'True Peak',
  'dsp.metric.mode': '模式',
  'dsp.metric.outputEstimate': '輸出估算',
  'dsp.metric.reason': '原因',
  'dsp.metric.sampleRate': '取樣率',
  'dsp.metric.taps': 'Taps',
  'dsp.module.channel.description': '平衡、延遲、Mono',
  'dsp.module.channel.title': '聲道工具',
  'dsp.module.eq.description': '頻段、前級、預設',
  'dsp.module.eq.title': '引數 EQ',
  'dsp.module.headroom.description': 'DSP 前餘量預留',
  'dsp.module.headroom.title': 'Headroom',
  'dsp.module.headphone.description': 'OPRA 耳機曲線',
  'dsp.module.headphone.title': '耳機校正',
  'dsp.module.room.description': '只處理 IR 卷積',
  'dsp.module.room.title': 'FIR / 房間校正',
  'dsp.module.safety.description': '只監控輸出鏈',
  'dsp.module.safety.title': '輸出安全',
  'dsp.panel.channel.advanced': '高階聲道',
  'dsp.panel.channel.balance': '聲像平衡',
  'dsp.panel.channel.bandCompensation': '分頻段左右補償',
  'dsp.panel.channel.bandHigh': '高頻',
  'dsp.panel.channel.bandLow': '低頻',
  'dsp.panel.channel.bandMid': '中頻',
  'dsp.panel.channel.centered': '中心穩定',
  'dsp.panel.channel.compensationDetail': '預設只降低偏響一側，適合不可維修的耳機偏音補償。',
  'dsp.panel.channel.compensationOff': '已關閉',
  'dsp.panel.channel.compensationOn': '已開啟',
  'dsp.panel.channel.compensationTitle': '偏音補償',
  'dsp.panel.channel.constantPower': '恆功率',
  'dsp.panel.channel.delaySkew': '延遲差',
  'dsp.panel.channel.he90Hint': '建議從 0.25 dB 開始，邊聽居中人聲邊微調。',
  'dsp.panel.channel.invertLeft': '左聲道反相',
  'dsp.panel.channel.invertRight': '右聲道反相',
  'dsp.panel.channel.kicker': '聲道工具',
  'dsp.panel.channel.leansLeft': '偏左 {value}',
  'dsp.panel.channel.leansRight': '偏右 {value}',
  'dsp.panel.channel.leftDelay': '左聲道延遲',
  'dsp.panel.channel.leftGain': '左聲道增益',
  'dsp.panel.channel.leftOutput': '左輸出',
  'dsp.panel.channel.leftTooLoud': '左側偏響',
  'dsp.panel.channel.monoTools': 'Mono / 檢查',
  'dsp.panel.channel.mono.left': '只聽左聲道',
  'dsp.panel.channel.mono.off': '關閉 Mono',
  'dsp.panel.channel.mono.right': '只聽右聲道',
  'dsp.panel.channel.mono.sum': '合併 Mono',
  'dsp.panel.channel.note': '聲道工具已從引數 EQ 中分離，適合檢查聲像、左右耳差異和單聲道相容。',
  'dsp.panel.channel.modePro': 'Pro',
  'dsp.panel.channel.modeSimple': 'Simple',
  'dsp.panel.channel.presetDefaultName': '耳機偏音補償',
  'dsp.panel.channel.presetEmpty': '還沒有儲存的聲道方案。',
  'dsp.panel.channel.presetName': '方案名稱',
  'dsp.panel.channel.presetPrompt': '給這個耳機方案起個名字',
  'dsp.panel.channel.presets': '耳機方案',
  'dsp.panel.channel.phaseTools': '相位 / 路由',
  'dsp.panel.channel.removePreset': '移除',
  'dsp.panel.channel.saveCurrent': '儲存當前引數',
  'dsp.panel.channel.selectPreset': '選擇方案',
  'dsp.panel.channel.switchPreset': '切換',
  'dsp.panel.channel.renamePreset': '重新命名',
  'dsp.panel.channel.renamePrompt': '重新命名這個耳機方案',
  'dsp.panel.channel.rightDelay': '右聲道延遲',
  'dsp.panel.channel.rightGain': '右聲道增益',
  'dsp.panel.channel.rightOutput': '右輸出',
  'dsp.panel.channel.rightTooLoud': '右側偏響',
  'dsp.panel.channel.step': '步進',
  'dsp.panel.channel.swap': '交換左右',
  'dsp.panel.channel.swapCompensation': '交換補償方向',
  'dsp.panel.channel.safeAttenuation': '靜電耳機建議使用衰減補償，避擴音高輸出電平。',
  'dsp.panel.channel.compare': 'A/B 對比',
  'dsp.panel.channel.compareActive': '正在旁路',
  'dsp.panel.channel.compareHint': '臨時關閉聲道處理，用來對比補償前後的聲像。',
  'dsp.panel.channel.monoHint': '合併 Mono 會兩邊都響；只聽左/右會靜音另一邊。',
  'dsp.panel.channel.trimCenter': '偏音清零',
  'dsp.panel.headroom.applyRecommended': '應用建議',
  'dsp.panel.headroom.budgetAria': 'Headroom 預算',
  'dsp.panel.headroom.clipCount': '削波次數',
  'dsp.panel.headroom.clipCountValue': '{count} 次',
  'dsp.panel.headroom.guardActive': '已啟用',
  'dsp.panel.headroom.guardDirect': '直通',
  'dsp.panel.headroom.guardStandby': '待命',
  'dsp.panel.headroom.guardState': '保護狀態',
  'dsp.panel.headroom.kicker': 'Headroom 管理',
  'dsp.panel.headroom.lastClip': '最近削波',
  'dsp.panel.headroom.makeConservative': '設為 -6 dB',
  'dsp.panel.headroom.makeSafe': '設為 {value}',
  'dsp.panel.headroom.modeAria': 'Headroom 模式',
  'dsp.panel.headroom.modeDaily': '日常',
  'dsp.panel.headroom.modeDailyDetail': '輕量 DSP 預留。',
  'dsp.panel.headroom.modeDirect': '直通',
  'dsp.panel.headroom.modeDirectDetail': '不額外降低電平。',
  'dsp.panel.headroom.modeDsp': 'DSP',
  'dsp.panel.headroom.modeDspDetail': '給 EQ/FIR 留出安全空間。',
  'dsp.panel.headroom.nextDirect': '保持直通',
  'dsp.panel.headroom.nextDirectDetail': '當前沒有需要預留的 DSP 風險。',
  'dsp.panel.headroom.nextHoldRisk': '先降低餘量',
  'dsp.panel.headroom.nextHoldRiskDetail': '檢測到削波風險，建議先預留 Headroom。',
  'dsp.panel.headroom.nextProtect': '應用保護餘量',
  'dsp.panel.headroom.nextProtectDetail': '當前輸出接近滿幅，建議立即降低。',
  'dsp.panel.headroom.nextReady': '繼續監聽',
  'dsp.panel.headroom.nextReadyDetail': 'DSP 已有安全餘量。',
  'dsp.panel.headroom.nextStandby': '保持待命',
  'dsp.panel.headroom.nextStandbyDetail': '有 DSP 模組開啟，但暫未檢測到風險。',
  'dsp.panel.headroom.nextStep': '下一步',
  'dsp.panel.headroom.nextWatch': '觀察輸出',
  'dsp.panel.headroom.nextWatchDetail': '輸出接近上限，建議留意削波。',
  'dsp.panel.headroom.noClip': '無記錄',
  'dsp.panel.headroom.note': 'Headroom 只負責預留電平空間，不再混進 EQ 或 FIR 的具體調音。',
  'dsp.panel.headroom.presetsAria': 'Headroom 預設',
  'dsp.panel.headroom.primaryAction': '應用 {value}',
  'dsp.panel.headroom.reasonChannel': '聲道工具可能提高電平。',
  'dsp.panel.headroom.reasonClipping': '檢測到削波。',
  'dsp.panel.headroom.reasonDirect': 'Headroom 只在 DSP 路徑生效；當前 EQ / FIR / 聲道工具都未啟用，原生直通不會被它處理。',
  'dsp.panel.headroom.reasonEq': 'EQ 曲線可能提高電平。',
  'dsp.panel.headroom.reasonLive': '即時餘量偏低。',
  'dsp.panel.headroom.reasonOutput': '輸出估算接近滿幅。',
  'dsp.panel.headroom.reasonSrcTruePeak': 'ECHO SRC / FIR 可能暴露 intersample peak，建議至少預留 -3 dB。',
  'dsp.panel.headroom.reasonRoom': 'FIR / 房間校正可能提高電平。',
  'dsp.panel.headroom.reasonSafe': '當前訊號安全。',
  'dsp.panel.headroom.recommendation': '建議',
  'dsp.panel.headroom.recommendationSafe': '安全',
  'dsp.panel.headroom.reserve': '預留餘量',
  'dsp.panel.headroom.safePolicy': '安全優先',
  'dsp.panel.headroom.safetyActions': '快速保護',
  'dsp.panel.headroom.status': '狀態',
  'dsp.panel.headroom.statusClose': '接近上限',
  'dsp.panel.headroom.statusRisk': '存在風險',
  'dsp.panel.headroom.statusSafe': '安全',
  'dsp.panel.room.future.recent': '最近 IR',
  'dsp.panel.room.future.response': '響應預覽',
  'dsp.panel.room.hero.activeDetail': '卷積正在參與輸出鏈。',
  'dsp.panel.room.hero.activeTitle': 'FIR 已啟用',
  'dsp.panel.room.hero.emptyDetail': '匯入 IR 後才能啟用房間校正。',
  'dsp.panel.room.hero.emptyTitle': '未載入 IR',
  'dsp.panel.room.hero.loadedDetail': 'IR 已載入，可以啟用。',
  'dsp.panel.room.hero.loadedTitle': 'IR 已載入',
  'dsp.panel.room.hero.state': '狀態',
  'dsp.panel.room.kicker': '空間處理',
  'dsp.panel.room.nextEnable': '啟用 FIR',
  'dsp.panel.room.nextEnableDetail': 'IR 已準備好，可以試聽。',
  'dsp.panel.room.nextImport': '匯入 IR',
  'dsp.panel.room.nextImportDetail': '先選擇一個卷積檔案。',
  'dsp.panel.room.nextListen': '繼續試聽',
  'dsp.panel.room.nextListenDetail': '確認校正後音量和相位正常。',
  'dsp.panel.room.nextTrim': '降低 Trim',
  'dsp.panel.room.nextTrimDetail': 'FIR 輸出存在削波風險。',
  'dsp.panel.room.note': 'FIR / 房間校正只處理卷積和 IR，不再和 EQ 預設混在一起。',
  'dsp.panel.room.quickTrim': '快速 Trim',
  'dsp.panel.room.routeTitle': '路徑',
  'dsp.panel.room.safeEnableHint': '先預留 -6 dB Headroom，再啟用 FIR。',
  'dsp.panel.room.safetyRisk': '請降低 Trim 或 Headroom。',
  'dsp.panel.room.safetySafe': '輸出鏈當前安全。',
  'dsp.panel.room.safetyTitle': '安全',
  'dsp.panel.room.trim': 'Trim',
  'dsp.panel.safety.kicker': '輸出安全',
  'dsp.panel.safety.heroProtectedTitle': '輸出鏈路受保護',
  'dsp.panel.safety.heroProtectedDetail': 'DSP 正在參與播放，輸出安全會持續監控削波、餘量和 bit-perfect 路徑。',
  'dsp.panel.safety.heroRiskTitle': '檢測到輸出風險',
  'dsp.panel.safety.heroRiskDetail': '當前鏈路有削波或餘量風險，先降低 Headroom、EQ 增益或 FIR Trim。',
  'dsp.panel.safety.heroDirectTitle': '原生直通',
  'dsp.panel.safety.heroDirectDetail': '沒有啟用 DSP 模組時，播放保持 bit-perfect 候選路徑，輸出安全只做狀態觀察。',
  'dsp.panel.safety.chainTitle': '當前鏈路',
  'dsp.panel.safety.checkTitle': '安全檢查',
  'dsp.panel.safety.nextTitle': '建議動作',
  'dsp.panel.safety.nextRisk': '先處理餘量',
  'dsp.panel.safety.nextRiskDetail': '有風險時不要繼續疊加 EQ / FIR 增益，優先降 Headroom 或相關模組 Trim。',
  'dsp.panel.safety.nextProtected': '繼續監聽',
  'dsp.panel.safety.nextProtectedDetail': '鏈路處於 DSP 路徑但沒有發現削波風險，可以繼續觀察即時輸出。',
  'dsp.panel.safety.nextDirect': '保持直通',
  'dsp.panel.safety.nextDirectDetail': '當前沒有 DSP 處理，適合確認原始輸出、裝置取樣率和 bit-perfect 候選狀態。',
  'dsp.panel.safety.routeInput': '輸入',
  'dsp.panel.safety.routeHeadroom': '餘量',
  'dsp.panel.safety.routeProcess': '處理',
  'dsp.panel.safety.routeOutput': '輸出',
  'dsp.panel.safety.checkBitPerfect': 'Bit-perfect',
  'dsp.panel.safety.checkLimiter': '保護限制器',
  'dsp.panel.safety.disableLimiter': '關閉保護限制器',
  'dsp.panel.safety.enableLimiter': '啟用保護限制器',
  'dsp.panel.safety.limiterBypassed': '已旁路',
  'dsp.panel.safety.limiterBypassedDetail': '最終保護限制器已關閉，熱輸出可能削波或失真。',
  'dsp.panel.safety.limiterToggleTitle': '保護限制器',
  'dsp.panel.safety.checkRoom': 'FIR',
  'dsp.panel.safety.checkChannel': '聲道工具',
  'dsp.panel.safety.note': '削波保護顯示僅供參考；最終仍要用耳朵聽是否失真、刺耳或壓縮感過強。',
  'dsp.room.status.active': '已啟用',
  'dsp.room.status.empty': '未載入',
  'dsp.room.status.error': '錯誤',
  'dsp.room.status.loaded': '已載入',
  'dsp.stage.input': '輸入',
  'dsp.stage.output': '輸出',
  'dsp.stage.shape': '塑形',
  'dsp.stage.space': '空間',
  'dsp.stage.stereo': '聲道',
  'dsp.status.active': '已啟用',
  'dsp.status.auto': '自動',
  'dsp.status.balanceActive': '聲道處理中',
  'dsp.status.bypassed': '已旁路',
  'dsp.status.candidate': '候選',
  'dsp.status.clear': '正常',
  'dsp.status.direct': '直通',
  'dsp.status.disabledByDsp': 'DSP 路徑',
  'dsp.status.dspPath': 'DSP 路徑',
  'dsp.status.flat': 'Flat',
  'dsp.status.headroomRisk': '餘量風險',
  'dsp.status.limiterArmed': '待命',
  'dsp.status.limiting': '正在限幅',
  'dsp.status.modulesActive': '{count} 個模組啟用',
  'dsp.status.nativeDirect': 'Bit-perfect 路徑',
  'dsp.status.noIr': '無 IR',
  'dsp.status.none': '無',
  'dsp.status.protected': '已保護',
  'dsp.status.ready': '就緒',
  'dsp.status.risk': '風險',
  'dsp.status.riskDetected': '檢測到風險',
  'dsp.status.shared': 'shared',
  'dsp.status.signalProtected': '訊號安全',
  'dsp.status.stereoDirect': '立體聲直通',
  'dsp.status.systemOutput': '系統輸出',
};

const dspLocalTextJaJP: Record<string, string> = {
  // Japanese local DSP strings
  'dsp.action.clear': 'クリア',
  'dsp.action.disableChannel': 'チャンネル補正をオフ',
  'dsp.action.disableFir': 'FIR をオフ',
  'dsp.action.enableChannel': 'チャンネル補正をオン',
  'dsp.action.enableFir': 'FIR をオン',
  'dsp.action.enableFirSafely': '安全に有効化',
  'dsp.action.importIr': 'IR をインポート',
  'dsp.action.refresh': '状態を更新',
  'dsp.action.reset': 'リセット',
  'dsp.action.save': '保存',
  'dsp.aria.chain': 'DSP モジュールチェーン',
  'dsp.aria.modules': 'DSP モジュール',
  'dsp.aria.pipeline': 'DSP pipeline',
  'dsp.aria.workspace': 'DSP ワークスペース',
  'dsp.brand.subtitle': 'Signal Control',
  'dsp.stage.src': 'サンプルレート',
  'dsp.error.channelBridge': 'Channel tools are unavailable.',
  'dsp.error.desktopBridge': 'Desktop bridge is unavailable.',
  'dsp.error.dspBridge': 'DSP bridge is unavailable.',
  'dsp.error.firBridge': 'FIR bridge is unavailable.',
  'dsp.label.bitPerfect': 'Bit-perfect',
  'dsp.label.currentModule': 'Current module',
  'dsp.label.module': 'DSP module',
  'dsp.label.moduleStatus': 'Module status',
  'dsp.label.output': 'Output',
  'dsp.metric.bitPerfect': 'Bit-perfect',
  'dsp.metric.clipping': 'Clipping',
  'dsp.metric.dsp': 'DSP',
  'dsp.metric.inputPeak': 'Input peak',
  'dsp.metric.ir': 'IR',
  'dsp.metric.latency': 'Latency',
  'dsp.metric.liveHeadroom': 'Live headroom',
  'dsp.metric.truePeak': 'True Peak',
  'dsp.metric.mode': 'モード',
  'dsp.metric.outputEstimate': 'Output estimate',
  'dsp.metric.reason': 'Reason',
  'dsp.metric.sampleRate': 'サンプルレート',
  'dsp.metric.taps': 'Taps',
  'dsp.module.channel.description': 'Balance, delay, mono',
  'dsp.module.channel.title': 'Channel tools',
  'dsp.module.eq.description': 'Bands, preamp, presets',
  'dsp.module.eq.title': 'Parametric EQ',
  'dsp.module.headroom.description': 'Reserve DSP headroom',
  'dsp.module.headroom.title': 'ヘッドルーム',
  'dsp.module.headphone.description': 'OPRA headphone curves',
  'dsp.module.headphone.title': 'Headphone correction',
  'dsp.module.room.description': 'IR convolution only',
  'dsp.module.room.title': 'FIR / ルーム補正',
  'dsp.module.safety.description': 'Final output monitor',
  'dsp.module.safety.title': 'Output safety',
  'dsp.panel.channel.advanced': 'Advanced channel',
  'dsp.panel.channel.balance': 'Stereo balance',
  'dsp.panel.channel.bandCompensation': 'Band compensation',
  'dsp.panel.channel.bandHigh': 'High',
  'dsp.panel.channel.bandLow': 'Low',
  'dsp.panel.channel.bandMid': 'Mid',
  'dsp.panel.channel.centered': 'Centered',
  'dsp.panel.channel.compensationDetail': 'Defaults to attenuating the louder side, useful for headphone channel imbalance that cannot be repaired.',
  'dsp.panel.channel.compensationOff': 'オフ',
  'dsp.panel.channel.compensationOn': 'On',
  'dsp.panel.channel.compensationTitle': 'Imbalance compensation',
  'dsp.panel.channel.constantPower': 'Constant power',
  'dsp.panel.channel.delaySkew': 'Delay skew',
  'dsp.panel.channel.he90Hint': 'Start from 0.25 dB and fine tune while listening to centered vocals.',
  'dsp.panel.channel.invertLeft': 'Invert left',
  'dsp.panel.channel.invertRight': 'Invert right',
  'dsp.panel.channel.kicker': 'Channel tools',
  'dsp.panel.channel.leansLeft': 'Left {value}',
  'dsp.panel.channel.leansRight': 'Right {value}',
  'dsp.panel.channel.leftDelay': 'Left delay',
  'dsp.panel.channel.leftGain': 'Left gain',
  'dsp.panel.channel.leftOutput': 'Left output',
  'dsp.panel.channel.leftTooLoud': 'Left side louder',
  'dsp.panel.channel.monoTools': 'Mono / Check',
  'dsp.panel.channel.mono.left': 'Left only',
  'dsp.panel.channel.mono.off': 'Mono off',
  'dsp.panel.channel.mono.right': 'Right only',
  'dsp.panel.channel.mono.sum': 'Sum mono',
  'dsp.panel.channel.note': 'Channel tools are separated from Parametric EQ, for checking stereo image, left/right differences, and mono compatibility.',
  'dsp.panel.channel.modePro': 'Pro',
  'dsp.panel.channel.modeSimple': 'Simple',
  'dsp.panel.channel.presetDefaultName': 'Headphone imbalance compensation',
  'dsp.panel.channel.presetEmpty': 'No saved channel profiles yet.',
  'dsp.panel.channel.presetName': 'プロファイル name',
  'dsp.panel.channel.presetPrompt': 'Name this headphone profile',
  'dsp.panel.channel.presets': 'Headphone profiles',
  'dsp.panel.channel.phaseTools': 'Phase / Routing',
  'dsp.panel.channel.removePreset': 'Remove',
  'dsp.panel.channel.saveCurrent': 'Save current settings',
  'dsp.panel.channel.selectPreset': 'Select profile',
  'dsp.panel.channel.switchPreset': 'Switch',
  'dsp.panel.channel.renamePreset': 'Rename',
  'dsp.panel.channel.renamePrompt': 'Rename this headphone profile',
  'dsp.panel.channel.rightDelay': 'Right delay',
  'dsp.panel.channel.rightGain': 'Right gain',
  'dsp.panel.channel.rightOutput': 'Right output',
  'dsp.panel.channel.rightTooLoud': 'Right side louder',
  'dsp.panel.channel.step': 'Step',
  'dsp.panel.channel.swap': 'Swap left/right',
  'dsp.panel.channel.swapCompensation': 'Swap compensation direction',
  'dsp.panel.channel.safeAttenuation': 'For electrostatic headphones, prefer attenuation compensation to avoid raising output level.',
  'dsp.panel.channel.compare': 'A/B compare',
  'dsp.panel.channel.compareActive': 'バイパスing',
  'dsp.panel.channel.compareHint': 'Temporarily bypass channel processing to compare the stereo image before and after compensation.',
  'dsp.panel.channel.monoHint': 'Sum mono plays both sides; left-only or right-only mutes the other side.',
  'dsp.panel.channel.trimCenter': 'Clear imbalance',
  'dsp.panel.headroom.applyRecommended': 'Apply recommendation',
  'dsp.panel.headroom.budgetAria': 'ヘッドルーム budget',
  'dsp.panel.headroom.clipCount': 'Clip count',
  'dsp.panel.headroom.clipCountValue': '{count} times',
  'dsp.panel.headroom.guardActive': '有効',
  'dsp.panel.headroom.guardDirect': 'ダイレクト',
  'dsp.panel.headroom.guardStandby': 'Standby',
  'dsp.panel.headroom.guardState': 'Guard state',
  'dsp.panel.headroom.kicker': 'ヘッドルーム management',
  'dsp.panel.headroom.lastClip': 'Last clip',
  'dsp.panel.headroom.makeConservative': 'Set to -6 dB',
  'dsp.panel.headroom.makeSafe': 'Set to {value}',
  'dsp.panel.headroom.modeAria': 'ヘッドルーム mode',
  'dsp.panel.headroom.modeDaily': 'Daily',
  'dsp.panel.headroom.modeDailyDetail': 'Light DSP reserve.',
  'dsp.panel.headroom.modeDirect': 'ダイレクト',
  'dsp.panel.headroom.modeDirectDetail': 'No extra level reduction.',
  'dsp.panel.headroom.modeDsp': 'DSP',
  'dsp.panel.headroom.modeDspDetail': 'Leave safe space for EQ/FIR.',
  'dsp.panel.headroom.nextDirect': 'Keep direct',
  'dsp.panel.headroom.nextDirectDetail': 'No DSP reserve risk is currently needed.',
  'dsp.panel.headroom.nextHoldRisk': 'Reduce headroom first',
  'dsp.panel.headroom.nextHoldRiskDetail': 'Clipping risk detected. Reserve headroom first.',
  'dsp.panel.headroom.nextProtect': 'Apply protection headroom',
  'dsp.panel.headroom.nextProtectDetail': 'Output is near full scale. Reduce level immediately.',
  'dsp.panel.headroom.nextReady': 'Keep monitoring',
  'dsp.panel.headroom.nextReadyDetail': 'DSP already has safe headroom.',
  'dsp.panel.headroom.nextStandby': 'Keep standby',
  'dsp.panel.headroom.nextStandbyDetail': 'DSP モジュール are enabled, but no risk is detected yet.',
  'dsp.panel.headroom.nextStep': 'Next step',
  'dsp.panel.headroom.nextWatch': 'Watch output',
  'dsp.panel.headroom.nextWatchDetail': 'Output is close to the limit. Watch for clipping.',
  'dsp.panel.headroom.noClip': 'No record',
  'dsp.panel.headroom.note': 'ヘッドルーム only reserves level space; it no longer mixes specific EQ or FIR tuning here.',
  'dsp.panel.headroom.presetsAria': 'ヘッドルーム presets',
  'dsp.panel.headroom.primaryAction': 'Apply {value}',
  'dsp.panel.headroom.reasonChannel': 'Channel tools may increase level.',
  'dsp.panel.headroom.reasonClipping': 'Clipping detected.',
  'dsp.panel.headroom.reasonDirect': 'ヘッドルーム only works in the DSP path; when EQ, FIR, and channel tools are all off, native direct is not processed by it.',
  'dsp.panel.headroom.reasonEq': 'EQ curves may increase level.',
  'dsp.panel.headroom.reasonLive': 'Live headroom is low.',
  'dsp.panel.headroom.reasonOutput': 'Estimated output is near full scale.',
  'dsp.panel.headroom.reasonSrcTruePeak': 'ECHO SRC / FIR can reveal intersample peaks; reserve at least -3 dB.',
  'dsp.panel.headroom.reasonRoom': 'FIR / room correction may increase level.',
  'dsp.panel.headroom.reasonSafe': 'Current signal is safe.',
  'dsp.panel.headroom.recommendation': 'Recommendation',
  'dsp.panel.headroom.recommendationSafe': 'Safe',
  'dsp.panel.headroom.reserve': 'Reserve headroom',
  'dsp.panel.headroom.safePolicy': 'セーフティ first',
  'dsp.panel.headroom.safetyActions': 'Quick protection',
  'dsp.panel.headroom.status': 'Status',
  'dsp.panel.headroom.statusClose': 'Near limit',
  'dsp.panel.headroom.statusRisk': 'Risk detected',
  'dsp.panel.headroom.statusSafe': 'Safe',
  'dsp.panel.room.future.recent': 'Recent IR',
  'dsp.panel.room.future.response': 'Response preview',
  'dsp.panel.room.hero.activeDetail': 'Convolution is participating in the output chain.',
  'dsp.panel.room.hero.activeTitle': 'FIR enabled',
  'dsp.panel.room.hero.emptyDetail': 'インポート an IR before enabling room correction.',
  'dsp.panel.room.hero.emptyTitle': 'No IR loaded',
  'dsp.panel.room.hero.loadedDetail': 'IR is loaded and ready to enable.',
  'dsp.panel.room.hero.loadedTitle': 'IR loaded',
  'dsp.panel.room.hero.state': 'State',
  'dsp.panel.room.kicker': 'Spatial processing',
  'dsp.panel.room.nextEnable': 'FIR をオン',
  'dsp.panel.room.nextEnableDetail': 'IR is ready. Try listening.',
  'dsp.panel.room.nextImport': 'IR をインポート',
  'dsp.panel.room.nextImportDetail': 'Choose a convolution file first.',
  'dsp.panel.room.nextListen': 'Keep listening',
  'dsp.panel.room.nextListenDetail': 'Confirm volume and phase are normal after correction.',
  'dsp.panel.room.nextTrim': 'Lower trim',
  'dsp.panel.room.nextTrimDetail': 'FIR output has clipping risk.',
  'dsp.panel.room.note': 'FIR / room correction only handles convolution and IR; it is no longer mixed with EQ presets.',
  'dsp.panel.room.quickTrim': 'Quick trim',
  'dsp.panel.room.routeTitle': 'Route',
  'dsp.panel.room.safeEnableHint': 'Reserve -6 dB headroom before enabling FIR.',
  'dsp.panel.room.safetyRisk': 'Lower トリム or ヘッドルーム.',
  'dsp.panel.room.safetySafe': 'The output chain is currently safe.',
  'dsp.panel.room.safetyTitle': 'セーフティ',
  'dsp.panel.room.trim': 'トリム',
  'dsp.panel.safety.kicker': 'Output safety',
  'dsp.panel.safety.heroProtectedTitle': 'Output chain protected',
  'dsp.panel.safety.heroProtectedDetail': 'DSP is participating in playback, so output safety continues monitoring clipping, headroom, and bit-perfect route status.',
  'dsp.panel.safety.heroRiskTitle': 'Output risk detected',
  'dsp.panel.safety.heroRiskDetail': 'The current chain has clipping or headroom risk. Lower ヘッドルーム, EQ gain, or FIR トリム first.',
  'dsp.panel.safety.heroDirectTitle': 'ネイティブ direct',
  'dsp.panel.safety.heroDirectDetail': 'When no DSP module is enabled, playback stays on the bit-perfect candidate route and output safety only observes status.',
  'dsp.panel.safety.chainTitle': 'Current chain',
  'dsp.panel.safety.checkTitle': 'セーフティ check',
  'dsp.panel.safety.nextTitle': 'Suggested action',
  'dsp.panel.safety.nextRisk': 'Handle headroom first',
  'dsp.panel.safety.nextRiskDetail': 'Do not keep stacking EQ / FIR gain while risk exists. Lower ヘッドルーム or the related module トリム first.',
  'dsp.panel.safety.nextProtected': 'Keep monitoring',
  'dsp.panel.safety.nextProtectedDetail': 'The chain is in the DSP path and no clipping risk was found. Continue watching live output.',
  'dsp.panel.safety.nextDirect': 'Keep direct',
  'dsp.panel.safety.nextDirectDetail': 'No DSP processing is active. This is suitable for checking original output, device sample rate, and bit-perfect candidate status.',
  'dsp.panel.safety.routeInput': 'Input',
  'dsp.panel.safety.routeHeadroom': 'ヘッドルーム',
  'dsp.panel.safety.routeProcess': 'Process',
  'dsp.panel.safety.routeOutput': 'Output',
  'dsp.panel.safety.checkBitPerfect': 'Bit-perfect',
  'dsp.panel.safety.checkLimiter': 'Protection limiter',
  'dsp.panel.safety.disableLimiter': 'Disable protection limiter',
  'dsp.panel.safety.enableLimiter': 'Enable protection limiter',
  'dsp.panel.safety.limiterBypassed': 'バイパスed',
  'dsp.panel.safety.limiterBypassedDetail': 'The final protection limiter is off. Hot output may clip or distort.',
  'dsp.panel.safety.limiterToggleTitle': 'Protection limiter',
  'dsp.panel.safety.checkRoom': 'FIR',
  'dsp.panel.safety.checkChannel': 'Channel tools',
  'dsp.panel.safety.note': 'Clipping-protection readouts are only a reference; trust your ears for distortion, harshness, or excessive compression.',
  'dsp.room.status.active': '有効',
  'dsp.room.status.empty': 'Not loaded',
  'dsp.room.status.error': 'エラー',
  'dsp.room.status.loaded': 'Loaded',
  'dsp.stage.input': 'Input',
  'dsp.stage.output': 'Output',
  'dsp.stage.shape': 'Shape',
  'dsp.stage.space': 'Space',
  'dsp.stage.stereo': 'Stereo',
  'dsp.status.active': 'Enabled',
  'dsp.status.auto': 'Auto',
  'dsp.status.balanceActive': 'Channel processing',
  'dsp.status.bypassed': 'バイパスed',
  'dsp.status.candidate': 'Candidate',
  'dsp.status.clear': 'クリア',
  'dsp.status.direct': 'ダイレクト',
  'dsp.status.disabledByDsp': 'DSP path',
  'dsp.status.dspPath': 'DSP path',
  'dsp.status.flat': 'Flat',
  'dsp.status.headroomRisk': 'ヘッドルーム risk',
  'dsp.status.limiterArmed': 'Armed',
  'dsp.status.limiting': 'Limiting',
  'dsp.status.modulesActive': '{count} modules active',
  'dsp.status.nativeDirect': 'Bit-perfect path',
  'dsp.status.noIr': 'No IR',
  'dsp.status.none': 'なし',
  'dsp.status.protected': 'Protected',
  'dsp.status.ready': 'Ready',
  'dsp.status.risk': 'Risk',
  'dsp.status.riskDetected': 'Risk detected',
  'dsp.status.shared': 'shared',
  'dsp.status.signalProtected': 'Signal protected',
  'dsp.status.stereoDirect': 'Stereo direct',
  'dsp.status.systemOutput': 'System output',
};


const dspLocalTexts = {
  'zh-CN': dspLocalTextZhCN,
  'zh-TW': dspLocalTextZhTW,
  'en-US': dspLocalTextEnUS,
  'ja-JP': dspLocalTextJaJP,
  'ko-KR': dspLocalTextEnUS,
} as const;

type DspTranslate = (key: string, options?: Parameters<ReturnType<typeof useI18n>['t']>[1]) => string;

const useDspI18n = (): { t: DspTranslate } => {
  const { locale, t } = useI18n();
  const localText = dspLocalTexts[locale] ?? dspLocalTextZhCN;

  return {
    t: useCallback((key, options) => {
      if (localText[key]) {
        return Object.entries(options ?? {}).reduce(
          (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
          localText[key],
        );
      }

      return t(key as TranslationKey, options);
    }, [localText, t]),
  };
};

const formatDb = (value: number | null | undefined): string => {
  if (!Number.isFinite(value)) {
    return '0 dB';
  }

  const rounded = Math.round(Number(value) * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(Math.abs(rounded) % 1 > 0 ? 1 : 0)} dB`;
};

const formatPreciseDb = (value: number | null | undefined): string => {
  if (!Number.isFinite(value)) {
    return '0 dB';
  }

  const rounded = Math.round(Number(value) * 100) / 100;
  const decimals = Math.abs(rounded % 1) < 0.001 ? 0 : Math.abs((rounded * 10) % 1) < 0.001 ? 1 : 2;
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(decimals)} dB`;
};

const formatLevel = (value: number | null | undefined): string => (Number.isFinite(value) ? formatDb(value) : '--');

const formatRate = (value: number | null | undefined, autoLabel: string): string => (value ? `${Math.round(value / 1000)} kHz` : autoLabel);

const clampNumber = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const finiteLevel = (value: number | null | undefined): number | null => (Number.isFinite(value) ? Number(value) : null);

const roundHeadroomDb = (value: number): number => Math.round(clampNumber(value, dspHeadroomMinDb, dspHeadroomMaxDb) * 10) / 10;

const roundChannelGainDb = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.round(clampNumber(value, channelBalanceMinGainDb, channelBalanceMaxGainDb) * 100) / 100;
};

const roundChannelBandGainDb = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.round(clampNumber(value, channelBalanceBandMinGainDb, channelBalanceBandMaxGainDb) * 100) / 100;
};

const roundChannelDelayMs = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.round(clampNumber(value, channelBalanceMinDelayMs, channelBalanceMaxDelayMs) * 100) / 100;
};

const linearToDb = (value: number): number => 20 * Math.log10(Math.max(0.000001, value));

const getBalanceGainDb = (balance: number, constantPower: boolean): { leftDb: number; rightDb: number } => {
  const safeBalance = clampNumber(balance, -1, 1);

  if (!constantPower) {
    const leftGain = safeBalance > 0 ? 1 - safeBalance : 1;
    const rightGain = safeBalance < 0 ? 1 + safeBalance : 1;
    return { leftDb: linearToDb(leftGain), rightDb: linearToDb(rightGain) };
  }

  const pan = (safeBalance + 1) * Math.PI * 0.25;
  const compensation = Math.sqrt(2);
  return {
    leftDb: linearToDb(Math.min(1, Math.cos(pan) * compensation)),
    rightDb: linearToDb(Math.min(1, Math.sin(pan) * compensation)),
  };
};

const formatBalancePosition = (balance: number): string => {
  const percent = Math.round(Math.abs(balance) * 100);
  if (percent === 0) {
    return '0%';
  }

  return `${balance > 0 ? 'R' : 'L'} ${percent}%`;
};

const normalizeChannelBandGains = (bandGains: ChannelBalanceState['bandGains'] | null | undefined): NonNullable<ChannelBalanceState['bandGains']> => (
  channelBalanceBandIds.reduce<NonNullable<ChannelBalanceState['bandGains']>>((next, bandId) => {
    next[bandId] = {
      leftGainDb: roundChannelBandGainDb(Number(bandGains?.[bandId]?.leftGainDb ?? 0)),
      rightGainDb: roundChannelBandGainDb(Number(bandGains?.[bandId]?.rightGainDb ?? 0)),
    };
    return next;
  }, {
    low: { ...defaultBandGains.low },
    mid: { ...defaultBandGains.mid },
    high: { ...defaultBandGains.high },
  })
);

const normalizeChannelBalanceState = (state: Partial<ChannelBalanceState> | null | undefined): ChannelBalanceState => ({
  enabled: state?.enabled === true,
  balance: clampNumber(Number(state?.balance ?? 0), -1, 1),
  leftGainDb: roundChannelGainDb(Number(state?.leftGainDb ?? 0)),
  rightGainDb: roundChannelGainDb(Number(state?.rightGainDb ?? 0)),
  bandGains: normalizeChannelBandGains(state?.bandGains),
  leftDelayMs: roundChannelDelayMs(Number(state?.leftDelayMs ?? 0)),
  rightDelayMs: roundChannelDelayMs(Number(state?.rightDelayMs ?? 0)),
  swapLeftRight: state?.swapLeftRight === true,
  monoMode: state?.monoMode === 'sum' || state?.monoMode === 'left' || state?.monoMode === 'right' ? state.monoMode : 'off',
  invertLeft: state?.invertLeft === true,
  invertRight: state?.invertRight === true,
  constantPower: state?.constantPower !== false,
  clippingRisk: state?.clippingRisk === true,
});

const readChannelPresets = (): ChannelBalancePreset[] => {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(channelPresetStorageKey) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item): ChannelBalancePreset | null => {
        if (!item || typeof item !== 'object') {
          return null;
        }

        const preset = item as Partial<ChannelBalancePreset>;
        const name = typeof preset.name === 'string' && preset.name.trim() ? preset.name.trim().slice(0, 40) : null;
        if (!name) {
          return null;
        }

        return {
          id: typeof preset.id === 'string' && preset.id ? preset.id : `channel-${Date.now()}`,
          name,
          state: normalizeChannelBalanceState(preset.state),
          createdAt: typeof preset.createdAt === 'string' ? preset.createdAt : new Date().toISOString(),
        };
      })
      .filter((item): item is ChannelBalancePreset => item !== null)
      .slice(0, maxChannelPresetCount);
  } catch {
    return [];
  }
};

const writeChannelPresets = (presets: ChannelBalancePreset[]): void => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(channelPresetStorageKey, JSON.stringify(presets.slice(0, maxChannelPresetCount)));
};

const formatTime = (value: string | null | undefined, emptyLabel: string): string => {
  if (!value) {
    return emptyLabel;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return emptyLabel;
  }

  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const isEchoSrcPcmActive = (audioStatus: AudioStatus | null): boolean => {
  const runtimeState = audioStatus?.echoSrcRuntime?.state;
  return Boolean(
    audioStatus?.echoSrcMode !== 'off' &&
    audioStatus?.echoSrcTargetSampleRate &&
    (runtimeState === 'active' || runtimeState === 'planned' || runtimeState === 'fallback'),
  );
};

const getRecommendedHeadroomDb = (audioStatus: AudioStatus | null, currentHeadroomDb: number): number => {
  const targetHeadroomDb = 1;
  const outputPeakDb = finiteLevel(audioStatus?.audioLevels?.estimatedOutputPeakDb);
  const outputTruePeakDb = finiteLevel(audioStatus?.audioLevels?.estimatedOutputTruePeakDb);
  const outputPeakForHeadroomDb = outputPeakDb === null
    ? outputTruePeakDb
    : outputTruePeakDb === null
      ? outputPeakDb
      : Math.max(outputPeakDb, outputTruePeakDb);
  const liveHeadroomDb = finiteLevel(audioStatus?.audioLevels?.headroomDb);
  const truePeakHeadroomDb = finiteLevel(audioStatus?.audioLevels?.truePeakHeadroomDb);
  const reductionFromOutput = outputPeakForHeadroomDb === null ? 0 : Math.max(0, outputPeakForHeadroomDb + targetHeadroomDb);
  const reductionFromLive = liveHeadroomDb === null ? 0 : Math.max(0, targetHeadroomDb - liveHeadroomDb);
  const reductionFromTruePeak = truePeakHeadroomDb === null ? 0 : Math.max(0, targetHeadroomDb - truePeakHeadroomDb);
  const reductionFromEchoSrc = isEchoSrcPcmActive(audioStatus) ? Math.max(0, 3 + currentHeadroomDb) : 0;
  const fallbackReduction = audioStatus?.clippingRisk ? 6 : 0;
  const neededReductionDb = Math.max(reductionFromOutput, reductionFromLive, reductionFromTruePeak, reductionFromEchoSrc, fallbackReduction);

  if (neededReductionDb <= 0.05) {
    return roundHeadroomDb(currentHeadroomDb);
  }

  return roundHeadroomDb(currentHeadroomDb - neededReductionDb);
};

type HeadroomTone = 'good' | 'warn' | 'risk';

const hasObservedDspClippingRisk = (
  audioStatus: AudioStatus | null,
  eqState: EqState,
  roomCorrection: RoomCorrectionState,
  channelBalance: ChannelBalanceState,
  clipCount = audioStatus?.audioLevels?.clipCount ?? 0,
): boolean =>
  clipCount > 0 ||
  audioStatus?.dspClippingRisk === true ||
  audioStatus?.dspLimiterProtecting === true ||
  eqState.clippingRisk ||
  roomCorrection.clippingRisk ||
  channelBalance.clippingRisk === true;

const hasHeadroomWarning = (
  audioStatus: AudioStatus | null,
  outputPeakDb: number | null,
  liveHeadroomDb: number | null,
  truePeakHeadroomDb: number | null,
): boolean =>
  audioStatus?.clippingRisk === true ||
  (outputPeakDb !== null && outputPeakDb >= -1) ||
  (liveHeadroomDb !== null && liveHeadroomDb <= 1) ||
  (truePeakHeadroomDb !== null && truePeakHeadroomDb <= 1);

type ModulePanelProps = {
  audioStatus: AudioStatus | null;
  eqState: EqState;
  roomCorrection: RoomCorrectionState;
  channelBalance: ChannelBalanceState;
  busyKey: string | null;
  onHeadroomChange: (headroomDb: number) => void;
  onSafetyLimiterChange: (enabled: boolean) => void;
  onImportRoomCorrection: () => void;
  onToggleRoomCorrection: () => void;
  onEnableRoomSafely: () => void;
  onRoomTrimChange: (trimDb: number) => void;
  onClearRoomCorrection: () => void;
  onChannelPatch: (patch: Partial<ChannelBalanceState>) => void;
  onChannelReset: () => void;
  onRefresh: () => void;
};

const DspMetric = ({ label, value, tone }: { label: string; value: string; tone?: HeadroomTone }): JSX.Element => (
  <span className="dsp-module-metric" data-tone={tone}>
    <em>{label}</em>
    <strong>{value}</strong>
  </span>
);

const HeadroomPanel = ({ audioStatus, eqState, roomCorrection, channelBalance, busyKey, onHeadroomChange, onRefresh }: ModulePanelProps): JSX.Element => {
  const { t } = useDspI18n();
  const headroomDb = eqState.dspHeadroomDb ?? 0;
  const dspPathActive = audioStatus?.dspActive === true;
  const recommendedHeadroomDb = getRecommendedHeadroomDb(audioStatus, headroomDb);
  const hasRecommendation = dspPathActive && Math.abs(recommendedHeadroomDb - headroomDb) > 0.05;
  const liveHeadroomDb = finiteLevel(audioStatus?.audioLevels?.headroomDb);
  const outputPeakDb = finiteLevel(audioStatus?.audioLevels?.estimatedOutputPeakDb);
  const truePeakDb = finiteLevel(audioStatus?.audioLevels?.estimatedOutputTruePeakDb);
  const truePeakHeadroomDb = finiteLevel(audioStatus?.audioLevels?.truePeakHeadroomDb);
  const inputPeakDb = finiteLevel(audioStatus?.audioLevels?.inputPeakDb);
  const clipCount = audioStatus?.audioLevels?.clipCount ?? 0;
  const clippingRisk = hasObservedDspClippingRisk(audioStatus, eqState, roomCorrection, channelBalance, clipCount);
  const srcTruePeakReserveRecommended = isEchoSrcPcmActive(audioStatus) && headroomDb > -2.95;
  const headroomWarning = hasHeadroomWarning(audioStatus, outputPeakDb, liveHeadroomDb, truePeakHeadroomDb) || srcTruePeakReserveRecommended;
  const lastClipAt = audioStatus?.audioLevels?.lastClipAt ?? null;
  const headroomArmed = Math.abs(headroomDb) > 0.05;
  const headroomActive = dspPathActive && headroomArmed;
  const guardStateKey: string =
    headroomActive ? 'dsp.panel.headroom.guardActive' :
    headroomArmed ? 'dsp.panel.headroom.guardStandby' :
    'dsp.panel.headroom.guardDirect';
  const statusTone: HeadroomTone = !dspPathActive ? 'good' : clippingRisk ? 'risk' : headroomWarning ? 'warn' : 'good';
  const statusKey: string =
    statusTone === 'risk' ? 'dsp.panel.headroom.statusRisk' :
    statusTone === 'warn' ? 'dsp.panel.headroom.statusClose' :
    'dsp.panel.headroom.statusSafe';
  const reasonKey: string =
    !dspPathActive ? 'dsp.panel.headroom.reasonDirect' :
    clipCount > 0 || audioStatus?.dspClippingRisk || audioStatus?.dspLimiterProtecting ? 'dsp.panel.headroom.reasonClipping' :
    eqState.clippingRisk ? 'dsp.panel.headroom.reasonEq' :
    roomCorrection.clippingRisk ? 'dsp.panel.headroom.reasonRoom' :
    channelBalance.clippingRisk ? 'dsp.panel.headroom.reasonChannel' :
    srcTruePeakReserveRecommended ? 'dsp.panel.headroom.reasonSrcTruePeak' :
    truePeakHeadroomDb !== null && truePeakHeadroomDb <= 1 ? 'dsp.panel.headroom.reasonOutput' :
    outputPeakDb !== null && outputPeakDb >= -1 ? 'dsp.panel.headroom.reasonOutput' :
    liveHeadroomDb !== null && liveHeadroomDb <= 1 ? 'dsp.panel.headroom.reasonLive' :
    'dsp.panel.headroom.reasonSafe';
  const modeOptions = [
    { value: 0, title: t('dsp.panel.headroom.modeDirect'), detail: t('dsp.panel.headroom.modeDirectDetail') },
    { value: -3, title: t('dsp.panel.headroom.modeDaily'), detail: t('dsp.panel.headroom.modeDailyDetail') },
    { value: -6, title: t('dsp.panel.headroom.modeDsp'), detail: t('dsp.panel.headroom.modeDspDetail') },
  ];
  const protectiveFloorDb = statusTone === 'risk' ? -6 : statusTone === 'warn' ? -3 : headroomDb;
  const protectiveHeadroomDb = roundHeadroomDb(Math.min(headroomDb, recommendedHeadroomDb, protectiveFloorDb));
  const conservativeHeadroomDb = roundHeadroomDb(Math.min(headroomDb, -6));
  const canApplyProtective = dspPathActive && protectiveHeadroomDb < headroomDb - 0.05;
  const canApplyConservative = dspPathActive && conservativeHeadroomDb < headroomDb - 0.05;
  const nextStepKey: string =
    !dspPathActive ? 'dsp.panel.headroom.nextDirect' :
    canApplyProtective ? 'dsp.panel.headroom.nextProtect' :
    statusTone === 'risk' ? 'dsp.panel.headroom.nextHoldRisk' :
    statusTone === 'warn' ? 'dsp.panel.headroom.nextWatch' :
    headroomActive ? 'dsp.panel.headroom.nextReady' :
    headroomArmed ? 'dsp.panel.headroom.nextStandby' :
    'dsp.panel.headroom.nextDirect';
  const nextStepDetailKey: string =
    !dspPathActive ? 'dsp.panel.headroom.nextDirectDetail' :
    canApplyProtective ? 'dsp.panel.headroom.nextProtectDetail' :
    statusTone === 'risk' ? 'dsp.panel.headroom.nextHoldRiskDetail' :
    statusTone === 'warn' ? 'dsp.panel.headroom.nextWatchDetail' :
    headroomActive ? 'dsp.panel.headroom.nextReadyDetail' :
    headroomArmed ? 'dsp.panel.headroom.nextStandbyDetail' :
    'dsp.panel.headroom.nextDirectDetail';

  return (
    <section className="dsp-module-panel dsp-module-panel--headroom">
      <div className="dsp-headroom-main">
        <div className="dsp-headroom-control">
          <div className="dsp-headroom-status" data-tone={statusTone}>
            <span>
              <em>{t('dsp.panel.headroom.status')}</em>
              <strong>{t(statusKey)}</strong>
            </span>
            <p>{t(reasonKey)}</p>
          </div>
          <div className="dsp-module-metrics dsp-headroom-metrics">
            <DspMetric label={t('dsp.metric.inputPeak')} value={formatLevel(inputPeakDb)} />
            <DspMetric label={t('dsp.metric.outputEstimate')} value={formatLevel(outputPeakDb)} />
            <DspMetric label={t('dsp.metric.truePeak')} value={formatLevel(truePeakDb)} tone={truePeakHeadroomDb !== null && truePeakHeadroomDb <= 1 ? 'warn' : undefined} />
            <DspMetric label={t('dsp.metric.liveHeadroom')} value={formatLevel(liveHeadroomDb)} tone={statusTone === 'risk' ? 'risk' : 'good'} />
            <DspMetric label={t('dsp.panel.headroom.guardState')} value={t(guardStateKey)} tone={headroomActive ? 'good' : headroomArmed ? 'warn' : undefined} />
            <DspMetric label={t('dsp.panel.headroom.clipCount')} value={t('dsp.panel.headroom.clipCountValue', { count: String(clipCount) })} tone={clipCount > 0 ? 'risk' : 'good'} />
            <DspMetric label={t('dsp.panel.headroom.lastClip')} value={formatTime(lastClipAt, t('dsp.panel.headroom.noClip'))} tone={clipCount > 0 ? 'risk' : undefined} />
          </div>
          <label className="dsp-module-range">
            <span>{t('dsp.panel.headroom.reserve')}</span>
            <input
              type="range"
              min={dspHeadroomMinDb}
              max={dspHeadroomMaxDb}
              step="0.1"
              value={headroomDb}
              onChange={(event) => onHeadroomChange(Number(event.currentTarget.value))}
            />
            <strong>{formatDb(headroomDb)}</strong>
          </label>
          <div className="dsp-headroom-budget" aria-label={t('dsp.panel.headroom.budgetAria')}>
            <span style={{ width: `${Math.max(6, Math.min(100, ((inputPeakDb ?? -18) + 24) * 3.3))}%` }}>
              <em>{t('dsp.metric.inputPeak')}</em>
              <strong>{formatLevel(inputPeakDb)}</strong>
            </span>
            <span style={{ width: `${Math.max(6, Math.min(100, ((outputPeakDb ?? -18) + 24) * 3.3))}%` }}>
              <em>{t('dsp.metric.outputEstimate')}</em>
              <strong>{formatLevel(outputPeakDb)}</strong>
            </span>
            <span data-tone={statusTone}>
              <em>{t('dsp.metric.liveHeadroom')}</em>
              <strong>{formatLevel(liveHeadroomDb)}</strong>
            </span>
          </div>
        </div>

        <aside className="dsp-headroom-assist">
          <div className="dsp-headroom-next-step" data-tone={statusTone}>
            <span>
              <em>{t('dsp.panel.headroom.nextStep')}</em>
              <strong>{t(nextStepKey)}</strong>
            </span>
            <p>{t(nextStepDetailKey)}</p>
            <div>
              <button type="button" disabled={!canApplyProtective || busyKey === 'headroom'} onClick={() => onHeadroomChange(protectiveHeadroomDb)}>
                <ShieldCheck size={14} aria-hidden="true" />
                {t('dsp.panel.headroom.primaryAction', { value: formatDb(protectiveHeadroomDb) })}
              </button>
              <button type="button" onClick={onRefresh}>
                <Activity size={14} aria-hidden="true" />
                {t('dsp.action.refresh')}
              </button>
            </div>
          </div>
          <div className="dsp-headroom-recommendation" data-active={hasRecommendation}>
            <em>{t('dsp.panel.headroom.recommendation')}</em>
            <strong>{hasRecommendation ? formatDb(recommendedHeadroomDb) : t('dsp.panel.headroom.recommendationSafe')}</strong>
            <button type="button" disabled={!hasRecommendation || busyKey === 'headroom'} onClick={() => onHeadroomChange(recommendedHeadroomDb)}>
              <Gauge size={14} aria-hidden="true" />
              {t('dsp.panel.headroom.applyRecommended')}
            </button>
          </div>
          <div className="dsp-headroom-safe-actions">
            <span>
              <em>{t('dsp.panel.headroom.safetyActions')}</em>
              <strong>{t('dsp.panel.headroom.safePolicy')}</strong>
            </span>
            <button type="button" disabled={!canApplyProtective || busyKey === 'headroom'} onClick={() => onHeadroomChange(protectiveHeadroomDb)}>
              <ShieldCheck size={14} aria-hidden="true" />
              {t('dsp.panel.headroom.makeSafe', { value: formatDb(protectiveHeadroomDb) })}
            </button>
            <button type="button" disabled={!canApplyConservative || busyKey === 'headroom'} onClick={() => onHeadroomChange(conservativeHeadroomDb)}>
              <ShieldCheck size={14} aria-hidden="true" />
              {t('dsp.panel.headroom.makeConservative')}
            </button>
          </div>
          <div className="dsp-headroom-modes" role="group" aria-label={t('dsp.panel.headroom.modeAria')}>
            {modeOptions.map((option) => (
              <button type="button" data-active={Math.abs(headroomDb - option.value) <= 0.05} disabled={busyKey === 'headroom'} key={option.value} onClick={() => onHeadroomChange(option.value)}>
                <strong>{option.title}</strong>
                <span>{option.detail}</span>
                <em>{formatDb(option.value)}</em>
              </button>
            ))}
          </div>
          <div className="dsp-module-actions" role="group" aria-label={t('dsp.panel.headroom.presetsAria')}>
            {[0, -3, -6, -9].map((value) => (
              <button type="button" data-active={Math.abs(headroomDb - value) <= 0.05} disabled={busyKey === 'headroom'} key={value} onClick={() => onHeadroomChange(value)}>
                {formatDb(value)}
              </button>
            ))}
          </div>
          <p className="dsp-module-note">{t('dsp.panel.headroom.note')}</p>
        </aside>
      </div>
    </section>
  );
};

const RoomCorrectionPanel = ({
  roomCorrection,
  eqState,
  audioStatus,
  busyKey,
  onImportRoomCorrection,
  onToggleRoomCorrection,
  onEnableRoomSafely,
  onRoomTrimChange,
  onClearRoomCorrection,
  onRefresh,
}: ModulePanelProps): JSX.Element => {
  const { t } = useDspI18n();
  const hasIr = Boolean(roomCorrection.irId);
  const roomTone: HeadroomTone = roomCorrection.clippingRisk || roomCorrection.status === 'error' ? 'risk' : roomCorrection.enabled ? 'good' : hasIr ? 'warn' : 'good';
  const heroTitleKey: string =
    roomCorrection.enabled ? 'dsp.panel.room.hero.activeTitle' :
    hasIr ? 'dsp.panel.room.hero.loadedTitle' :
    'dsp.panel.room.hero.emptyTitle';
  const heroDetailKey: string =
    roomCorrection.enabled ? 'dsp.panel.room.hero.activeDetail' :
    hasIr ? 'dsp.panel.room.hero.loadedDetail' :
    'dsp.panel.room.hero.emptyDetail';
  const nextTitleKey: string =
    roomCorrection.clippingRisk ? 'dsp.panel.room.nextTrim' :
    roomCorrection.enabled ? 'dsp.panel.room.nextListen' :
    hasIr ? 'dsp.panel.room.nextEnable' :
    'dsp.panel.room.nextImport';
  const nextDetailKey: string =
    roomCorrection.clippingRisk ? 'dsp.panel.room.nextTrimDetail' :
    roomCorrection.enabled ? 'dsp.panel.room.nextListenDetail' :
    hasIr ? 'dsp.panel.room.nextEnableDetail' :
    'dsp.panel.room.nextImportDetail';
  const dspHeadroomDb = eqState.dspHeadroomDb ?? 0;
  const bitPerfectValue = roomCorrection.enabled ? t('dsp.status.disabledByDsp') : t('dsp.status.ready');
  const clippingValue = roomCorrection.clippingRisk ? t('dsp.status.riskDetected') : t('dsp.status.clear');
  const latencyValue = roomCorrection.latencySamples > 0 ? `${roomCorrection.latencySamples} samples` : t('dsp.status.none');
  const outputPeakDb = finiteLevel(audioStatus?.audioLevels?.estimatedOutputPeakDb);
  const safeTrimDb = Math.min(roomCorrection.trimDb, -6);
  const canSafeEnable = hasIr && !roomCorrection.enabled;

  return (
    <section className="dsp-module-panel dsp-module-panel--room" data-enabled={roomCorrection.enabled} data-tone={roomTone}>
      <div className="dsp-room-main">
        <div className="dsp-room-hero">
          <p>{t(heroDetailKey)}</p>
          <div className="dsp-room-primary">
            <span>
              <em>{t('dsp.panel.room.hero.state')}</em>
              <strong>{t(heroTitleKey)}</strong>
              <small>{t('dsp.panel.room.safeEnableHint')}</small>
            </span>
            <div className="dsp-module-actions">
              <button type="button" disabled={busyKey === 'room-import'} onClick={onImportRoomCorrection}>
                <FileAudio size={14} aria-hidden="true" />
                {t('dsp.action.importIr')}
              </button>
              <button type="button" disabled={!canSafeEnable || busyKey !== null} onClick={onEnableRoomSafely}>
                <ShieldCheck size={14} aria-hidden="true" />
                {t('dsp.action.enableFirSafely')}
              </button>
              <button type="button" data-active={roomCorrection.enabled} disabled={!hasIr || busyKey === 'room-toggle'} onClick={onToggleRoomCorrection}>
                <Zap size={14} aria-hidden="true" />
                {roomCorrection.enabled ? t('dsp.action.disableFir') : t('dsp.action.enableFir')}
              </button>
              <button type="button" disabled={!hasIr || busyKey === 'room-clear'} onClick={onClearRoomCorrection}>
                {t('dsp.action.clear')}
              </button>
            </div>
          </div>
        </div>

        <label className="dsp-module-range dsp-room-trim">
          <span>{t('dsp.panel.room.trim')}</span>
          <input
            type="range"
            min={roomCorrectionMinTrimDb}
            max={roomCorrectionMaxTrimDb}
            step="0.1"
            value={roomCorrection.trimDb}
            disabled={!hasIr}
            onChange={(event) => onRoomTrimChange(Number(event.currentTarget.value))}
          />
          <strong>{formatDb(roomCorrection.trimDb)}</strong>
        </label>

        <div className="dsp-room-trim-tools" role="group" aria-label={t('dsp.panel.room.quickTrim')}>
          <span>{t('dsp.panel.room.quickTrim')}</span>
          {[-6, -3, 0].map((trimPreset) => (
            <button
              type="button"
              data-active={Math.abs(roomCorrection.trimDb - trimPreset) <= 0.05}
              disabled={!hasIr || busyKey === 'room-trim'}
              key={trimPreset}
              onClick={() => onRoomTrimChange(trimPreset)}
            >
              {formatDb(trimPreset)}
            </button>
          ))}
        </div>

        <div className="dsp-module-metrics dsp-room-metrics">
          <DspMetric label={t('dsp.metric.ir')} value={roomCorrection.irName ?? t('dsp.status.noIr')} tone={hasIr ? 'good' : undefined} />
          <DspMetric label={t('dsp.metric.mode')} value={roomCorrection.channelMode} />
          <DspMetric label={t('dsp.metric.taps')} value={roomCorrection.tapCount > 0 ? String(roomCorrection.tapCount) : '--'} />
          <DspMetric label={t('dsp.metric.sampleRate')} value={roomCorrection.sampleRate ? `${roomCorrection.sampleRate} Hz` : '--'} />
          <DspMetric label={t('dsp.metric.latency')} value={latencyValue} />
          <DspMetric label={t('dsp.metric.outputEstimate')} value={formatLevel(outputPeakDb)} tone={roomCorrection.clippingRisk ? 'risk' : undefined} />
        </div>

        {roomCorrection.error ? <p className="dsp-module-error">{roomCorrection.error}</p> : null}
        <p className="dsp-module-note">{t('dsp.panel.room.note')}</p>
      </div>

      <aside className="dsp-room-side">
        <div className="dsp-room-status" data-tone={roomTone}>
          <span>
            <ShieldCheck size={17} aria-hidden="true" />
            <em>{t('dsp.panel.room.safetyTitle')}</em>
          </span>
          <strong>{roomTone === 'risk' ? t('dsp.status.riskDetected') : t('dsp.status.signalProtected')}</strong>
          <p>{roomTone === 'risk' ? t('dsp.panel.room.safetyRisk') : t('dsp.panel.room.safetySafe')}</p>
        </div>

        <div className="dsp-room-route">
          <span>
            <Route size={16} aria-hidden="true" />
            <em>{t('dsp.panel.room.routeTitle')}</em>
          </span>
          <dl>
            <div>
              <dt>{t('dsp.metric.bitPerfect')}</dt>
              <dd>{bitPerfectValue}</dd>
            </div>
            <div>
              <dt>{t('dsp.panel.headroom.reserve')}</dt>
              <dd>{formatDb(dspHeadroomDb)}</dd>
            </div>
            <div>
              <dt>{t('dsp.metric.clipping')}</dt>
              <dd>{clippingValue}</dd>
            </div>
            <div>
              <dt>{t('dsp.metric.latency')}</dt>
              <dd>{latencyValue}</dd>
            </div>
          </dl>
        </div>

        <div className="dsp-room-next">
          <span>
            <Info size={16} aria-hidden="true" />
            <em>{t('dsp.panel.headroom.nextStep')}</em>
          </span>
          <strong>{t(nextTitleKey)}</strong>
          <p>{t(nextDetailKey)}</p>
          <div className="dsp-room-next-actions">
            {!hasIr ? (
              <button type="button" disabled={busyKey === 'room-import'} onClick={onImportRoomCorrection}>
                <FileAudio size={14} aria-hidden="true" />
                {t('dsp.action.importIr')}
              </button>
            ) : roomCorrection.clippingRisk ? (
              <>
                <button type="button" disabled={busyKey === 'room-trim'} onClick={() => onRoomTrimChange(safeTrimDb)}>
                  <Gauge size={14} aria-hidden="true" />
                  {t('dsp.panel.room.nextTrim')}
                </button>
                <button type="button" onClick={onRefresh}>
                  {t('dsp.action.refresh')}
                </button>
              </>
            ) : roomCorrection.enabled ? (
              <>
                <button type="button" data-active onClick={onToggleRoomCorrection}>
                  <Zap size={14} aria-hidden="true" />
                  {t('dsp.action.disableFir')}
                </button>
                <button type="button" onClick={onRefresh}>
                  {t('dsp.action.refresh')}
                </button>
              </>
            ) : (
              <>
                <button type="button" disabled={busyKey !== null} onClick={onEnableRoomSafely}>
                  <ShieldCheck size={14} aria-hidden="true" />
                  {t('dsp.action.enableFirSafely')}
                </button>
                <button type="button" disabled={busyKey === 'room-toggle'} onClick={onToggleRoomCorrection}>
                  <Zap size={14} aria-hidden="true" />
                  {t('dsp.action.enableFir')}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="dsp-room-expansion">
          <span><Clock3 size={15} aria-hidden="true" />{t('dsp.panel.room.future.recent')}</span>
          <span><AudioWaveform size={15} aria-hidden="true" />{t('dsp.panel.room.future.response')}</span>
        </div>
      </aside>
    </section>
  );
};

const ChannelPanel = ({ channelBalance, busyKey, onChannelPatch, onChannelReset }: ModulePanelProps): JSX.Element => {
  const { t } = useDspI18n();
  const [trimStepDb, setTrimStepDb] = useState(0.25);
  const [channelPresets, setChannelPresets] = useState<ChannelBalancePreset[]>(() => readChannelPresets());
  const [activeChannelPresetId, setActiveChannelPresetId] = useState<string | null>(null);
  const [presetNameDraft, setPresetNameDraft] = useState(() => t('dsp.panel.channel.presetDefaultName'));
  const [renamingPresetId, setRenamingPresetId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [compareBypassed, setCompareBypassed] = useState(false);
  const [panelMode, setPanelMode] = useState<ChannelPanelMode>('simple');
  const [balanceDraftPercent, setBalanceDraftPercent] = useState(() => Math.round(channelBalance.balance * 1000) / 10);
  const [balanceDragging, setBalanceDragging] = useState(false);
  const compareSnapshotRef = useRef<ChannelBalanceState | null>(null);
  const leftGainDb = Number(channelBalance.leftGainDb ?? 0);
  const rightGainDb = Number(channelBalance.rightGainDb ?? 0);
  const bandGains = normalizeChannelBandGains(channelBalance.bandGains);
  const leftDelayMs = Number(channelBalance.leftDelayMs ?? 0);
  const rightDelayMs = Number(channelBalance.rightDelayMs ?? 0);
  const balanceGain = getBalanceGainDb(channelBalance.balance, channelBalance.constantPower);
  const effectiveLeftDb = leftGainDb + balanceGain.leftDb;
  const effectiveRightDb = rightGainDb + balanceGain.rightDb;
  const outputSkewDb = effectiveRightDb - effectiveLeftDb;
  const outputSkewAbsDb = Math.abs(outputSkewDb);
  const outputSkewLabel = outputSkewAbsDb < 0.05
    ? t('dsp.panel.channel.centered')
    : outputSkewDb > 0
      ? t('dsp.panel.channel.leansRight', { value: formatPreciseDb(outputSkewAbsDb) })
      : t('dsp.panel.channel.leansLeft', { value: formatPreciseDb(outputSkewAbsDb) });
  const delaySkewMs = rightDelayMs - leftDelayMs;
  const leftMeterWidth = clampNumber(50 - (outputSkewDb * 8), 8, 92);
  const rightMeterWidth = 100 - leftMeterWidth;
  const hasBandEffect = channelBalanceBandIds.some((bandId) => (
    Math.abs(bandGains[bandId].leftGainDb) > 0.001 || Math.abs(bandGains[bandId].rightGainDb) > 0.001
  ));
  const hasAdvancedEffect =
    channelBalance.swapLeftRight
    || channelBalance.monoMode !== 'off'
    || channelBalance.invertLeft
    || channelBalance.invertRight
    || hasBandEffect;
  const patchChannel = (patch: Partial<ChannelBalanceState>): void => {
    setActiveChannelPresetId(null);
    onChannelPatch(patch);
  };
  useEffect(() => {
    if (!balanceDragging) {
      setBalanceDraftPercent(Math.round(channelBalance.balance * 1000) / 10);
    }
  }, [balanceDragging, channelBalance.balance]);
  const patchBalancePercent = (nextPercent: number): void => {
    const roundedPercent = Math.round(clampNumber(nextPercent, -100, 100) * 10) / 10;
    setBalanceDraftPercent(roundedPercent);
    patchChannel({ balance: clampNumber(roundedPercent / 100, -1, 1), enabled: true });
  };
  const patchBandGain = (bandId: ChannelBalanceBandId, side: 'leftGainDb' | 'rightGainDb', gainDb: number): void => {
    patchChannel({
      bandGains: {
        ...bandGains,
        [bandId]: {
          ...bandGains[bandId],
          [side]: roundChannelBandGainDb(gainDb),
        },
      },
      enabled: true,
    });
  };
  const swapCompensationDirection = (): void => {
    patchChannel({
      leftGainDb: rightGainDb,
      rightGainDb: leftGainDb,
      leftDelayMs: rightDelayMs,
      rightDelayMs: leftDelayMs,
      bandGains: channelBalanceBandIds.reduce<NonNullable<ChannelBalanceState['bandGains']>>((next, bandId) => {
        next[bandId] = {
          leftGainDb: bandGains[bandId].rightGainDb,
          rightGainDb: bandGains[bandId].leftGainDb,
        };
        return next;
      }, {
        low: { ...defaultBandGains.low },
        mid: { ...defaultBandGains.mid },
        high: { ...defaultBandGains.high },
      }),
      enabled: true,
    });
  };
  const resetChannel = (): void => {
    compareSnapshotRef.current = null;
    setCompareBypassed(false);
    setActiveChannelPresetId(null);
    onChannelReset();
  };
  const clearCompensation = (): void => {
    patchChannel({
      enabled: hasAdvancedEffect,
      balance: 0,
      leftGainDb: 0,
      rightGainDb: 0,
      bandGains: normalizeChannelBandGains(null),
      leftDelayMs: 0,
      rightDelayMs: 0,
    });
  };
  const toggleCompareBypass = (): void => {
    if (compareBypassed) {
      const snapshot = compareSnapshotRef.current;
      compareSnapshotRef.current = null;
      setCompareBypassed(false);
      if (snapshot) {
        onChannelPatch(snapshot);
      }
      return;
    }

    compareSnapshotRef.current = normalizeChannelBalanceState(channelBalance);
    setCompareBypassed(true);
    onChannelPatch({ enabled: false });
  };
  const saveChannelPreset = (): void => {
    const presetName = presetNameDraft.trim() || t('dsp.panel.channel.presetDefaultName');

    const sourceState = compareBypassed && compareSnapshotRef.current ? compareSnapshotRef.current : channelBalance;
    const nextPreset: ChannelBalancePreset = {
      id: `channel-${Date.now()}`,
      name: presetName.slice(0, 40),
      state: { ...normalizeChannelBalanceState(sourceState), enabled: true, clippingRisk: false },
      createdAt: new Date().toISOString(),
    };
    setChannelPresets((current) => {
      const next = [nextPreset, ...current.filter((preset) => preset.name !== nextPreset.name)].slice(0, maxChannelPresetCount);
      writeChannelPresets(next);
      return next;
    });
    setActiveChannelPresetId(nextPreset.id);
    setPresetNameDraft(t('dsp.panel.channel.presetDefaultName'));
  };
  const applyChannelPreset = (preset: ChannelBalancePreset): void => {
    compareSnapshotRef.current = null;
    setCompareBypassed(false);
    setActiveChannelPresetId(preset.id);
    onChannelPatch({ ...preset.state, enabled: true });
  };
  const renameChannelPreset = (preset: ChannelBalancePreset): void => {
    setRenamingPresetId(preset.id);
    setRenameDraft(preset.name);
  };
  const commitRenameChannelPreset = (presetId: string): void => {
    const presetName = renameDraft.trim();

    if (!presetName) {
      setRenamingPresetId(null);
      return;
    }

    setChannelPresets((current) => {
      const next = current.map((item) => (
        item.id === presetId
          ? { ...item, name: presetName.slice(0, 40) }
          : item
      ));
      writeChannelPresets(next);
      return next;
    });
    setRenamingPresetId(null);
    setRenameDraft('');
  };
  const removeChannelPreset = (presetId: string): void => {
    if (activeChannelPresetId === presetId) {
      setActiveChannelPresetId(null);
    }
    if (renamingPresetId === presetId) {
      setRenamingPresetId(null);
      setRenameDraft('');
    }

    setChannelPresets((current) => {
      const next = current.filter((preset) => preset.id !== presetId);
      writeChannelPresets(next);
      return next;
    });
  };
  const activeChannelPreset = channelPresets.find((preset) => preset.id === activeChannelPresetId) ?? null;

  return (
    <section className="dsp-module-panel dsp-module-panel--channel" data-enabled={channelBalance.enabled}>
      <div className="dsp-channel-main">
        <div className="dsp-channel-hero">
          <div className="dsp-channel-primary">
            <span>
              <em>{t('dsp.panel.channel.compensationTitle')}</em>
              <strong>{outputSkewLabel}</strong>
              <small>{t('dsp.panel.channel.compensationDetail')}</small>
            </span>
            <div className="dsp-module-actions">
              <button
                type="button"
                className="dsp-channel-toggle"
                aria-pressed={channelBalance.enabled}
                data-active={channelBalance.enabled}
                disabled={busyKey === 'channel'}
                onClick={() => patchChannel({ enabled: !channelBalance.enabled })}
              >
                <span className="dsp-channel-toggle-rail" aria-hidden="true"><span /></span>
                <span className="dsp-channel-toggle-copy">
                  <strong>{t('dsp.panel.channel.compensationTitle')}</strong>
                  <small>{channelBalance.enabled ? t('dsp.panel.channel.compensationOn') : t('dsp.panel.channel.compensationOff')}</small>
                </span>
              </button>
              <button type="button" data-active={compareBypassed} disabled={busyKey === 'channel'} onClick={toggleCompareBypass}>
                {compareBypassed ? t('dsp.panel.channel.compareActive') : t('dsp.panel.channel.compare')}
              </button>
              <button type="button" disabled={busyKey === 'channel-reset'} onClick={resetChannel}>
                <RotateCcw size={14} />{t('dsp.action.reset')}
              </button>
            </div>
          </div>

          <div className="dsp-channel-mode-tabs" role="tablist" aria-label={t('dsp.panel.channel.advanced')}>
            {(['simple', 'pro'] as const).map((mode) => (
              <button
                type="button"
                aria-selected={panelMode === mode}
                data-active={panelMode === mode}
                key={mode}
                onClick={() => setPanelMode(mode)}
                role="tab"
              >
                {mode === 'simple' ? t('dsp.panel.channel.modeSimple') : t('dsp.panel.channel.modePro')}
              </button>
            ))}
          </div>

          <div className="dsp-channel-bias-card">
            <div className="dsp-channel-bias-head">
              <span>{t('dsp.panel.channel.leftOutput')}</span>
              <strong>{outputSkewLabel}</strong>
              <span>{t('dsp.panel.channel.rightOutput')}</span>
            </div>
            <div className="dsp-channel-bias-meter" aria-hidden="true">
              <span data-side="left" style={{ width: `${leftMeterWidth}%` }} />
              <i />
              <span data-side="right" style={{ width: `${rightMeterWidth}%` }} />
            </div>
            <div className="dsp-channel-bias-values">
              <strong>{formatPreciseDb(effectiveLeftDb)}</strong>
              <strong>{formatPreciseDb(effectiveRightDb)}</strong>
            </div>
          </div>

          <div className="dsp-channel-trim-tools">
            <span>{t('dsp.panel.channel.step')}</span>
            {[...electrostaticTrimSteps, ...channelTrimSteps.filter((stepDb) => stepDb !== 0.25)].map((stepDb) => (
              <button type="button" data-active={trimStepDb === stepDb} key={stepDb} onClick={() => setTrimStepDb(stepDb)}>
                {formatPreciseDb(stepDb)}
              </button>
            ))}
            <button
              type="button"
              disabled={leftGainDb <= channelBalanceMinGainDb + 0.001}
              onClick={() => patchChannel({ leftGainDb: roundChannelGainDb(leftGainDb - trimStepDb), enabled: true })}
            >
              {t('dsp.panel.channel.leftTooLoud')}
            </button>
            <button
              type="button"
              disabled={rightGainDb <= channelBalanceMinGainDb + 0.001}
              onClick={() => patchChannel({ rightGainDb: roundChannelGainDb(rightGainDb - trimStepDb), enabled: true })}
            >
              {t('dsp.panel.channel.rightTooLoud')}
            </button>
            <button type="button" onClick={clearCompensation}>
              {t('dsp.panel.channel.trimCenter')}
            </button>
            <button type="button" onClick={swapCompensationDirection}>
              {t('dsp.panel.channel.swapCompensation')}
            </button>
          </div>

          {panelMode === 'pro' ? (
            <div className="dsp-channel-band-card">
              <div className="dsp-channel-band-head">
                <em>{t('dsp.panel.channel.bandCompensation')}</em>
                <span><Info size={15} aria-hidden="true" />{t('dsp.panel.channel.safeAttenuation')}</span>
              </div>
              {channelBalanceBandIds.map((bandId) => (
                <div className="dsp-channel-band-row" key={bandId}>
                  <span>
                    <strong>{t(channelBandLabels[bandId].titleKey)}</strong>
                    <small>{channelBandLabels[bandId].range}</small>
                  </span>
                  <label>
                    <small>{t('dsp.panel.channel.leftOutput')}</small>
                    <input
                      type="number"
                      min={channelBalanceBandMinGainDb}
                      max={channelBalanceBandMaxGainDb}
                      step="0.1"
                      value={bandGains[bandId].leftGainDb}
                      onChange={(event) => patchBandGain(bandId, 'leftGainDb', Number(event.currentTarget.value))}
                    />
                  </label>
                  <label>
                    <small>{t('dsp.panel.channel.rightOutput')}</small>
                    <input
                      type="number"
                      min={channelBalanceBandMinGainDb}
                      max={channelBalanceBandMaxGainDb}
                      step="0.1"
                      value={bandGains[bandId].rightGainDb}
                      onChange={(event) => patchBandGain(bandId, 'rightGainDb', Number(event.currentTarget.value))}
                    />
                  </label>
                </div>
              ))}
            </div>
          ) : null}

          <label className="dsp-module-range dsp-channel-balance-range">
            <span>{t('dsp.panel.channel.balance')}</span>
            <input
              type="range"
              min="-100"
              max="100"
              step="0.5"
              value={balanceDragging ? balanceDraftPercent : Math.round(channelBalance.balance * 1000) / 10}
              onBlur={() => setBalanceDragging(false)}
              onChange={(event) => patchBalancePercent(Number(event.currentTarget.value))}
              onPointerCancel={() => setBalanceDragging(false)}
              onPointerDown={() => setBalanceDragging(true)}
              onPointerUp={() => setBalanceDragging(false)}
            />
            <strong>{formatBalancePosition((balanceDragging ? balanceDraftPercent : Math.round(channelBalance.balance * 1000) / 10) / 100)}</strong>
          </label>

          {panelMode === 'pro' ? (
            <div className="dsp-module-grid dsp-channel-grid">
              <label>
                <span>{t('dsp.panel.channel.leftGain')}</span>
                <input type="number" min={channelBalanceMinGainDb} max={channelBalanceMaxGainDb} step="0.05" value={leftGainDb} onChange={(event) => patchChannel({ leftGainDb: roundChannelGainDb(Number(event.currentTarget.value)), enabled: true })} />
              </label>
              <label>
                <span>{t('dsp.panel.channel.rightGain')}</span>
                <input type="number" min={channelBalanceMinGainDb} max={channelBalanceMaxGainDb} step="0.05" value={rightGainDb} onChange={(event) => patchChannel({ rightGainDb: roundChannelGainDb(Number(event.currentTarget.value)), enabled: true })} />
              </label>
              <label>
                <span>{t('dsp.panel.channel.leftDelay')}</span>
                <input type="number" min={channelBalanceMinDelayMs} max={channelBalanceMaxDelayMs} step="0.01" value={leftDelayMs} onChange={(event) => patchChannel({ leftDelayMs: roundChannelDelayMs(Number(event.currentTarget.value)), enabled: true })} />
              </label>
              <label>
                <span>{t('dsp.panel.channel.rightDelay')}</span>
                <input type="number" min={channelBalanceMinDelayMs} max={channelBalanceMaxDelayMs} step="0.01" value={rightDelayMs} onChange={(event) => patchChannel({ rightDelayMs: roundChannelDelayMs(Number(event.currentTarget.value)), enabled: true })} />
              </label>
            </div>
          ) : null}
        </div>
      </div>

      <aside className="dsp-channel-side">
        <div className="dsp-channel-summary">
          <DspMetric label={t('dsp.panel.channel.leftOutput')} value={formatPreciseDb(effectiveLeftDb)} />
          <DspMetric label={t('dsp.panel.channel.rightOutput')} value={formatPreciseDb(effectiveRightDb)} />
          <DspMetric label={t('dsp.panel.channel.delaySkew')} value={`${delaySkewMs > 0 ? '+' : ''}${Math.round(delaySkewMs * 100) / 100} ms`} />
        </div>

        <div className="dsp-channel-tools">
          <span><Info size={15} aria-hidden="true" />{t('dsp.panel.channel.he90Hint')}</span>
        </div>

        <div className="dsp-channel-tools">
          <span><Info size={15} aria-hidden="true" />{t('dsp.panel.channel.compareHint')}</span>
        </div>

        <div className="dsp-channel-tools">
          <em>{t('dsp.panel.channel.presets')}</em>
          <div className="dsp-channel-presets">
            <div className="dsp-channel-save-row">
              <label>
                <span>{t('dsp.panel.channel.presetName')}</span>
                <input
                  type="text"
                  maxLength={40}
                  value={presetNameDraft}
                  onChange={(event) => setPresetNameDraft(event.currentTarget.value)}
                />
              </label>
              <button type="button" onClick={saveChannelPreset}>
                <Save size={14} aria-hidden="true" />{t('dsp.panel.channel.saveCurrent')}
              </button>
            </div>
            {channelPresets.length > 0 ? (
              <>
                <div className="dsp-channel-preset-picker">
                  <label>
                    <span>{t('dsp.panel.channel.switchPreset')}</span>
                    <select
                      value={activeChannelPresetId ?? ''}
                      onChange={(event) => {
                        const preset = channelPresets.find((item) => item.id === event.currentTarget.value);
                        if (preset) {
                          applyChannelPreset(preset);
                        }
                      }}
                    >
                      <option value="">{t('dsp.panel.channel.selectPreset')}</option>
                      {channelPresets.map((preset) => (
                        <option key={preset.id} value={preset.id}>{preset.name}</option>
                      ))}
                    </select>
                  </label>
                  <div className="dsp-channel-preset-actions">
                    <button type="button" disabled={!activeChannelPreset} onClick={() => activeChannelPreset ? renameChannelPreset(activeChannelPreset) : undefined}>
                      <Pencil size={13} aria-hidden="true" />
                      {t('dsp.panel.channel.renamePreset')}
                    </button>
                    <button type="button" disabled={!activeChannelPreset} onClick={() => activeChannelPreset ? removeChannelPreset(activeChannelPreset.id) : undefined}>
                      <Trash2 size={13} aria-hidden="true" />
                      {t('dsp.panel.channel.removePreset')}
                    </button>
                  </div>
                </div>
                {activeChannelPreset && renamingPresetId === activeChannelPreset.id ? (
                  <div className="dsp-channel-rename-row">
                    <input
                      aria-label={t('dsp.panel.channel.renamePrompt')}
                      maxLength={40}
                      type="text"
                      value={renameDraft}
                      onChange={(event) => setRenameDraft(event.currentTarget.value)}
                    />
                    <button type="button" onClick={() => commitRenameChannelPreset(activeChannelPreset.id)}>
                      <CheckCircle2 size={13} aria-hidden="true" />
                      {t('dsp.action.save')}
                    </button>
                    <button type="button" onClick={() => setRenamingPresetId(null)}>
                      {t('dsp.action.clear')}
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <small>{t('dsp.panel.channel.presetEmpty')}</small>
            )}
          </div>
        </div>

        {panelMode === 'pro' ? (
          <>
            <div className="dsp-channel-tools">
              <em>{t('dsp.panel.channel.monoTools')}</em>
              <span><Info size={15} aria-hidden="true" />{t('dsp.panel.channel.monoHint')}</span>
              <div className="dsp-module-actions">
                {(['off', 'sum', 'left', 'right'] as const).map((mode) => (
                  <button type="button" data-active={channelBalance.monoMode === mode} key={mode} onClick={() => patchChannel({ monoMode: mode, enabled: mode !== 'off' || channelBalance.enabled })}>
                    {t(monoModeKeyMap[mode])}
                  </button>
                ))}
              </div>
            </div>

            <div className="dsp-channel-tools">
              <em>{t('dsp.panel.channel.phaseTools')}</em>
              <div className="dsp-module-actions">
                <button type="button" data-active={channelBalance.swapLeftRight} onClick={() => patchChannel({ swapLeftRight: !channelBalance.swapLeftRight, enabled: true })}>{t('dsp.panel.channel.swap')}</button>
                <button type="button" data-active={channelBalance.invertLeft} onClick={() => patchChannel({ invertLeft: !channelBalance.invertLeft, enabled: true })}>{t('dsp.panel.channel.invertLeft')}</button>
                <button type="button" data-active={channelBalance.invertRight} onClick={() => patchChannel({ invertRight: !channelBalance.invertRight, enabled: true })}>{t('dsp.panel.channel.invertRight')}</button>
                <button type="button" data-active={channelBalance.constantPower} onClick={() => patchChannel({ constantPower: !channelBalance.constantPower })}>{t('dsp.panel.channel.constantPower')}</button>
              </div>
            </div>
          </>
        ) : null}

        <p className="dsp-module-note">{t('dsp.panel.channel.note')}</p>
      </aside>
    </section>
  );
};

const SafetyPanel = ({ audioStatus, eqState, roomCorrection, channelBalance, busyKey, onSafetyLimiterChange, onRefresh }: ModulePanelProps): JSX.Element => {
  const { t } = useDspI18n();
  const dspActive = audioStatus?.dspActive === true;
  const limiterProtecting = audioStatus?.dspLimiterProtecting === true;
  const safetyLimiterEnabled = eqState.dspSafetyLimiterEnabled !== false;
  const liveHeadroomDb = finiteLevel(audioStatus?.audioLevels?.headroomDb);
  const outputPeakDb = finiteLevel(audioStatus?.audioLevels?.estimatedOutputPeakDb);
  const truePeakHeadroomDb = finiteLevel(audioStatus?.audioLevels?.truePeakHeadroomDb);
  const clipCount = audioStatus?.audioLevels?.clipCount ?? 0;
  const clippingRisk = hasObservedDspClippingRisk(audioStatus, eqState, roomCorrection, channelBalance, clipCount);
  const headroomWarning = hasHeadroomWarning(audioStatus, outputPeakDb, liveHeadroomDb, truePeakHeadroomDb);
  const routeTone: HeadroomTone = limiterProtecting ? 'risk' : clippingRisk || headroomWarning ? 'warn' : dspActive ? 'good' : 'warn';
  const heroTitleKey: string =
    limiterProtecting || clippingRisk ? 'dsp.panel.safety.heroRiskTitle' :
    dspActive ? 'dsp.panel.safety.heroProtectedTitle' :
    'dsp.panel.safety.heroDirectTitle';
  const heroDetailKey: string =
    limiterProtecting || clippingRisk ? 'dsp.panel.safety.heroRiskDetail' :
    dspActive ? 'dsp.panel.safety.heroProtectedDetail' :
    'dsp.panel.safety.heroDirectDetail';
  const nextTitleKey: string =
    limiterProtecting || clippingRisk ? 'dsp.panel.safety.nextRisk' :
    dspActive ? 'dsp.panel.safety.nextProtected' :
    'dsp.panel.safety.nextDirect';
  const nextDetailKey: string =
    limiterProtecting || clippingRisk ? 'dsp.panel.safety.nextRiskDetail' :
    dspActive ? 'dsp.panel.safety.nextProtectedDetail' :
    'dsp.panel.safety.nextDirectDetail';
  const activeProcessModules = [
    eqState.enabled || audioStatus?.eqEnabled ? t('dsp.module.eq.title') : null,
    roomCorrection.enabled ? t('dsp.module.room.title') : null,
    channelBalance.enabled || audioStatus?.channelBalanceEnabled ? t('dsp.module.channel.title') : null,
  ].filter((module): module is string => Boolean(module));
  const processLabel = activeProcessModules.length > 0 ? activeProcessModules.join(' / ') : t('dsp.status.bypassed');
  const routeItems = [
    { key: 'dsp.panel.safety.routeInput', icon: RadioTower, value: audioStatus?.codec ?? t('dsp.status.systemOutput') },
    { key: 'dsp.panel.safety.routeHeadroom', icon: Gauge, value: formatDb(eqState.dspHeadroomDb ?? audioStatus?.dspHeadroomDb ?? 0) },
    { key: 'dsp.panel.safety.routeProcess', icon: SlidersHorizontal, value: processLabel },
    { key: 'dsp.panel.safety.routeOutput', icon: ShieldCheck, value: limiterProtecting ? t('dsp.status.limiting') : clippingRisk ? t('dsp.status.riskDetected') : t('dsp.status.ready') },
  ];
  const safetyChecks = [
    {
      label: t('dsp.panel.safety.checkBitPerfect'),
      value: dspActive ? t('dsp.status.dspPath') : t('dsp.status.candidate'),
      tone: dspActive ? undefined : 'good' as HeadroomTone,
    },
    {
      label: t('dsp.panel.safety.checkLimiter'),
      value: safetyLimiterEnabled
        ? (limiterProtecting ? t('dsp.status.limiting') : t('dsp.status.limiterArmed'))
        : t('dsp.panel.safety.limiterBypassed'),
      tone: !safetyLimiterEnabled ? 'risk' as HeadroomTone : limiterProtecting ? 'risk' as HeadroomTone : 'good' as HeadroomTone,
    },
    {
      label: t('dsp.metric.outputEstimate'),
      value: formatLevel(outputPeakDb),
      tone: outputPeakDb !== null && outputPeakDb >= -1 ? 'warn' as HeadroomTone : undefined,
    },
    {
      label: t('dsp.metric.liveHeadroom'),
      value: formatLevel(liveHeadroomDb),
      tone: liveHeadroomDb !== null && liveHeadroomDb <= 1 ? 'warn' as HeadroomTone : 'good' as HeadroomTone,
    },
    {
      label: t('dsp.panel.headroom.clipCount'),
      value: t('dsp.panel.headroom.clipCountValue', { count: String(clipCount) }),
      tone: clipCount > 0 ? 'risk' as HeadroomTone : 'good' as HeadroomTone,
    },
    {
      label: t('dsp.panel.safety.checkRoom'),
      value: roomCorrection.enabled ? t('dsp.status.active') : t('dsp.status.bypassed'),
      tone: roomCorrection.clippingRisk ? 'risk' as HeadroomTone : roomCorrection.enabled ? 'good' as HeadroomTone : undefined,
    },
    {
      label: t('dsp.panel.safety.checkChannel'),
      value: channelBalance.enabled ? t('dsp.status.active') : t('dsp.status.bypassed'),
      tone: channelBalance.clippingRisk ? 'risk' as HeadroomTone : channelBalance.enabled ? 'good' as HeadroomTone : undefined,
    },
    {
      label: t('dsp.metric.reason'),
      value: audioStatus?.bitPerfectDisabledReason ?? t('dsp.status.none'),
      tone: clippingRisk ? 'risk' as HeadroomTone : undefined,
    },
  ];

  return (
    <section className="dsp-module-panel dsp-module-panel--safety" data-tone={routeTone}>
      <div className="dsp-safety-hero">
        <div className="dsp-safety-emblem">
          <ShieldCheck size={28} aria-hidden="true" />
        </div>
        <div>
          <h2>{t(heroTitleKey)}</h2>
          <p>{t(heroDetailKey)}</p>
        </div>
      </div>

      <div className="dsp-safety-route" aria-label={t('dsp.panel.safety.chainTitle')}>
        {routeItems.map((item) => {
          const Icon = item.icon;
          return (
            <span key={item.key}>
              <Icon size={17} aria-hidden="true" />
              <em>{t(item.key)}</em>
              <strong>{item.value}</strong>
            </span>
          );
        })}
      </div>

      <div className="dsp-safety-body">
        <div className="dsp-safety-checks">
          <div className="dsp-safety-section-head">
            <span><AudioWaveform size={16} aria-hidden="true" />{t('dsp.panel.safety.checkTitle')}</span>
          </div>
          <div className="dsp-module-metrics dsp-safety-metrics">
            {safetyChecks.map((check) => (
              <DspMetric key={check.label} label={check.label} value={check.value} tone={check.tone} />
            ))}
          </div>
        </div>

        <aside className="dsp-safety-next">
          <span>
            <Info size={16} aria-hidden="true" />
            <em>{t('dsp.panel.safety.nextTitle')}</em>
          </span>
          <strong>{t(nextTitleKey)}</strong>
          <p>{t(nextDetailKey)}</p>
          <div className="dsp-module-actions" role="group" aria-label={t('dsp.panel.safety.limiterToggleTitle')}>
            <button
              type="button"
              data-active={safetyLimiterEnabled}
              disabled={busyKey === 'safety'}
              onClick={() => onSafetyLimiterChange(true)}
            >
              <ShieldCheck size={14} aria-hidden="true" />
              {t('dsp.panel.safety.enableLimiter')}
            </button>
            <button
              type="button"
              data-active={!safetyLimiterEnabled}
              disabled={busyKey === 'safety'}
              onClick={() => onSafetyLimiterChange(false)}
            >
              <Zap size={14} aria-hidden="true" />
              {t('dsp.panel.safety.disableLimiter')}
            </button>
          </div>
          {!safetyLimiterEnabled ? <p>{t('dsp.panel.safety.limiterBypassedDetail')}</p> : null}
          <button type="button" onClick={onRefresh}>
            <Activity size={14} aria-hidden="true" />
            {t('dsp.action.refresh')}
          </button>
        </aside>
      </div>

      <p className="dsp-module-note">{t('dsp.panel.safety.note')}</p>
    </section>
  );
};

const DspWorkbench = (): JSX.Element => {
  const { t } = useDspI18n();
  const { audioStatus, error } = useThrottledSharedPlaybackStatus(dspPlaybackStatusUiIntervalMs);
  const [selectedModuleId, setSelectedModuleId] = useState<DspModuleId>(() => readStoredDspModuleId());
  const [eqState, setEqState] = useState<EqState>(fallbackEqState);
  const [roomCorrection, setRoomCorrection] = useState<RoomCorrectionState>(fallbackRoomCorrection);
  const [channelBalance, setChannelBalance] = useState<ChannelBalanceState>(fallbackChannelBalance);
  const [compressor, setCompressor] = useState<CompressorState>(() => defaultDspRackState().compressor);
  const [crossfeed, setCrossfeed] = useState<CrossfeedState>(() => defaultDspRackState().crossfeed);
  const [stereoField, setStereoField] = useState<StereoFieldState>(() => defaultDspRackState().stereoField);
  const [channelMatrix, setChannelMatrix] = useState<ChannelMatrixState>(() => defaultDspRackState().channelMatrix);
  const [moduleError, setModuleError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  useEffect(() => {
    writeStoredDspModuleId(selectedModuleId);
  }, [selectedModuleId]);

  const loadModuleStates = useCallback(async (): Promise<void> => {
    const eq = getEqBridge();
    if (!eq) {
      setModuleError(t('dsp.error.desktopBridge'));
      return;
    }

    try {
      const [nextEqState, nextRoomCorrection, nextChannelBalance, nextCompressor, nextCrossfeed, nextStereoField, nextChannelMatrix] = await Promise.all([
        eq.getState(),
        eq.getRoomCorrectionState?.() ?? Promise.resolve(fallbackRoomCorrection),
        eq.getChannelBalanceState(),
        eq.getCompressorState?.() ?? Promise.resolve(defaultDspRackState().compressor),
        eq.getCrossfeedState?.() ?? Promise.resolve(defaultDspRackState().crossfeed),
        eq.getStereoFieldState?.() ?? Promise.resolve(defaultDspRackState().stereoField),
        eq.getChannelMatrixState?.() ?? Promise.resolve(defaultDspRackState().channelMatrix),
      ]);
      setEqState(nextEqState);
      setRoomCorrection(nextRoomCorrection);
      setChannelBalance(nextChannelBalance);
      setCompressor(nextCompressor);
      setCrossfeed(nextCrossfeed);
      setStereoField(nextStereoField);
      setChannelMatrix(nextChannelMatrix);
      setModuleError(null);
    } catch (stateError) {
      setModuleError(stateError instanceof Error ? stateError.message : String(stateError));
    }
  }, [t]);

  useEffect(() => {
    void loadModuleStates();
  }, [loadModuleStates]);

  const runModuleAction = useCallback(async (key: string, action: () => Promise<void>): Promise<void> => {
    setBusyKey(key);
    setModuleError(null);
    try {
      await action();
      await refreshPlaybackStatus();
    } catch (actionError) {
      setModuleError(formatDspActionError(actionError));
    } finally {
      setBusyKey(null);
    }
  }, []);

  const handleHeadroomChange = useCallback(
    (headroomDb: number): void => {
      const eq = getEqBridge();
      if (!eq?.setDspHeadroom) {
        setModuleError(t('dsp.error.dspBridge'));
        return;
      }

      const safeHeadroomDb = Math.round(clampNumber(headroomDb, dspHeadroomMinDb, dspHeadroomMaxDb) * 10) / 10;
      setEqState((current) => ({ ...current, dspHeadroomDb: safeHeadroomDb }));
      void runModuleAction('headroom', async () => {
        setEqState(await eq.setDspHeadroom(safeHeadroomDb));
      });
    },
    [runModuleAction, t],
  );

  const handleSafetyLimiterChange = useCallback(
    (enabled: boolean): void => {
      const eq = getEqBridge();
      if (!eq?.setDspSafetyLimiterEnabled) {
        setModuleError(t('dsp.error.dspBridge'));
        return;
      }

      setEqState((current) => ({ ...current, dspSafetyLimiterEnabled: enabled }));
      void runModuleAction('safety', async () => {
        setEqState(await eq.setDspSafetyLimiterEnabled(enabled));
      });
    },
    [runModuleAction, t],
  );

  const handleImportRoomCorrection = useCallback((): void => {
    const eq = getEqBridge();
    if (!eq?.importRoomCorrectionIr) {
      setModuleError(t('dsp.error.firBridge'));
      return;
    }

    void runModuleAction('room-import', async () => {
      const imported = await eq.importRoomCorrectionIr();
      if (imported) {
        setRoomCorrection(imported);
      }
    });
  }, [runModuleAction, t]);

  const handleToggleRoomCorrection = useCallback((): void => {
    const eq = getEqBridge();
    if (!eq?.setRoomCorrectionEnabled) {
      setModuleError(t('dsp.error.firBridge'));
      return;
    }

    void runModuleAction('room-toggle', async () => {
      setRoomCorrection(await eq.setRoomCorrectionEnabled(!roomCorrection.enabled));
    });
  }, [roomCorrection.enabled, runModuleAction, t]);

  const handleEnableRoomSafely = useCallback((): void => {
    const eq = getEqBridge();
    if (!eq?.setDspHeadroom || !eq?.setRoomCorrectionEnabled) {
      setModuleError(t('dsp.error.firBridge'));
      return;
    }

    if (!roomCorrection.irId) {
      setModuleError(t('dsp.error.firBridge'));
      return;
    }

    const safeHeadroomDb = roundHeadroomDb(Math.min(eqState.dspHeadroomDb ?? 0, -6));
    setEqState((current) => ({ ...current, dspHeadroomDb: safeHeadroomDb }));
    setRoomCorrection((current) => ({ ...current, enabled: true }));
    void runModuleAction('room-safe-enable', async () => {
      setEqState(await eq.setDspHeadroom(safeHeadroomDb));
      setRoomCorrection(await eq.setRoomCorrectionEnabled(true));
    });
  }, [eqState.dspHeadroomDb, roomCorrection.irId, runModuleAction, t]);

  const handleRoomTrimChange = useCallback(
    (trimDb: number): void => {
      const eq = getEqBridge();
      if (!eq?.setRoomCorrectionTrim) {
        setModuleError(t('dsp.error.firBridge'));
        return;
      }

      const safeTrimDb = Math.round(clampNumber(trimDb, roomCorrectionMinTrimDb, roomCorrectionMaxTrimDb) * 10) / 10;
      setRoomCorrection((current) => ({ ...current, trimDb: safeTrimDb }));
      void runModuleAction('room-trim', async () => {
        setRoomCorrection(await eq.setRoomCorrectionTrim(safeTrimDb));
      });
    },
    [runModuleAction, t],
  );

  const handleClearRoomCorrection = useCallback((): void => {
    const eq = getEqBridge();
    if (!eq?.clearRoomCorrection) {
      setModuleError(t('dsp.error.firBridge'));
      return;
    }

    void runModuleAction('room-clear', async () => {
      setRoomCorrection(await eq.clearRoomCorrection());
    });
  }, [runModuleAction, t]);

  const handleChannelPatch = useCallback(
    (patch: Partial<ChannelBalanceState>): void => {
      const eq = getEqBridge();
      if (!eq?.setChannelBalanceState) {
        setModuleError(t('dsp.error.channelBridge'));
        return;
      }

      setChannelBalance((current) => ({ ...current, ...patch }));
      void runModuleAction('channel', async () => {
        setChannelBalance(await eq.setChannelBalanceState(patch));
      });
    },
    [runModuleAction, t],
  );

  const handleChannelReset = useCallback((): void => {
    const eq = getEqBridge();
    if (!eq?.resetChannelBalance) {
      setModuleError(t('dsp.error.channelBridge'));
      return;
    }

    void runModuleAction('channel-reset', async () => {
      setChannelBalance(await eq.resetChannelBalance());
    });
  }, [runModuleAction, t]);

  const dspActive = audioStatus?.dspActive === true;
  const eqEnabled = audioStatus?.eqEnabled ?? eqState.enabled;
  const activeEqPresetName = audioStatus?.eqPresetName || eqState.presetName || '';
  const headphoneCorrectionActive = eqEnabled && activeEqPresetName.startsWith('耳机校正 -');
  const channelBalanceEnabled = audioStatus?.channelBalanceEnabled ?? channelBalance.enabled;
  const outputPeakDb = finiteLevel(audioStatus?.audioLevels?.estimatedOutputPeakDb);
  const liveHeadroomDb = finiteLevel(audioStatus?.audioLevels?.headroomDb);
  const truePeakHeadroomDb = finiteLevel(audioStatus?.audioLevels?.truePeakHeadroomDb);
  const clipCount = audioStatus?.audioLevels?.clipCount ?? 0;
  const clippingRisk = hasObservedDspClippingRisk(audioStatus, eqState, roomCorrection, channelBalance, clipCount);
  const headroomWarning = hasHeadroomWarning(audioStatus, outputPeakDb, liveHeadroomDb, truePeakHeadroomDb);
  const dspHeadroomDb = eqState.dspHeadroomDb ?? 0;
  const safetyLimiterEnabled = eqState.dspSafetyLimiterEnabled !== false;
  const outputName = audioStatus?.outputDeviceName || t('dsp.status.systemOutput');
  const sampleRate = audioStatus?.actualDeviceSampleRate ?? audioStatus?.requestedOutputSampleRate ?? audioStatus?.fileSampleRate ?? null;
  const modules = useMemo<DspModule[]>(
    () => [
      {
        id: 'rack',
        stageKey: 'dsp.stage.input',
        title: 'DSP Rack',
        subtitle: '8 个可重排模块',
        description: '编排实际处理顺序',
        icon: Route,
        enabled: false,
        accent: 'violet',
      },
      {
        id: 'headroom',
        stageKey: 'dsp.stage.input',
        title: t('dsp.module.headroom.title'),
        subtitle: formatDb(dspHeadroomDb),
        description: t('dsp.module.headroom.description'),
        icon: Gauge,
        enabled: Math.abs(dspHeadroomDb) > 0.05,
        accent: 'blue',
      },
      {
        id: 'eq',
        stageKey: 'dsp.stage.shape',
        title: t('dsp.module.eq.title'),
        subtitle: audioStatus?.eqPresetName || eqState.presetName || t('dsp.status.flat'),
        description: t('dsp.module.eq.description'),
        icon: SlidersHorizontal,
        enabled: eqEnabled,
        accent: 'violet',
      },
      {
        id: 'compressor',
        stageKey: 'dsp.stage.shape',
        title: '压缩器',
        subtitle: compressor.enabled ? `${compressor.ratio.toFixed(1)}:1 / ${compressor.thresholdDb.toFixed(1)} dB` : t('dsp.status.bypassed'),
        description: '软拐点、并行混合与补偿增益',
        icon: Gauge,
        enabled: compressor.enabled,
        accent: 'amber',
      },
      {
        id: 'crossfeed',
        stageKey: 'dsp.stage.stereo',
        title: '交叉馈送',
        subtitle: crossfeed.enabled ? `${Math.round(crossfeed.amount * 100)}% / ${Math.round(crossfeed.cutoffHz)} Hz` : t('dsp.status.bypassed'),
        description: '耳机低频声像自然融合',
        icon: Headphones,
        enabled: crossfeed.enabled,
        accent: 'blue',
      },
      {
        id: 'stereoField',
        stageKey: 'dsp.stage.stereo',
        title: '立体声场',
        subtitle: stereoField.enabled ? `${Math.round(stereoField.width * 100)}%` : t('dsp.status.bypassed'),
        description: 'Mid / Side 宽度与增益',
        icon: Waves,
        enabled: stereoField.enabled,
        accent: 'violet',
      },
      {
        id: 'channelMatrix',
        stageKey: 'dsp.stage.stereo',
        title: '声道矩阵',
        subtitle: channelMatrix.enabled ? '2 × 2' : t('dsp.status.bypassed'),
        description: '左右声道任意路由与混合',
        icon: Route,
        enabled: channelMatrix.enabled,
        accent: 'amber',
      },
      {
        id: 'headphone',
        stageKey: 'dsp.stage.shape',
        title: t('dsp.module.headphone.title'),
        subtitle: headphoneCorrectionActive ? activeEqPresetName : 'OPRA',
        description: t('dsp.module.headphone.description'),
        icon: Headphones,
        enabled: headphoneCorrectionActive,
        accent: 'blue',
      },
      {
        id: 'room',
        stageKey: 'dsp.stage.space',
        title: t('dsp.module.room.title'),
        subtitle: roomCorrection.irName ?? t('dsp.status.noIr'),
        description: t('dsp.module.room.description'),
        icon: Waves,
        enabled: roomCorrection.enabled,
        accent: 'green',
      },
      {
        id: 'channel',
        stageKey: 'dsp.stage.stereo',
        title: t('dsp.module.channel.title'),
        subtitle: channelBalanceEnabled ? t('dsp.status.balanceActive') : t('dsp.status.stereoDirect'),
        description: t('dsp.module.channel.description'),
        icon: Headphones,
        enabled: channelBalanceEnabled,
        accent: 'amber',
      },
      {
        id: 'safety',
        stageKey: 'dsp.stage.output',
        title: t('dsp.module.safety.title'),
        subtitle: !safetyLimiterEnabled ? t('dsp.panel.safety.limiterBypassed') : audioStatus?.dspLimiterProtecting === true ? t('dsp.status.limiting') : clippingRisk ? t('dsp.status.riskDetected') : headroomWarning ? t('dsp.status.headroomRisk') : t('dsp.status.limiterArmed'),
        description: t('dsp.module.safety.description'),
        icon: ShieldCheck,
        enabled: !safetyLimiterEnabled || audioStatus?.dspLimiterProtecting === true || clippingRisk || headroomWarning || dspActive,
        accent: !safetyLimiterEnabled || audioStatus?.dspLimiterProtecting === true || clippingRisk || headroomWarning ? 'amber' : 'green',
      },
    ],
    [activeEqPresetName, audioStatus?.dspLimiterProtecting, audioStatus?.eqPresetName, channelBalanceEnabled, channelMatrix.enabled, clippingRisk, compressor.enabled, compressor.ratio, compressor.thresholdDb, crossfeed.amount, crossfeed.cutoffHz, crossfeed.enabled, dspActive, dspHeadroomDb, eqEnabled, eqState.presetName, headroomWarning, headphoneCorrectionActive, roomCorrection.enabled, roomCorrection.irName, safetyLimiterEnabled, stereoField.enabled, stereoField.width, t],
  );

  const activeCount = modules.filter((module) => module.id !== 'rack' && module.enabled).length;
  const selectedModule = modules.find((module) => module.id === selectedModuleId) ?? modules[1];
  const SelectedIcon = selectedModule.icon;
  const pipelineNodes = modules.filter((module) => module.id !== 'rack').map((module) => ({
    id: module.id,
    label: t(module.stageKey),
    value: module.enabled ? module.subtitle : t('dsp.status.bypassed'),
    enabled: module.enabled,
    selected: module.id === selectedModuleId,
    risk: module.id === 'safety' && clippingRisk,
  }));
  const panelProps: ModulePanelProps = {
    audioStatus,
    eqState,
    roomCorrection,
    channelBalance,
    busyKey,
    onHeadroomChange: handleHeadroomChange,
    onSafetyLimiterChange: handleSafetyLimiterChange,
    onImportRoomCorrection: handleImportRoomCorrection,
    onToggleRoomCorrection: handleToggleRoomCorrection,
    onEnableRoomSafely: handleEnableRoomSafely,
    onRoomTrimChange: handleRoomTrimChange,
    onClearRoomCorrection: handleClearRoomCorrection,
    onChannelPatch: handleChannelPatch,
    onChannelReset: handleChannelReset,
    onRefresh: () => {
      void loadModuleStates();
      void refreshPlaybackStatus();
    },
  };

  useEffect(() => {
    const dspError = moduleError ?? error;
    if (dspError) {
      dispatchAudioErrorNotice(dspError);
    }
  }, [moduleError, error]);

  return (
    <div className="dsp-page">
      <div className="dsp-stage" data-module={selectedModuleId}>
        <aside className="dsp-rail" aria-label={t('dsp.aria.modules')}>
          <div className="dsp-brand">
            <span>DSP</span>
            <strong>ECHO</strong>
            <em>{t('dsp.brand.subtitle')}</em>
          </div>

          <div className="dsp-output-card">
            <RadioTower size={17} aria-hidden="true" />
            <div>
              <span>{t('dsp.label.output')}</span>
              <strong>{outputName}</strong>
              <small>{formatRate(sampleRate, t('dsp.status.auto'))} / {audioStatus?.outputMode ?? t('dsp.status.shared')}</small>
            </div>
          </div>

          <nav className="dsp-chain" aria-label={t('dsp.aria.chain')}>
            {modules.map((module, index) => {
              const Icon = module.icon;
              const isSelected = module.id === selectedModuleId;
              const previousModule = modules[index - 1];
              const showStage = !previousModule || previousModule.stageKey !== module.stageKey;

              return (
                <div className="dsp-chain-group" key={module.id}>
                  {showStage ? <span className="dsp-chain-stage">{t(module.stageKey)}</span> : null}
                  <button
                    type="button"
                    className="dsp-chain-item"
                    data-active={module.id === 'rack' || module.enabled}
                    data-selected={isSelected}
                    data-accent={module.accent}
                    onClick={() => setSelectedModuleId(module.id)}
                  >
                    <span className="dsp-chain-handle" aria-hidden="true" />
                    <span className="dsp-chain-icon">
                      <Icon size={17} aria-hidden="true" />
                    </span>
                    <span className="dsp-chain-copy">
                      <strong>{module.title}</strong>
                      <small>{module.description}</small>
                    </span>
                    <span className="dsp-chain-state" aria-hidden="true">
                      {module.id === 'rack' ? <Route size={14} /> : module.enabled ? <CheckCircle2 size={14} /> : null}
                    </span>
                  </button>
                </div>
              );
            })}
          </nav>
        </aside>

        <section
          className="dsp-workspace"
          data-module={selectedModuleId}
          aria-label={t('dsp.aria.workspace')}
        >
          <header className="dsp-topbar">
            <div className="dsp-topbar-title">
              <span className="dsp-selected-icon">
                <SelectedIcon size={22} aria-hidden="true" />
              </span>
              <div>
                <p>{t('dsp.label.module')}</p>
                <h1>{selectedModule.title}</h1>
                <span className="dsp-topbar-subtitle">{t(selectedModule.stageKey)} / {selectedModule.description}</span>
              </div>
            </div>
            <div className="dsp-topbar-status">
              <span data-active={dspActive}>
                <Activity size={14} aria-hidden="true" />
                {dspActive ? t('dsp.status.modulesActive', { count: activeCount }) : t('dsp.status.nativeDirect')}
              </span>
              <span data-risk={clippingRisk}>
                <AudioWaveform size={14} aria-hidden="true" />
                {audioStatus?.dspLimiterProtecting === true ? t('dsp.status.limiting') : clippingRisk || headroomWarning ? t('dsp.status.headroomRisk') : t('dsp.status.ready')}
              </span>
            </div>
          </header>

          <div className="dsp-pipeline-map" aria-label={t('dsp.aria.pipeline')}>
            {pipelineNodes.map((node) => (
              <span key={node.id} data-active={node.enabled} data-selected={node.selected} data-risk={node.risk}>
                <em>{node.label}</em>
                <strong>{node.value}</strong>
              </span>
            ))}
          </div>

          <div className="dsp-focus-strip" data-risk={clippingRisk}>
            <span>
              <em>{t('dsp.label.currentModule')}</em>
              <strong>{selectedModule.title}</strong>
            </span>
            <span>
              <em>{t('dsp.label.moduleStatus')}</em>
              <strong>{selectedModule.id === 'rack' ? '可编辑' : selectedModule.enabled ? t('dsp.status.active') : t('dsp.status.bypassed')}</strong>
            </span>
            <span>
              <em>{t('dsp.label.bitPerfect')}</em>
              <strong>{dspActive ? t('dsp.status.dspPath') : t('dsp.status.ready')}</strong>
            </span>
            <button type="button" onClick={panelProps.onRefresh}>
              {t('dsp.action.refresh')}
            </button>
          </div>

          <div className="dsp-editor-shell" data-module={selectedModuleId}>
            {selectedModuleId === 'rack' ? <DspRackPanel /> : null}
            {selectedModuleId === 'headroom' ? <HeadroomPanel {...panelProps} /> : null}
            {selectedModuleId === 'eq' ? <EqPanel audioStatus={audioStatus} onAudioStatusRefresh={() => void refreshPlaybackStatus()} surface="eq-only" /> : null}
            {selectedModuleId === 'compressor' ? <CompressorPanel state={compressor} onApplied={setCompressor} /> : null}
            {selectedModuleId === 'crossfeed' ? <CrossfeedPanel state={crossfeed} onApplied={setCrossfeed} /> : null}
            {selectedModuleId === 'stereoField' ? <StereoFieldPanel state={stereoField} onApplied={setStereoField} /> : null}
            {selectedModuleId === 'channelMatrix' ? <ChannelMatrixPanel state={channelMatrix} onApplied={setChannelMatrix} /> : null}
            {selectedModuleId === 'headphone' ? (
              <HeadphoneCorrectionPanel
                eqState={eqState}
                showTitle={false}
                onApplied={setEqState}
                onAppliedStatusRefresh={() => {
                  void refreshPlaybackStatus();
                }}
              />
            ) : null}
            {selectedModuleId === 'room' ? <RoomCorrectionPanel {...panelProps} /> : null}
            {selectedModuleId === 'channel' ? <ChannelPanel {...panelProps} /> : null}
            {selectedModuleId === 'safety' ? <SafetyPanel {...panelProps} /> : null}
          </div>
        </section>
      </div>
    </div>
  );
};

export const DspPage = (): JSX.Element => <DspWorkbench />;
