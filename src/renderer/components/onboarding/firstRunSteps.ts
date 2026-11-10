import { CheckCircle2, Headphones, Keyboard, Languages, Palette } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { TranslationKey } from '../../i18n/locales';

export type FirstRunStepId = 'language' | 'audio' | 'appearance' | 'daily' | 'summary';

export type FirstRunStep = {
  id: FirstRunStepId;
  labelKey: TranslationKey;
  eyebrowKey?: TranslationKey;
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
  icon: LucideIcon;
};

export type FirstRunPhase = {
  id: 'basics' | 'playback' | 'personalize' | 'daily' | 'summary';
  labelKey: TranslationKey;
  subtitleKeys?: TranslationKey[];
  stepIds: FirstRunStepId[];
  icon: LucideIcon;
};

export const firstRunSteps: FirstRunStep[] = [
  {
    id: 'language',
    labelKey: 'firstRun.step.language.label',
    eyebrowKey: 'firstRun.step.language.eyebrow',
    titleKey: 'firstRun.step.language.title',
    descriptionKey: 'firstRun.step.language.description',
    icon: Languages,
  },
  {
    id: 'audio',
    labelKey: 'firstRun.step.audio.label',
    eyebrowKey: 'firstRun.step.audio.eyebrow',
    titleKey: 'firstRun.step.audio.title',
    descriptionKey: 'firstRun.step.audio.description',
    icon: Headphones,
  },
  {
    id: 'appearance',
    labelKey: 'firstRun.step.appearance.label',
    eyebrowKey: 'firstRun.step.appearance.eyebrow',
    titleKey: 'firstRun.step.appearance.title',
    descriptionKey: 'firstRun.step.appearance.description',
    icon: Palette,
  },
  {
    id: 'daily',
    labelKey: 'firstRun.daily.label',
    titleKey: 'firstRun.daily.label',
    descriptionKey: 'firstRun.daily.description',
    icon: Keyboard,
  },
  {
    id: 'summary',
    labelKey: 'firstRun.step.summary.label',
    eyebrowKey: 'firstRun.step.summary.eyebrow',
    titleKey: 'firstRun.step.summary.title',
    descriptionKey: 'firstRun.step.summary.description',
    icon: CheckCircle2,
  },
];

export const firstRunPhases: FirstRunPhase[] = [
  {
    id: 'basics',
    labelKey: 'firstRun.phase.basics',
    stepIds: ['language'],
    icon: Languages,
  },
  {
    id: 'playback',
    labelKey: 'firstRun.step.audio.label',
    stepIds: ['audio'],
    icon: Headphones,
  },
  {
    id: 'personalize',
    labelKey: 'firstRun.step.appearance.label',
    stepIds: ['appearance'],
    icon: Palette,
  },
  {
    id: 'daily',
    labelKey: 'firstRun.daily.label',
    stepIds: ['daily'],
    icon: Keyboard,
  },
  {
    id: 'summary',
    labelKey: 'firstRun.step.summary.label',
    stepIds: ['summary'],
    icon: CheckCircle2,
  },
];

