export type BuiltInEqPresetDefinition = {
  id: string;
  name: string;
  preampDb: number;
  gains: number[];
  sourceLabel?: string;
  sourceUrl?: string;
};

const autoEqTargetUrl = (fileName: string): string =>
  `https://github.com/jaakkopasanen/AutoEq/blob/master/targets/${encodeURIComponent(fileName).replace(/%20/g, '%20')}`;

export const builtInEqPresetDefinitions: BuiltInEqPresetDefinition[] = [
  { id: 'flat', name: 'Flat', preampDb: 0, gains: [] },
  { id: 'harman-target', name: 'Harman 2018', preampDb: -3, gains: [2.3, 2.5, 2.6, 2.6, 2.4, 2.1, 1.8, 1.4, 1, 0.6, 0.3, 0.1, 0, 0, 0, 0, 0.1, 0.3, 0.6, 0.9, 1.2, 1.5, 1.7, 1.8, 1.7, 1.5, 1.2, 0.9, 0.6, 0.3, 0.1] },
  { id: 'harman-in-ear', name: 'Harman IE 2019', preampDb: -3, gains: [2.6, 2.8, 3, 2.9, 2.7, 2.4, 2, 1.5, 1, 0.5, 0.2, 0, -0.1, -0.1, 0, 0.2, 0.5, 0.9, 1.2, 1.5, 1.7, 1.8, 1.7, 1.5, 1.3, 1.1, 0.9, 0.6, 0.4, 0.2, 0] },
  { id: 'diffuse-field', name: 'Diffuse Field', preampDb: -3, gains: [-1.6, -1.5, -1.4, -1.2, -1, -0.8, -0.5, -0.2, 0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1, 2.4, 2.6, 2.7, 2.6, 2.4, 2.1, 1.7, 1.3, 0.9, 0.5, 0.2, 0, -0.2, -0.4, -0.6] },
  { id: 'bk-room-curve', name: 'B&K Room', preampDb: -2, gains: [2, 1.9, 1.8, 1.7, 1.5, 1.3, 1.1, 0.9, 0.6, 0.4, 0.2, 0, -0.2, -0.4, -0.6, -0.8, -1, -1.1, -1.2, -1.3, -1.4, -1.5, -1.6, -1.7, -1.8, -1.8, -1.9, -1.9, -2, -2, -2] },
  // Source-backed target variants sampled from AutoEq targets at ECHO's fixed 31-band frequencies.
  { id: 'harman-over-ear-2013', name: 'Harman OE 2013', preampDb: -10, gains: [1.5, 1.3, 1.3, 1.4, 1.3, 1, 0.2, -0.4, -1.2, -1.9, -2.4, -2.4, -2, -1.5, -1.2, -0.8, -0.3, 0, 0.8, 2.7, 5.4, 8.1, 9.1, 7.5, 5.4, 3.3, 0.9, -2.1, -6.3, -11.5, -12], sourceLabel: 'AutoEq target: Harman over-ear 2013', sourceUrl: autoEqTargetUrl('Harman over-ear 2013.csv') },
  { id: 'harman-over-ear-2015', name: 'Harman OE 2015', preampDb: -10, gains: [3.3, 3.2, 3.3, 3.4, 3.2, 2.7, 1.7, 0.6, -0.7, -1.7, -2.4, -2.4, -1.9, -1.4, -1.2, -0.9, -0.4, 0, 0.8, 2.6, 5.2, 8.6, 10, 8.7, 6.7, 5, 2.5, -0.7, -4.9, -10.4, -12], sourceLabel: 'AutoEq target: Harman over-ear 2015', sourceUrl: autoEqTargetUrl('Harman over-ear 2015.csv') },
  { id: 'harman-over-ear-2018-no-bass', name: 'Harman OE 2018 No Bass', preampDb: -9, gains: [-2.1, -2, -2, -2.2, -2.4, -2.5, -2.5, -2.2, -2.1, -2.1, -2.4, -2.2, -1.6, -1.2, -0.9, -0.5, -0.2, 0, 0.8, 2.7, 5.3, 7.4, 8.5, 8.2, 6.4, 4.7, 2.4, -0.7, -5, -9.2, -12], sourceLabel: 'AutoEq target: Harman over-ear 2018 without bass', sourceUrl: autoEqTargetUrl('Harman over-ear 2018 without bass.csv') },
  { id: 'harman-in-ear-2016', name: 'Harman IE 2016', preampDb: -9, gains: [6.9, 7.1, 7.3, 7.3, 7.3, 6.7, 5.8, 4.3, 2.1, -0.2, -1.4, -2, -2, -1.6, -1.3, -0.9, -0.4, 0, 0.7, 2.6, 5.3, 8, 9, 7.4, 5.3, 3.2, 0.8, -2.2, -6.4, -11.6, -12], sourceLabel: 'AutoEq target: Harman in-ear 2016', sourceUrl: autoEqTargetUrl('Harman in-ear 2016.csv') },
  { id: 'harman-in-ear-2017', name: 'Harman IE 2017', preampDb: -11, gains: [7.9, 8, 7.9, 7.6, 6.7, 5.6, 4.2, 3, 1.6, 0.2, -1, -1.7, -1.6, -1.4, -1.3, -1, -0.4, 0, 1, 3.1, 5.8, 9.1, 10.3, 9.1, 7.7, 7.2, 6.5, -3.4, -4.9, -12, -12], sourceLabel: 'AutoEq target: Harman in-ear 2017-1', sourceUrl: autoEqTargetUrl('Harman in-ear 2017-1.csv') },
  { id: 'harman-in-ear-2019-no-bass', name: 'Harman IE 2019 No Bass', preampDb: -10, gains: [-1.4, -1.2, -1.2, -1.4, -1.9, -2.3, -2.4, -2.1, -1.6, -1.4, -1.7, -1.9, -1.8, -1.6, -1.4, -1.1, -0.6, 0, 1.1, 3.1, 5.8, 8.3, 9.4, 8.9, 7.7, 6.4, 3.6, -0.8, -5.4, -10.2, -12], sourceLabel: 'AutoEq target: Harman in-ear 2019 without bass', sourceUrl: autoEqTargetUrl('Harman in-ear 2019 without bass.csv') },
  { id: 'harman-speaker-room-2013', name: 'Harman Speaker Room 2013', preampDb: -11, gains: [-4, -4.1, -4.2, -4, -4.1, -4.2, -4.3, -3.8, -3.7, -3.4, -3.5, -3.3, -2.7, -2.1, -1.8, -1.4, -0.7, 0, 0.9, 3.3, 6.1, 9.5, 11, 9.5, 7.6, 6.3, 3.8, 1.2, -3.2, -8.2, -12], sourceLabel: 'AutoEq target: Harman loudspeaker in-room flat 2013', sourceUrl: autoEqTargetUrl('Harman loudspeaker in-room flat 2013.csv') },
  { id: 'diffuse-field-iso-11904-1', name: 'Diffuse Field ISO 11904-1', preampDb: -12, gains: [-4.1, -4.1, -4.1, -4.1, -4.1, -4.1, -4.1, -4.1, -3.9, -3.7, -3.5, -3.3, -3, -2.6, -2, -1.3, -0.8, 0, 1.4, 3.6, 6.9, 11.2, 11.6, 8.8, 6.5, 5.3, 5.4, 2.7, -0.3, -3.4, -6.9], sourceLabel: 'AutoEq target: Diffuse field ISO 11904-1', sourceUrl: autoEqTargetUrl('Diffuse field ISO 11904-1.csv') },
  { id: 'diffuse-field-gras-kemar', name: 'Diffuse Field GRAS KEMAR', preampDb: -12, gains: [-3.8, -3.8, -3.8, -3.8, -3.8, -3.8, -3.8, -3.8, -3.9, -4, -3.8, -3.6, -3.3, -2.7, -1.8, -1, -0.3, 0, 1.3, 3.9, 7.9, 11.1, 11.1, 9.4, 6.9, 5.1, 5.4, 3.2, 1.4, -2.7, -5.2], sourceLabel: 'AutoEq target: Diffuse field GRAS KEMAR', sourceUrl: autoEqTargetUrl('Diffuse field GRAS KEMAR.csv') },
  { id: 'diffuse-field-5128', name: 'Diffuse Field 5128', preampDb: -12, gains: [-4.2, -4.2, -4.2, -4.2, -4.1, -4, -4, -3.9, -3.8, -3.7, -3.5, -3.2, -2.9, -2.4, -1.8, -0.9, 0, 0, 1.6, 3.4, 5.9, 10, 12, 10.1, 9.1, 7.6, 8.4, 4.4, 1.2, -0.1, -5.3], sourceLabel: 'AutoEq target: Diffuse field 5128', sourceUrl: autoEqTargetUrl('Diffuse field 5128.csv') },
];
