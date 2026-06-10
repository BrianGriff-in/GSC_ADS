import React, { useState, useEffect } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { User, StudentProfile } from './types';
import ConfirmationModal from './components/ConfirmationModal';
import SuperadminDashboard from './components/SuperadminDashboard';
import AdminDashboard from './components/AdminDashboard';
import StudentDashboard from './components/StudentDashboard';
import LoadingOverlay from './components/LoadingOverlay';
import gscLogo from './assets/images/gsc_logo_1781014653507.png';

export default function App() {
  // Authentication states
  const [currentUser, setCurrentUser] = useState<{ id: number; username: string; role: 'superadmin' | 'admin' | 'student' } | null>(null);
  const [authRole, setAuthRole] = useState<'superadmin' | 'admin' | 'student' | null>(null);
  
  // Login input fields
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loading, setLoading] = useState(false);
  const [systemMode, setSystemMode] = useState('');

  // Reusable confirmation modal states
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [modalMessage, setModalMessage] = useState('');
  const [modalConfirmCallback, setModalConfirmCallback] = useState<() => void>(() => {});

  // Fetch db status on start
  useEffect(() => {
    fetch("/api/system/db-status")
      .then(res => res.json())
      .then(data => setSystemMode(data.mode))
      .catch(() => setSystemMode("Offline-local fallback mode active"));

    // Check if session storage has authenticated user
    const savedUser = sessionStorage.getItem("cached_dorm_user");
    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        setCurrentUser(parsed);
        setAuthRole(parsed.role);
      } catch (e) {
        sessionStorage.removeItem("cached_dorm_user");
      }
    }
  }, []);

  const triggerConfirm = (title: string, message: string, onConfirm: () => void) => {
    setModalTitle(title);
    setModalMessage(message);
    setModalConfirmCallback(() => () => {
      onConfirm();
      setModalOpen(false);
    });
    setModalOpen(true);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usernameInput || !passwordInput) {
      setLoginError("Please provide username and password");
      return;
    }
    setLoading(true);
    setLoginError('');
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: usernameInput, password: passwordInput })
      });
      const data = await res.json();
      if (data.error) {
        setLoginError(data.error);
      } else {
        setCurrentUser(data);
        setAuthRole(data.role);
        sessionStorage.setItem("cached_dorm_user", JSON.stringify(data));
      }
    } catch (err: any) {
      setLoginError("Failed to communicate with authentication server!");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    triggerConfirm(
      "Confirm Logout",
      "Are you sure you want to dismiss your session and logout of the system?",
      () => {
        setCurrentUser(null);
        setAuthRole(null);
        sessionStorage.removeItem("cached_dorm_user");
        setUsernameInput('');
        setPasswordInput('');
        setShowPassword(false);
      }
    );
  };

  const prefillCredentials = (user: string, pass: string) => {
    setUsernameInput(user);
    setPasswordInput(pass);
    setLoginError('');
  };

  return (
    <div className="min-vh-100 py-4 bg-slate-100">
      
      {/* 1. AUTH SCREEN VIEW */}
      {!currentUser && (
        <div className="container d-flex justify-content-center align-items-center py-5" style={{ minHeight: '85vh' }}>
          <div className="card p-4 p-sm-5 border border-slate-200" style={{ maxWidth: '520px', width: '100%', backgroundColor: '#ffffff' }}>
            
            <div className="text-center mb-4">
              <div className="d-flex justify-content-center mb-3">
                <img 
                  src={gscLogo} 
                  alt="Global Student Center Logo" 
                  className="rounded-circle border border-slate-200 shadow-sm" 
                  style={{ width: '130px', height: '130px', objectFit: 'cover' }}
                  referrerPolicy="no-referrer"
                />
              </div>
              <h2 className="fw-light text-secondary uppercase tracking-widest mt-1" style={{ fontSize: '18px' }}>
                GLOBAL <span className="fw-bold text-dark">STUDENT CENTER</span>
              </h2>
              <p className="text-slate-500 text-uppercase tracking-wider small mb-3" style={{ fontSize: '10.5px' }}>
                Resident attendance checks, room mappings, excuses & applications
              </p>
            </div>

            <form onSubmit={handleLogin} className="needs-validation">
              {loginError && (
                <div className="alert alert-danger border border-danger-subtle small text-center p-2 font-semibold" role="alert">
                  ⚠️ {loginError}
                </div>
              )}

              <div className="mb-3">
                <label className="form-label text-muted text-xs uppercase tracking-widest fw-bold">User Login ID</label>
                <input 
                  type="text" 
                  className="form-control form-control-lg font-monospace" 
                  placeholder="e.g. GF001, superadmin, admin1"
                  value={usernameInput}
                  onChange={e => setUsernameInput(e.target.value)}
                />
              </div>

              <div className="mb-4">
                <label className="form-label text-muted text-xs uppercase tracking-widest fw-bold">Secure Password</label>
                <div className="position-relative">
                  <input 
                    type={showPassword ? "text" : "password"} 
                    className="form-control form-control-lg font-monospace pe-5" 
                    placeholder="••••••••"
                    value={passwordInput}
                    onChange={e => setPasswordInput(e.target.value)}
                  />
                  <button
                    type="button"
                    className="position-absolute end-0 top-50 translate-middle-y border-0 bg-transparent pe-3 text-secondary d-flex align-items-center"
                    onClick={() => setShowPassword(prev => !prev)}
                    style={{ height: '100%', zIndex: 10, cursor: 'pointer' }}
                    id="toggle-password-visibility"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <button 
                type="submit" 
                className="btn btn-dark btn-lg w-100 fw-bold text-white mb-3" 
                disabled={loading}
              >
                {loading ? 'Verifying profile...' : 'Authenticate'}
              </button>
            </form>

          </div>
        </div>
      )}


      {/* 2. DYNAMIC WORKSPACE PANEL BASED ON ROLES */}
      {currentUser && (
        <main>
          {authRole === 'superadmin' && (
            <SuperadminDashboard 
              userId={currentUser.id} 
              username={currentUser.username} 
              onLogoutClick={handleLogout}
              triggerConfirm={triggerConfirm}
            />
          )}

          {authRole === 'admin' && (
            <AdminDashboard 
              userId={currentUser.id} 
              username={currentUser.username} 
              onLogoutClick={handleLogout}
              triggerConfirm={triggerConfirm}
            />
          )}

          {authRole === 'student' && (
            <StudentDashboard 
              userId={currentUser.id} 
              username={currentUser.username} 
              onLogoutClick={handleLogout}
              triggerConfirm={triggerConfirm}
            />
          )}
        </main>
      )}


      {/* 3. CORE SYSTEM DISMISS PREEMPTIVE ACTION DIALOG */}
      <ConfirmationModal 
        isOpen={modalOpen}
        title={modalTitle}
        message={modalMessage}
        onConfirm={modalConfirmCallback}
        onCancel={() => setModalOpen(false)}
      />

      {/* 4. SYSTEM LOADING OVERLAY FOR BRANDED PRESENTATION */}
      <LoadingOverlay isOpen={loading} message="authenticating" />


    </div>
  );
}
