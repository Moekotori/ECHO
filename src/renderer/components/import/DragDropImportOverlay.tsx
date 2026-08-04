import { useCallback, useEffect, useRef, useState } from 'react';
import { FolderPlus, Music, Upload } from 'lucide-react';
import { translateFallback, useOptionalI18n } from '../../i18n/I18nProvider';
import type { TranslationKey } from '../../i18n/locales';

type DragDropImportOverlayProps = {
  onNotice: (message: string) => void;
};

const getEventFiles = (event: DragEvent): File[] => Array.from(event.dataTransfer?.files ?? []);

const hasFileDrag = (event: DragEvent): boolean => Array.from(event.dataTransfer?.types ?? []).includes('Files');
const echoPackageExtension = '.echo';
const escapeKeys = new Set(['Escape', 'Esc']);

type Translate = (key: TranslationKey, options?: Record<string, string | number>) => string;

type DragDropMode = 'library' | 'plugin';

const firstEchoPackageFile = (files: File[]): File | null =>
  files.find((file) => file.name.toLowerCase().endsWith(echoPackageExtension)) ?? null;

const summarizeDroppedFilesImport = (
  result: Awaited<ReturnType<NonNullable<Window['echo']>['library']['importDroppedFiles']>>,
  t: Translate,
): string => {
  const parts: string[] = [];

  if (result.importedCount > 0) {
    parts.push(t('import.dragDrop.files.imported', { count: result.importedCount }));
  }

  if (result.ignoredCount > 0) {
    parts.push(t('import.dragDrop.files.ignored', { count: result.ignoredCount }));
  }

  if (result.failedCount > 0) {
    parts.push(t('import.dragDrop.files.failed', { count: result.failedCount }));
  }

  return parts.length > 0
    ? t('import.dragDrop.files.summaryWithOutput', { summary: parts.join(t('punctuation.clauseSeparator')), outputDirectory: result.outputDirectory })
    : t('import.dragDrop.files.empty');
};

export const DragDropImportOverlay = ({ onNotice }: DragDropImportOverlayProps): JSX.Element | null => {
  const t = useOptionalI18n()?.t ?? translateFallback;
  const [isDragging, setIsDragging] = useState(false);
  const [dragMode, setDragMode] = useState<DragDropMode>('library');
  const dragDepthRef = useRef(0);

  const resetDragState = useCallback((): void => {
    dragDepthRef.current = 0;
    setIsDragging(false);
    setDragMode('library');
  }, []);

  const importAndEnablePluginPackage = useCallback((file: File): void => {
    const plugins = window.echo?.plugins;
    if (!plugins) {
      onNotice(t('import.dragDrop.plugin.desktopBridgeUnavailable'));
      return;
    }

    void plugins.importPackage(file)
      .then(async (result) => {
        if (!result) {
          onNotice(t('import.dragDrop.plugin.cancelled'));
          return;
        }

        try {
          await plugins.enable({ pluginId: result.pluginId, trustedPermissions: [] });
          onNotice(t('import.dragDrop.plugin.enabled', { pluginId: result.pluginId }));
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          onNotice(t('import.dragDrop.plugin.importedNeedsReview', { pluginId: result.pluginId, reason }));
        }
        window.dispatchEvent(new Event('plugins:changed'));
      })
      .catch((error) => {
        onNotice(error instanceof Error ? error.message : String(error));
      });
  }, [onNotice, t]);

  useEffect(() => {
    if (!isDragging) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!escapeKeys.has(event.key) || event.defaultPrevented) {
        return;
      }

      event.preventDefault();
      resetDragState();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDragging, resetDragState]);

  useEffect(() => {
    const handleDragEnter = (event: DragEvent): void => {
      if (!hasFileDrag(event)) {
        return;
      }

      event.preventDefault();
      dragDepthRef.current += 1;
      setDragMode(firstEchoPackageFile(getEventFiles(event)) ? 'plugin' : 'library');
      setIsDragging(true);
    };

    const handleDragOver = (event: DragEvent): void => {
      if (!hasFileDrag(event)) {
        return;
      }

      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
      setDragMode(firstEchoPackageFile(getEventFiles(event)) ? 'plugin' : 'library');
      setIsDragging(true);
    };

    const handleDragLeave = (event: DragEvent): void => {
      if (!hasFileDrag(event)) {
        return;
      }

      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setIsDragging(false);
      }
    };

    const handleDrop = (event: DragEvent): void => {
      if (!hasFileDrag(event)) {
        return;
      }

      event.preventDefault();
      const files = getEventFiles(event);
      resetDragState();

      const echoPackageFile = firstEchoPackageFile(files);
      if (echoPackageFile) {
        importAndEnablePluginPackage(echoPackageFile);
        return;
      }

      const library = window.echo?.library;
      if (!library) {
        onNotice(t('import.dragDrop.desktopBridgeUnavailable'));
        return;
      }

      if (files.length === 0) {
        onNotice(t('import.dragDrop.noDroppedFiles'));
        return;
      }

      void library.importDroppedFiles(files)
        .then((result) => {
          onNotice(summarizeDroppedFilesImport(result, t));
          if (result.importedCount > 0) {
            window.dispatchEvent(new Event('library:changed'));
          }
        })
        .catch((error) => {
          onNotice(error instanceof Error ? error.message : String(error));
        });
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, [importAndEnablePluginPackage, onNotice, resetDragState, t]);

  if (!isDragging) {
    return null;
  }

  return (
    <div className="drag-import-overlay" aria-live="polite">
      <div className="drag-import-panel">
        <div className="drag-import-icons" aria-hidden="true">
          <FolderPlus size={32} />
          <Upload size={38} />
          <Music size={32} />
        </div>
        <strong>{t(dragMode === 'plugin' ? 'import.dragDrop.plugin.overlay.title' : 'import.dragDrop.overlay.title')}</strong>
        <span>{t(dragMode === 'plugin' ? 'import.dragDrop.plugin.overlay.description' : 'import.dragDrop.overlay.description')}</span>
      </div>
    </div>
  );
};
