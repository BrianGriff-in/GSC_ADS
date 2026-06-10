import React from 'react';

interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmationModal({
  isOpen,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  onConfirm,
  onCancel
}: ConfirmationModalProps) {
  if (!isOpen) return null;

  return (
    <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(15, 23, 42, 0.45)', zIndex: 1500 }}>
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content border border-slate-300 shadow-lg" style={{ borderRadius: '0px' }}>
          <div className="modal-header border-bottom border-slate-100 bg-light p-3">
            <h5 className="modal-title fw-bold text-dark d-flex align-items-center gap-2 text-uppercase tracking-widest" style={{ fontSize: '13px' }}>
              ⚠️ {title}
            </h5>
            <button type="button" className="btn-close" aria-label="Close" onClick={onCancel}></button>
          </div>
          <div className="modal-body p-4">
            <p className="text-slate-600 mb-0" style={{ fontSize: '14px', lineHeight: '1.6' }}>{message}</p>
          </div>
          <div className="modal-footer border-top border-slate-100 p-3 gap-2 bg-light">
            <button 
              type="button" 
              className="btn btn-outline-secondary fw-semibold px-4" 
              onClick={onCancel}
            >
              {cancelText}
            </button>
            <button 
              type="button" 
              className="btn btn-danger fw-semibold px-4 text-white" 
              onClick={onConfirm}
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
