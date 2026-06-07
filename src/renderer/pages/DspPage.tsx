import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AudioWaveform, CheckCircle2, Gauge, Headphones, Info, RadioTower, Route, ShieldCheck, SlidersHorizontal, Waves, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AudioEchoSrcMode, AudioEchoSrcQualityProfile, AudioStatus, ChannelBalanceMonoMode, ChannelBalanceState } from '../../shared/types/audio';
import type { EqState, RoomCorrectionState } from '../../shared/types/eq';
import { useI18n } from '../i18n/I18nProvider';
import type { TranslationKey } from '../i18n/locales';
import { refreshPlaybackStatus, useSharedPlaybackStatus } from '../stores/playbackStatusStore';
import { getEqBridge } from '../utils/echoBridge';

type DspModuleId = 'headroom' | 'src' | 'eq' | 'headphone' | 'room' | 'channel' | 'safety';

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

type UzumeFormatPath = 'pcm_bitperfect' | 'pcm_processed' | 'dsd_direct' | 'dsd_upsampling' | 'd2p_processed' | 'sdm_processed';

type UzumeFormatPathState = 'current' | 'available' | 'transition' | 'planned' | 'unavailable';

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

const echoSrcModeOptions: Array<{ mode: AudioEchoSrcMode; title: string; detail: string }> = [
  { mode: 'off', title: '关闭', detail: '保持源采样率，Bit-perfect 条件不受 SRC 影响。' },
  { mode: 'family2x', title: '2x PCM', detail: '44.1k 家族升到 88.2k，48k 家族升到 96k。' },
  { mode: 'family4x', title: '4x PCM', detail: '44.1k 家族升到 176.4k，48k 家族升到 192k。' },
  { mode: 'family8x', title: '8x Ultra', detail: '实验档：44.1k 家族升到 352.8k，48k 家族升到 384k。' },
];

const echoSrcQualityOptions: Array<{ profile: AudioEchoSrcQualityProfile; title: string; detail: string; precision: string }> = [
  { profile: 'transparent', title: 'Transparent', detail: '最高精度 SOXR，优先透明和低失真。', precision: 'SOXR precision 28' },
  { profile: 'balanced', title: 'Balanced', detail: '保持原有 SOXR 档位，兼顾稳定和开销。', precision: 'SOXR precision 20' },
  { profile: 'lowLatency', title: 'Low latency', detail: '降低 SRC 开销，适合低延迟输出。', precision: 'SOXR precision 16' },
];

const normalizeEchoSrcMode = (mode: unknown): AudioEchoSrcMode =>
  mode === 'family2x' || mode === 'family4x' || mode === 'family8x' ? mode : 'off';

const normalizeEchoSrcQualityProfile = (profile: unknown): AudioEchoSrcQualityProfile =>
  profile === 'balanced' || profile === 'lowLatency' ? profile : 'transparent';

