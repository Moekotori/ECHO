export type PetBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export const petWindowBaseSize = 196;
export const petScalePercentMin = 60;
export const petScalePercentMax = 180;
export const defaultPetScalePercent = 100;

export type PetState = {
  visible: boolean;
  bounds: PetBounds | null;
  settings: {
    petEnabled: boolean;
    petBounds: PetBounds | null;
    petScalePercent: number;
  };
};
