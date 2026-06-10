// Shared Types for Dorm Attendance Tracking System

export type UserRole = 'superadmin' | 'admin' | 'student';

export interface User {
  id: number;
  username: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
}

export interface StudentProfile {
  id: number;
  user_id: number;
  username: string; // From User
  first_name: string;
  last_name: string;
  date_of_birth: string;
  place_of_birth: string;
  university_name: string;
  email: string;
  phone_number: string;
  sex: 'male' | 'female';
  profile_photo: string | null; // Cloudinary URL or base64 data
  move_in_date: string; // Asia/Phnom_Penh auto timestamp
  is_archived: boolean;
  archived_at: string | null;
}

export interface Room {
  id: number;
  room_label: string; // "Room 1", "Room 2", etc.
  gender: 'male' | 'female';
  created_at: string;
}

export interface RoomMember {
  id: number;
  student_id: number;
  student_username?: string;
  student_name?: string;
  room_id: number;
  assigned_at: string;
  assigned_by: number;
  assigned_by_name?: string;
}

export interface MeetingSession {
  id: number;
  title: string; // "June Meeting 2026", etc.
  created_by: number;
  created_by_name?: string;
  started_at: string;
  ended_at: string | null;
  is_active: boolean;
  year: number;
  month: number;
}

export interface Attendance {
  id: number;
  session_id: number;
  student_id: number;
  student_username?: string;
  student_name?: string;
  room_id: number;
  room_label?: string;
  sex?: 'male' | 'female';
  status: 'on_time' | 'late' | 'absent';
  marked_at: string | null;
  marked_by: number | null;
  marked_by_name?: string;
  last_edited_by: number | null;
  last_edited_by_name?: string;
  last_edited_at: string | null;
}

export interface LateAbsentRequest {
  id: number;
  student_id: number;
  student_username?: string;
  student_name?: string;
  attendance_id: number;
  session_title?: string;
  reason: string;
  status: 'pending' | 'approved' | 'denied';
  submitted_at: string;
  reviewed_by: number | null;
  reviewed_by_name?: string;
  reviewed_at: string | null;
  is_void: boolean;
}

export interface MoveOutRequest {
  id: number;
  student_id: number;
  student_username?: string;
  student_name?: string;
  reason: string;
  requested_move_out_date: string;
  status: 'pending' | 'approved' | 'denied';
  submitted_at: string;
  reviewed_by: number | null;
  reviewed_by_name?: string;
  reviewed_at: string | null;
  is_deleted: boolean;
  deleted_at: string | null;
}

export interface Notification {
  id: number;
  recipient_id: number;
  type: 'absent' | 'request_submitted' | 'request_reviewed' | 'move_out_submitted' | 'move_out_reviewed';
  message: string;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
  related_id: number | null;
  related_type: string | null;
}

export interface AuditLog {
  id: number;
  performed_by: number;
  performed_by_name: string; // name
  action: string;
  target_type: string;
  target_id: number;
  detail: string;
  performed_at: string;
}
