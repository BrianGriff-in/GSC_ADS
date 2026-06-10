import React, { useState, useEffect } from 'react';
import { User, AuditLog } from '../types';
import SuccessModal from './SuccessModal';
import LoadingOverlay from './LoadingOverlay';

interface SuperadminDashboardProps {
  userId: number;
  username: string;
  onLogoutClick: () => void;
  triggerConfirm: (title: string, message: string, onConfirm: () => void) => void;
}

export default function SuperadminDashboard({
  userId,
  username,
  onLogoutClick,
  triggerConfirm
}: SuperadminDashboardProps) {
  const [admins, setAdmins] = useState<User[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');

  // Success Modal States
  const [successModalOpen, setSuccessModalOpen] = useState(false);
  const [successModalTitle, setSuccessModalTitle] = useState('');
  const [successModalMessage, setSuccessModalMessage] = useState('');

  const triggerSuccess = (title: string, message: string) => {
    setSuccessModalTitle(title);
    setSuccessModalMessage(message);
    setSuccessModalOpen(true);
  };
  const [editingAdmin, setEditingAdmin] = useState<User | null>(null);
  const [editPassword, setEditPassword] = useState('');
  const [dbMode, setDbMode] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Fetch data
  const fetchData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [adminRes, logsRes, dbRes] = await Promise.all([
        fetch("/api/superadmin/admins"),
        fetch("/api/audit-logs"),
        fetch("/api/system/db-status")
      ]);

      const [adminData, logsData, dbData] = await Promise.all([
        adminRes.json(),
        logsRes.json(),
        dbRes.json()
      ]);

      setAdmins(adminData);
      setAuditLogs(logsData);
      setDbMode(dbData.mode);
    } catch (e) {
      console.error(e);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    const eventSource = new EventSource(`/api/live-sync?userId=${userId}&role=superadmin`);
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "refresh") {
          fetchData(true);
        }
      } catch (e) {
        console.error("Error parsing live-sync live updates", e);
      }
    };

    eventSource.onerror = (err) => {
      console.warn("Live sync connection interrupted, automatically reconnecting...", err);
    };

    return () => {
      eventSource.close();
    };
  }, [userId]);

  const handleCreateAdmin = () => {
    if (!usernameInput || !passwordInput) {
      alert("Please provide both username and password");
      return;
    }
    
    triggerConfirm(
      "Create Admin Account",
      `Are you sure you want to create admin '${usernameInput}'?`,
      async () => {
        setSubmitting(true);
        try {
          const res = await fetch("/api/superadmin/admins", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              username: usernameInput,
              password: passwordInput,
              superadmin_id: userId
            })
          });
          const data = await res.json();
          if (data.error) {
            alert(data.error);
          } else {
            triggerSuccess(
              "Admin Account Created",
              `Administrator login account for "${usernameInput}" has been initialized successfully under secure oversight.`
            );
            setUsernameInput('');
            setPasswordInput('');
            await fetchData();
          }
        } catch (err) {
          console.error(err);
        } finally {
          setSubmitting(false);
        }
      }
    );
  };

  const handleToggleActive = (admin: User) => {
    const actionText = admin.is_active ? "deactivate" : "activate";
    triggerConfirm(
      "Change Status",
      `Are you sure you want to ${actionText} admin '${admin.username}'?`,
      async () => {
        try {
          await fetch(`/api/superadmin/admins/${admin.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              is_active: !admin.is_active,
              superadmin_id: userId
            })
          });
          fetchData();
        } catch (err) {
          console.error(err);
        }
      }
    );
  };

  const handleUpdatePassword = (adminId: number) => {
    if (!editPassword) {
      alert("Password cannot be blank");
      return;
    }
    triggerConfirm(
      "Update Admin Password",
      "Are you sure you want to update this admin password?",
      async () => {
        try {
          await fetch(`/api/superadmin/admins/${adminId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              password: editPassword,
              superadmin_id: userId
            })
          });
          setEditPassword('');
          setEditingAdmin(null);
          triggerSuccess("Password Updated", "The selected administrator's login credential password has been securely altered and stored.");
          fetchData();
        } catch (err) {
          console.error(err);
        }
      }
    );
  };

  const handleDeleteAdmin = (admin: User) => {
    triggerConfirm(
      "Delete Admin Record",
      `Are you absolutely sure you want to permanently delete admin '${admin.username}'?`,
      async () => {
        try {
          await fetch(`/api/superadmin/admins/${admin.id}`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ superadmin_id: userId })
          });
          fetchData();
        } catch (err) {
          console.error(err);
        }
      }
    );
  };

  const handleClearAuditLogs = () => {
    triggerConfirm(
      "Purge Control Hub Logs",
      "Are you absolutely sure you want to permanently delete all administrative logs inside the event audit trail? This action cannot be undone.",
      async () => {
        setSubmitting(true);
        try {
          const res = await fetch("/api/superadmin/clear-audit-logs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ superadmin_id: userId, superadmin_name: username })
          });
          const data = await res.json();
          if (data.error) {
            alert(data.error);
          } else {
            triggerSuccess("Audit Logs Purged", "All historical administrative transactions have been completely cleared from the system.");
            await fetchData();
          }
        } catch (e) {
          console.error(e);
        } finally {
          setSubmitting(false);
        }
      }
    );
  };

  return (
    <div className="container py-4">
      <header className="d-flex justify-content-between align-items-center mb-4 bg-white p-4 border border-slate-200">
        <div>
          <span className="badge bg-danger mb-1 fw-bold text-uppercase tracking-wider">Superadmin Console</span>
          <h1 className="h3 font-light text-slate-400 uppercase tracking-widest mb-0">
            Global Student Center <span className="font-bold text-slate-900">Control Hub</span>
          </h1>
          <p className="text-secondary small mb-0 mt-1">Logged as Operator: <span className="text-dark fw-medium">{username}</span> | 📡 Database Sync: <span className="text-primary fw-bold font-monospace">{dbMode}</span></p>
        </div>
        <button 
          onClick={onLogoutClick} 
          className="btn btn-outline-danger fw-semibold"
        >
          Logout Session
        </button>
      </header>

      <div className="row g-4">
        {/* Create and List Admin Section */}
        <div className="col-12 col-lg-6">
          <div className="card border-0 shadow-sm rounded-4 mb-4">
            <div className="card-header bg-dark text-white rounded-top-4 p-3 border-0">
              <h5 className="fw-bold mb-0 d-flex align-items-center gap-2">
                👥 Manage Dorm Managers (Admins)
              </h5>
            </div>
            <div className="card-body p-4">
              <div className="bg-light p-3 rounded-3 mb-4 border">
                <h6 className="fw-bold mb-2">Create New Admin</h6>
                <div className="row g-2">
                  <div className="col-12 col-sm-5">
                    <input 
                      type="text" 
                      className="form-control" 
                      placeholder="Username (e.g. admin_sophea)" 
                      value={usernameInput}
                      onChange={e => setUsernameInput(e.target.value)}
                    />
                  </div>
                  <div className="col-12 col-sm-5">
                    <input 
                      type="password" 
                      className="form-control" 
                      placeholder="Secure Password" 
                      value={passwordInput}
                      onChange={e => setPasswordInput(e.target.value)}
                    />
                  </div>
                  <div className="col-12 col-sm-2">
                    <button 
                      className="btn btn-dark w-full fw-bold text-white" 
                      onClick={handleCreateAdmin}
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>

              {loading ? (
                <div className="text-center py-4">
                  <div className="spinner-border spinner-border-sm text-secondary" role="status"></div>
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-hover align-middle mb-0">
                    <thead className="table-light">
                      <tr>
                        <th>Username</th>
                        <th>Created</th>
                        <th>Status</th>
                        <th className="text-end">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {admins.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="text-center text-muted py-3">No active admins initialized. Create one above!</td>
                        </tr>
                      ) : (
                        admins.map(adm => (
                          <tr key={adm.id}>
                            <td>
                              <span className="fw-bold text-dark">{adm.username}</span>
                            </td>
                            <td>
                              <span className="text-secondary small">
                                {new Date(adm.created_at).toLocaleDateString()}
                              </span>
                            </td>
                            <td>
                              <span className={`badge ${adm.is_active ? 'bg-success-subtle text-success' : 'bg-secondary-subtle text-secondary'}`}>
                                {adm.is_active ? 'Active' : 'Deactivated'}
                              </span>
                            </td>
                            <td className="text-end">
                              <div className="d-flex justify-content-end gap-1">
                                <button 
                                  className="btn btn-sm btn-outline-secondary"
                                  onClick={() => {
                                    setEditingAdmin(adm);
                                    setEditPassword('');
                                  }}
                                >
                                  Reset Pass
                                </button>
                                <button 
                                  className={`btn btn-sm ${adm.is_active ? 'btn-outline-warning' : 'btn-outline-success'}`}
                                  onClick={() => handleToggleActive(adm)}
                                >
                                  {adm.is_active ? 'Deactivate' : 'Activate'}
                                </button>
                                <button 
                                  className="btn btn-sm btn-outline-danger"
                                  onClick={() => handleDeleteAdmin(adm)}
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Reset password card helper */}
          {editingAdmin && (
            <div className="card b-danger border-2 shadow-sm rounded-4 mb-4">
              <div className="card-body p-4">
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h6 className="fw-bold mb-0">Reset Password for <span className="text-danger">{editingAdmin.username}</span></h6>
                  <button className="btn-close" onClick={() => setEditingAdmin(null)}></button>
                </div>
                <div className="input-group">
                  <input 
                    type="text" 
                    className="form-control" 
                    placeholder="Enter new password" 
                    value={editPassword}
                    onChange={e => setEditPassword(e.target.value)}
                  />
                  <button className="btn btn-dark text-white fw-bold" onClick={() => handleUpdatePassword(editingAdmin.id)}>
                    Save Password
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Global Audit Log Section */}
        <div className="col-12 col-lg-6">
          <div className="card border-0 shadow-sm rounded-4">
            <div className="card-header bg-secondary text-white rounded-top-4 p-3 border-0 d-flex justify-content-between align-items-center">
              <h5 className="fw-bold mb-0 d-flex align-items-center gap-2">
                📋 Dynamic Audit Trail (Logs)
              </h5>
              {auditLogs.length > 0 && (
                <button 
                  className="btn btn-danger btn-sm rounded-3 fw-bold text-white d-flex align-items-center gap-1 border"
                  style={{ borderColor: 'rgba(255,255,255,0.3)' }}
                  onClick={handleClearAuditLogs}
                  id="btn-clear-sys-logs"
                >
                  🗑️ Clear All Logs
                </button>
              )}
            </div>
            <div className="card-body p-4">
              <p className="text-muted small mb-3">All crucial record transactions are documented for admin accountability.</p>
              
              <div className="overflow-auto border rounded-3 p-2 bg-light-subtle" style={{ maxHeight: '450px' }}>
                {auditLogs.length === 0 ? (
                  <p className="text-center text-muted py-4">No audit logs received yet.</p>
                ) : (
                  auditLogs.map(log => (
                    <div key={log.id} className="p-3 mb-2 bg-white rounded border shadow-xs">
                      <div className="d-flex justify-content-between align-items-center mb-1">
                        <span className="badge bg-dark-subtle text-dark-emphasis fw-bold">
                          {log.action}
                        </span>
                        <span className="text-secondary small font-monospace">
                          {new Date(log.performed_at).toLocaleTimeString() || log.performed_at}
                        </span>
                      </div>
                      <p className="mb-1 text-dark small">{log.detail}</p>
                      <div className="d-flex justify-content-between text-secondary style={{ fontSize: '11px' }}">
                        <span>Performer: <span className="fw-bold text-secondary-emphasis">{log.performed_by_name || `ID: ${log.performed_by}`}</span></span>
                        <span>Target: {log.target_type} ({log.target_id})</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <SuccessModal 
        isOpen={successModalOpen}
        title={successModalTitle}
        message={successModalMessage}
        onClose={() => setSuccessModalOpen(false)}
      />

      <LoadingOverlay isOpen={submitting} message="processing" />


    </div>
  );
}