const dspLocalText: Record<string, string> = {
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
  'dsp.aria.capabilities': 'UZUME 能力控制',
  'dsp.aria.chain': 'UZUME section 链',
  'dsp.aria.modules': 'UZUME sections',
  'dsp.aria.pipeline': 'UZUME 路径',
  'dsp.aria.workspace': 'UZUME 工作区',
  'dsp.brand.subtitle': 'Signal Engine',
  'dsp.capability.avx.detail': 'CPU SIMD backend 将在 UZUME kernel ABI 冻结后接入。',
  'dsp.capability.avx.title': 'AVX2 / AVX512',
  'dsp.capability.dsd.detail': 'DSD direct / D2P / SDM family 尚未接入 UI 可用路径。',
  'dsp.capability.dsd.title': 'DSD family',
  'dsp.capability.fused.detail': 'RPC-001 仍是 skeleton / transitional path，不能声明完整 fused macro-kernel。',
  'dsp.capability.fused.title': 'Fused macro-kernel',
  'dsp.capability.gpu.detail': 'GPU limiter / matrix / FIR scratch 目前只作为遥测字段，不作为 UZUME 可用能力。',
  'dsp.capability.gpu.title': 'GPU render-ahead',
  'dsp.capability.headroom.detail': '当前 Headroom 仍通过 legacy/compat DSP 参数工作，UZUME Headroom kernel 未实现。',
  'dsp.capability.headroom.title': 'Headroom section',
  'dsp.capability.polySinc.detail': '当前 PCM SRC 仍来自 ECHO/SOXR 兼容路径，UZUME Poly-Sinc 尚未落地。',
  'dsp.capability.polySinc.title': 'UZUME Poly-Sinc SRC',
  'dsp.capability.sharedConvolution.detail': '当前 FIR 使用 legacy convolver source，Shared Convolution Engine 未实现。',
  'dsp.capability.sharedConvolution.title': 'Shared convolution',
  'dsp.capability.state.active': '可用',
  'dsp.capability.state.planned': '未实现',
  'dsp.capability.state.transitional': '过渡',
  'dsp.capability.state.unavailable': '不可用',
  'dsp.capability.stripTitle': 'RPC-001 能力面',
  'dsp.capability.stripDetail': 'RPC-001 仍是 skeleton；这里全部只读标记为未实现，不提供 UZUME 开关。',
  'dsp.module.src.description': 'Poly-Sinc 未实现',
  'dsp.module.src.title': 'UZUME SRC / PCM',
  'dsp.panel.src.active': 'ECHO/SOXR 兼容升频',
  'dsp.panel.src.bypassDsd': 'DSD 输出旁路',
  'dsp.panel.src.bypassShared': '共享输出旁路',
  'dsp.panel.src.compatDetail': 'SOXR 仍是旧链路，不在这里伪装成 UZUME profile。现有 ECHO/SOXR 设置只作为状态读数显示。',
  'dsp.panel.src.compatModeConfigured': '已保存兼容设置',
  'dsp.panel.src.compatModeOff': '兼容 SRC 关闭',
  'dsp.panel.src.compatPath': '兼容路径',
  'dsp.panel.src.compatSettings': 'ECHO/SOXR 设置',
  'dsp.panel.src.compatTitle': '当前可用的是 ECHO/SOXR 兼容路径',
  'dsp.panel.src.detail': 'RPC-001 只展示 PCM rate plan 和 disabled reason；正式 UZUME Poly-Sinc SRC 尚未接入。',
  'dsp.panel.src.engine': '引擎',
  'dsp.panel.src.kicker': '采样率转换',
  'dsp.panel.src.legacyPrecision': '兼容精度',
  'dsp.panel.src.mode': '模式',
  'dsp.panel.src.native': '原生直通',
  'dsp.panel.src.note': '这里只显示状态，不提供 UZUME SRC 开关。共享输出、DSD 输出或 HQPlayer 接管时，ECHO/SOXR 兼容 SRC 也会旁路。',
  'dsp.panel.src.pending': '等待下一次播放规划',
  'dsp.panel.src.plannedProfiles': '规划中的 UZUME SRC profile',
  'dsp.panel.src.precision': '精度',
  'dsp.panel.src.profileUnavailable': '未实现',
  'dsp.panel.src.quality': '质量策略',
  'dsp.panel.src.route': '路径',
  'dsp.panel.src.sourceRate': '源采样率',
  'dsp.panel.src.targetRate': '目标采样率',
  'dsp.panel.src.unavailable': '未实现',
  'dsp.panel.src.unavailableDetail': 'Poly-Sinc planner / kernel 完成前，这些倍率不能作为 UZUME 控件启用。',
  'dsp.panel.src.unavailableTitle': 'UZUME Poly-Sinc SRC 未实现',
  'dsp.panel.src.uzumeStatus': 'UZUME SRC',
  'dsp.stage.src': '采样率',
  'dsp.error.channelBridge': '声道工具不可用。',
  'dsp.error.desktopBridge': '桌面桥接不可用。',
  'dsp.error.dspBridge': 'UZUME 参数桥接不可用。',
  'dsp.error.firBridge': 'FIR 桥接不可用。',
  'dsp.label.bitPerfect': 'Bit-perfect',
  'dsp.label.currentModule': '当前模块',
  'dsp.label.module': 'UZUME section',
  'dsp.label.moduleStatus': '模块状态',
  'dsp.label.output': '输出',
  'dsp.metric.bitPerfect': 'Bit-perfect',
  'dsp.metric.clipping': '削波',
  'dsp.metric.compatBackend': '兼容后端',
  'dsp.metric.dsp': 'UZUME',
  'dsp.metric.inputPeak': '输入峰值',
  'dsp.metric.ir': 'IR',
  'dsp.metric.latency': '延迟',
  'dsp.metric.liveHeadroom': '实时余量',
  'dsp.metric.mode': '模式',
  'dsp.metric.outputEstimate': '输出估算',
  'dsp.metric.preamp': 'Preamp',
  'dsp.metric.preset': 'Preset',
  'dsp.metric.reason': '原因',
  'dsp.metric.sampleRate': '采样率',
  'dsp.metric.status': '状态',
  'dsp.metric.taps': 'Taps',
  'dsp.module.channel.description': 'Matrix 未实现',
  'dsp.module.channel.title': 'UZUME Matrix',
  'dsp.module.eq.description': 'EQ 未实现',
  'dsp.module.eq.title': 'UZUME EQ',
  'dsp.module.headroom.description': 'Headroom 未实现',
  'dsp.module.headroom.title': 'UZUME Headroom',
  'dsp.module.headphone.description': 'OPRA 未实现',
  'dsp.module.headphone.title': 'OPRA Headphone',
  'dsp.module.room.description': 'FIR 未实现',
  'dsp.module.room.title': 'UZUME FIR',
  'dsp.module.safety.description': 'Safety 未实现',
  'dsp.module.safety.title': 'UZUME Safety',
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
  'dsp.panel.headroom.modeDailyDetail': '轻量 UZUME 预留。',
  'dsp.panel.headroom.modeDirect': '直通',
  'dsp.panel.headroom.modeDirectDetail': '不额外降低电平。',
  'dsp.panel.headroom.modeDsp': 'UZUME',
  'dsp.panel.headroom.modeDspDetail': '给 EQ / FIR / Matrix 留出安全空间。',
  'dsp.panel.headroom.nextDirect': '保持直通',
  'dsp.panel.headroom.nextDirectDetail': '当前没有需要预留的 UZUME 风险。',
  'dsp.panel.headroom.nextHoldRisk': '先降低余量',
  'dsp.panel.headroom.nextHoldRiskDetail': '检测到削波风险，建议先预留 Headroom。',
  'dsp.panel.headroom.nextProtect': '应用保护余量',
  'dsp.panel.headroom.nextProtectDetail': '当前输出接近满幅，建议立即降低。',
  'dsp.panel.headroom.nextReady': '继续监听',
  'dsp.panel.headroom.nextReadyDetail': 'UZUME 已有安全余量。',
  'dsp.panel.headroom.nextStandby': '保持待命',
  'dsp.panel.headroom.nextStandbyDetail': '有 UZUME section 开启，但暂未检测到风险。',
  'dsp.panel.headroom.nextStep': '下一步',
  'dsp.panel.headroom.nextWatch': '观察输出',
  'dsp.panel.headroom.nextWatchDetail': '输出接近上限，建议留意削波。',
  'dsp.panel.headroom.noClip': '无记录',
  'dsp.panel.headroom.note': 'Headroom 只负责预留电平空间；RPC-001 中它已经能单独激活 UZUME processed path。',
  'dsp.panel.headroom.presetsAria': 'Headroom 预设',
  'dsp.panel.headroom.primaryAction': '应用 {value}',
  'dsp.panel.headroom.reasonChannel': '声道工具可能提高电平。',
  'dsp.panel.headroom.reasonClipping': '检测到削波。',
  'dsp.panel.headroom.reasonDirect': 'Headroom 只在 UZUME processed path 生效；当前 EQ / FIR / Matrix 都未启用，原生直通不会被它处理。',
  'dsp.panel.headroom.reasonEq': 'EQ 曲线可能提高电平。',
  'dsp.panel.headroom.reasonLive': '实时余量偏低。',
  'dsp.panel.headroom.reasonOutput': '输出估算接近满幅。',
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
  'dsp.panel.room.hero.activeDetail': 'Transitional FIR convolver 正在参与 UZUME 输出链。',
  'dsp.panel.room.hero.activeTitle': 'FIR 已启用',
  'dsp.panel.room.hero.emptyDetail': '导入 IR 后才能启用房间校正。',
  'dsp.panel.room.hero.emptyTitle': '未载入 IR',
  'dsp.panel.room.hero.loadedDetail': 'IR 已载入，可以启用。',
  'dsp.panel.room.hero.loadedTitle': 'IR 已载入',
  'dsp.panel.room.hero.state': '状态',
  'dsp.panel.room.kicker': 'FIR / transitional',
  'dsp.panel.room.nextEnable': '启用 FIR',
  'dsp.panel.room.nextEnableDetail': 'IR 已准备好，可以试听。',
  'dsp.panel.room.nextImport': '导入 IR',
  'dsp.panel.room.nextImportDetail': '先选择一个卷积文件。',
  'dsp.panel.room.nextListen': '继续试听',
  'dsp.panel.room.nextListenDetail': '确认校正后音量和相位正常。',
  'dsp.panel.room.nextTrim': '降低 Trim',
  'dsp.panel.room.nextTrimDetail': 'FIR 输出存在削波风险。',
  'dsp.panel.room.note': 'RPC-001 中 FIR 仍是 transitional convolver source；正式 Shared Convolution Engine 尚未启用。',
  'dsp.panel.room.quickTrim': '快速 Trim',
  'dsp.panel.room.routeTitle': '路径',
  'dsp.panel.room.safeEnableHint': '先预留 -6 dB Headroom，再启用 FIR。',
  'dsp.panel.room.safetyRisk': '请降低 Trim 或 Headroom。',
  'dsp.panel.room.safetySafe': '输出链当前安全。',
  'dsp.panel.room.safetyTitle': '安全',
  'dsp.panel.room.trim': 'Trim',
  'dsp.panel.safety.kicker': '输出安全',
  'dsp.panel.safety.heroProtectedTitle': '输出链路受保护',
  'dsp.panel.safety.heroProtectedDetail': 'UZUME 正在参与播放，输出安全会持续监控削波、余量和 bit-perfect 路径。',
  'dsp.panel.safety.heroRiskTitle': '检测到输出风险',
  'dsp.panel.safety.heroRiskDetail': '当前链路有削波或余量风险，先降低 Headroom、EQ 增益或 FIR Trim。',
  'dsp.panel.safety.heroDirectTitle': '原生直通',
  'dsp.panel.safety.heroDirectDetail': '没有启用 UZUME section 时，播放保持 bit-perfect 候选路径，输出安全只做状态观察。',
  'dsp.panel.safety.chainTitle': '当前链路',
  'dsp.panel.safety.checkTitle': '安全检查',
  'dsp.panel.safety.nextTitle': '建议动作',
  'dsp.panel.safety.nextRisk': '先处理余量',
  'dsp.panel.safety.nextRiskDetail': '有风险时不要继续叠加 EQ / FIR 增益，优先降 Headroom 或相关 section Trim。',
  'dsp.panel.safety.nextProtected': '继续监听',
  'dsp.panel.safety.nextProtectedDetail': '链路处于 UZUME processed path 但没有发现削波风险，可以继续观察实时输出。',
  'dsp.panel.safety.nextDirect': '保持直通',
  'dsp.panel.safety.nextDirectDetail': '当前没有 UZUME 处理，适合确认原始输出、设备采样率和 bit-perfect 候选状态。',
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
  'dsp.panel.safety.note': '输出安全只负责最终链路状态，不改变 EQ、FIR 或声道参数。',
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
  'dsp.status.compatPath': '兼容路径',
  'dsp.status.direct': '直通',
  'dsp.status.disabledByDsp': 'UZUME 路径',
  'dsp.status.dspPath': 'UZUME 路径',
  'dsp.status.flat': 'Flat',
  'dsp.status.headroomRisk': '余量风险',
  'dsp.status.limiterArmed': '待命',
  'dsp.status.limiting': '正在限幅',
  'dsp.status.modulesActive': '{count} 个 section 启用',
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
  'dsp.status.unimplemented': '未实现',
  'dsp.format.detail': '后端 planner 是实际路径来源；UI 只显示当前路径和启用 section 后会触发的路径变化。',
  'dsp.format.path.d2p_processed.detail': 'DSD 解码为 PCM 后进入 UZUME。当前只作为后端状态展示。',
  'dsp.format.path.d2p_processed.title': 'D2P processed',
  'dsp.format.path.dsd_direct.detail': 'Native / DoP 直出；打开 EQ/FIR/Headroom/Matrix 会退出 direct。',
  'dsp.format.path.dsd_direct.title': 'DSD direct',
  'dsp.format.path.dsd_upsampling.detail': 'SDM-only 规划路径；PCM-domain DSP 会退出此路径。',
  'dsp.format.path.dsd_upsampling.title': 'DSD upsampling',
  'dsp.format.path.pcm_bitperfect.detail': '不进入改样本处理；打开 section 会切到 PCM processed。',
  'dsp.format.path.pcm_bitperfect.title': 'PCM bit-perfect',
  'dsp.format.path.pcm_processed.detail': 'Headroom / EQ / FIR / Matrix / Safety 作用于 UZUME chain。',
  'dsp.format.path.pcm_processed.title': 'PCM processed',
  'dsp.format.path.sdm_processed.detail': '完整 SDM processed 尚未完成，只显示为不可选能力。',
  'dsp.format.path.sdm_processed.title': 'SDM processed',
  'dsp.format.state.available': '可进入',
  'dsp.format.state.current': '当前',
  'dsp.format.state.planned': '未实现',
  'dsp.format.state.transition': '由控件触发',
  'dsp.format.state.unavailable': '不可用',
  'dsp.format.title': 'Format path',
  'dsp.transition.detail.d2p': '当前已经离开 DSD direct；此 section 作用在 DSD 解码后的 PCM 域。',
  'dsp.transition.detail.dsdDirect': '打开此 section 会退出 DSD direct / DoP，后端会重新规划为 DSD -> PCM processed。',
  'dsp.transition.detail.dsdUpsampling': '打开此 PCM-domain section 会退出 DSD upsampling / SDM-only；完整 SDM processed 还未完成。',
  'dsp.transition.detail.pcmBitperfect': '打开此 section 会退出 PCM bit-perfect，后端会重新规划为 PCM processed。',
  'dsp.transition.detail.pcmProcessed': '当前已经在 PCM processed；控件会直接作用于 UZUME chain。',
  'dsp.transition.detail.sdm': '当前处于 SDM processed 遥测路径；这部分仍按实验/不可用状态展示。',
  'dsp.transition.detail.src': 'UZUME Poly-Sinc SRC 尚未实现，这里只显示规划倍率和 ECHO/SOXR 兼容读数。',
  'dsp.transition.title': '路径变化',
  'dsp.unimplemented.compat': '兼容读数',
  'dsp.unimplemented.compatDetail': '这些数值来自现有 legacy/compat backend，只读显示，不作为 UZUME 功能开关。',
  'dsp.unimplemented.detail': 'RPC-001 仍是 skeleton；真正的 UZUME kernel、planner 和 control backend 尚未接入。',
  'dsp.unimplemented.kicker': 'RPC-001 skeleton',
  'dsp.unimplemented.noControl': '没有 UZUME 控件',
  'dsp.unimplemented.noControlDetail': '未实现的子功能不提供按钮、滑杆或开关，避免误触后看起来像已经接入。',
  'dsp.unimplemented.note': 'UI 只标记 UZUME 状态；legacy/compat 后端状态保留为读数，不在这里伪装成 UZUME 能力。',
  'dsp.unimplemented.title': '{module} 未实现',
};

