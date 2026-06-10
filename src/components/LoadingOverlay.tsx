import React, { useState, useEffect } from 'react';
import gscLogo from '../assets/images/gsc_logo_1781014653507.png';

interface LoadingOverlayProps {
  isOpen: boolean;
  message?: string;
}

export default function LoadingOverlay({ isOpen, message = "loading" }: LoadingOverlayProps) {
  const [dots, setDots] = useState('.');

  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => {
      setDots(prev => {
        if (prev === '...') return '.';
        if (prev === '..') return '...';
        return '..';
      });
    }, 400);

    return () => clearInterval(interval);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div 
      className="position-fixed top-0 start-0 w-100 h-100 d-flex flex-column align-items-center justify-content-center" 
      style={{ 
        backgroundColor: 'rgba(15, 23, 42, 0.75)', 
        backdropFilter: 'blur(6px)',
        zIndex: 2000,
        transition: 'opacity 0.25s ease-in-out'
      }}
    >
      <div className="text-center p-4">
        {/* Horizontal 3D flipping logo */}
        <div className="d-flex justify-content-center mb-4">
          <img 
            src={gscLogo} 
            alt="Global Student Center Logo Loader" 
            className="rounded-circle shadow-lg border border-slate-700 animate-flip-3d" 
            style={{ 
              width: '120px', 
              height: '120px', 
              objectFit: 'cover'
            }}
            referrerPolicy="no-referrer"
          />
        </div>
        
        {/* Cycling Loading Text */}
        <p 
          className="font-monospace text-emerald-400 uppercase tracking-widest mb-0 fw-bold" 
          style={{ fontSize: '15px', textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}
        >
          {message}{dots}
        </p>
      </div>
    </div>
  );
}
