import { useCallback, useEffect, useRef, useState } from 'react';
import { FolderPlus, Music, Upload } from 'lucide-react';
import { translateFallback, useOptionalI18n } from '../../i18n/I18nProvider';
import type { TranslationKey } from '../../i18n/locales';

type DragDropImportOverlayProps = {
  onNotice: (message: string) => void;
};

const getEventFiles = (event: DragEvent): File[] => Array.from(event.dataTransfer?.files ?? []);

const hasFileDrag = (event: DragEvent): boolean => Array.from(event.dataTransfer?.types ?? []).includes('Files');

type Translate = (key: TranslationKey, options?: Record<string, string | number>) => string;

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
  const dragDepthRef = useRef(0);

  const resetDragState = useCallback((): void => {
    dragDepthRef.current = 0;
    setIsDragging(false);
  }, []);

  useEffect(() => {
    const handleDragEnter = (event: DragEvent): void => {
      if (!hasFileDrag(event)) {
        return;
      }

      event.preventDefault();
      dragDepthRef.current += 1;
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
  }, [onNotice, resetDragState, t]);

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
        <strong>{t('import.dragDrop.overlay.title')}</strong>
        <span>{t('import.dragDrop.overlay.description')}</span>
      </div>
    </div>
  );
};