type DspTranslate = (key: string, options?: Parameters<ReturnType<typeof useI18n>['t']>[1]) => string;

const useDspI18n = (): { t: DspTranslate } => {
  const { t } = useI18n();
  return {
    t: useCallback((key, options) => {
      if (dspLocalText[key]) {
        return Object.entries(options ?? {}).reduce(
          (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
          dspLocalText[key],
        );
      }

      return t(key as TranslationKey, options);
    }, [t]),
  };
};

const formatDb = (value: number | null | undefined): string => {
  if (!Number.isFinite(value)) {
    return '0 dB';
  }

  const rounded = Math.round(Number(value) * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(Math.abs(rounded) % 1 > 0 ? 1 : 0)} dB`;
};

const formatLevel = (value: number | null | undefined): string => (Number.isFinite(value) ? formatDb(value) : '--');

const formatRate = (value: number | null | undefined, autoLabel: string): string => (value ? `${Math.round(value / 1000)} kHz` : autoLabel);

const finiteLevel = (value: number | null | undefined): number | null => (Number.isFinite(value) ? Number(value) : null);

const formatBalancePosition = (balance: number): string => {
  const percent = Math.round(Math.abs(balance) * 100);
  if (percent === 0) {
    return '0%';
  }

  return `${balance > 0 ? 'R' : 'L'} ${percent}%`;
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
): boolean =>
  audioStatus?.clippingRisk === true ||
  (outputPeakDb !== null && outputPeakDb >= -1) ||
  (liveHeadroomDb !== null && liveHeadroomDb <= 1);

type ModulePanelProps = {
  audioStatus: AudioStatus | null;
  eqState: EqState;
  roomCorrection: RoomCorrectionState;
  channelBalance: ChannelBalanceState;
  formatPath: UzumeFormatPath;
  echoSrcMode: AudioEchoSrcMode;
  echoSrcQualityProfile: AudioEchoSrcQualityProfile;
  onRefresh: () => void;
};

const DspMetric = ({ label, value, tone }: { label: string; value: string; tone?: HeadroomTone }): JSX.Element => (
  <span className="dsp-module-metric" data-tone={tone}>
    <em>{label}</em>
    <strong>{value}</strong>
  </span>
);

type UzumeCapabilityState = 'active' | 'transitional' | 'planned' | 'unavailable';

type UzumeCapability = {
  id: string;
  title: string;
  detail: string;
  state: UzumeCapabilityState;
  icon: LucideIcon;
};

const getUzumeCapabilityStateLabelKey = (state: UzumeCapabilityState): string => {
  if (state === 'active') {
    return 'dsp.capability.state.active';
  }
  if (state === 'transitional') {
    return 'dsp.capability.state.transitional';
  }
  if (state === 'unavailable') {
    return 'dsp.capability.state.unavailable';
  }

  return 'dsp.capability.state.planned';
};

const uzumeFormatPathOrder: UzumeFormatPath[] = [
  'pcm_bitperfect',
  'pcm_processed',
  'dsd_direct',
  'dsd_upsampling',
  'd2p_processed',
  'sdm_processed',
];

const normalizeUzumeFormatPath = (audioStatus: AudioStatus | null, dspActive: boolean): UzumeFormatPath => {
  const rawPath = audioStatus?.uzumeFormatPath;
  if (rawPath && uzumeFormatPathOrder.includes(rawPath as UzumeFormatPath)) {
    return rawPath as UzumeFormatPath;
  }

  if (audioStatus?.activeDsdOutputMode === 'dop' || audioStatus?.activeDsdOutputMode === 'native') {
    return 'dsd_direct';
  }

  return dspActive ? 'pcm_processed' : 'pcm_bitperfect';
};

const getUzumeFormatPathTitleKey = (path: UzumeFormatPath): string => `dsp.format.path.${path}.title`;

const getUzumeFormatPathDetailKey = (path: UzumeFormatPath): string => `dsp.format.path.${path}.detail`;

const getUzumePathStateLabelKey = (state: UzumeFormatPathState): string => `dsp.format.state.${state}`;

const getUzumePathState = (path: UzumeFormatPath, currentPath: UzumeFormatPath): UzumeFormatPathState => {
  if (path === currentPath) {
    return 'current';
  }
  if (path === 'pcm_processed') {
    return currentPath === 'pcm_bitperfect' || currentPath === 'dsd_direct' || currentPath === 'dsd_upsampling'
      ? 'transition'
      : 'available';
  }
  if (path === 'pcm_bitperfect') {
    return currentPath === 'pcm_processed' ? 'available' : 'unavailable';
  }
  if (path === 'dsd_direct') {
    return currentPath === 'dsd_direct' ? 'current' : 'unavailable';
  }

  return 'planned';
};

const getTransitionDetailKey = (path: UzumeFormatPath, moduleId: DspModuleId): string => {
  if (moduleId === 'src') {
    return 'dsp.transition.detail.src';
  }
  if (path === 'pcm_bitperfect') {
    return 'dsp.transition.detail.pcmBitperfect';
  }
  if (path === 'pcm_processed') {
    return 'dsp.transition.detail.pcmProcessed';
  }
  if (path === 'dsd_direct') {
    return 'dsp.transition.detail.dsdDirect';
  }
  if (path === 'dsd_upsampling') {
    return 'dsp.transition.detail.dsdUpsampling';
  }
  if (path === 'd2p_processed') {
    return 'dsp.transition.detail.d2p';
  }

  return 'dsp.transition.detail.sdm';
};

const UzumeFormatPathStrip = ({ currentPath }: { currentPath: UzumeFormatPath }): JSX.Element => {
  const { t } = useDspI18n();

  return (
    <section className="dsp-format-strip" aria-label={t('dsp.format.title')}>
      <div className="dsp-format-strip__head">
        <span>
          <Route size={15} aria-hidden="true" />
          {t('dsp.format.title')}
        </span>
        <p>{t('dsp.format.detail')}</p>
      </div>
      <div className="dsp-format-controls" role="group" aria-label={t('dsp.format.title')}>
        {uzumeFormatPathOrder.map((path) => {
          const state = getUzumePathState(path, currentPath);

          return (
            <span
              className="dsp-format-chip"
              data-state={state}
              key={path}
              title={t(getUzumeFormatPathDetailKey(path))}
            >
              <strong>{t(getUzumeFormatPathTitleKey(path))}</strong>
              <small>{t(getUzumePathStateLabelKey(state))}</small>
            </span>
          );
        })}
      </div>
    </section>
  );
};

const DspTransitionNotice = ({ formatPath, moduleId }: { formatPath: UzumeFormatPath; moduleId: DspModuleId }): JSX.Element => {
  const { t } = useDspI18n();
  const tone: HeadroomTone = formatPath === 'pcm_processed' || formatPath === 'd2p_processed' ? 'good' : 'warn';

  return (
    <div className="dsp-transition-notice" data-tone={tone} role="note">
      <Route size={16} aria-hidden="true" />
      <span>
        <strong>{t('dsp.transition.title')}</strong>
        <small>{t(getTransitionDetailKey(formatPath, moduleId))}</small>
      </span>
    </div>
  );
};

const UzumeCapabilityStrip = ({ capabilities }: { capabilities: UzumeCapability[] }): JSX.Element => {
  const { t } = useDspI18n();

  return (
    <section className="dsp-capability-strip" aria-label={t('dsp.aria.capabilities')}>
      <div className="dsp-capability-strip__head">
        <span>
          <Zap size={15} aria-hidden="true" />
          {t('dsp.capability.stripTitle')}
        </span>
        <p>{t('dsp.capability.stripDetail')}</p>
      </div>
      <div className="dsp-capability-controls" role="group" aria-label={t('dsp.aria.capabilities')}>
        {capabilities.map((capability) => {
          const Icon = capability.icon;

          return (
            <span
              className="dsp-capability-chip"
              data-state={capability.state}
              key={capability.id}
              title={capability.detail}
            >
              <Icon size={15} aria-hidden="true" />
              <span>
                <strong>{capability.title}</strong>
                <small>{t(getUzumeCapabilityStateLabelKey(capability.state))}</small>
              </span>
            </span>
          );
        })}
      </div>
    </section>
  );
};

const EchoSrcPanel = ({
  audioStatus,
  echoSrcMode,
  echoSrcQualityProfile,
}: ModulePanelProps): JSX.Element => {
  const { t } = useDspI18n();
  const warnings = audioStatus?.warnings ?? [];
  const active = audioStatus?.echoSrcActive === true;
  const compatConfigured = echoSrcMode !== 'off';
  const effectiveQualityProfile = normalizeEchoSrcQualityProfile(audioStatus?.echoSrcQualityProfile ?? echoSrcQualityProfile);
  const qualityOption = echoSrcQualityOptions.find((option) => option.profile === effectiveQualityProfile) ?? echoSrcQualityOptions[0];
  const modeOption = echoSrcModeOptions.find((option) => option.mode === echoSrcMode) ?? echoSrcModeOptions[0];
  const sharedBypass = compatConfigured && (audioStatus?.outputMode === 'shared' || warnings.includes('echo_src_bypassed_in_shared_output'));
  const dsdBypass =
    compatConfigured &&
    (warnings.includes('echo_src_bypassed_for_dsd_direct') || warnings.includes('echo_src_bypassed_for_dsd_pcm'));
  const routeKey: string =
    active ? 'dsp.panel.src.active' :
    sharedBypass ? 'dsp.panel.src.bypassShared' :
    dsdBypass ? 'dsp.panel.src.bypassDsd' :
    !compatConfigured ? 'dsp.panel.src.compatModeOff' :
    'dsp.panel.src.pending';
  const routeTone: HeadroomTone | undefined = active || sharedBypass || dsdBypass || compatConfigured ? 'warn' : undefined;
  const sourceRate = audioStatus?.fileSampleRate ?? null;
  const targetRate = active ? audioStatus?.echoSrcTargetSampleRate : null;
  const plannedProfiles = echoSrcModeOptions.filter((option) => option.mode !== 'off');
  const compatModeLabel = compatConfigured ? modeOption.title : t('dsp.panel.src.compatModeOff');
  const compatModeDetail = compatConfigured ? t('dsp.panel.src.compatModeConfigured') : t('dsp.panel.src.native');
  const compatQualityLabel = compatConfigured || active ? qualityOption.title : '--';
  const compatPrecisionLabel = compatConfigured || active ? qualityOption.precision : '--';

  return (
    <section className="dsp-module-panel dsp-module-panel--src">
      <p className="dsp-module-kicker">{t('dsp.panel.src.kicker')}</p>
      <div className="dsp-module-heading">
        <span><RadioTower size={18} />{t('dsp.module.src.title')}</span>
        <strong>{t('dsp.panel.src.unavailable')}</strong>
      </div>
      <p className="dsp-module-note">{t('dsp.panel.src.detail')}</p>

      <div className="dsp-module-metrics">
        <DspMetric label={t('dsp.panel.src.uzumeStatus')} value={t('dsp.panel.src.unavailable')} tone="warn" />
        <DspMetric label={t('dsp.panel.src.compatPath')} value={t(routeKey)} tone={routeTone} />
        <DspMetric label={t('dsp.panel.src.sourceRate')} value={formatRate(sourceRate, '--')} />
        <DspMetric label={t('dsp.panel.src.targetRate')} value={formatRate(targetRate, '--')} tone={active ? 'good' : undefined} />
        <DspMetric label={t('dsp.panel.src.engine')} value={compatConfigured || active ? 'ECHO/SOXR' : '--'} tone={active ? 'warn' : undefined} />
        <DspMetric label={t('dsp.panel.src.legacyPrecision')} value={compatPrecisionLabel} />
      </div>

      <div className="dsp-src-unavailable" role="status">
        <span className="dsp-src-unavailable__icon">
          <ShieldCheck size={17} aria-hidden="true" />
        </span>
        <span className="dsp-src-unavailable__copy">
          <strong>{t('dsp.panel.src.unavailableTitle')}</strong>
          <small>{t('dsp.panel.src.unavailableDetail')}</small>
        </span>
      </div>

      <div className="dsp-src-planned" role="group" aria-label={t('dsp.panel.src.plannedProfiles')}>
        {plannedProfiles.map((option) => (
          <article
            key={option.mode}
            title={t('dsp.panel.src.unavailableDetail')}
          >
            <RadioTower size={14} aria-hidden="true" />
            <span>
              <strong>{option.title}</strong>
              <small>
                <ShieldCheck size={13} aria-hidden="true" />
                {t('dsp.panel.src.profileUnavailable')}
              </small>
            </span>
          </article>
        ))}
      </div>

      <div className="dsp-src-readouts" aria-label={t('dsp.panel.src.compatTitle')}>
        <article>
          <span>{t('dsp.panel.src.compatSettings')}</span>
          <strong>{compatModeLabel}</strong>
          <small>{compatModeDetail}</small>
        </article>
        <article>
          <span>{t('dsp.panel.src.quality')}</span>
          <strong>{compatQualityLabel}</strong>
          <small>{t('dsp.panel.src.compatDetail')}</small>
        </article>
      </div>

      <p className="dsp-module-note">{t('dsp.panel.src.note')}</p>
    </section>
  );
};

type UzumeUnimplementedReadout = {
  label: string;
  value: string;
  tone?: HeadroomTone;
};

const UzumeUnimplementedPanel = ({
  module,
  audioStatus,
  eqState,
  roomCorrection,
  channelBalance,
  formatPath,
}: ModulePanelProps & { module: DspModule }): JSX.Element => {
  const { t } = useDspI18n();
  const Icon = module.icon;
  const bitPerfectValue = formatPath === 'pcm_bitperfect' || formatPath === 'dsd_direct'
    ? t('dsp.status.ready')
    : t('dsp.status.dspPath');
  const baseReadouts: UzumeUnimplementedReadout[] = [
    { label: t('dsp.metric.dsp'), value: t('dsp.status.unimplemented'), tone: 'warn' },
    { label: t('dsp.label.bitPerfect'), value: bitPerfectValue },
  ];
  const moduleReadouts = ((): UzumeUnimplementedReadout[] => {
    if (module.id === 'headroom') {
      return [
        { label: t('dsp.metric.compatBackend'), value: 'legacy headroom' },
        { label: t('dsp.panel.headroom.reserve'), value: formatDb(eqState.dspHeadroomDb ?? audioStatus?.dspHeadroomDb ?? 0) },
        { label: t('dsp.metric.liveHeadroom'), value: formatLevel(finiteLevel(audioStatus?.audioLevels?.headroomDb)) },
        { label: t('dsp.metric.outputEstimate'), value: formatLevel(finiteLevel(audioStatus?.audioLevels?.estimatedOutputPeakDb)) },
      ];
    }

    if (module.id === 'eq') {
      return [
        { label: t('dsp.metric.compatBackend'), value: 'legacy EQ' },
        { label: t('dsp.metric.status'), value: eqState.enabled || audioStatus?.eqEnabled ? t('dsp.status.active') : t('dsp.status.bypassed') },
        { label: t('dsp.metric.preset'), value: audioStatus?.eqPresetName || eqState.presetName || t('dsp.status.flat') },
        { label: t('dsp.metric.preamp'), value: formatDb(eqState.preampDb ?? 0) },
      ];
    }

    if (module.id === 'headphone') {
      const presetName = audioStatus?.eqPresetName || eqState.presetName || '';
      const opraProfile = presetName.startsWith('耳机校正 -') ? presetName : t('dsp.status.none');

      return [
        { label: t('dsp.metric.compatBackend'), value: 'Profile EQ' },
        { label: t('dsp.metric.status'), value: opraProfile === t('dsp.status.none') ? t('dsp.status.bypassed') : t('dsp.status.active') },
        { label: t('dsp.metric.preset'), value: opraProfile },
      ];
    }

    if (module.id === 'room') {
      return [
        { label: t('dsp.metric.compatBackend'), value: 'legacy FIR' },
        { label: t('dsp.metric.status'), value: roomCorrection.enabled ? t('dsp.status.active') : t('dsp.status.bypassed') },
        { label: t('dsp.metric.ir'), value: roomCorrection.irName ?? t('dsp.status.noIr') },
        { label: t('dsp.panel.room.trim'), value: formatDb(roomCorrection.trimDb) },
        { label: t('dsp.metric.latency'), value: roomCorrection.latencySamples > 0 ? `${roomCorrection.latencySamples} samples` : t('dsp.status.none') },
      ];
    }

    if (module.id === 'channel') {
      const monoMode = channelBalance.monoMode ?? 'off';

      return [
        { label: t('dsp.metric.compatBackend'), value: 'legacy matrix' },
        { label: t('dsp.metric.status'), value: channelBalance.enabled || audioStatus?.channelBalanceEnabled ? t('dsp.status.active') : t('dsp.status.bypassed') },
        { label: t('dsp.panel.channel.balance'), value: formatBalancePosition(Number(channelBalance.balance ?? 0)) },
        { label: t('dsp.metric.mode'), value: t(monoModeKeyMap[monoMode]) },
        { label: t('dsp.metric.clipping'), value: channelBalance.clippingRisk ? t('dsp.status.riskDetected') : t('dsp.status.clear') },
      ];
    }

    if (module.id === 'safety') {
      const limiterProtecting = audioStatus?.dspLimiterProtecting === true;
      const safetyLimiterEnabled = eqState.dspSafetyLimiterEnabled !== false;

      return [
        { label: t('dsp.metric.compatBackend'), value: 'legacy safety' },
        { label: t('dsp.panel.safety.limiterToggleTitle'), value: safetyLimiterEnabled ? t('dsp.status.limiterArmed') : t('dsp.panel.safety.limiterBypassed'), tone: !safetyLimiterEnabled ? 'risk' : undefined },
        { label: t('dsp.panel.safety.routeOutput'), value: limiterProtecting ? t('dsp.status.limiting') : t('dsp.status.ready'), tone: limiterProtecting ? 'risk' : undefined },
        { label: t('dsp.metric.outputEstimate'), value: formatLevel(finiteLevel(audioStatus?.audioLevels?.estimatedOutputPeakDb)) },
        { label: t('dsp.metric.reason'), value: audioStatus?.bitPerfectDisabledReason ?? t('dsp.status.none') },
      ];
    }

    return [];
  })();

  return (
    <section className="dsp-module-panel dsp-module-panel--unimplemented" data-module={module.id} data-state="planned">
      <div className="dsp-unimplemented-hero">
        <span className="dsp-unimplemented-icon" aria-hidden="true">
          <Icon size={26} />
        </span>
        <div>
          <p className="dsp-module-kicker">{t('dsp.unimplemented.kicker')}</p>
          <div className="dsp-module-heading">
            <span>{module.title}</span>
            <strong>{t('dsp.status.unimplemented')}</strong>
          </div>
          <h2>{t('dsp.unimplemented.title', { module: module.title })}</h2>
          <p>{t('dsp.unimplemented.detail')}</p>
        </div>
      </div>

      <DspTransitionNotice formatPath={formatPath} moduleId={module.id} />

      <div className="dsp-unimplemented-grid">
        <article data-tone="warn">
          <ShieldCheck size={16} aria-hidden="true" />
          <span>
            <strong>{t('dsp.unimplemented.noControl')}</strong>
            <small>{t('dsp.unimplemented.noControlDetail')}</small>
          </span>
        </article>
        <article>
          <Info size={16} aria-hidden="true" />
          <span>
            <strong>{t('dsp.unimplemented.compat')}</strong>
            <small>{t('dsp.unimplemented.compatDetail')}</small>
          </span>
        </article>
      </div>

      <div className="dsp-module-metrics dsp-unimplemented-metrics">
        {[...baseReadouts, ...moduleReadouts].map((readout) => (
          <DspMetric key={`${readout.label}:${readout.value}`} label={readout.label} value={readout.value} tone={readout.tone} />
        ))}
      </div>

      <p className="dsp-module-note">{t('dsp.unimplemented.note')}</p>
    </section>
  );
};

export const DspPage = (): JSX.Element => {
  const { t } = useDspI18n();
  const { audioStatus, error } = useSharedPlaybackStatus();
  const [selectedModuleId, setSelectedModuleId] = useState<DspModuleId>('eq');
  const [eqState, setEqState] = useState<EqState>(fallbackEqState);
  const [roomCorrection, setRoomCorrection] = useState<RoomCorrectionState>(fallbackRoomCorrection);
  const [channelBalance, setChannelBalance] = useState<ChannelBalanceState>(fallbackChannelBalance);
  const [echoSrcMode, setEchoSrcMode] = useState<AudioEchoSrcMode>('off');
  const [echoSrcQualityProfile, setEchoSrcQualityProfile] = useState<AudioEchoSrcQualityProfile>('transparent');
  const [moduleError, setModuleError] = useState<string | null>(null);

  const loadModuleStates = useCallback(async (): Promise<void> => {
    const eq = getEqBridge();
    if (!eq) {
      setModuleError(t('dsp.error.desktopBridge'));
      return;
    }

    try {
      const [nextEqState, nextRoomCorrection, nextChannelBalance] = await Promise.all([
        eq.getState(),
        eq.getRoomCorrectionState?.() ?? Promise.resolve(fallbackRoomCorrection),
        eq.getChannelBalanceState(),
      ]);
      setEqState(nextEqState);
      setRoomCorrection(nextRoomCorrection);
      setChannelBalance(nextChannelBalance);
      setModuleError(null);
    } catch (stateError) {
      setModuleError(stateError instanceof Error ? stateError.message : String(stateError));
    }
  }, [t]);

  useEffect(() => {
    void loadModuleStates();
  }, [loadModuleStates]);

  useEffect(() => {
    let cancelled = false;
    const applyEchoSrcSetting = (mode: unknown): void => {
      if (!cancelled) {
        setEchoSrcMode(normalizeEchoSrcMode(mode));
      }
    };
    const applyEchoSrcQualitySetting = (profile: unknown): void => {
      if (!cancelled) {
        setEchoSrcQualityProfile(normalizeEchoSrcQualityProfile(profile));
      }
    };

    void window.echo?.app?.getSettings?.()
      .then((settings) => {
        applyEchoSrcSetting(settings?.audioEchoSrcMode);
        applyEchoSrcQualitySetting(settings?.audioEchoSrcQualityProfile);
      })
      .catch(() => undefined);

    const handleSettingsChanged = (event: Event): void => {
      const settings = (event as CustomEvent<{ audioEchoSrcMode?: AudioEchoSrcMode; audioEchoSrcQualityProfile?: AudioEchoSrcQualityProfile }>).detail;
      if (settings && Object.prototype.hasOwnProperty.call(settings, 'audioEchoSrcMode')) {
        applyEchoSrcSetting(settings.audioEchoSrcMode);
      }
      if (settings && Object.prototype.hasOwnProperty.call(settings, 'audioEchoSrcQualityProfile')) {
        applyEchoSrcQualitySetting(settings.audioEchoSrcQualityProfile);
      }
    };

    window.addEventListener('settings:changed', handleSettingsChanged);
    return () => {
      cancelled = true;
      window.removeEventListener('settings:changed', handleSettingsChanged);
    };
  }, []);

  const dspActive = audioStatus?.dspActive === true;
  const formatPath = normalizeUzumeFormatPath(audioStatus, dspActive);
  const formatPathLabel = t(getUzumeFormatPathTitleKey(formatPath));
  const outputPeakDb = finiteLevel(audioStatus?.audioLevels?.estimatedOutputPeakDb);
  const liveHeadroomDb = finiteLevel(audioStatus?.audioLevels?.headroomDb);
  const clipCount = audioStatus?.audioLevels?.clipCount ?? 0;
  const clippingRisk = hasObservedDspClippingRisk(audioStatus, eqState, roomCorrection, channelBalance, clipCount);
  const headroomWarning = hasHeadroomWarning(audioStatus, outputPeakDb, liveHeadroomDb);
  const safetyLimiterEnabled = eqState.dspSafetyLimiterEnabled !== false;
  const outputName = audioStatus?.outputDeviceName || t('dsp.status.systemOutput');
  const sampleRate = audioStatus?.actualDeviceSampleRate ?? audioStatus?.requestedOutputSampleRate ?? audioStatus?.fileSampleRate ?? null;
  const echoSrcActive = audioStatus?.echoSrcActive === true;
  const echoSrcEnabled = echoSrcMode !== 'off' || echoSrcActive;
  const uzumeModuleStatus = t('dsp.status.unimplemented');

  const modules = useMemo<DspModule[]>(
    () => [
      {
        id: 'headroom',
        stageKey: 'dsp.stage.input',
        title: t('dsp.module.headroom.title'),
        subtitle: uzumeModuleStatus,
        description: t('dsp.module.headroom.description'),
        icon: Gauge,
        enabled: false,
        accent: 'blue',
      },
      {
        id: 'src',
        stageKey: 'dsp.stage.src',
        title: t('dsp.module.src.title'),
        subtitle: uzumeModuleStatus,
        description: t('dsp.module.src.description'),
        icon: RadioTower,
        enabled: false,
        accent: echoSrcEnabled ? 'amber' : 'blue',
      },
      {
        id: 'eq',
        stageKey: 'dsp.stage.shape',
        title: t('dsp.module.eq.title'),
        subtitle: uzumeModuleStatus,
        description: t('dsp.module.eq.description'),
        icon: SlidersHorizontal,
        enabled: false,
        accent: 'violet',
      },
      {
        id: 'headphone',
        stageKey: 'dsp.stage.shape',
        title: t('dsp.module.headphone.title'),
        subtitle: uzumeModuleStatus,
        description: t('dsp.module.headphone.description'),
        icon: Headphones,
        enabled: false,
        accent: 'blue',
      },
      {
        id: 'room',
        stageKey: 'dsp.stage.space',
        title: t('dsp.module.room.title'),
        subtitle: uzumeModuleStatus,
        description: t('dsp.module.room.description'),
        icon: Waves,
        enabled: false,
        accent: 'green',
      },
      {
        id: 'channel',
        stageKey: 'dsp.stage.stereo',
        title: t('dsp.module.channel.title'),
        subtitle: uzumeModuleStatus,
        description: t('dsp.module.channel.description'),
        icon: Headphones,
        enabled: false,
        accent: 'amber',
      },
      {
        id: 'safety',
        stageKey: 'dsp.stage.output',
        title: t('dsp.module.safety.title'),
        subtitle: uzumeModuleStatus,
        description: t('dsp.module.safety.description'),
        icon: ShieldCheck,
        enabled: false,
        accent: !safetyLimiterEnabled || audioStatus?.dspLimiterProtecting === true || clippingRisk || headroomWarning ? 'amber' : 'green',
      },
    ],
    [audioStatus?.dspLimiterProtecting, clippingRisk, echoSrcEnabled, headroomWarning, safetyLimiterEnabled, t, uzumeModuleStatus],
  );

  const selectedModule = modules.find((module) => module.id === selectedModuleId) ?? modules[1];
  const SelectedIcon = selectedModule.icon;
  const pipelineNodes = modules.map((module) => ({
    id: module.id,
    label: t(module.stageKey),
    value: module.subtitle,
    enabled: module.enabled,
    selected: module.id === selectedModuleId,
    risk: false,
  }));
  const uzumeCapabilities = useMemo<UzumeCapability[]>(() => [
    {
      id: 'headroom',
      title: t('dsp.capability.headroom.title'),
      detail: t('dsp.capability.headroom.detail'),
      state: 'planned',
      icon: Gauge,
    },
    {
      id: 'fused-kernel',
      title: t('dsp.capability.fused.title'),
      detail: t('dsp.capability.fused.detail'),
      state: 'planned',
      icon: Zap,
    },
    {
      id: 'shared-convolution',
      title: t('dsp.capability.sharedConvolution.title'),
      detail: t('dsp.capability.sharedConvolution.detail'),
      state: 'planned',
      icon: Waves,
    },
    {
      id: 'poly-sinc-src',
      title: t('dsp.capability.polySinc.title'),
      detail: t('dsp.capability.polySinc.detail'),
      state: 'planned',
      icon: RadioTower,
    },
    {
      id: 'dsd-family',
      title: t('dsp.capability.dsd.title'),
      detail: t('dsp.capability.dsd.detail'),
      state: 'planned',
      icon: AudioWaveform,
    },
    {
      id: 'gpu-render-ahead',
      title: t('dsp.capability.gpu.title'),
      detail: t('dsp.capability.gpu.detail'),
      state: 'planned',
      icon: Activity,
    },
    {
      id: 'avx-backend',
      title: t('dsp.capability.avx.title'),
      detail: t('dsp.capability.avx.detail'),
      state: 'planned',
      icon: Gauge,
    },
  ], [t]);
  const panelProps: ModulePanelProps = {
    audioStatus,
    eqState,
    roomCorrection,
    channelBalance,
    formatPath,
    echoSrcMode,
    echoSrcQualityProfile,
    onRefresh: () => {
      void loadModuleStates();
      void refreshPlaybackStatus();
    },
  };

  return (
    <div className="dsp-page">
      <div className="dsp-stage" data-module={selectedModuleId}>
        <aside className="dsp-rail" aria-label={t('dsp.aria.modules')}>
          <div className="dsp-brand">
            <span>UZUME</span>
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
                    data-active={module.enabled}
                    data-state="planned"
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
                      {module.enabled ? <CheckCircle2 size={14} /> : null}
                    </span>
                  </button>
                </div>
              );
            })}
          </nav>
        </aside>

        <section className="dsp-workspace" data-module={selectedModuleId} aria-label={t('dsp.aria.workspace')}>
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
                {formatPathLabel}
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
              <strong>{t('dsp.status.unimplemented')}</strong>
            </span>
            <span>
              <em>{t('dsp.label.bitPerfect')}</em>
              <strong>{formatPath === 'pcm_bitperfect' || formatPath === 'dsd_direct' ? t('dsp.status.ready') : t('dsp.status.dspPath')}</strong>
            </span>
            <button type="button" onClick={panelProps.onRefresh}>
              {t('dsp.action.refresh')}
            </button>
          </div>

          <UzumeFormatPathStrip currentPath={formatPath} />

          <UzumeCapabilityStrip capabilities={uzumeCapabilities} />

          {error || moduleError ? <p className="dsp-status-error">{moduleError ?? error}</p> : null}

          <div className="dsp-editor-shell" data-module={selectedModuleId}>
            {selectedModuleId === 'src' ? <EchoSrcPanel {...panelProps} /> : null}
            {selectedModuleId !== 'src' ? <UzumeUnimplementedPanel {...panelProps} module={selectedModule} /> : null}
          </div>
        </section>
      </div>
    </div>
  );
};
