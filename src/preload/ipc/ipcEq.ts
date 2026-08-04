import type { EchoApi } from '../apiTypes';
import type { ChannelBalanceState } from '../../shared/types/audio';
import type { RoomCorrectionState } from '../../shared/types/eq';
import type { SystemAudioEngine } from '../systemAudioEngine';

export function createEqApi(
  ipcRenderer: Electron.IpcRenderer,
  IpcChannels: Record<string, string>,
  sa: SystemAudioEngine,
): EchoApi['eq'] {
  return {
    getState: () => ipcRenderer.invoke(IpcChannels.EqGetState),
    setEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.EqSetEnabled, enabled),
    setBandGain: (request) => ipcRenderer.invoke(IpcChannels.EqSetBandGain, request),
    setBandFrequency: (request) => ipcRenderer.invoke(IpcChannels.EqSetBandFrequency, request),
    setBandQ: (request) => ipcRenderer.invoke(IpcChannels.EqSetBandQ, request),
    setBandFilterType: (request) => ipcRenderer.invoke(IpcChannels.EqSetBandFilterType, request),
    setBandEnabled: (request) => ipcRenderer.invoke(IpcChannels.EqSetBandEnabled, request),
    setPreamp: (preampDb) => ipcRenderer.invoke(IpcChannels.EqSetPreamp, preampDb),
    setDspHeadroom: (headroomDb) => ipcRenderer.invoke(IpcChannels.EqSetDspHeadroom, headroomDb),
    setDspSafetyLimiterEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.EqSetDspSafetyLimiterEnabled, enabled),
    setPreset: (presetId) => ipcRenderer.invoke(IpcChannels.EqSetPreset, presetId),
    reset: () => ipcRenderer.invoke(IpcChannels.EqReset),
    listPresets: () => ipcRenderer.invoke(IpcChannels.EqListPresets),
    savePreset: (request) => ipcRenderer.invoke(IpcChannels.EqSavePreset, request),
    exportPreset: (request) => ipcRenderer.invoke(IpcChannels.EqExportPreset, request),
    exportApoPreset: (request) => ipcRenderer.invoke(IpcChannels.EqExportApoPreset, request),
    exportApoGraphicEqPreset: (request) => ipcRenderer.invoke(IpcChannels.EqExportApoGraphicEqPreset, request),
    previewImportPreset: () => ipcRenderer.invoke(IpcChannels.EqPreviewImportPreset),
    importPreset: () => ipcRenderer.invoke(IpcChannels.EqImportPreset),
    deletePreset: (presetId) => ipcRenderer.invoke(IpcChannels.EqDeletePreset, presetId),
    browseHeadphoneCorrections: (request) => ipcRenderer.invoke(IpcChannels.EqBrowseHeadphoneCorrections, request),
    searchHeadphoneCorrections: (request) => ipcRenderer.invoke(IpcChannels.EqSearchHeadphoneCorrections, request),
    applyHeadphoneCorrection: (request) => ipcRenderer.invoke(IpcChannels.EqApplyHeadphoneCorrection, request),
    listProfiles: () => ipcRenderer.invoke(IpcChannels.EqListProfiles),
    saveProfile: (request) => ipcRenderer.invoke(IpcChannels.EqSaveProfile, request),
    applyProfile: (profileId) => ipcRenderer.invoke(IpcChannels.EqApplyProfile, profileId),
    deleteProfile: (profileId) => ipcRenderer.invoke(IpcChannels.EqDeleteProfile, profileId),
    bindProfileToOutput: (request) => ipcRenderer.invoke(IpcChannels.EqBindProfileToOutput, request),
    getProfileBinding: (target) => ipcRenderer.invoke(IpcChannels.EqGetProfileBinding, target),
    getChannelBalanceState: async () => {
      const state = await ipcRenderer.invoke(IpcChannels.ChannelBalanceGetState) as ChannelBalanceState;
      sa.applySystemChannelBalanceState(state);
      return state;
    },
    setChannelBalanceState: async (patch) => {
      const state = await ipcRenderer.invoke(IpcChannels.ChannelBalanceSetState, patch) as ChannelBalanceState;
      sa.applySystemChannelBalanceState(state);
      return state;
    },
    resetChannelBalance: async () => {
      const state = await ipcRenderer.invoke(IpcChannels.ChannelBalanceReset) as ChannelBalanceState;
      sa.applySystemChannelBalanceState(state);
      return state;
    },
    getRoomCorrectionState: () => ipcRenderer.invoke(IpcChannels.RoomCorrectionGetState) as Promise<RoomCorrectionState>,
    importRoomCorrectionIr: () => ipcRenderer.invoke(IpcChannels.RoomCorrectionImportIr) as Promise<RoomCorrectionState | null>,
    setRoomCorrectionEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.RoomCorrectionSetEnabled, enabled) as Promise<RoomCorrectionState>,
    setRoomCorrectionTrim: (trimDb) => ipcRenderer.invoke(IpcChannels.RoomCorrectionSetTrim, trimDb) as Promise<RoomCorrectionState>,
    clearRoomCorrection: () => ipcRenderer.invoke(IpcChannels.RoomCorrectionClear) as Promise<RoomCorrectionState>,
  };
}
