import { readTagLibAudioTechnicalMetadata, shouldPreferTagLibForAlacTechnicalFields } from '../audioPublicApi';
import { resolveMp4ContainerAudioCodec } from '../audioPublicApi';
import { normalizeAudioSampleRate } from '../audioPublicApi';
import type { FieldSources, MetadataResult } from './libraryTypes';

export const repairAlacTechnicalMetadataBeforeWrite = async (
  filePath: string,
  metadata: MetadataResult,
): Promise<MetadataResult> => {
  const fields = { ...metadata.fields };
  const fieldSources: FieldSources = { ...metadata.fieldSources };
  let changed = false;

  const resolvedCodec = await resolveMp4ContainerAudioCodec(filePath, fields.codec);
  if (resolvedCodec && resolvedCodec !== fields.codec) {
    fields.codec = resolvedCodec;
    fieldSources.codec = 'technical';
    changed = true;
  }

  if (fields.sampleRate !== null && normalizeAudioSampleRate(fields.sampleRate) === null) {
    fields.sampleRate = null;
    fieldSources.sampleRate = 'unknown';
    changed = true;
  }

  if (!shouldPreferTagLibForAlacTechnicalFields(filePath, fields.codec)) {
    return changed ? { ...metadata, fields, fieldSources } : metadata;
  }

  try {
    const tagLibTechnical = await readTagLibAudioTechnicalMetadata(filePath);
    if (!tagLibTechnical || !shouldPreferTagLibForAlacTechnicalFields(filePath, fields.codec, tagLibTechnical.codec)) {
      return changed ? { ...metadata, fields, fieldSources } : metadata;
    }

    const applyNumber = (
      field: 'sampleRate' | 'bitDepth' | 'bitrate',
      value: number | null,
      validate: (candidate: number) => boolean = (candidate) => Number.isFinite(candidate) && candidate > 0,
    ): void => {
      if (value === null || !validate(value)) {
        return;
      }

      fields[field] = value;
      fieldSources[field] = 'technical';
      changed = true;
    };

    if (tagLibTechnical.codec) {
      fields.codec = tagLibTechnical.codec;
      fieldSources.codec = 'technical';
      changed = true;
    }
    applyNumber('sampleRate', tagLibTechnical.sampleRate, (value) => normalizeAudioSampleRate(value) !== null);
    applyNumber('bitDepth', tagLibTechnical.bitDepth);
    applyNumber('bitrate', tagLibTechnical.bitrate);
  } catch {
    return changed ? { ...metadata, fields, fieldSources } : metadata;
  }

  return changed ? { ...metadata, fields, fieldSources } : metadata;
};
