import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell } from 'recharts';
import { User, StudentProfile, Room, MeetingSession, Attendance, LateAbsentRequest, MoveOutRequest, Notification } from '../types';
import SuccessModal from './SuccessModal';
import LoadingOverlay from './LoadingOverlay';

interface AdminDashboardProps {
  userId: number;
  username: string;
  onLogoutClick: () => void;
  triggerConfirm: (title: string, message: string, onConfirm: () => void) => void;
}

export default function AdminDashboard({
  userId,
  username,
  onLogoutClick,
  triggerConfirm
}: AdminDashboardProps) {
  // Navigation Tabs
  const [activeTab, setActiveTab] = useState<'session' | 'students' | 'rooms' | 'requests' | 'history'>('session');

  // Backend States
  const [students, setStudents] = useState<any[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [activeSession, setActiveSession] = useState<any>(null);
  const [historySessions, setHistorySessions] = useState<any[]>([]);
  const [excuses, setExcuses] = useState<LateAbsentRequest[]>([]);
  const [moveOuts, setMoveOuts] = useState<MoveOutRequest[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [dbMode, setDbMode] = useState('');
  const [loading, setLoading] = useState(false);
  const [isFirstLoad, setIsFirstLoad] = useState(true);

  // Forms Input States
  const [newRoomLabel, setNewRoomLabel] = useState('');
  const [newRoomGender, setNewRoomGender] = useState<'male' | 'female'>('male');
  
  const [newStudentGender, setNewStudentGender] = useState<'male' | 'female'>('male');
  const [newStudentPassword, setNewStudentPassword] = useState('student123');

  const [sessionTitleInput, setSessionTitleInput] = useState('');
  
  // Select state for Assign Room
  const [assigningStudentId, setAssigningStudentId] = useState<number | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');

  // Search, Gender filters inside Students List
  const [studentSearch, setStudentSearch] = useState('');
  const [studentGenderTab, setStudentGenderTab] = useState<'all' | 'male' | 'female'>('all');
  const [selectedRoomFilter, setSelectedRoomFilter] = useState<'all' | string>('all');
  const [studentSortBy, setStudentSortBy] = useState<'none' | 'absent' | 'late'>('none');

  // Active Session Gender Tab Filter
  const [sessionGenderTab, setSessionGenderTab] = useState<'male' | 'female'>('male');

  // Success Modal States
  const [successModalOpen, setSuccessModalOpen] = useState(false);
  const [successModalTitle, setSuccessModalTitle] = useState('');
  const [successModalMessage, setSuccessModalMessage] = useState('');

  const triggerSuccess = (title: string, message: string) => {
    setSuccessModalTitle(title);
    setSuccessModalMessage(message);
    setSuccessModalOpen(true);
  };

  // Active Session Filters
  const [activeSessionSearch, setActiveSessionSearch] = useState('');
  const [activeSessionSortBy, setActiveSessionSortBy] = useState<'default' | 'name' | 'room'>('default');

  // Year & Month history filter
  const [historyYearFilter, setHistoryYearFilter] = useState('all');
  const [historyMonthFilter, setHistoryMonthFilter] = useState('all');

  // Submitting state specifically for write actions
  const [submitting, setSubmitting] = useState(false);

  // Historical session CRUD States
  const [createHistoricalOpen, setCreateHistoricalOpen] = useState(false);
  const [histSessionTitle, setHistSessionTitle] = useState('');
  const [histSessionDate, setHistSessionDate] = useState('');

  const [viewingHistSession, setViewingHistSession] = useState<any | null>(null);
  const [histRoster, setHistRoster] = useState<any[]>([]);
  const [editHistTitle, setEditHistTitle] = useState('');
  const [editHistDate, setEditHistDate] = useState('');
  const [isUpdatingHist, setIsUpdatingHist] = useState(false);

  // Print Report States
  const [printData, setPrintData] = useState<{
    type: 'daily' | 'monthly';
    title: string;
    subtitle: string;
    metadata: Record<string, any>;
    roster: any[];
  } | null>(null);

  // Selected student details modal status
  const [viewingStudent, setViewingStudent] = useState<any | null>(null);
  const [resetPasswordInput, setResetPasswordInput] = useState('');

  // Gender mismatch popup modal details
  const [genderMismatchOpen, setGenderMismatchOpen] = useState(false);
  const [genderMismatchDetails, setGenderMismatchDetails] = useState({ studentName: '', studentSex: '', roomLabel: '', roomGender: '' });

  // Stats and calculation
  const [attendanceStats, setAttendanceStats] = useState({ on_time: 0, late: 0, absent: 0 });
  const [studentsAbsenceHistory, setStudentsAbsenceHistory] = useState<Record<number, number>>({});

  // Daily export (Specific meeting session)
  const handleExportDailyPDF = (session: any, roster: any[]) => {
    triggerConfirm(
      "Confirm Daily Print/Export",
      `Are you sure you want to generate and export a daily attendance log for "${session.title}"? This formats the log into a clean formal schema and opens your browser's printing dialog.`,
      () => {
        setPrintData({
          type: 'daily',
          title: `Daily Attendance Log: ${session.title}`,
          subtitle: `Official record for session conducted on ${new Date(session.started_at).toLocaleDateString()}`,
          metadata: {
            "Session ID": session.id,
            "Started At": new Date(session.started_at).toLocaleString(),
            "Ended At": session.ended_at ? new Date(session.ended_at).toLocaleString() : "Active Session",
            "Total Count": roster.length,
            "On-Time/Present": roster.filter((r: any) => r.status === 'present' || r.status === 'on-time' || r.status === 'on_time').length,
            "Late Check-ins": roster.filter((r: any) => r.status === 'late').length,
            "Absent Count": roster.filter((r: any) => r.status === 'absent').length
          },
          roster: roster
        });
        
        setTimeout(() => {
          window.print();
        }, 300);
      }
    );
  };

  // Monthly export (Aggregated metrics matching currently filtered year & month)
  const handleExportMonthlyPDF = async () => {
    const currentYearNum = historyYearFilter === 'all' ? new Date().getFullYear() : parseInt(historyYearFilter);
    const currentMonthNum = historyMonthFilter === 'all' ? (new Date().getMonth() + 1) : parseInt(historyMonthFilter);

    triggerConfirm(
      "Confirm Monthly Print/Export",
      `Are you sure you want to aggregate and print the monthly attendance consolidation report for ${historyMonthFilter === 'all' ? 'All Months' : 'Month ' + historyMonthFilter}, Year ${currentYearNum}?`,
      async () => {
        try {
          setLoading(true);
          const res = await fetch(`/api/admins/attendance/monthly-report?year=${currentYearNum}&month=${currentMonthNum}`);
          if (!res.ok) throw new Error("Could not load monthly report");
          const list = await res.json();
          
          setPrintData({
            type: 'monthly',
            title: `Monthly Attendance Consolidation Report`,
            subtitle: `Consolidated record for ${historyMonthFilter === 'all' ? 'All Months' : 'Month ' + historyMonthFilter}, Year ${currentYearNum}`,
            metadata: {
              "Reporting Period": `${historyMonthFilter === 'all' ? 'Annual Summary' : 'Month ' + historyMonthFilter} / Year ${currentYearNum}`,
              "Active Student Roster Size": list.length,
              "Total Monthly Meetings Logged": historySessions.filter(s => 
                (historyYearFilter === 'all' || s.year === currentYearNum) && 
                (historyMonthFilter === 'all' || s.month === currentMonthNum)
              ).length
            },
            roster: list
          });

          setTimeout(() => {
            window.print();
          }, 300);
        } catch (e: any) {
          console.error(e);
          alert("Error printing monthly summary: " + e.message);
        } finally {
          setLoading(false);
        }
      }
    );
  };

  // Fetch all datasets securely
  const fetchAllData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`/api/admins/dashboard-summary/${userId}`);
      const data = await res.json();

      if (data && !data.error) {
        setDbMode(data.dbMode.mode);
        setStudents(data.students);
        setRooms(data.rooms);
        setActiveSession(data.activeSession);
        setExcuses(data.excuses || []);
        setMoveOuts(data.moveOuts || []);
        setHistorySessions(data.historySessions);
        setNotifications(data.notifications);
        setStudentsAbsenceHistory(data.studentsAbsenceHistory);
      }

    } catch (e) {
      console.error("Error loaded data inside admin console", e);
    } finally {
      if (!silent) setLoading(false);
      setIsFirstLoad(false);
    }
  };

  useEffect(() => {
    fetchAllData();
  }, [activeTab]);

  useEffect(() => {
    const eventSource = new EventSource(`/api/live-sync?userId=${userId}&role=admin`);
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "refresh") {
          fetchAllData(true);
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

  // --- HISTORICAL SESSION CRUD ACTIONS ---
  const handleCreateHistoricalSession = async () => {
    if (!histSessionTitle) {
      alert("Please provide a session title");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/admins/sessions/historical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: histSessionTitle,
          date: histSessionDate
        })
      });
      const data = await res.json();
      if (data.success) {
        setCreateHistoricalOpen(false);
        triggerSuccess("Historical Session Created", `Historical record for "${histSessionTitle}" has been saved successfully. All registered students initialized to 'absent'. You can now adjust individual rosters in the details panel.`);
        await fetchAllData();
      } else {
        alert(data.error || "Failed to create historical session");
      }
    } catch (err: any) {
      console.error(err);
      alert("Error creating historical record");
    } finally {
      setSubmitting(false);
    }
  };

  const handleViewHistoricalSession = async (session: any) => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admins/sessions/${session.id}/roster`);
      if (!res.ok) throw new Error("Could not load roster details");
      const data = await res.json();
      setViewingHistSession(session);
      setHistRoster(data);
      setEditHistTitle(session.title);
      setEditHistDate(new Date(session.started_at).toISOString().split('T')[0]);
    } catch (err: any) {
      console.error(err);
      alert("Error loading historical session details");
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateHistoricalMetadata = async () => {
    if (!viewingHistSession) return;
    if (!editHistTitle) {
      alert("Please specify a title");
      return;
    }
    setIsUpdatingHist(true);
    try {
      const res = await fetch(`/api/admins/sessions/${viewingHistSession.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editHistTitle,
          started_at: editHistDate
        })
      });
      const data = await res.json();
      if (data.success) {
        setViewingHistSession((prev: any) => ({
          ...prev,
          title: editHistTitle,
          started_at: new Date(editHistDate).toISOString()
        }));
        triggerSuccess("Session Details Updated", "The session details have been successfully modified.");
        await fetchAllData();
      } else {
        alert(data.error || "Failed to edit metadata");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsUpdatingHist(false);
    }
  };

  const handleDeleteHistoricalSession = async (sessionId: number) => {
    triggerConfirm(
      "Permanently Remove Session Logs",
      "Are you sure you want to completely delete this historical attendance session? This action will permanently remove all associated student snapshotted check-in state logs cascade-wise from the database and cannot be undone.",
      async () => {
        setSubmitting(true);
        try {
          const res = await fetch(`/api/admins/sessions/${sessionId}`, {
            method: "DELETE"
          });
          const data = await res.json();
          if (data.success) {
            setViewingHistSession(null);
            triggerSuccess("Historical Session Deleted", "The selected archived attendance log session and roster statuses have been permanently purged.");
            await fetchAllData();
          } else {
            alert(data.error || "Failed to delete session");
          }
        } catch (e) {
          console.error(e);
        } finally {
          setSubmitting(false);
        }
      }
    );
  };

  const handleOverrideHistoricalAttendance = async (attendanceId: number, targetStatus: string) => {
    if (!viewingHistSession) return;
    
    // 1. Optimistic Update of local histRoster state immediately
    setHistRoster((prev: any[]) => 
      prev.map((r: any) => 
        r.attendance_id === attendanceId ? { ...r, status: targetStatus } : r
      )
    );

    // 2. Async Sync
    try {
      const res = await fetch("/api/admins/attendance/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attendance_id: attendanceId,
          target_status: targetStatus,
          admin_id: userId,
          admin_name: username
        })
      });
      const d = await res.json();
      if (!d.success) {
        alert(d.error || "Failed copy");
      } else {
        // Silent back-end sync details
        fetchAllData(true);
      }
    } catch (err: any) {
      console.error(err);
    }
  };

  // Create room
  const handleCreateRoom = () => {
    if (!newRoomLabel) {
      alert("Label is required");
      return;
    }
    triggerConfirm(
      "Create Dorm Room",
      `Are you sure you want to add '${newRoomLabel}' designated for '${newRoomGender}' members?`,
      async () => {
        setSubmitting(true);
        try {
          const res = await fetch("/api/admins/rooms", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              room_label: newRoomLabel,
              gender: newRoomGender,
              admin_id: userId,
              admin_name: username
            })
          });
          const data = await res.json();
          if (data.error) {
            alert(data.error);
          } else {
            setNewRoomLabel('');
            await fetchAllData();
          }
        } catch (e) {
          console.error(e);
        } finally {
          setSubmitting(false);
        }
      }
    );
  };

  // Delete Room
  const handleDeleteRoom = (room: Room) => {
    triggerConfirm(
      "Delete Room",
      `Are you sure you want to delete room '${room.room_label}'?`,
      async () => {
        setSubmitting(true);
        try {
          const res = await fetch(`/api/admins/rooms/${room.id}`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ admin_id: userId, admin_name: username })
          });
          const d = await res.json();
          if (d.error) {
            alert(d.error);
          } else {
            await fetchAllData();
          }
        } catch (e) {
          console.error(e);
        } finally {
          setSubmitting(false);
        }
      }
    );
  };

  // Create auto-increment student (BFxxx / GFxxx)
  const handleCreateStudent = () => {
    triggerConfirm(
      "Create Student Credential",
      `Are you sure you want to initialize a new '${newStudentGender}' student profile? Quick password is '${newStudentPassword}'`,
      async () => {
        try {
          const res = await fetch("/api/admins/students", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sex: newStudentGender,
              password: newStudentPassword,
              admin_id: userId,
              admin_name: username
            })
          });
          const data = await res.json();
          if (data.error) {
            alert(data.error);
          } else {
            triggerSuccess(
              "Dormitory Student Registered Successfully",
              `A brand-new student login account has been allocated automatically.\n\nGenerated Username: ${data.username}\nDefault Password: ${newStudentPassword}\n\nThis student is eligible to log in immediately and customize their profile profile.`
            );
            fetchAllData();
          }
        } catch (e) {
          console.error(e);
        }
      }
    );
  };

  // Assign Student to Room (Strict Gender verification checks)
  const handleAssignRoom = () => {
    if (!assigningStudentId || !selectedRoomId) {
      alert("Please select a valid room!");
      return;
    }
    const student = students.find(s => s.id === assigningStudentId);
    const room = rooms.find(r => r.id === parseInt(selectedRoomId));

    if (!student || !room) return;

    if (student.sex !== room.gender) {
      setGenderMismatchDetails({
        studentName: `${student.first_name || ''} ${student.last_name || ''} (@${student.username})`.trim(),
        studentSex: student.sex || 'unknown',
        roomLabel: room.room_label || 'Selected Room',
        roomGender: room.gender || 'unknown'
      });
      setGenderMismatchOpen(true);
      return;
    }

    triggerConfirm(
      "Assign Dorm Room",
      `Assign ${student.username} into ${room.room_label}?`,
      async () => {
        setSubmitting(true);
        try {
          const res = await fetch("/api/admins/room-members/assign", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              student_id: assigningStudentId,
              room_id: parseInt(selectedRoomId),
              admin_id: userId,
              admin_name: username
            })
          });
          const d = await res.json();
          if (res.status >= 400 || d.error) {
            alert(d.error || "Failed to assign student to room!");
          } else {
            triggerSuccess(
              "Room Allocation Approved",
              "The resident roommate has been successfully assigned and registered to the designated room. Roster metrics updated."
            );
            setAssigningStudentId(null);
            setSelectedRoomId('');
            await fetchAllData();
          }
        } catch (e) {
          console.error(e);
          alert("A network error occurred while assigning room!");
        } finally {
          setSubmitting(false);
        }
      }
    );
  };

  // Remove room assignment (Make student unassigned)
  const handleRemoveRoomAssignment = (studentId: number, usernameStr: string) => {
    triggerConfirm(
      "Evict Student",
      `Are you sure you want to remove student '${usernameStr}' from their assigned room?`,
      async () => {
        setSubmitting(true);
        try {
          const res = await fetch("/api/admins/room-members/unassign", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              student_id: studentId,
              admin_id: userId,
              admin_name: username
            })
          });
          const d = await res.json();
          if (res.status >= 400 || d.error) {
            alert(d.error || "Failed to unassign student!");
          } else {
            triggerSuccess("Student Unassigned", `Student '${usernameStr}' has been successfully unallocated from their designated dorm room space.`);
            await fetchAllData();
          }
        } catch (e) {
          console.error(e);
          alert("A network error occurred while unassigning room!");
        } finally {
          setSubmitting(false);
        }
      }
    );
  };

  // Delete student
  const handleDeleteStudent = (stud: any) => {
    triggerConfirm(
      "Delete Student",
      `Are you sure you want to permanently delete '${stud.username}' (${stud.first_name || 'No Name'})?`,
      async () => {
        setSubmitting(true);
        try {
          const res = await fetch(`/api/admins/students/${stud.id}`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ admin_id: userId, admin_name: username })
          });
          const data = await res.json();
          if (data.error) {
            alert(data.error);
          } else {
            setViewingStudent(null);
            await fetchAllData();
          }
        } catch (e) {
          console.error(e);
          alert("An error occurred while deleting the student profile.");
        } finally {
          setSubmitting(false);
        }
      }
    );
  };

  // Reset student password
  const handleResetStudentPassword = (stud: any, newPassword: string) => {
    if (!newPassword.trim()) {
      alert("Please enter a valid new password.");
      return;
    }
    triggerConfirm(
      "Reset Student Password",
      `Are you sure you want to change the password for '${stud.username}' (${stud.first_name || 'No Name'})?`,
      async () => {
        setSubmitting(true);
        try {
          const res = await fetch(`/api/admins/students/${stud.id}/reset-password`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              password: newPassword,
              admin_id: userId,
              admin_name: username
            })
          });
          const data = await res.json();
          if (data.error) {
            alert(data.error);
          } else {
            triggerSuccess("Password Reset Successful", `Password for student '${stud.username}' has been successfully updated.`);
            setResetPasswordInput('');
            setViewingStudent(null);
            await fetchAllData();
          }
        } catch (e) {
          console.error(e);
          alert("An error occurred while resetting the student password.");
        } finally {
          setSubmitting(false);
        }
      }
    );
  };

  // Create attendance session
  const handleCreateSession = () => {
    if (!sessionTitleInput) {
      alert("Session Title is required!");
      return;
    }
    triggerConfirm(
      "Initialize Attendance Session",
      `Open monthly session '${sessionTitleInput}'? All active dormitory students will be snapshotted as absent in this session.`,
      async () => {
        setSubmitting(true);
        try {
          const res = await fetch("/api/admins/sessions/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: sessionTitleInput,
              admin_id: userId,
              admin_name: username
            })
          });
          const d = await res.json();
          if (d.error) {
            alert(d.error);
          } else {
            triggerSuccess(
              "Meeting Session Initialized",
              `The active attendance tracking meeting "${d.title || sessionTitleInput}" is now running live.\n\nDormitory roommates have been snapshotted automatically. Gatekeepers can now begin marking on-time vs late logs.`
            );
            setSessionTitleInput('');
            await fetchAllData();
          }
        } catch (e) {
          console.error(e);
        } finally {
          setSubmitting(false);
        }
      }
    );
  };

  // Mark Present - Instantly runs without blocking prompts & utilizes instant optimistic UI updates
  const handleMarkPresent = (attId: number, studName: string) => {
    // 1. Optimistic Update
    if (activeSession && activeSession.roster) {
      setActiveSession((prev: any) => {
        if (!prev) return prev;
        return {
          ...prev,
          roster: prev.roster.map((r: any) => 
            r.attendance_id === attId 
              ? { ...r, status: 'on_time', marked_at: new Date().toISOString() } 
              : r
          )
        };
      });
    }

    // 2. Async Sync
    fetch("/api/admins/attendance/mark-present", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attendance_id: attId,
        admin_id: userId,
        admin_name: username
      })
    })
    .then(res => res.json())
    .then(data => {
      // Background silent-sync to guarantee consistent counters/details
      fetchAllData(true);
    })
    .catch(err => {
      console.error("Async check-in failed:", err);
    });
  };

  // Override attendance (Edit/Undo action) - Instantly mutates state optimistically
  const handleOverrideAttendance = (attId: number, targetStatus: string, studName: string) => {
    // 1. Optimistic Update
    if (activeSession && activeSession.roster) {
      setActiveSession((prev: any) => {
        if (!prev) return prev;
        return {
          ...prev,
          roster: prev.roster.map((r: any) => 
            r.attendance_id === attId 
              ? { ...r, status: targetStatus, marked_at: new Date().toISOString() } 
              : r
          )
        };
      });
    }

    // 2. Async Sync
    fetch("/api/admins/attendance/override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attendance_id: attId,
        target_status: targetStatus,
        admin_id: userId,
        admin_name: username
      })
    })
    .then(res => res.json())
    .then(() => {
      fetchAllData(true);
    })
    .catch(err => {
      console.error("Async override failed:", err);
    });
  };

  // Terminate Active Meeting
  const handleTerminateSession = (sessId: number, title: string) => {
    triggerConfirm(
      "End Meeting Session",
      `Are you absolutely sure you want to end session '${title}'? All remaining absent students will receive a warning notice and final statistics saved.`,
      async () => {
        setSubmitting(true);
        try {
          await fetch("/api/admins/sessions/end", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              session_id: sessId,
              admin_id: userId,
              admin_name: username
            })
          });
          await fetchAllData();
        } catch (e) {
          console.error(e);
        } finally {
          setSubmitting(false);
        }
      }
    );
  };

  // Review Excuse request
  const handleReviewExcuse = (id: number, status: 'approved' | 'denied') => {
    triggerConfirm(
      "Review Excuse Submission",
      `Are you sure you want to set status of excuse request ID ${id} to ${status.toUpperCase()}?`,
      async () => {
        try {
          await fetch("/api/requests/excuse/review", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              request_id: id,
              status,
              admin_id: userId,
              admin_name: username
            })
          });
          fetchAllData();
        } catch (e) {
          console.error(e);
        }
      }
    );
  };

  // Review Move-Out request
  const handleReviewMoveout = (id: number, studentUser: string, status: 'approved' | 'denied') => {
    const actText = status === 'approved' ? 'APPROVE and immediately evict' : 'DENY';
    triggerConfirm(
      "Review Move-out Application",
      `Are you sure you want to ${actText} move-out application for '${studentUser}'?`,
      async () => {
        try {
          await fetch("/api/requests/moveout/review", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              request_id: id,
              status,
              admin_id: userId,
              admin_name: username
            })
          });
          fetchAllData();
        } catch (e) {
          console.error(e);
        }
      }
    );
  };

  // Prune move-out applications older than 1 month
  const handlePruneMoveouts = () => {
    triggerConfirm(
      "Prune Historical Move-outs",
      "Are you sure you want to permanently delete approved and denied move-out messages older than 1 month to optimize server storage?",
      async () => {
        try {
          const res = await fetch("/api/admins/requests/prune-moveouts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ admin_id: userId, admin_name: username })
          });
          const d = await res.json();
          alert(`Successfully pruned ${d.count || 0} old notices from disk.`);
          fetchAllData();
        } catch (e) {
          console.error(e);
        }
      }
    );
  };

  // Clear all late/absent excuse request logs
  const handleClearAllLateAbsent = () => {
    triggerConfirm(
      "Clear All Excuses",
      "Are you sure you want to permanently delete ALL late and absent excuse submission records from the system database? This action cannot be undone.",
      async () => {
        setSubmitting(true);
        try {
          const res = await fetch("/api/admins/requests/clear-late-absent", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ admin_id: userId, admin_name: username })
          });
          const d = await res.json();
          if (d.error) {
            alert(d.error);
          } else {
            triggerSuccess("Excuses Purged", "All historical excuse submission data was completely cleared from the system.");
            await fetchAllData();
          }
        } catch (e) {
          console.error(e);
        } finally {
          setSubmitting(false);
        }
      }
    );
  };

  // Clear all student move-out applications
  const handleClearAllMoveouts = () => {
    triggerConfirm(
      "Clear All Move-Out Notices",
      "Are you sure you want to permanently delete ALL student move-out notification logs from the system database? This action cannot be undone.",
      async () => {
        setSubmitting(true);
        try {
          const res = await fetch("/api/admins/requests/clear-moveouts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ admin_id: userId, admin_name: username })
          });
          const d = await res.json();
          if (d.error) {
            alert(d.error);
          } else {
            triggerSuccess("Moveouts Purged", "All move-out request and notification logs were completely cleared.");
            await fetchAllData();
          }
        } catch (e) {
          console.error(e);
        } finally {
          setSubmitting(false);
        }
      }
    );
  };

  // Clear all recipient notifications
  const handleClearAllNotifications = () => {
    triggerConfirm(
      "Clear Your Notifications",
      "Are you sure you want to clear all your current notifications? This will clear your personal alert logs.",
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
            triggerSuccess("Notifications Cleared", "Your personal notification logs have been cleared.");
            await fetchAllData();
          }
        } catch (e) {
          console.error(e);
        } finally {
          setSubmitting(false);
        }
      }
    );
  };

  // Read notification clearing dot
  const handleReadNotification = (id: number) => {
    fetch("/api/notifications/clear-dot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notification_id: id })
    }).then(() => fetchAllData());
  };

  // Dismiss all notifications
  const handleReadAllNotifications = () => {
    fetch("/api/notifications/read-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient_id: userId })
    }).then(() => fetchAllData());
  };


  // Filtering logs
  const totalMaleStudents = students.filter(s => s.sex === 'male').length;
  const totalFemaleStudents = students.filter(s => s.sex === 'female').length;

  const filteredStudents = students.filter(s => {
    const matchSearch = (s.username + ' ' + (s.first_name || '') + ' ' + (s.last_name || '')).toLowerCase().includes(studentSearch.toLowerCase());
    const matchGender = studentGenderTab === 'all' || s.sex === studentGenderTab;
    const matchRoom = selectedRoomFilter === 'all' || String(s.room_id) === selectedRoomFilter;
    return matchSearch && matchGender && matchRoom;
  }).sort((a, b) => {
    if (studentSortBy === 'absent') {
      return (studentsAbsenceHistory[b.id] || 0) - (studentsAbsenceHistory[a.id] || 0);
    }
    // No sorting
    return b.id - a.id;
  });

  // Unique years & months in history
  const uniqueYears = Array.from(new Set(historySessions.map(h => h.year)));
  const uniqueMonths = Array.from(new Set(historySessions.map(h => h.month)));

  const filteredHistory = historySessions.filter(h => {
    const matchYear = historyYearFilter === 'all' || String(h.year) === historyYearFilter;
    const matchMonth = historyMonthFilter === 'all' || String(h.month) === historyMonthFilter;
    return matchYear && matchMonth;
  });

  // Aggregate stats across filtered history sessions for charts
  const chartData = filteredHistory.map(h => ({
    name: h.title,
    "On Time": parseInt(h.count_on_time),
    "Late": parseInt(h.count_late),
    "Absent": parseInt(h.count_absent)
  })).reverse();

  // Active session stats overview
  const activeSessionRoster = activeSession?.roster || [];
  const activeSessionFiltered = activeSessionRoster.filter((st: any) => {
    const matchGender = st.sex === sessionGenderTab;
    const fullName = `${st.first_name || ''} ${st.last_name || ''} ${st.student_username || ''} ${st.room_label || ''}`.toLowerCase();
    const matchSearch = fullName.includes(activeSessionSearch.toLowerCase());
    return matchGender && matchSearch;
  }).sort((a: any, b: any) => {
    if (activeSessionSortBy === 'name') {
      const nameA = `${a.first_name || ''} ${a.last_name || ''}`.trim().toLowerCase() || a.student_username.toLowerCase();
      const nameB = `${b.first_name || ''} ${b.last_name || ''}`.trim().toLowerCase() || b.student_username.toLowerCase();
      return nameA.localeCompare(nameB);
    }
    if (activeSessionSortBy === 'room') {
      const roomA = (a.room_label || '').toLowerCase();
      const roomB = (b.room_label || '').toLowerCase();
      return roomA.localeCompare(roomB);
    }
    return 0;
  });

  const activeStatsOnTime = activeSessionRoster.filter((st: any) => st.status === 'on_time').length;
  const activeStatsLate = activeSessionRoster.filter((st: any) => st.status === 'late').length;
  const activeStatsAbsent = activeSessionRoster.filter((st: any) => st.status === 'absent').length;

  // Notification count
  const unreadNotifs = notifications.filter(n => !n.is_read);

  return (
    <div className="container-fluid py-4 px-xl-5">
      {/* Header Panel */}
      <header className="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-4 bg-dark text-white p-4 border border-slate-800">
        <div>
          <div className="d-flex align-items-center gap-2 mb-2">
            <span className="badge bg-success text-uppercase fw-bold tracking-wider">Dorm Manager Console</span>
            <span className="badge bg-secondary text-light font-monospace small">V5.3 LTS</span>
          </div>
          <h1 className="h3 font-light text-slate-400 uppercase tracking-widest mb-0">
            Global Student Center <span className="font-bold text-white">Attendance Tracker</span>
          </h1>
          <p className="text-secondary small mb-0 mt-1">
            Current Operator: <span className="text-slate-200 fw-medium">{username}</span>
          </p>
        </div>
        <div className="d-flex gap-2">
          {/* Notifications status dropdown */}
          <div className="dropdown">
            <button 
              className="btn btn-outline-light d-flex align-items-center gap-2 position-relative" 
              type="button" 
              data-bs-toggle="dropdown" 
              aria-expanded="false"
            >
              🔔 Notifications 
              {unreadNotifs.length > 0 && (
                <span className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger border border-white">
                  {unreadNotifs.length}
                </span>
              )}
            </button>
            <ul className="dropdown-menu dropdown-menu-end p-3 border-slate-200" style={{ width: '320px' }}>
              <div className="d-flex justify-content-between align-items-center border-bottom pb-2 mb-2">
                <span className="fw-semibold text-dark text-uppercase tracking-wider small">System Alerts</span>
                <div className="d-flex gap-2">
                  {unreadNotifs.length > 0 && (
                    <button className="btn btn-xs btn-link text-primary p-0 h-auto text-decoration-none fw-medium" onClick={handleReadAllNotifications}>
                      ✓ Read All
                    </button>
                  )}
                  {notifications.length > 0 && (
                    <button className="btn btn-xs btn-link text-danger p-0 h-auto text-decoration-none fw-medium ms-1" onClick={handleClearAllNotifications} id="clear-all-alerts-btn">
                      🗑️ Clear
                    </button>
                  )}
                </div>
              </div>
              <div className="overflow-auto" style={{ maxHeight: '250px' }}>
                {notifications.length === 0 ? (
                  <p className="text-muted small text-center my-3">No system notifications</p>
                ) : (
                  notifications.map(n => (
                    <div 
                      key={n.id} 
                      className={`p-2 mb-2 rounded border small cursor-pointer position-relative ${!n.is_read ? 'bg-light-subtle border-primary' : 'bg-white'}`}
                      onClick={() => !n.is_read && handleReadNotification(n.id)}
                      style={{ cursor: 'pointer' }}
                    >
                      <p className="mb-0 text-dark font-medium">{n.message}</p>
                      <span className="text-muted" style={{ fontSize: '10px' }}>
                        {new Date(n.created_at).toLocaleDateString()}
                      </span>
                      {!n.is_read && <span className="position-absolute top-50 end-0 translate-middle p-1 bg-danger border border-light rounded-circle"></span>}
                    </div>
                  ))
                )}
              </div>
            </ul>
          </div>

          <button 
            onClick={onLogoutClick} 
            className="btn btn-danger fw-semibold px-4 text-white"
          >
            Logout
          </button>
        </div>
      </header>

      {/* Roster & Live Counts Overview (no refresh needed) */}
      <section className="row g-3 mb-4">
        <div className="col-md-3 col-sm-6">
          <div className="card border-0 shadow-sm rounded-4 bg-white p-4 h-100 border-start border-primary border-4">
            <p className="text-muted small fw-medium mb-1">👦 MALE RESIDENTS</p>
            <h2 className="fw-bold mb-0 text-dark">{totalMaleStudents} Students</h2>
            <span className="text-secondary small mt-1 d-block">Matched to BFxxx tags</span>
          </div>
        </div>
        <div className="col-md-3 col-sm-6">
          <div className="card border-0 shadow-sm rounded-4 bg-white p-4 h-100 border-start border-danger border-4">
            <p className="text-muted small fw-medium mb-1">👧 FEMALE RESIDENTS</p>
            <h2 className="fw-bold mb-0 text-dark">{totalFemaleStudents} Students</h2>
            <span className="text-secondary small mt-1 d-block">Matched to GFxxx tags</span>
          </div>
        </div>
        <div className="col-md-3 col-sm-6">
          <div className="card border-0 shadow-sm rounded-4 bg-white p-4 h-100 border-start border-success border-4">
            <p className="text-muted small fw-medium mb-1">🏠 LAUNCHED ROOMS</p>
            <h2 className="fw-bold mb-0 text-dark">{rooms.length} Units</h2>
            <span className="text-secondary small mt-1 d-block">Occupancy checks active</span>
          </div>
        </div>
        <div className="col-md-3 col-sm-6">
          <div className="card border-0 shadow-sm rounded-4 bg-white p-4 h-100 border-start border-warning border-4">
            <p className="text-muted small fw-medium mb-1">⚠️ RED ALERTS GAGE</p>
            <h2 className="fw-bold mb-0 text-danger-emphasis">
              {students.filter(s => (studentsAbsenceHistory[s.id] || 0) >= 3).length} Flags
            </h2>
            <span className="text-danger small mt-1 d-block">Absent &gt;= 3 times this year!</span>
          </div>
        </div>
      </section>

      {/* Main Feature Tabs Navigation */}
      <ul className="nav nav-pills nav-fill gap-2 p-2 mb-4 bg-white rounded-3 shadow-xs border">
        <li className="nav-item">
          <button 
            className={`nav-link fw-bold ${activeTab === 'session' ? 'active bg-dark' : 'text-secondary'}`}
            onClick={() => setActiveTab('session')}
          >
            ⏱️ Active Meeting & Attendance
          </button>
        </li>
        <li className="nav-item">
          <button 
            className={`nav-link fw-bold ${activeTab === 'students' ? 'active bg-dark' : 'text-secondary'}`}
            onClick={() => setActiveTab('students')}
          >
            👥 Residents Registry (CRUD)
          </button>
        </li>
        <li className="nav-item">
          <button 
            className={`nav-link fw-bold ${activeTab === 'rooms' ? 'active bg-dark' : 'text-secondary'}`}
            onClick={() => setActiveTab('rooms')}
          >
            🏠 Rooms Allocation
          </button>
        </li>
        <li className="nav-item">
          <button 
            className={`nav-link fw-bold ${activeTab === 'requests' ? 'active bg-dark' : 'text-secondary'}`}
            onClick={() => setActiveTab('requests')}
          >
            ✉️ Applications & Pruning
          </button>
        </li>
        <li className="nav-item">
          <button 
            className={`nav-link fw-bold ${activeTab === 'history' ? 'active bg-dark' : 'text-secondary'}`}
            onClick={() => setActiveTab('history')}
          >
            📊 Analytics & Logs Archive
          </button>
        </li>
      </ul>


      {/* --- TAB VIEW CONTROLS --- */}

      {/* 1. ATTENDANCE MEETING SESSIONS */}
      {activeTab === 'session' && (
        <div className="row g-4">
          {/* Active Meeting Roster Layout */}
          <div className="col-12 col-lg-8">
            {activeSession ? (
              <div className="card border-0 shadow-sm rounded-4">
                <div className="card-header bg-dark text-white p-3 rounded-top-4 d-flex justify-content-between align-items-center">
                  <div>
                    <span className="badge bg-success mb-1">SESSION RUNNING</span>
                    <h5 className="mb-0 fw-bold">{activeSession.session.title}</h5>
                    <p className="text-secondary small mb-0">Started on Cambodian Time: {new Date(activeSession.session.started_at).toLocaleTimeString()}</p>
                  </div>
                  <button 
                    className="btn btn-outline-danger btn-sm text-white border-white fw-bold"
                    onClick={() => handleTerminateSession(activeSession.session.id, activeSession.session.title)}
                  >
                    ⏹️ End Session Manually
                  </button>
                </div>
                
                <div className="card-body p-4">
                  {/* Stats tracker bar */}
                  <div className="row g-2 text-center mb-4">
                    <div className="col-4">
                      <div className="p-3 bg-light rounded-3 border-bottom border-success border-3">
                        <span className="text-secondary small">On-Time ✅</span>
                        <h4 className="fw-bold mb-0 text-success">{activeStatsOnTime}</h4>
                      </div>
                    </div>
                    <div className="col-4">
                      <div className="p-3 bg-light rounded-3 border-bottom border-warning border-3">
                        <span className="text-secondary small">Late 🕐</span>
                        <h4 className="fw-bold mb-0 text-warning">{activeStatsLate}</h4>
                      </div>
                    </div>
                    <div className="col-4">
                      <div className="p-3 bg-light rounded-3 border-bottom border-danger border-3">
                        <span className="text-secondary small">Absent ❌</span>
                        <h4 className="fw-bold mb-0 text-danger">{activeStatsAbsent}</h4>
                      </div>
                    </div>
                  </div>

                  {/* Gender separation tabs inside Active Roster as requested layout */}
                  <div className="d-flex align-items-center justify-content-between mb-3 border-bottom pb-2">
                    <h6 className="fw-bold mb-0 text-secondary">Roster Grid</h6>
                    <div className="btn-group btn-group-sm">
                      <button 
                        className={`btn ${sessionGenderTab === 'male' ? 'btn-dark' : 'btn-outline-secondary'}`}
                        onClick={() => setSessionGenderTab('male')}
                      >
                        👦 Boys Section
                      </button>
                      <button 
                        className={`btn ${sessionGenderTab === 'female' ? 'btn-dark' : 'btn-outline-secondary'}`}
                        onClick={() => setSessionGenderTab('female')}
                      >
                        👧 Girls Section
                      </button>
                    </div>
                  </div>

                  {/* Search and Sort controls for Active Session Roster */}
                  <div className="row g-2 mb-4 p-2 bg-light border border-slate-200" style={{ borderRadius: '0px' }}>
                    <div className="col-md-7">
                      <div className="input-group input-group-sm">
                        <span className="input-group-text bg-white border-slate-300">🔍</span>
                        <input 
                          type="text" 
                          className="form-control font-monospace" 
                          placeholder="Search matching name or room number (e.g. Sokha, Room 2)..."
                          value={activeSessionSearch}
                          onChange={e => setActiveSessionSearch(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="col-md-5">
                      <div className="input-group input-group-sm">
                        <span className="input-group-text bg-slate-50 text-slate-500 text-xs uppercase tracking-wider font-semibold border-slate-300">Sort By</span>
                        <select 
                          className="form-select font-monospace"
                          value={activeSessionSortBy}
                          onChange={e => setActiveSessionSortBy(e.target.value as any)}
                        >
                          <option value="default">Default Order</option>
                          <option value="name">Alphabetical Student Name</option>
                          <option value="room">Dorm Room Number</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {activeSessionFiltered.length === 0 ? (
                    <p className="text-center text-muted py-4">No active {sessionGenderTab} student logs registered in this session.</p>
                  ) : (
                    <div className="row g-3">
                      {activeSessionFiltered.map((st: any) => {
                        const absentCount = studentsAbsenceHistory[st.student_id] || 0;
                        const hasRedAlert = absentCount >= 3;
                        return (
                          <div className="col-md-6" key={st.student_id}>
                            <div className={`card ${hasRedAlert ? 'border-danger border-2 bg-danger-subtle' : 'bg-light'} p-3 rounded-3 shadow-xs h-100`}>
                              <div className="d-flex justify-content-between align-items-start mb-2">
                                <div>
                                  <h6 className="fw-bold mb-0 text-dark">
                                    {st.student_username} - {st.first_name || 'Incomplete Profile'} {st.last_name || ''}
                                  </h6>
                                  <span className="badge bg-secondary font-monospace small">{st.room_label}</span>
                                  {hasRedAlert && (
                                    <span className="badge bg-danger ms-1 fw-bold text-white">⚠️ READY TO BE FIRED ({absentCount} abs)</span>
                                  )}
                                </div>
                                <span className={`badge ${
                                  st.status === 'on_time' ? 'bg-success text-white' :
                                  st.status === 'late' ? 'bg-warning text-dark' :
                                  'bg-danger text-white'
                                }`}>
                                  {st.status.toUpperCase()}
                                </span>
                              </div>

                              <div className="d-flex flex-wrap gap-2 mt-2 pt-2 border-top">
                                {st.status === 'absent' ? (
                                  <button 
                                    className="btn btn-success btn-sm w-100 fw-bold"
                                    onClick={() => handleMarkPresent(st.attendance_id, st.student_username)}
                                  >
                                    🔔 Mark Present
                                  </button>
                                ) : (
                                  <div className="btn-group btn-group-sm w-100">
                                    <button 
                                      className="btn btn-outline-success fw-bold"
                                      disabled={st.status === 'on_time'}
                                      onClick={() => handleOverrideAttendance(st.attendance_id, 'on_time', st.student_username)}
                                    >
                                      On-Time
                                    </button>
                                    <button 
                                      className="btn btn-outline-warning fw-bold text-dark"
                                      disabled={st.status === 'late'}
                                      onClick={() => handleOverrideAttendance(st.attendance_id, 'late', st.student_username)}
                                    >
                                      Late
                                    </button>
                                    <button 
                                      className="btn btn-outline-danger fw-bold"
                                      onClick={() => handleOverrideAttendance(st.attendance_id, 'absent', st.student_username)}
                                    >
                                      Undo/Absent
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                </div>
              </div>
            ) : (
              <div className="card border-0 shadow-sm rounded-4 text-center py-5 px-4 bg-white">
                <div className="py-2">
                  <span className="fs-1">⚠️</span>
                  <h4 className="fw-bold text-dark mt-3">No Active Meeting Running</h4>
                  <p className="text-secondary max-w-lg mx-auto">Create a monthly meeting session below. This authorizes room snapshots, absent flags generation, and student logs tracking.</p>
                  
                  <div className="input-group max-w-md mx-auto mt-4" style={{ maxWidth: '400px' }}>
                    <input 
                      type="text" 
                      className="form-control" 
                      placeholder="e.g. June Meeting 2026"
                      value={sessionTitleInput}
                      onChange={e => setSessionTitleInput(e.target.value)}
                    />
                    <button className="btn btn-dark fw-bold text-white" onClick={handleCreateSession}>
                      Start Session
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Guidelines Sidebar helper */}
          <div className="col-12 col-lg-4">
            <div className="card border-0 shadow-sm rounded-4 bg-white p-4">
              <h5 className="fw-bold text-dark mb-3">🚀 Gate Check Workflow</h5>
              <ol className="text-secondary small ps-3 mb-0">
                <li className="mb-2">Click <strong>Start Session</strong> to generate snapshots of active roommates.</li>
                <li className="mb-2">Students walk to gate and announce their arrival.</li>
                <li className="mb-2">Browse the student under Male/Female Section, then click <strong>Mark Present</strong>.</li>
                <li className="mb-2">System auto-compares with creation timestamp (15 minutes cut-off defines On-Time vs Late).</li>
                <li className="mb-2">Click <strong>End Session</strong> manually when meeting is complete. All unpresented members are marked absent automatically with notification warnings!</li>
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* 2. RESIDENTS CARD REGISTRY (CRUD) */}
      {activeTab === 'students' && (
        <div>
          {/* Toolbar and filter menu */}
          <div className="card border-0 shadow-sm rounded-4 bg-white p-4 mb-4">
            <div className="row g-3 align-items-center">
              <div className="col-md-3">
                <label className="form-label text-muted small fw-medium">Search Resident Name</label>
                <input 
                  type="text" 
                  className="form-control" 
                  placeholder="e.g. Sokha" 
                  value={studentSearch}
                  onChange={e => setStudentSearch(e.target.value)}
                />
              </div>
              <div className="col-md-2">
                <label className="form-label text-muted small fw-medium">Filter Gender</label>
                <select className="form-select" value={studentGenderTab} onChange={e => setStudentGenderTab(e.target.value as any)}>
                  <option value="all">Both (Boys & Girls)</option>
                  <option value="male">Boys Only (BFxxx)</option>
                  <option value="female">Girls Only (GFxxx)</option>
                </select>
              </div>
              <div className="col-md-2">
                <label className="form-label text-muted small fw-medium">Room Assigned Unit</label>
                <select className="form-select" value={selectedRoomFilter} onChange={e => setSelectedRoomFilter(e.target.value)}>
                  <option value="all">All Rooms</option>
                  {rooms.map(r => (
                    <option key={r.id} value={r.id}>{r.room_label}</option>
                  ))}
                </select>
              </div>
              <div className="col-md-2">
                <label className="form-label text-muted small fw-medium">Sort Order</label>
                <select className="form-select" value={studentSortBy} onChange={e => setStudentSortBy(e.target.value as any)}>
                  <option value="none">No Sorting</option>
                  <option value="absent">Absences Count (Desc)</option>
                </select>
              </div>
              <div className="col-md-3 text-end d-flex align-items-end justify-content-end pt-3">
                <button 
                  className="btn btn-dark w-100 fw-bold text-white d-flex align-items-center justify-content-center gap-1"
                  style={{ borderRadius: '8px' }}
                  data-bs-toggle="modal" 
                  data-bs-target="#createStudentModal"
                >
                  ➕ Create Student (BF/GF)
                </button>
              </div>
            </div>
          </div>

          {/* Student Grid lists */}
          <div className="row g-3">
            {filteredStudents.length === 0 ? (
              <div className="col-12 py-5 text-center text-muted">No students matched constraints. Create student above!</div>
            ) : (
              filteredStudents.map(st => {
                const absentCount = studentsAbsenceHistory[st.id] || 0;
                const hasRedAlert = absentCount >= 3;
                return (
                  <div className="col-xl-3 col-sm-6" key={st.id}>
                    <div className={`card border-0 rounded-4 shadow-sm p-4 h-100 bg-white transition-all position-relative ${
                      hasRedAlert ? 'border border-danger border-2' : ''
                    }`}>
                      {hasRedAlert && (
                        <div className="position-absolute top-0 end-0 bg-danger text-white py-1 px-3 fw-bold rounded-top-end-4 text-xs">
                          🚨 RED ALERT ({absentCount} abs)
                        </div>
                      )}

                      <div className="text-center pb-3 border-bottom mb-3">
                        <div 
                          className="bg-light mx-auto mb-3 rounded-circle d-flex align-items-center justify-content-center border"
                          style={{ width: '80px', height: '80px', overflow: 'hidden' }}
                        >
                          {st.profile_photo ? (
                            <img src={st.profile_photo} alt="Avatar" className="w-100 h-100 object-fit-cover" />
                          ) : (
                            <span className="fs-1">{st.sex === 'female' ? "👧" : "👦"}</span>
                          )}
                        </div>
                        <h5 className="fw-bold mb-0 text-dark">
                          {st.first_name || 'Pending'} {st.last_name || 'Profile'}
                        </h5>
                        <p className="text-secondary small mb-1">{st.username}</p>
                        <span className={`badge ${st.sex === 'female' ? 'bg-danger-subtle text-danger' : 'bg-primary-subtle text-primary'}`}>
                          {st.sex.toUpperCase()}
                        </span>
                        <span className={`badge mx-1 ${st.is_active ? 'bg-success' : 'bg-secondary'}`}>
                          {st.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>

                      {/* Extra metrics */}
                      <div className="small text-secondary mb-3">
                        <div className="d-flex justify-content-between mb-1">
                          <span>Room Unit:</span>
                          <span className="fw-bold text-dark">{st.room_label || 'Unassigned 🏠'}</span>
                        </div>
                        <div className="d-flex justify-content-between mb-1">
                          <span>Absences count:</span>
                          <span className={`${hasRedAlert ? 'text-danger fw-bold' : 'text-dark'}`}>{absentCount} times</span>
                        </div>
                        <div className="d-flex justify-content-between">
                          <span>University:</span>
                          <span className="text-dark-emphasis text-truncate style={{ maxWidth: '120px' }}">{st.university_name || '-'}</span>
                        </div>
                      </div>

                      {/* Controls */}
                      <div className="d-flex gap-2">
                        <button 
                          className="btn btn-sm btn-outline-secondary w-100 fw-bold"
                          onClick={() => setViewingStudent(st)}
                        >
                          Details
                        </button>
                        <button 
                          className="btn btn-sm btn-dark text-white w-100 fw-bold"
                          onClick={() => {
                            setAssigningStudentId(st.id);
                            setSelectedRoomId(st.room_id ? String(st.room_id) : '');
                          }}
                        >
                          Assign Unit
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Dynamic Assign Room Panel Inline Modal */}
          {assigningStudentId && (
            <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1050 }}>
              <div className="modal-dialog modal-dialog-centered">
                <div className="modal-content">
                  <div className="modal-header">
                    <h5 className="modal-title fw-bold">Assign Room Unit</h5>
                    <button className="btn-close" onClick={() => setAssigningStudentId(null)}></button>
                  </div>
                  <div className="modal-body">
                    <p className="small text-secondary">
                      Select room for student: <span className="fw-bold text-dark">
                        {students.find(s => s.id === assigningStudentId)?.username}
                      </span> ({students.find(s => s.id === assigningStudentId)?.sex})
                    </p>
                    
                    <label className="form-label font-medium small">Choose Available Room (Verification Active)</label>
                    <select className="form-select" value={selectedRoomId} onChange={e => setSelectedRoomId(e.target.value)}>
                      <option value="">-- Choose Space --</option>
                      {rooms.map(r => (
                        <option key={r.id} value={r.id}>
                          {r.room_label} - Designated for: {r.gender.toUpperCase()}s (Current occupancy: {r.current_member_count})
                        </option>
                      ))}
                    </select>

                    <p className="small text-muted mt-2">
                      ⚠️ Note: Gender verification checks list automatically. You cannot put boys into girls' rooms or vice-versa!
                    </p>
                  </div>
                  <div className="modal-footer">
                    <button className="btn btn-sm btn-outline-secondary" onClick={() => setAssigningStudentId(null)}>Cancel</button>
                    {students.find(s => s.id === assigningStudentId)?.room_id && (
                      <button 
                        className="btn btn-sm btn-outline-danger me-auto" 
                        onClick={() => {
                          handleRemoveRoomAssignment(assigningStudentId, students.find(s => s.id === assigningStudentId)?.username);
                          setAssigningStudentId(null);
                        }}
                      >
                        Remove Allocation
                      </button>
                    )}
                    <button className="btn btn-sm btn-dark text-white fw-bold" onClick={handleAssignRoom}>Save Assignment</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Student Detailed custom modal viewer */}
          {viewingStudent && (
            <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1055 }}>
              <div className="modal-dialog modal-dialog-centered">
                <div className="modal-content">
                  <div className="modal-header">
                    <h5 className="modal-title fw-bold">Resident ID Detailed Log: {viewingStudent.username}</h5>
                    <button className="btn-close" onClick={() => setViewingStudent(null)}></button>
                  </div>
                  <div className="modal-body p-4">
                    <div className="text-center mb-3">
                      <div className="mx-auto rounded-circle overflow-hidden mb-2 bg-light border" style={{ width: '90px', height: '90px' }}>
                        {viewingStudent.profile_photo ? (
                          <img src={viewingStudent.profile_photo} alt="Student avatar" className="w-100 h-100 object-fit-cover" />
                        ) : (
                          <span className="fs-1 d-block pt-1">{viewingStudent.sex === 'female' ? "👧" : "👦"}</span>
                        )}
                      </div>
                      <h5 className="fw-bold mb-0 text-dark">{viewingStudent.first_name || 'Pending First Name'} {viewingStudent.last_name || 'Pending Last Name'}</h5>
                      <span className="text-muted small">Move-in date: {viewingStudent.move_in_date ? new Date(viewingStudent.move_in_date).toLocaleDateString() : 'Auto-registered'}</span>
                    </div>

                    <div className="table-responsive small">
                      <table className="table table-bordered">
                        <tbody>
                          <tr>
                            <td className="fw-bold bg-light" style={{ width: '40%' }}>Date of Birth</td>
                            <td>{viewingStudent.date_of_birth ? new Date(viewingStudent.date_of_birth).toLocaleDateString() : '-'}</td>
                          </tr>
                          <tr>
                            <td className="fw-bold bg-light">Place of Birth</td>
                            <td>{viewingStudent.place_of_birth || '-'}</td>
                          </tr>
                          <tr>
                            <td className="fw-bold bg-light">University</td>
                            <td>{viewingStudent.university_name || '-'}</td>
                          </tr>
                          <tr>
                            <td className="fw-bold bg-light">Email Address</td>
                            <td>{viewingStudent.email || '-'}</td>
                          </tr>
                          <tr>
                            <td className="fw-bold bg-light">Phone Number</td>
                            <td>{viewingStudent.phone_number || '-'}</td>
                          </tr>
                          <tr>
                            <td className="fw-bold bg-light">Social Media</td>
                            <td>
                              <div className="d-flex align-items-center gap-3 py-1">
                                {viewingStudent.facebook ? (
                                  <a 
                                    href={viewingStudent.facebook} 
                                    target="_blank" 
                                    rel="noopener noreferrer" 
                                    className="btn btn-primary d-inline-flex align-items-center justify-content-center shadow-sm border-0" 
                                    style={{ 
                                      width: '48px', 
                                      height: '48px', 
                                      padding: 0, 
                                      borderRadius: '12px',
                                      background: 'linear-gradient(135deg, #18ACFE 0%, #1573EC 100%)'
                                    }}
                                    title="Facebook Account"
                                    id="visit-facebook-btn"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="white" viewBox="0 0 24 24">
                                      <path d="M9 8H7v3h2v9h4v-9h3.6l.4-3H13V6c0-.5.5-1 1-1h3V1H14c-2.8 0-5 2.2-5 5v2z" />
                                    </svg>
                                  </a>
                                ) : null}
                                {viewingStudent.telegram ? (
                                  <a 
                                    href={viewingStudent.telegram} 
                                    target="_blank" 
                                    rel="noopener noreferrer" 
                                    className="btn text-white d-inline-flex align-items-center justify-content-center shadow-sm border-0" 
                                    style={{ 
                                      width: '48px', 
                                      height: '48px', 
                                      padding: 0, 
                                      borderRadius: '12px',
                                      background: 'linear-gradient(135deg, #37BCF0 0%, #1F92D0 100%)'
                                    }}
                                    title="Telegram Account"
                                    id="visit-telegram-btn"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="white" viewBox="0 0 24 24">
                                      <path d="M20.665 3.717l-17.73 6.837c-1.21.486-1.203 1.161-.222 1.462l4.552 1.42 10.532-6.645c.498-.303.953-.14.579.192l-8.533 7.701-.33 4.955c.485 0 .7-.223.971-.485l2.333-2.27 4.856 3.587c.895.493 1.537.24 1.761-.83l3.185-15.01c.326-1.309-.5-1.905-1.353-1.554z" />
                                    </svg>
                                  </a>
                                ) : null}
                                {!viewingStudent.facebook && !viewingStudent.telegram && (
                                  <span className="text-muted">-</span>
                                )}
                              </div>
                            </td>
                          </tr>
                          <tr>
                            <td className="fw-bold bg-light">Room Unit</td>
                            <td>{viewingStudent.room_label || 'Unassigned'}</td>
                          </tr>
                          <tr>
                            <td className="fw-bold bg-light">Absences count</td>
                            <td className="fw-bold text-danger">{studentsAbsenceHistory[viewingStudent.id] || 0} times absences</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <div className="mt-3 p-3 border rounded bg-light">
                      <h6 className="fw-bold text-dark mb-2 d-flex align-items-center gap-1">
                        🔑 Reset Student Password
                      </h6>
                      <p className="text-muted small mb-3">
                        Enter a new password for this resident to restore access.
                      </p>
                      <div className="input-group">
                        <input
                          type="text"
                          className="form-control form-control-sm font-monospace"
                          placeholder="Enter new password"
                          value={resetPasswordInput}
                          onChange={(e) => setResetPasswordInput(e.target.value)}
                          id="student-reset-password-input"
                        />
                        <button
                          className="btn btn-sm btn-dark text-white fw-bold"
                          type="button"
                          onClick={() => handleResetStudentPassword(viewingStudent, resetPasswordInput)}
                          id="student-reset-password-button"
                        >
                          Update Password
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="modal-footer">
                    <button className="btn btn-outline-danger me-auto btn-sm" onClick={() => {
                      handleDeleteStudent(viewingStudent);
                      setViewingStudent(null);
                    }}>Delete Student</button>
                    <button className="btn btn-dark text-white fw-bold btn-sm" onClick={() => setViewingStudent(null)}>Close</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Outer modal to create student */}
          <div className="modal fade" id="createStudentModal" tabIndex={-1} aria-labelledby="createStudentModalLabel" aria-hidden="true">
            <div className="modal-dialog modal-dialog-centered">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title fw-bold" id="createStudentModalLabel">Add New Dorm Student</h5>
                  <button type="button" className="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div className="modal-body p-4">
                  <div className="mb-3">
                    <label className="form-label text-muted small fw-medium">Gender of Student</label>
                    <div className="d-flex gap-3">
                      <div className="form-check">
                        <input className="form-check-input" type="radio" name="sexRadio" id="sexM" checked={newStudentGender === 'male'} onChange={() => setNewStudentGender('male')} />
                        <label className="form-check-label" htmlFor="sexM">👦 Male Student (BFxxx ID generation)</label>
                      </div>
                      <div className="form-check">
                        <input className="form-check-input" type="radio" name="sexRadio" id="sexF" checked={newStudentGender === 'female'} onChange={() => setNewStudentGender('female')} />
                        <label className="form-check-label" htmlFor="sexF">👧 Female Student (GFxxx ID generation)</label>
                      </div>
                    </div>
                  </div>

                  <div className="mb-3">
                    <label className="form-label text-muted small fw-medium">Default Sign-in Password</label>
                    <input 
                      type="text" 
                      className="form-control" 
                      value={newStudentPassword}
                      onChange={e => setNewStudentPassword(e.target.value)}
                    />
                    <p className="text-muted small mt-1">Students sign in using their automatically generated BF/GF sequential ID and this key.</p>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
                  <button type="button" className="btn btn-dark text-white fw-bold" data-bs-dismiss="modal" onClick={handleCreateStudent}>Generate Account</button>
                </div>
              </div>
            </div>
          </div>

        </div>
      )}


      {/* 3. ROOMS MANAGEMENT */}
      {activeTab === 'rooms' && (
        <div className="row g-4">
          <div className="col-12 col-lg-5">
            <div className="card border-0 shadow-sm rounded-4 bg-white p-4">
              <h5 className="fw-bold mb-3">Add Dormitory Room</h5>
              
              <div className="mb-3">
                <label className="form-label text-muted small">Literal Room Label</label>
                <input 
                  type="text" 
                  className="form-control" 
                  placeholder="e.g. Room 5, Room 6" 
                  value={newRoomLabel}
                  onChange={e => setNewRoomLabel(e.target.value)}
                />
              </div>

              <div className="mb-4">
                <label className="form-label text-muted small">Designated Member Sex</label>
                <select className="form-select" value={newRoomGender} onChange={e => setNewRoomGender(e.target.value as any)}>
                  <option value="male">Boys designates Only</option>
                  <option value="female">Girls designates Only</option>
                </select>
              </div>

              <button className="btn btn-dark text-white w-100 fw-bold" onClick={handleCreateRoom}>
                Create Designated Room
              </button>
            </div>
          </div>

          <div className="col-12 col-lg-7">
            <div className="card border-0 shadow-sm rounded-4 bg-white p-4">
              <h5 className="fw-bold text-dark mb-3">Dorm Rooms Occupancy & Status</h5>
              <div className="table-responsive">
                <table className="table table-hover align-middle mb-0">
                  <thead className="table-light">
                    <tr>
                      <th>Room Label</th>
                      <th>Designation</th>
                      <th>Current Occupancy</th>
                      <th className="text-end">Controls</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rooms.map(r => (
                      <tr key={r.id}>
                        <td><span className="fw-bold fs-6 text-dark">{r.room_label}</span></td>
                        <td>
                          <span className={`badge ${r.gender === 'female' ? 'bg-danger-subtle text-danger' : 'bg-primary-subtle text-primary'}`}>
                            {r.gender.toUpperCase()}S ONLY
                          </span>
                        </td>
                        <td>
                          <span className="text-dark fw-semibold">{r.current_member_count || 0} residents checked in</span>
                        </td>
                        <td className="text-end">
                          <button 
                            className="btn btn-sm btn-outline-danger" 
                            disabled={(r.current_member_count || 0) > 0}
                            title="Rooms must be completely empty to delete"
                            onClick={() => handleDeleteRoom(r)}
                          >
                            Delete empty room
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}


      {/* 4. APPLICATIONS ENGAGEMENT (EXCUSES AND MOVEOUTS) */}
      {activeTab === 'requests' && (
        <div className="row g-4">
          <div className="col-12 d-flex flex-wrap gap-2 justify-content-end">
            <button className="btn btn-outline-danger btn-sm rounded-3 fw-bold" onClick={handlePruneMoveouts} id="btn-prune-moveouts">
              🧹 Prune old resolved Move-outs (&gt; 1 month)
            </button>
            <button className="btn btn-danger btn-sm rounded-3 fw-bold text-white d-inline-flex align-items-center gap-1" onClick={handleClearAllLateAbsent} id="btn-purge-excuses">
              💥 Purge All Excuse Requests
            </button>
            <button className="btn btn-danger btn-sm rounded-3 fw-bold text-white d-inline-flex align-items-center gap-1" onClick={handleClearAllMoveouts} id="btn-purge-moveouts">
              💥 Purge All Move-Out Notices
            </button>
          </div>

          <div className="col-12 col-lg-6">
            <div className="card border-0 shadow-sm rounded-4 bg-white p-4">
              <h5 className="fw-bold text-dark mb-3">✉️ Late / Absent Illness Excuses</h5>
              <p className="text-muted small">Excuse requests are submitted by absent students within 1 day of a finished session.</p>

              {excuses.length === 0 ? (
                <p className="text-center text-muted py-4">No excuse applications submitted.</p>
              ) : (
                excuses.map(ex => (
                  <div key={ex.id} className="p-3 mb-3 border rounded-3 bg-light-subtle position-relative">
                    <span className={`position-absolute top-3 end-3 badge ${
                      ex.status === 'approved' ? 'bg-success' :
                      ex.status === 'denied' ? 'bg-danger' : 'bg-warning text-dark'
                    }`}>
                      {ex.status.toUpperCase()}
                    </span>

                    <h6 className="fw-bold mb-1 text-dark">
                      Student: {ex.student_username} ({ex.first_name || 'Incomplete Profile'})
                    </h6>
                    <span className="badge bg-secondary mb-2 small">{ex.session_title}</span>
                    <p className="mb-2 text-dark small bg-white p-2 rounded border">{ex.reason}</p>
                    
                    <div className="d-flex justify-content-between align-items-center text-secondary small">
                      <span>Submitted: {new Date(ex.submitted_at).toLocaleDateString()}</span>
                      {ex.status === 'pending' && (
                        <div className="d-flex gap-1">
                          <button className="btn btn-xs btn-success text-white py-1 px-3 fs-9" onClick={() => handleReviewExcuse(ex.id, 'approved')}>
                            Approve
                          </button>
                          <button className="btn btn-xs btn-danger text-white py-1 px-3 fs-9" onClick={() => handleReviewExcuse(ex.id, 'denied')}>
                            Deny
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="col-12 col-lg-6">
            <div className="card border-0 shadow-sm rounded-4 bg-white p-4">
              <h5 className="fw-bold text-dark mb-3">🚪 Move-Out Applications</h5>
              <p className="text-muted small">Students request room move-outs. Approved notices automatically evict students and archive their profiles.</p>

              {moveOuts.length === 0 ? (
                <p className="text-center text-muted py-4">No move-out applications received.</p>
              ) : (
                moveOuts.map(mo => (
                  <div key={mo.id} className="p-3 mb-3 border rounded-3 bg-light-subtle position-relative">
                    <span className={`position-absolute top-3 end-3 badge ${
                      mo.status === 'approved' ? 'bg-success' :
                      mo.status === 'denied' ? 'bg-danger' : 'bg-warning text-dark'
                    }`}>
                      {mo.status.toUpperCase()}
                    </span>

                    <h6 className="fw-bold mb-1 text-dark">
                      Student: {mo.student_username} ({mo.first_name || 'Incomplete Profile'})
                    </h6>
                    <p className="small text-secondary mb-2">Requested move out date: {new Date(mo.requested_move_out_date).toLocaleDateString()}</p>
                    <p className="mb-2 text-dark small bg-white p-2 rounded border">{mo.reason}</p>
                    
                    <div className="d-flex justify-content-between align-items-center text-secondary small">
                      <span>Submitted: {new Date(mo.submitted_at).toLocaleDateString()}</span>
                      {mo.status === 'pending' && (
                        <div className="d-flex gap-1">
                          <button className="btn btn-xs btn-success text-white py-1 px-3 fs-9" onClick={() => handleReviewMoveout(mo.id, mo.student_username || '', 'approved')}>
                            Approve & Evict
                          </button>
                          <button className="btn btn-xs btn-danger text-white py-1 px-3 fs-9" onClick={() => handleReviewMoveout(mo.id, mo.student_username || '', 'denied')}>
                            Deny
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


      {/* 5. HISTORICAL RETRIEVAL AND CHARTS */}
      {activeTab === 'history' && (
        <div className="card border-0 shadow-sm rounded-4 bg-white p-4">
          <div className="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-2 border-bottom pb-3">
            <div>
              <h5 className="fw-bold mb-0">Meeting Logs Analytics & Archives</h5>
              <p className="text-muted small mb-0">Check historical attendance metrics with interactive chart summaries.</p>
            </div>
            
            {/* Year & Month filter as requested */}
            <div className="d-flex gap-2">
              <select className="form-select form-select-sm" value={historyYearFilter} onChange={e => setHistoryYearFilter(e.target.value)}>
                <option value="all">All Years</option>
                {uniqueYears.map(y => (
                  <option key={y} value={String(y)}>{y}</option>
                ))}
              </select>
              <select className="form-select form-select-sm" value={historyMonthFilter} onChange={e => setHistoryMonthFilter(e.target.value)}>
                <option value="all">All Months</option>
                {uniqueMonths.map(m => (
                  <option key={m} value={String(m)}>Month {m}</option>
                ))}
              </select>
              <button 
                className="btn btn-sm btn-dark fw-bold px-3 d-flex align-items-center gap-1 text-nowrap"
                onClick={handleExportMonthlyPDF}
              >
                🖨️ Export Monthly PDF
              </button>
            </div>
          </div>

          <div className="row g-4">
            <div className="col-12 col-lg-6">
              <h6 className="fw-bold text-center text-secondary mb-3">Attendance Session Trends</h6>
              {chartData.length === 0 ? (
                <div className="text-center py-5 text-muted small">No data segments found for trends.</div>
              ) : (
                <div style={{ width: '100%', height: 300 }}>
                  <ResponsiveContainer>
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="On Time" fill="#198754" />
                      <Bar dataKey="Late" fill="#ffc107" />
                      <Bar dataKey="Absent" fill="#dc3545" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="col-12 col-lg-6">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <h6 className="fw-bold text-secondary mb-0">Archived Sessions</h6>
                <button 
                  className="btn btn-sm btn-outline-dark fw-bold px-3"
                  onClick={() => {
                    setHistSessionTitle('');
                    setHistSessionDate(new Date().toISOString().split('T')[0]);
                    setCreateHistoricalOpen(true);
                  }}
                >
                  💡 Record Historical Session
                </button>
              </div>

              <div className="table-responsive">
                <table className="table table-bordered table-hover align-middle mb-0">
                  <thead className="table-light">
                    <tr>
                      <th>Title</th>
                      <th>Date</th>
                      <th className="text-center text-success">On-Time</th>
                      <th className="text-center text-warning">Late</th>
                      <th className="text-center text-danger">Absent</th>
                      <th className="text-center text-secondary">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHistory.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center text-muted py-3">No historical database matches.</td>
                      </tr>
                    ) : (
                      filteredHistory.map(h => (
                        <tr 
                          key={h.id} 
                          onClick={() => handleViewHistoricalSession(h)}
                          title="Click to Edit Session or Adjust Student Roster"
                          style={{ cursor: "pointer" }}
                        >
                          <td>
                            <div className="d-flex align-items-center gap-1">
                              <span className="fw-bold text-dark">{h.title}</span>
                            </div>
                          </td>
                          <td><span className="text-secondary small">{new Date(h.started_at).toLocaleDateString()}</span></td>
                          <td className="text-center text-success fw-bold">{h.count_on_time}</td>
                          <td className="text-center text-warning fw-bold">{h.count_late}</td>
                          <td className="text-center text-danger fw-bold">{h.count_absent}</td>
                          <td className="text-center">
                            <span className="btn btn-xs btn-outline-secondary py-0 px-2 text-uppercase fw-bold text-center align-middle" style={{ fontSize: '10px' }}>
                              Edit ⚙️
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <p className="small text-muted mt-2">
                * Note: Click any historical session row to edit its title/date, delete the record completely, or override checklist markers for attendee profiles.
              </p>
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

      {/* --- GENDER MISMATCH popup MODAL --- */}
      {genderMismatchOpen && (
        <div className="modal fade show d-block" tabIndex={-1} style={{ background: "rgba(0,0,0,0.6)", zIndex: 1100 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content border border-danger rounded-0 shadow">
              <div className="modal-header bg-danger text-white rounded-0">
                <h5 className="modal-title font-light tracking-wide uppercase" style={{ fontSize: "15px" }}>
                  🛑 Gender Allocation Blocked
                </h5>
                <button type="button" className="btn-close btn-close-white" onClick={() => setGenderMismatchOpen(false)}></button>
              </div>
              <div className="modal-body p-4 text-center">
                <div style={{ fontSize: "3rem" }} className="mb-2">⚠️</div>
                <h6 className="fw-bold text-dark text-uppercase tracking-wider mb-3">Room Assignment Safeguard</h6>
                
                <p className="small text-muted mb-4">
                  You requested to assign student <strong>{genderMismatchDetails.studentName}</strong> ({genderMismatchDetails.studentSex.toUpperCase()}) into <strong>{genderMismatchDetails.roomLabel}</strong>, which is designated exclusively for <strong>{genderMismatchDetails.roomGender.toUpperCase()}S</strong>.
                </p>

                <div className="alert alert-danger rounded-0 text-start mb-0" style={{ fontSize: "11.5px" }}>
                  <strong>Policy Restriction Notice:</strong> To maintain dormitory safety, security regulations, and standard roommate compliance, boys cannot be assigned to girls' rooms or girls to boys' rooms.
                </div>
              </div>
              <div className="modal-footer bg-light rounded-0 justify-content-center">
                <button type="button" className="btn btn-secondary rounded-0 btn-sm text-uppercase fw-bold px-4" onClick={() => setGenderMismatchOpen(false)}>
                  I Understand / Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- CREATE HISTORICAL SESSION MODAL --- */}
      {createHistoricalOpen && (
        <div className="modal fade show d-block" tabIndex={-1} style={{ background: "rgba(0,0,0,0.6)", zIndex: 1050 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content border border-slate-800 rounded-0 shadow">
              <div className="modal-header bg-dark text-white rounded-0">
                <h5 className="modal-title font-light tracking-wide uppercase" style={{ fontSize: "15px" }}>
                  Record Offline Historical Session
                </h5>
                <button type="button" className="btn-close btn-close-white" onClick={() => setCreateHistoricalOpen(false)}></button>
              </div>
              <div className="modal-body p-4">
                <p className="small text-muted mb-4">
                  Manual offline registration will create a new inactive historical session on the designated date and pre-populate the attendance roster with all currently registered students initialized as <strong>absent</strong>. You can then change their check-in state manually.
                </p>
                <div className="mb-3">
                  <label className="form-label font-monospace text-uppercase small text-secondary">Session Title / Event Name</label>
                  <input 
                    type="text" 
                    className="form-control rounded-0" 
                    placeholder="e.g. June Monthly General Assemblies"
                    value={histSessionTitle}
                    onChange={(e) => setHistSessionTitle(e.target.value)}
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label font-monospace text-uppercase small text-secondary">Calendar Date Held</label>
                  <input 
                    type="date" 
                    className="form-control rounded-0" 
                    value={histSessionDate}
                    onChange={(e) => setHistSessionDate(e.target.value)}
                  />
                </div>
              </div>
              <div className="modal-footer bg-light rounded-0">
                <button type="button" className="btn btn-outline-secondary rounded-0 btn-sm text-uppercase fw-bold" onClick={() => setCreateHistoricalOpen(false)}>
                  Cancel
                </button>
                <button type="button" className="btn btn-dark rounded-0 btn-sm text-uppercase fw-bold px-3" onClick={handleCreateHistoricalSession}>
                  Save Record
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- VIEWING & EDITING HISTORICAL ROSTER DETAILS MODAL --- */}
      {viewingHistSession && (
        <div className="modal fade show d-block" tabIndex={-1} style={{ background: "rgba(0,0,0,0.6)", zIndex: 1050, overflowY: "auto" }}>
          <div className="modal-dialog modal-lg modal-dialog-centered">
            <div className="modal-content border border-slate-800 rounded-0 shadow">
              <div className="modal-header bg-dark text-white rounded-0">
                <h5 className="modal-title font-light tracking-wide uppercase" style={{ fontSize: "15px" }}>
                  📝 Historical Session Logs: ID {viewingHistSession.id}
                </h5>
                <button type="button" className="btn-close btn-close-white" onClick={() => setViewingHistSession(null)}></button>
              </div>
              <div className="modal-body p-4">
                {/* Section A: Session Metadata Editing */}
                <div className="card rounded-0 mb-4 bg-light border border-slate-200">
                  <div className="card-header bg-secondary bg-opacity-10 py-2">
                    <span className="font-monospace text-uppercase small text-secondary fw-bold">Update Session Metadata</span>
                  </div>
                  <div className="card-body p-3">
                    <div className="row g-3">
                      <div className="col-md-6">
                        <label className="form-label font-monospace text-uppercase small text-secondary" style={{ fontSize: '11px' }}>Session Title</label>
                        <input 
                          type="text" 
                          className="form-control form-control-sm rounded-0" 
                          value={editHistTitle} 
                          onChange={(e) => setEditHistTitle(e.target.value)} 
                        />
                      </div>
                      <div className="col-md-4">
                        <label className="form-label font-monospace text-uppercase small text-secondary" style={{ fontSize: '11px' }}>Calendar Date</label>
                        <input 
                          type="date" 
                          className="form-control form-control-sm rounded-0" 
                          value={editHistDate} 
                          onChange={(e) => setEditHistDate(e.target.value)} 
                        />
                      </div>
                      <div className="col-md-2 d-flex align-items-end">
                        <button 
                          type="button" 
                          className="btn btn-sm btn-dark w-full rounded-0 text-uppercase fw-bold"
                          style={{ fontSize: "11px", height: "31px" }}
                          onClick={handleUpdateHistoricalMetadata}
                          disabled={isUpdatingHist}
                        >
                          {isUpdatingHist ? "Saving..." : "Update"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section B: Attendance Roster Logs Management */}
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <h6 className="fw-bold text-dark text-uppercase small tracking-wider mb-0">Student Check-in Roster State ({histRoster.length} students)</h6>
                  <span className="badge bg-secondary font-monospace tracking-wide text-uppercase" style={{ fontSize: '10px' }}>Historical Database View</span>
                </div>

                <div className="table-responsive border border-slate-200" style={{ maxHeight: "300px", overflowY: "auto" }}>
                  <table className="table table-sm table-striped table-hover align-middle mb-0" style={{ fontSize: '12.5px' }}>
                    <thead className="table-dark sticky-top">
                      <tr>
                        <th>Student Name</th>
                        <th>Sex</th>
                        <th>Room</th>
                        <th className="text-center">Status Marker</th>
                        <th className="text-center">Action Options</th>
                      </tr>
                    </thead>
                    <tbody>
                      {histRoster.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="text-center text-muted py-3">No student records registered for this historical session.</td>
                        </tr>
                      ) : (
                        histRoster.map((r: any) => (
                          <tr key={r.attendance_id}>
                            <td>
                              <span className="fw-bold">{r.first_name} {r.last_name}</span>
                              <div className="text-muted font-monospace" style={{ fontSize: '10px' }}>@{r.student_username}</div>
                            </td>
                            <td>
                              <span className="badge bg-secondary-subtle text-dark border border-secondary border-opacity-25 text-uppercase" style={{ fontSize: '10px' }}>
                                {r.sex}
                              </span>
                            </td>
                            <td>
                              <span className="badge bg-light text-dark border border-secondary border-opacity-25 font-monospace">{r.room_label}</span>
                            </td>
                            <td className="text-center">
                              <span className={`badge uppercase tracking-wider ${
                                r.status === 'present' || r.status === 'on-time' ? 'bg-success' :
                                r.status === 'late' ? 'bg-warning text-dark' : 'bg-danger'
                              }`} style={{ fontSize: '10.5px' }}>
                                {r.status}
                              </span>
                            </td>
                            <td className="text-center">
                              <div className="d-flex align-items-center justify-content-center gap-1">
                                <button 
                                  className="btn btn-xs btn-outline-success font-semibold px-2"
                                  style={{ fontSize: "10.5px", padding: "1px 4px" }}
                                  onClick={() => handleOverrideHistoricalAttendance(r.attendance_id, "on-time")}
                                >
                                  Present
                                </button>
                                <button 
                                  className="btn btn-xs btn-outline-warning font-semibold px-2 text-dark"
                                  style={{ fontSize: "10.5px", padding: "1px 4px" }}
                                  onClick={() => handleOverrideHistoricalAttendance(r.attendance_id, "late")}
                                >
                                  Late
                                </button>
                                <button 
                                  className="btn btn-xs btn-outline-danger font-semibold px-2"
                                  style={{ fontSize: "10.5px", padding: "1px 4px" }}
                                  onClick={() => handleOverrideHistoricalAttendance(r.attendance_id, "absent")}
                                >
                                  Absent
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="modal-footer bg-light d-flex justify-content-between rounded-0">
                <button 
                  type="button" 
                  className="btn btn-sm btn-outline-danger rounded-0 text-uppercase fw-bold"
                  onClick={() => handleDeleteHistoricalSession(viewingHistSession.id)}
                >
                  🗑️ Purge/Delete Session
                </button>
                <div className="d-flex gap-2">
                  <button 
                    type="button" 
                    className="btn btn-dark rounded-0 btn-sm text-uppercase fw-bold px-3 d-flex align-items-center gap-1"
                    onClick={() => handleExportDailyPDF(viewingHistSession, histRoster)}
                  >
                    🖨️ Export PDF (Daily)
                  </button>
                  <button 
                    type="button" 
                    className="btn btn-secondary rounded-0 btn-sm text-uppercase fw-bold px-4" 
                    onClick={() => setViewingHistSession(null)}
                  >
                    Close Panel
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <LoadingOverlay isOpen={(loading && isFirstLoad) || submitting} message={(loading && isFirstLoad) ? "Synchronizing database records..." : "Processing request..."} />

      {/* --- OFFLINE/ONLINE PRINTER FRIENDLY REPORT DESIGN --- */}
      {printData && createPortal(
        <div className="print-report-layout" style={{ color: 'black', background: 'white' }}>
          {/* Cover Header */}
          <div style={{ textAlign: 'center', marginBottom: '30px', fontFamily: 'serif' }}>
            <h3 className="print-title" style={{ fontWeight: 'bold', fontSize: '16pt', margin: '15px 0 5px 0' }}>{printData.title}</h3>
            <p className="print-subtitle" style={{ fontSize: '10.5pt', fontStyle: 'italic', margin: '0 0 20px 0' }}>{printData.subtitle}</p>
          </div>

          {/* Stats Segment */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '25px', fontSize: '9.5pt', fontFamily: 'serif', borderBottom: '1.5px solid #000', paddingBottom: '15px' }}>
            <div>
              <strong>Report Generated On:</strong> {new Date().toLocaleDateString()}<br />
              <strong>Authorized Custodian:</strong> Administrative Portal ({username})<br />
              <strong>Sync Connection Indicator:</strong> {dbMode === 'Local SQLite-like File Fallback' ? 'Local Fallback' : 'Primary Cloud DB'}<br />
            </div>
            <div style={{ textAlign: 'right' }}>
              {Object.entries(printData.metadata).map(([key, val]) => (
                <div key={key}>
                  <strong>{key}:</strong> {val}
                </div>
              ))}
            </div>
          </div>

          {/* Record Logs Log List */}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9.5pt', fontFamily: 'serif', marginTop: '15px' }}>
            <thead>
              {printData.type === 'daily' ? (
                <tr>
                  <th style={{ border: '1.5px solid black', padding: '8px', fontWeight: 'bold', backgroundColor: '#f2f2f2', textAlign: 'left', fontSize: '9.5pt' }}>No.</th>
                  <th style={{ border: '1.5px solid black', padding: '8px', fontWeight: 'bold', backgroundColor: '#f2f2f2', textAlign: 'left', fontSize: '9.5pt' }}>Student Name</th>
                  <th style={{ border: '1.5px solid black', padding: '8px', fontWeight: 'bold', backgroundColor: '#f2f2f2', textAlign: 'left', fontSize: '9.5pt' }}>Gender</th>
                  <th style={{ border: '1.5px solid black', padding: '8px', fontWeight: 'bold', backgroundColor: '#f2f2f2', textAlign: 'left', fontSize: '9.5pt' }}>Room Assignment</th>
                  <th style={{ border: '1.5px solid black', padding: '8px', fontWeight: 'bold', backgroundColor: '#f2f2f2', textAlign: 'left', fontSize: '9.5pt' }}>Attendance Status</th>
                  <th style={{ border: '1.5px solid black', padding: '8px', fontWeight: 'bold', backgroundColor: '#f2f2f2', textAlign: 'left', fontSize: '9.5pt' }}>Marked At</th>
                  <th style={{ border: '1.5px solid black', padding: '8px', fontWeight: 'bold', backgroundColor: '#f2f2f2', textAlign: 'left', fontSize: '9.5pt', width: '120px' }}>Roster Signature</th>
                </tr>
              ) : (
                <tr>
                  <th style={{ border: '1.5px solid black', padding: '8px', fontWeight: 'bold', backgroundColor: '#f2f2f2', textAlign: 'left', fontSize: '9.5pt' }}>No.</th>
                  <th style={{ border: '1.5px solid black', padding: '8px', fontWeight: 'bold', backgroundColor: '#f2f2f2', textAlign: 'left', fontSize: '9.5pt' }}>Student Name</th>
                  <th style={{ border: '1.5px solid black', padding: '8px', fontWeight: 'bold', backgroundColor: '#f2f2f2', textAlign: 'left', fontSize: '9.5pt' }}>Gender</th>
                  <th style={{ border: '1.5px solid black', padding: '8px', fontWeight: 'bold', backgroundColor: '#f2f2f2', textAlign: 'left', fontSize: '9.5pt' }}>Room Unit</th>
                  <th style={{ border: '1.5px solid black', padding: '8px', fontWeight: 'bold', backgroundColor: '#f2f2f2', textAlign: 'center', fontSize: '9.5pt' }}>Total Sessions</th>
                  <th style={{ border: '1.5px solid black', padding: '8px', fontWeight: 'bold', backgroundColor: '#f2f2f2', textAlign: 'center', fontSize: '9.5pt', color: '#1a7f37' }}>On-Time</th>
                  <th style={{ border: '1.5px solid black', padding: '8px', fontWeight: 'bold', backgroundColor: '#f2f2f2', textAlign: 'center', fontSize: '9.5pt', color: '#bc6d00' }}>Late</th>
                  <th style={{ border: '1.5px solid black', padding: '8px', fontWeight: 'bold', backgroundColor: '#f2f2f2', textAlign: 'center', fontSize: '9.5pt', color: '#cf222e' }}>Absent</th>
                  <th style={{ border: '1.5px solid black', padding: '8px', fontWeight: 'bold', backgroundColor: '#f2f2f2', textAlign: 'left', fontSize: '9.5pt', width: '130px' }}>Evaluation Flag</th>
                </tr>
              )}
            </thead>
            <tbody>
              {printData.roster.map((row: any, idx: number) => (
                printData.type === 'daily' ? (
                  <tr key={row.attendance_id || idx} style={{ pageBreakInside: 'avoid' }}>
                    <td style={{ border: '1px solid black', padding: '7px', fontSize: '9pt' }}>{idx + 1}</td>
                    <td style={{ border: '1px solid black', padding: '7px', fontWeight: 'bold', fontSize: '9pt' }}>{row.first_name} {row.last_name}</td>
                    <td style={{ border: '1px solid black', padding: '7px', textTransform: 'capitalize', fontSize: '9pt' }}>{row.sex}</td>
                    <td style={{ border: '1px solid black', padding: '7px', fontSize: '9pt' }}>{row.room_label}</td>
                    <td style={{ 
                      border: '1px solid black', 
                      padding: '7px', 
                      fontSize: '9pt',
                      fontWeight: 'bold',
                      color: row.status === 'absent' ? '#cf222e' : row.status === 'late' ? '#bc6d00' : '#1a7f37'
                    }}>
                      {row.status.toUpperCase()}
                    </td>
                    <td style={{ border: '1px solid black', padding: '7px', fontSize: '9pt' }}>
                      {row.marked_at ? new Date(row.marked_at).toLocaleString() : '-'}
                    </td>
                    <td style={{ border: '1px solid black', padding: '7px' }}></td>
                  </tr>
                ) : (
                  <tr key={row.student_id || idx} style={{ pageBreakInside: 'avoid' }}>
                    <td style={{ border: '1px solid black', padding: '7px', fontSize: '9pt' }}>{idx + 1}</td>
                    <td style={{ border: '1px solid black', padding: '7px', fontWeight: 'bold', fontSize: '9pt' }}>{row.first_name} {row.last_name}</td>
                    <td style={{ border: '1px solid black', padding: '7px', textTransform: 'capitalize', fontSize: '9pt' }}>{row.sex}</td>
                    <td style={{ border: '1px solid black', padding: '7px', fontSize: '9pt' }}>{row.room_label}</td>
                    <td style={{ border: '1px solid black', padding: '7px', textAlign: 'center', fontSize: '9pt' }}>{row.total_meetings}</td>
                    <td style={{ border: '1px solid black', padding: '7px', textAlign: 'center', fontWeight: 'bold', fontSize: '9pt', color: '#1a7f37' }}>{row.on_time_count}</td>
                    <td style={{ border: '1px solid black', padding: '7px', textAlign: 'center', fontWeight: 'bold', fontSize: '9pt', color: '#bc6d00' }}>{row.late_count}</td>
                    <td style={{ border: '1px solid black', padding: '7px', textAlign: 'center', fontWeight: 'bold', fontSize: '9pt', color: '#cf222e' }}>{row.absent_count}</td>
                    <td style={{ border: '1px solid black', padding: '7px', fontSize: '9pt' }}>
                      {row.absent_count >= 3 ? '⚠️ FLAG RED ALERT' : '✅ EXCELLENT STANDING'}
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>


        </div>,
        document.body
      )}


    </div>
  );
}
