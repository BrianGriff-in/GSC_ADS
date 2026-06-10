import React from 'react';

interface SuccessModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  buttonText?: string;
  onClose: () => void;
}

export default function SuccessModal({
  isOpen,
  title,
  message,
  buttonText = "Dismiss",
  onClose
}: SuccessModalProps) {
  if (!isOpen) return null;

  return (
    <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(15, 23, 42, 0.45)', zIndex: 1600 }}>
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content border border-emerald-300 shadow-lg" style={{ borderRadius: '0px' }}>
          <div className="modal-header border-bottom border-emerald-100 bg-emerald-50/50 p-3">
            <h5 className="modal-title fw-bold text-emerald-800 d-flex align-items-center gap-2 text-uppercase tracking-widest" style={{ fontSize: '13px' }}>
              ✅ {title}
            </h5>
            <button type="button" className="btn-close" aria-label="Close" onClick={onClose}></button>
          </div>
          <div className="modal-body p-4">
            <p className="text-slate-600 mb-0" style={{ fontSize: '14px', lineHeight: '1.6' }}>{message}</p>
          </div>
          <div className="modal-footer border-top border-slate-100 p-3 gap-2 bg-light">
            <button 
              type="button" 
              className="btn btn-dark fw-semibold px-4 text-white" 
              onClick={onClose}
              id="success-modal-close-btn"
            >
              {buttonText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
