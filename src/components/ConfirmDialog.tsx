import { useId } from 'react';
import { AlertTriangle, LogOut, X } from 'lucide-react';
import { Modal } from './Modal';

interface ConfirmDialogProps {
  open: boolean;
  eyebrow?: string;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  eyebrow,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Stay at table',
  tone = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descId = useId();

  if (!open) return null;

  return (
    <Modal
      className="confirm-modal"
      labelledBy={titleId}
      describedBy={descId}
      onClose={onCancel}
    >
      <button
        type="button"
        className="modal-close"
        aria-label="Close"
        onClick={onCancel}
      >
        <X size={16} />
      </button>

      {eyebrow && (
        <div className={`eyebrow${tone === 'danger' ? ' eyebrow--danger' : ''}`}>
          {tone === 'danger' ? <AlertTriangle size={12} /> : <LogOut size={12} />}
          {eyebrow}
        </div>
      )}

      <h2 id={titleId} className="modal-title">
        {title}
      </h2>
      <p id={descId} className="modal-sub">
        {description}
      </p>

      <div className="modal-actions confirm-actions">
        <button type="button" className="btn btn-ghost" autoFocus onClick={onCancel}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
