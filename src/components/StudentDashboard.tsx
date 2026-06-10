import React, { useState, useEffect } from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import { StudentProfile, Attendance, LateAbsentRequest, MoveOutRequest, Notification } from '../types';
import SuccessModal from './SuccessModal';
import LoadingOverlay from './LoadingOverlay';

interface StudentDashboardProps {
  userId: number;
  username: string;
  onLogoutClick: () => void;
  triggerConfirm: (title: string, message: string, onConfirm: () => void) => void;
}

export default function StudentDashboard({
  userId,
  username,
  onLogoutClick,
  triggerConfirm
}: StudentDashboardProps) {
  // Navigation tabs
  const [activeSubTab, setActiveTab ] = useState<'profile' | 'history' | 'moveout'>('profile');

  // Success Modal States
  const [successModalOpen, setSuccessModalOpen] = useState(false);
  const [successModalTitle, setSuccessModalTitle] = useState('');
  const [successModalMessage, setSuccessModalMessage] = useState('');

  const triggerSuccess = (title: string, message: string) => {
    setSuccessModalTitle(title);
    setSuccessModalMessage(message);
    setSuccessModalOpen(true);
  };

  // Backend States
  const [profile, setProfile] = useState<any | null>(null);
  const [attendanceList, setAttendanceList] = useState<Attendance[]>([]);
  const [moveOuts, setMoveOuts] = useState<MoveOutRequest[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [dbMode, setDbMode] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form states
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dob, setDob] = useState('');
  const [pob, setPlaceOfBirth] = useState('');
  const [uni, setUniversity] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [facebook, setFacebook] = useState('');
  const [telegram, setTelegram] = useState('');
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);

  // Filter keys inside logs
  const [historyMonthFilter, setHistoryMonthFilter] = useState('all');
  const [historyStatusFilter, setHistoryStatusFilter] = useState('all');

  // Request Excuse forms
  const [selectedSessionToExcuse, setSelectedSessionToExcuse] = useState<string>('');
  const [excuseReason, setExcuseReason] = useState('');

  // Request Move-out forms
  const [moveoutReason, setMoveoutReason] = useState('');
  const [requestedMoveoutDate, setRequestedMoveoutDate] = useState('');
  const [editingMoveoutId, setEditingMoveoutId] = useState<number | null>(null);

  // Fetch student profile, stats history and move-outs
  const fetchStudentData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`/api/students/dashboard-summary/${userId}`);
      const data = await res.json();

      if (data && !data.error) {
        setDbMode(data.dbMode.mode);

        const profData = data.profile;
        if (profData && !profData.error) {
          setProfile(profData);
          setFirstName(profData.first_name || '');
          setLastName(profData.last_name || '');
          setDob(profData.date_of_birth ? profData.date_of_birth.substring(0, 10) : '');
          setPlaceOfBirth(profData.place_of_birth || '');
          setUniversity(profData.university_name || '');
          setEmail(profData.email || '');
          setPhone(profData.phone_number || '');
          setFacebook(profData.facebook || '');
          setTelegram(profData.telegram || '');
          setPhotoBase64(profData.profile_photo || null);
        }

        setAttendanceList(data.attendanceList || []);
        setMoveOuts(data.moveOuts || []);
        setNotifications(data.notifications || []);
      }

    } catch (e) {
      console.error(e);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchStudentData();
  }, [activeSubTab]);

  useEffect(() => {
    const eventSource = new EventSource(`/api/live-sync?userId=${userId}&role=student`);
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "refresh") {
          fetchStudentData(true);
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

  // Handle image upload input base64 conversion
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPhotoBase64(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // Submit profile details (move_in_date auto logged on first submittal)
  const handleSaveProfile = () => {
    triggerConfirm(
      "Submit Student Profile Form",
      "Are you sure you want to save your updated profile details? If this is your first submittal, your official move-in date timestamp will be locked.",
      async () => {
        setSubmitting(true);
        try {
          const res = await fetch(`/api/students/profile/${userId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              first_name: firstName,
              last_name: lastName,
              date_of_birth: dob,
              place_of_birth: pob,
              university_name: uni,
              email,
              phone_number: phone,
              facebook,
              telegram,
              profile_photo: photoBase64
            })
          });
          const d = await res.json();
          if (d.success) {
            triggerSuccess("Profile Updated Successfully", "Your student profile has been successfully saved, updated, and synced with the system.");
            await fetchStudentData();
          }
        } catch (e) {
          console.error(e);
        } finally {
          setSubmitting(false);
        }
      }
    );
  };

  // Submit Excuse Excuse
  const handleSendExcuse = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSessionToExcuse || !excuseReason) {
      alert("Missing chosen missed session or reason");
      return;
    }

    triggerConfirm(
      "Submit Missed Excuse Application",
      "Are you sure you want to submit this late/absent excuse request? Requests are voided if submitted more than 1 day following the session's timestamp.",
      async () => {
        setSubmitting(true);
        try {
          const res = await fetch("/api/students/requests/excuse", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              student_id: userId,
              attendance_id: parseInt(selectedSessionToExcuse),
              reason: excuseReason
            })
          });
          const d = await res.json();
          if (!d.error) {
            triggerSuccess("Excuse Request Filed", "Your late/absent excuse request has been submitted successfully to the administrators.");
            setExcuseReason('');
            setSelectedSessionToExcuse('');
            await fetchStudentData();
          } else {
            alert(d.error);
          }
        } catch (err) {
          console.error(err);
        } finally {
          setSubmitting(false);
        }
      }
    );
  };

  // Submit Moveout
  const handleSendMoveout = (e: React.FormEvent) => {
    e.preventDefault();
    if (!moveoutReason || !requestedMoveoutDate) {
      alert("Please provide reason and requested calendar date");
      return;
    }

    const isEdit = editingMoveoutId !== null;
    const alertLabel = isEdit ? "Update Move-out Request" : "Submit Move-out Request";
    const alertMsg = isEdit 
      ? "Are you sure you want to edit your pending move-out details?"
      : "Are you sure you want to post a new move-out application? Note: Active roommates are auto evict-linked upon operator check approval.";

    triggerConfirm(
      alertLabel,
      alertMsg,
      async () => {
        try {
          const method = isEdit ? "PUT" : "POST";
          const url = isEdit ? `/api/students/requests/moveout/${editingMoveoutId}` : "/api/students/requests/moveout";
          const payload = isEdit 
            ? { reason: moveoutReason, requested_move_out_date: requestedMoveoutDate }
            : { student_id: userId, reason: moveoutReason, requested_move_out_date: requestedMoveoutDate };

          const res = await fetch(url, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          const d = await res.json();
          if (!d.error) {
            triggerSuccess(
              isEdit ? "Application Updated" : "Application Posted",
              isEdit 
                ? "Your pending move-out application details have been updated successfully." 
                : "Your move-out application has been submitted successfully to the administrators."
            );
            setMoveoutReason('');
            setRequestedMoveoutDate('');
            setEditingMoveoutId(null);
            fetchStudentData();
          } else {
            alert(d.error);
          }
        } catch (err) {
          console.error(err);
        }
      }
    );
  };

  // Delete Move-Out
  const handleDeleteMoveout = (id: number) => {
    triggerConfirm(
      "Withdraw Move-out",
      "Are you sure you want to permanently delete and withdraw this move-out request?",
      async () => {
        try {
          await fetch(`/api/students/requests/moveout/${id}`, {
            method: "DELETE"
          });
          fetchStudentData();
        } catch (e) {
          console.error(e);
        }
      }
    );
  };

  // Dismiss user notificaiton dot
  const handleClearNotif = (notId: number) => {
    fetch("/api/notifications/clear-dot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notification_id: notId })
    }).then(() => fetchStudentData());
  };

  // Clear all for currently logged in student
  const handleClearAllNotifications = () => {
    triggerConfirm(
      "Clear Your Alerts",
      "Are you sure you want to permanently clear all your notification messages? This action cannot be undone.",
      async () => {
        setSubmitting(true);
        try {
          const res = await fetch("/api/notifications/clear-user-notifications", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ recipient_id: userId })
          });
          const d = await res.json();
          if (d.error) {
            alert(d.error);
          } else {
            triggerSuccess("Notifications Cleared", "Your personal notification logs have been successfully cleared.");
            await fetchStudentData();
          }
        } catch (e) {
          console.error(e);
        } finally {
          setSubmitting(false);
        }
      }
    );
  };

  // Filter matching logs list
  const filteredList = attendanceList.filter(att => {
    const started = att.started_at ? new Date(att.started_at) : new Date();
    const monthNo = started.getMonth() + 1;
    const matchMonth = historyMonthFilter === 'all' || String(monthNo) === historyMonthFilter;
    const matchStatus = historyStatusFilter === 'all' || att.status === historyStatusFilter;
    return matchMonth && matchStatus;
  });

  // Calculate quick metrics
  const onTimeCount = attendanceList.filter(a => a.status === 'on_time').length;
  const lateCount = attendanceList.filter(a => a.status === 'late').length;
  const absentCount = attendanceList.filter(a => a.status === 'absent').length;

  // Chart data representation for Student
  const pieData = [
    { name: "On Time", value: onTimeCount, color: "#198754" },
    { name: "Late", value: lateCount, color: "#ffc107" },
    { name: "Absent", value: absentCount, color: "#dc3545" }
  ].filter(d => d.value > 0);

  // Missed sessions student can apply excuses for
  // Sick excuses only eligible for missed/late sessions
  const missedSessionsList = attendanceList.filter(a => a.status === 'absent' || a.status === 'late');

  return (
    <div className="container py-4">
      {/* Header section with operator profile */}
      <header className="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-4 bg-white p-4 border border-slate-200">
        <div className="d-flex align-items-center gap-3">
          <div 
            className="bg-light d-flex align-items-center justify-content-center border border-slate-200"
            style={{ width: '65px', height: '65px', overflow: 'hidden' }}
          >
            {photoBase64 ? (
              <img src={photoBase64} alt="Avatar" className="w-100 h-100 object-fit-cover" />
            ) : (
              <span className="fs-2">{profile?.sex === 'female' ? "👧" : "👦"}</span>
            )}
          </div>
          <div>
            <span className="badge bg-primary text-uppercase fw-bold mb-1">Student Dashboard</span>
            <h1 className="h4 font-light text-slate-400 uppercase tracking-widest mb-0">
              Welcome, <span className="font-bold text-slate-900">{firstName || lastName ? `${firstName} ${lastName}` : username}</span>
            </h1>
            <p className="text-secondary small mb-0 mt-1">
              Seat allocated: <span className="badge bg-secondary font-monospace">{profile?.room_label || 'Unassigned 🏠'}</span>
            </p>
          </div>
        </div>

        <div className="d-flex gap-2">
          {/* Notifications logs */}
          <div className="dropdown">
            <button className="btn btn-outline-dark btn-sm position-relative px-3" type="button" data-bs-toggle="dropdown">
              🔔 Notifications ({notifications.filter(n => !n.is_read).length})
              {notifications.filter(n => !n.is_read).length > 0 && (
                <span className="position-absolute top-0 start-100 translate-middle p-1 bg-danger border border-white rounded-circle"></span>
              )}
            </button>
            <ul className="dropdown-menu dropdown-menu-end p-3 border-slate-200" style={{ width: '310px' }}>
              <div className="d-flex justify-content-between align-items-center border-bottom pb-2 mb-2">
                <span className="fw-bold text-dark text-uppercase tracking-wider small">My Alerts</span>
                {notifications.length > 0 && (
                  <button 
                    className="btn btn-xs btn-link text-danger p-0 h-auto text-decoration-none fw-semibold" 
                    onClick={handleClearAllNotifications}
                    id="clear-student-alerts-btn"
                  >
                    🗑️ Clear
                  </button>
                )}
              </div>
              <div className="overflow-auto" style={{ maxHeight: '200px' }}>
                {notifications.length === 0 ? (
                  <p className="text-center text-muted small py-2">No alarms received.</p>
                ) : (
                  notifications.map(n => (
                    <div 
                      key={n.id} 
                      className={`p-2 rounded border small mb-2 ${!n.is_read ? 'bg-light-subtle border-primary cursor-pointer' : 'bg-white'}`}
                      onClick={() => !n.is_read && handleClearNotif(n.id)}
                      style={{ cursor: 'pointer' }}
                    >
                      <p className="mb-0 text-dark-emphasis">{n.message}</p>
                      {!n.is_read && <span className="badge bg-danger text-white py-0 px-2 mt-1">New Alarm</span>}
                    </div>
                  ))
                )}
              </div>
            </ul>
          </div>

          <button onClick={onLogoutClick} className="btn btn-danger btn-sm px-3 fw-bold">Logout</button>
        </div>
      </header>

      {/* Main sections pills */}
      <ul className="nav nav-tabs mb-4">
        <li className="nav-item">
          <button className={`nav-link fw-bold ${activeSubTab === 'profile' ? 'active text-dark' : 'text-secondary'}`} onClick={() => setActiveTab('profile')}>
            👤 My Profile Form
          </button>
        </li>
        <li className="nav-item">
          <button className={`nav-link fw-bold ${activeSubTab === 'history' ? 'active text-dark' : 'text-secondary'}`} onClick={() => setActiveTab('history')}>
            📊 Check Attendance Logs
          </button>
        </li>
        <li className="nav-item">
          <button className={`nav-link fw-bold ${activeSubTab === 'moveout' ? 'active text-dark' : 'text-secondary'}`} onClick={() => setActiveTab('moveout')}>
            🚪 Move-out Application
          </button>
        </li>
      </ul>

      {/* --- SUB TAB PANELS --- */}

      {/* 1. STUDENT PROFILE COMPILATION */}
      {activeSubTab === 'profile' && (
        <div className="row g-4">
          <div className="col-12 col-lg-8">
            <div className="card border-0 shadow-sm rounded-4 bg-white p-4">
              <h5 className="fw-bold text-dark mb-3">Residential Information Form</h5>
              <p className="text-muted small">Please fill out your official profile details accurately. This updates the admin logs in real-time.</p>

              <div className="row g-3">
                <div className="col-md-6">
                  <label className="form-label text-muted small fw-medium">First Name</label>
                  <input type="text" className="form-control" value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="e.g. Sokha" />
                </div>
                <div className="col-md-6">
                  <label className="form-label text-muted small fw-medium">Last Name</label>
                  <input type="text" className="form-control" value={lastName} onChange={e => setLastName(e.target.value)} placeholder="e.g. Meas" />
                </div>
                <div className="col-md-6">
                  <label className="form-label text-muted small fw-medium">Date of Birth</label>
                  <input type="date" className="form-control" value={dob} onChange={e => setDob(e.target.value)} />
                </div>
                <div className="col-md-6">
                  <label className="form-label text-muted small fw-medium">Place of Birth (POB)</label>
                  <input type="text" className="form-control" value={pob} onChange={e => setPlaceOfBirth(e.target.value)} placeholder="e.g. Kampong Cham" />
                </div>
                <div className="col-md-6">
                  <label className="form-label text-muted small fw-medium">University Affiliation</label>
                  <input type="text" className="form-control" value={uni} onChange={e => setUniversity(e.target.value)} placeholder="e.g. RUPP, ITC" />
                </div>
                <div className="col-md-6">
                  <label className="form-label text-muted small fw-medium">Email Address</label>
                  <input type="email" className="form-control" value={email} onChange={e => setEmail(e.target.value)} placeholder="e.g. sokha@gmail.com" />
                </div>
                <div className="col-md-6">
                  <label className="form-label text-muted small fw-medium">Phone Number</label>
                  <input type="text" className="form-control" value={phone} onChange={e => setPhone(e.target.value)} placeholder="e.g. 012345678" />
                </div>
                <div className="col-md-6">
                  <label className="form-label text-muted small fw-medium">Facebook Profile URL</label>
                  <input type="url" className="form-control" value={facebook} onChange={e => setFacebook(e.target.value)} placeholder="e.g. https://facebook.com/username" id="student-facebook-input" />
                </div>
                <div className="col-md-6">
                  <label className="form-label text-muted small fw-medium">Telegram Profile URL / Link</label>
                  <input type="url" className="form-control" value={telegram} onChange={e => setTelegram(e.target.value)} placeholder="e.g. https://t.me/username" id="student-telegram-input" />
                </div>

                <div className="col-md-6">
                  <label className="form-label text-muted small fw-medium">Optional Profile Photo File</label>
                  <input type="file" className="form-control" accept="image/*" onChange={handleImageChange} />
                  <p className="text-secondary style={{ fontSize: '11px' }} mt-1">Image parses as base64 database resource column.</p>
                </div>

                <div className="col-12 mt-4">
                  <button className="btn btn-dark text-white fw-bold px-4" onClick={handleSaveProfile}>
                    💾 Submit Profile Options
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="col-12 col-lg-4">
            <div className="card border-0 shadow-sm rounded-4 bg-white p-4">
              <h5 className="fw-bold mb-3 d-flex align-items-center gap-1">🛡️ System Lock Indicator</h5>
              <div className="bg-light p-3 rounded border text-secondary small">
                <p className="mb-2"><strong>Dorm Move-in:</strong> {profile?.move_in_date ? new Date(profile.move_in_date).toLocaleDateString() : 'Pending verification submittal'}</p>
                <p className="mb-0"><strong>Username Code:</strong> {username}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. ATTENDANCE HISTORY LOGS */}
      {activeSubTab === 'history' && (
        <div className="row g-4">
          {/* Quick Metrics boxes */}
          <div className="col-12 col-lg-4">
            <div className="card border-0 shadow-sm rounded-4 bg-white p-4 mb-4">
              <h5 className="fw-bold text-dark mb-3">Checked Summary</h5>
              
              <div className="row g-2 mb-3 text-center">
                <div className="col-4">
                  <div className="p-2 border rounded bg-success-subtle text-success">
                    <span className="small d-block">On-Time</span>
                    <strong className="fs-5">{onTimeCount}</strong>
                  </div>
                </div>
                <div className="col-4">
                  <div className="p-2 border rounded bg-warning-subtle text-warning-emphasis">
                    <span className="small d-block">Late</span>
                    <strong className="fs-5">{lateCount}</strong>
                  </div>
                </div>
                <div className="col-4">
                  <div className="p-2 border rounded bg-danger-subtle text-danger">
                    <span className="small d-block">Absent</span>
                    <strong className="fs-5">{absentCount}</strong>
                  </div>
                </div>
              </div>

              {/* PieChart representation of student stats */}
              {attendanceList.length > 0 ? (
                <div style={{ width: '100%', height: 180 }} className="d-flex justify-content-center">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        y="50%"
                        innerRadius={50}
                        outerRadius={70}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-muted small text-center my-3">No stats to render yet.</p>
              )}
            </div>

            {/* Submitting Missed Excuse form */}
            <div className="card border-0 shadow-sm rounded-4 bg-white p-4">
              <h5 className="fw-bold text-dark mb-2">📬 File missed Excuse request</h5>
              <p className="text-muted small">Excuses submitted more than 1 day following the session timestamp are automatically voided.</p>
              
              <form onSubmit={handleSendExcuse}>
                <div className="mb-3">
                  <label className="form-label text-muted small">Select Session Roster Check</label>
                  <select className="form-select form-select-sm" value={selectedSessionToExcuse} onChange={e => setSelectedSessionToExcuse(e.target.value)}>
                    <option value="">-- Choose session check --</option>
                    {missedSessionsList.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.session_title} - Currently: {a.status.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mb-3">
                  <label className="form-label text-muted small">Written Reason explanation</label>
                  <textarea 
                    className="form-control form-control-sm" 
                    rows={3} 
                    placeholder="Provide sick note details or transport issues..."
                    value={excuseReason}
                    onChange={e => setExcuseReason(e.target.value)}
                  ></textarea>
                </div>

                <button className="btn btn-dark btn-sm text-white w-100 fw-bold" type="submit">
                  File Missed Excuse Notice
                </button>
              </form>
            </div>
          </div>

          <div className="col-12 col-lg-8">
            <div className="card border-0 shadow-sm rounded-4 bg-white p-4">
              <div className="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-2 border-bottom pb-2">
                <h5 className="fw-bold mb-0">Checked logs lists</h5>
                
                {/* AJAX style live filters */}
                <div className="d-flex gap-2">
                  <select className="form-select form-select-sm" value={historyMonthFilter} onChange={e => setHistoryMonthFilter(e.target.value)}>
                    <option value="all">All Months</option>
                    <option value="1">January (1)</option>
                    <option value="2">February (2)</option>
                    <option value="3">March (3)</option>
                    <option value="4">April (4)</option>
                    <option value="5">May (5)</option>
                    <option value="6">June (6)</option>
                    <option value="7">July (7)</option>
                    <option value="8">August (8)</option>
                    <option value="9">September (9)</option>
                    <option value="10">October (10)</option>
                    <option value="11">November (11)</option>
                    <option value="12">December (12)</option>
                  </select>
                  <select className="form-select form-select-sm" value={historyStatusFilter} onChange={e => setHistoryStatusFilter(e.target.value)}>
                    <option value="all">All Statuses</option>
                    <option value="on_time">On-Time</option>
                    <option value="late">Late</option>
                    <option value="absent">Absent</option>
                  </select>
                </div>
              </div>

              <div className="table-responsive small">
                <table className="table table-striped table-hover align-middle mb-0">
                  <thead className="table-light">
                    <tr>
                      <th>Meeting Title</th>
                      <th>Class Date</th>
                      <th>Clock Time Present</th>
                      <th>Check Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredList.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="text-center text-muted">No attendance logs match selected dropdown filters.</td>
                      </tr>
                    ) : (
                      filteredList.map(a => (
                        <tr key={a.id}>
                          <td><span className="fw-semibold text-dark">{a.session_title}</span></td>
                          <td><span>{a.started_at ? new Date(a.started_at).toLocaleDateString() : '-'}</span></td>
                          <td>
                            <span>
                              {a.marked_at ? new Date(a.marked_at).toLocaleTimeString() : 'Absent snapshot ended'}
                            </span>
                          </td>
                          <td>
                            <span className={`badge ${
                              a.status === 'on_time' ? 'bg-success text-white' :
                              a.status === 'late' ? 'bg-warning text-dark' :
                              'bg-danger text-white'
                            }`}>
                              {a.status.toUpperCase()}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. STUDENT MOVEOUT APPLICATIONS */}
      {activeSubTab === 'moveout' && (
        <div className="row g-4">
          <div className="col-12 col-lg-5">
            <div className="card border-0 shadow-sm rounded-4 bg-white p-4">
              <h5 className="fw-bold mb-3">{editingMoveoutId ? '✏️ Edit Move-out Application' : '🚪 Apply Move-out Request'}</h5>
              
              <form onSubmit={handleSendMoveout}>
                <div className="mb-3">
                  <label className="form-label text-muted small">Desired calendar date of moving out</label>
                  <input 
                    type="date" 
                    className="form-control"
                    value={requestedMoveoutDate}
                    onChange={e => setRequestedMoveoutDate(e.target.value)}
                  />
                </div>

                <div className="mb-4">
                  <label className="form-label text-muted small">Written statement / reason</label>
                  <textarea 
                    className="form-control" 
                    rows={4} 
                    placeholder="State reason (e.g. final graduation, lease ended, parent home relocation)..."
                    value={moveoutReason}
                    onChange={e => setMoveoutReason(e.target.value)}
                  ></textarea>
                </div>

                <div className="d-flex gap-2">
                  {editingMoveoutId && (
                    <button 
                      type="button" 
                      className="btn btn-outline-secondary w-50"
                      onClick={() => {
                        setEditingMoveoutId(null);
                        setMoveoutReason('');
                        setRequestedMoveoutDate('');
                      }}
                    >
                      Cancel Edit
                    </button>
                  )}
                  <button className="btn btn-dark text-white fw-bold w-100" type="submit">
                    {editingMoveoutId ? 'Save Changes' : 'File moveout statement'}
                  </button>
                </div>
              </form>
            </div>
          </div>

          <div className="col-12 col-lg-7">
            <div className="card border-0 shadow-sm rounded-4 bg-white p-4">
              <h5 className="fw-bold text-dark mb-3">Notice History</h5>
              
              {moveOuts.length === 0 ? (
                <p className="text-center text-secondary py-5">No move-out claims posted currently.</p>
              ) : (
                moveOuts.map(mo => (
                  <div key={mo.id} className="p-3 mb-3 border rounded-3 bg-light-subtle position-relative">
                    <span className={`position-absolute top-3 end-3 badge ${
                      mo.status === 'approved' ? 'bg-success' :
                      mo.status === 'denied' ? 'bg-danger' : 'bg-warning text-dark'
                    }`}>
                      {mo.status.toUpperCase()}
                    </span>

                    <h6 className="fw-bold text-dark mb-1">Status Checked Log</h6>
                    <p className="text-secondary small mb-2">Move out desired target date: {new Date(mo.requested_move_out_date).toLocaleDateString()}</p>
                    <p className="mb-3 text-dark small bg-white p-2 rounded border">{mo.reason}</p>
                    
                    <div className="d-flex justify-content-between align-items-center text-muted small">
                      <span>Posted: {new Date(mo.submitted_at).toLocaleDateString()}</span>
                      
                      {mo.status === 'pending' && (
                        <div className="d-flex gap-1">
                          <button 
                            className="btn btn-sm btn-outline-dark"
                            onClick={() => {
                              setEditingMoveoutId(mo.id);
                              setMoveoutReason(mo.reason);
                              setRequestedMoveoutDate(mo.requested_move_out_date.substring(0, 10));
                            }}
                          >
                            Edit
                          </button>
                          <button 
                            className="btn btn-sm btn-outline-danger"
                            onClick={() => handleDeleteMoveout(mo.id)}
                          >
                            Withdraw
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

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
