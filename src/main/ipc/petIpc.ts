import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';

const loadPetWindow = () => import('../app/petWindow');

export const registerPetIpc = (): void => {
  ipcMain.handle(IpcChannels.PetShow, async () => (await loadPetWindow()).showPetWindow());
  ipcMain.handle(IpcChannels.PetHide, async () => (await loadPetWindow()).hidePetWindow());
  ipcMain.handle(IpcChannels.PetGetState, async () => (await loadPetWindow()).getPetState());
  ipcMain.handle(IpcChannels.PetMoveTo, async (_event, position: unknown) => (await loadPetWindow()).movePetWindow(position));
  ipcMain.handle(IpcChannels.PetResetBounds, async () => (await loadPetWindow()).resetPetBounds());
  ipcMain.handle(IpcChannels.PetSetScale, async (_event, scalePercent: unknown) => (await loadPetWindow()).setPetScale(scalePercent));
};
