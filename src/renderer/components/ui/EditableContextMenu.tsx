import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ClipboardPaste, Copy, RotateCcw, RotateCw, Scissors, Trash2, WholeWord } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type EditableElement = HTMLInputElement | HTMLTextAreaElement;

type MenuState = {
  target: EditableElement;
  position: { x: number; y: number };
  hasSelection: boolean;
  hasValue: boolean;
};

type MenuAction = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'delete' | 'selectAll';

type MenuItem = {
  action: MenuAction;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
};

const viewportPadding = 8;
const pointerOffset = 6;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, max));

const isEditableTarget = (target: EventTarget | null): target is EditableElement => {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
    return false;
  }

  return !target.disabled && !target.readOnly;
};

const hasSelection = (target: EditableElement): boolean => {
  const start = target.selectionStart ?? 0;
  const end = target.selectionEnd ?? 0;
  return end > start;
};

const replaceSelection = (target: EditableElement, text: string): void => {
  target.focus();
  target.setRangeText(text, target.selectionStart ?? target.value.length, target.selectionEnd ?? target.value.length, 'end');
  target.dispatchEvent(new Event('input', { bubbles: true }));
};

const runDocumentCommand = (target: EditableElement, command: string): void => {
  target.focus();
  document.execCommand(command);
};

const runMenuAction = async (target: EditableElement, action: MenuAction): Promise<void> => {
  if (!document.contains(target)) {
    return;
  }

  if (action === 'delete') {
    replaceSelection(target, '');
    return;
  }

  if (action === 'selectAll') {
    target.focus();
    target.select();
    return;
  }

  if (action === 'paste') {
    try {
      const text = await navigator.clipboard?.readText?.();
      if (typeof text === 'string') {
        replaceSelection(target, text);
        return;
      }
    } catch {
      // Fall back to the browser command below.
    }
  }

  runDocumentCommand(target, action);
};

export const EditableContextMenu = (): JSX.Element | null => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuState, setMenuState] = useState<MenuState | null>(null);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleContextMenu = (event: MouseEvent): void => {
      if (event.defaultPrevented || !isEditableTarget(event.target)) {
        return;
      }

      event.preventDefault();
      setMenuState({
        target: event.target,
        position: { x: event.clientX, y: event.clientY },
        hasSelection: hasSelection(event.target),
        hasValue: event.target.value.length > 0,
      });
    };

    document.addEventListener('contextmenu', handleContextMenu);
    return () => document.removeEventListener('contextmenu', handleContextMenu);
  }, []);

  useLayoutEffect(() => {
    if (!menuState || !menuRef.current) {
      return;
    }

    const rect = menuRef.current.getBoundingClientRect();
    setMenuPosition({
      x: clamp(menuState.position.x + pointerOffset, viewportPadding, window.innerWidth - rect.width - viewportPadding),
      y: clamp(menuState.position.y + pointerOffset, viewportPadding, window.innerHeight - rect.height - viewportPadding),
    });
  }, [menuState]);

  useEffect(() => {
    if (!menuState) {
      return;
    }

    const close = (): void => setMenuState(null);
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        close();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    document.addEventListener('pointerdown', close);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      document.removeEventListener('pointerdown', close);
    };
  }, [menuState]);

  if (!menuState) {
    return null;
  }

  const items: MenuItem[] = [
    { action: 'undo', label: '撤销', icon: RotateCcw },
    { action: 'redo', label: '重做', icon: RotateCw },
    { action: 'cut', label: '剪切', icon: Scissors, disabled: !menuState.hasSelection },
    { action: 'copy', label: '复制', icon: Copy, disabled: !menuState.hasSelection },
    { action: 'paste', label: '粘贴', icon: ClipboardPaste },
    { action: 'delete', label: '删除', icon: Trash2, disabled: !menuState.hasSelection },
    { action: 'selectAll', label: '全选', icon: WholeWord, disabled: !menuState.hasValue },
  ];

  return createPortal(
    <div className="editable-menu-layer" role="presentation">
      <div
        ref={menuRef}
        className="editable-context-menu"
        role="menu"
        aria-label="文本编辑菜单"
        style={{ left: menuPosition.x, top: menuPosition.y }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {items.map((item, index) => {
          const Icon = item.icon;
          return (
            <button
              key={item.action}
              className="editable-menu-item"
              type="button"
              role="menuitem"
              disabled={item.disabled}
              data-section-break={index === 2 || index === 6 ? 'true' : undefined}
              onClick={() => {
                void runMenuAction(menuState.target, item.action);
                setMenuState(null);
              }}
            >
              <Icon size={16} aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
};
