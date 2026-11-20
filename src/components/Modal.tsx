import { useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

interface ModalProps {
  children: ReactNode;
  className?: string;
  labelledBy?: string;
  describedBy?: string;
  onClose?: () => void;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
}

/**
 * Accessible dialog backdrop + container with focus trapping, Escape dismissal,
 * and focus restoration on unmount.
 */
export function Modal({
  children,
  className = '',
  labelledBy,
  describedBy,
  onClose,
  closeOnBackdrop = true,
  closeOnEscape = true,
}: ModalProps) {
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;

    if (dialog && !dialog.contains(document.activeElement)) {
      const auto = dialog.querySelector<HTMLElement>('[autofocus]');
      const first = auto ?? dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (first ?? dialog).focus({ preventScroll: true });
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const backdrop = backdropRef.current;
      const allBackdrops = document.querySelectorAll('.modal-backdrop, .drawer-backdrop');
      const topmost = allBackdrops[allBackdrops.length - 1];
      if (backdrop && topmost && backdrop !== topmost) return;

      if (e.key === 'Escape' && closeOnEscape && onCloseRef.current) {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (e.key === 'Tab' && dialog) {
        const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
          (el) => el.offsetParent !== null || el === document.activeElement
        );
        if (focusables.length === 0) {
          e.preventDefault();
          dialog.focus();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first || !dialog.contains(document.activeElement)) {
            e.preventDefault();
            last.focus();
          }
        } else if (document.activeElement === last || !dialog.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (previouslyFocused && previouslyFocused.isConnected) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [closeOnEscape]);

  return (
    <div
      ref={backdropRef}
      className="modal-backdrop"
      onClick={closeOnBackdrop && onClose ? onClose : undefined}
    >
      <div
        ref={dialogRef}
        className={`modal ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
