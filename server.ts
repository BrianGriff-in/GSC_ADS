import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));

// LIVE SYNC REAL-TIME BROADCAST ENGINE (SSE)
interface SSEClient {
  id: number;
  role: string;
  res: any;
}

let sseClients: SSEClient[] = [];

function broadcastLiveUpdate(payload: any) {
  const message = `data: ${JSON.stringify(payload)}\n\n`;
  sseClients.forEach(client => {
    try {
      client.res.write(message);
    } catch (e) {
      // client connection already terminated / broken
    }
  });
}

// Intercept all State Mutation queries to auto-alert clients immediately
app.use((req, res, next) => {
  if (req.path.startsWith("/api/") && req.path !== "/api/live-sync" && ["POST", "PUT", "DELETE"].includes(req.method)) {
    res.on("finish", () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        broadcastLiveUpdate({
          type: "refresh",
          method: req.method,
          path: req.path,
          timestamp: new Date().toISOString()
        });
      }
    });
  }
  next();
});

// SSE Subscription Endpoint
app.get("/api/live-sync", (req, res) => {
  const userId = parseInt(req.query.userId as string) || 0;
  const role = (req.query.role as string) || "";

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.write("retry: 5000\n\n");

  const client: SSEClient = { id: userId, role, res };
  sseClients.push(client);

  // Send successful connection event
  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

  // Heartbeat ping every 12 seconds to prevent Cloud Run/ingress connection timers from dropping the stream
  const pingInterval = setInterval(() => {
    try {
      res.write(`data: ${JSON.stringify({ type: "ping" })}\n\n`);
    } catch (e) {
      // Stream is closed or broken
    }
  }, 12000);

  req.on("close", () => {
    clearInterval(pingInterval);
    sseClients = sseClients.filter(c => c !== client);
    res.end();
  });
});

// DATABASE AND SERVICE ACCESSIBILITY LAYER
// We create a dual-mode engine that connects to Postgres (Supabase) if possible, 
// but falls back gracefully to local file database to guarantee 100% up-time and functional previews.
let pgPool: pg.Pool | null = null;
let useLocalFallback = false;
const FALLBACK_FILE = path.join(process.cwd(), "db_fallback.json");

// Structure of local fallback database
interface LocalDB {
  users: any[];
  student_profiles: any[];
  rooms: any[];
  room_members: any[];
  meeting_sessions: any[];
  attendance: any[];
  late_absent_requests: any[];
  move_out_requests: any[];
  notifications: any[];
  audit_logs: any[];
}

let localData: LocalDB = {
  users: [],
  student_profiles: [],
  rooms: [],
  room_members: [],
  meeting_sessions: [],
  attendance: [],
  late_absent_requests: [],
  move_out_requests: [],
  notifications: [],
  audit_logs: []
};

// Check if PostgreSQL works and can be initialized
const dbUrl = process.env.DATABASE_URL || "postgresql://postgres.otxsamtxmldpfsjnwocq:Hou$&@123we@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres";

async function initDB() {
  console.log("Attempting connection to database on: " + dbUrl.split("@")[1] || dbUrl);
  try {
    pgPool = new pg.Pool({
      connectionString: dbUrl,
      connectionTimeoutMillis: 5000, // Fail fast if blocked by network/firewall
      max: 20,                       // Keep hot connections open inside the pool
      idleTimeoutMillis: 30000,      // Allow hot connections to live for up to 30 seconds
    });
    
    // Testing connection
    const client = await pgPool.connect();
    console.log("Connected to PostgreSQL successfully!");
    
    // Creating tables if they don't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      CREATE TABLE IF NOT EXISTS student_profiles (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL,
        first_name VARCHAR(100) DEFAULT '',
        last_name VARCHAR(100) DEFAULT '',
        date_of_birth DATE,
        place_of_birth VARCHAR(255) DEFAULT '',
        university_name VARCHAR(255) DEFAULT '',
        email VARCHAR(255) DEFAULT '',
        phone_number VARCHAR(100) DEFAULT '',
        sex VARCHAR(20) NOT NULL,
        profile_photo TEXT,
        facebook TEXT,
        telegram TEXT,
        move_in_date TIMESTAMPTZ DEFAULT NOW(),
        is_archived BOOLEAN DEFAULT FALSE,
        archived_at TIMESTAMPTZ
      );
      
      CREATE TABLE IF NOT EXISTS rooms (
        id SERIAL PRIMARY KEY,
        room_label VARCHAR(100) NOT NULL,
        gender VARCHAR(20) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      CREATE TABLE IF NOT EXISTS room_members (
        id SERIAL PRIMARY KEY,
        student_id INT NOT NULL,
        room_id INT NOT NULL,
        assigned_at TIMESTAMPTZ DEFAULT NOW(),
        assigned_by INT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS meeting_sessions (
        id SERIAL PRIMARY KEY,
        title VARCHAR(100) NOT NULL,
        created_by INT NOT NULL,
        started_at TIMESTAMPTZ DEFAULT NOW(),
        ended_at TIMESTAMPTZ,
        is_active BOOLEAN DEFAULT TRUE,
        year INT NOT NULL,
        month INT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS attendance (
        id SERIAL PRIMARY KEY,
        session_id INT NOT NULL,
        student_id INT NOT NULL,
        room_id INT NOT NULL,
        status VARCHAR(20) NOT NULL,
        marked_at TIMESTAMPTZ,
        marked_by INT,
        last_edited_by INT,
        last_edited_at TIMESTAMPTZ
      );
      
      CREATE TABLE IF NOT EXISTS late_absent_requests (
        id SERIAL PRIMARY KEY,
        student_id INT NOT NULL,
        attendance_id INT NOT NULL,
        reason TEXT NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        submitted_at TIMESTAMPTZ DEFAULT NOW(),
        reviewed_by INT,
        reviewed_at TIMESTAMPTZ,
        is_void BOOLEAN DEFAULT FALSE
      );
      
      CREATE TABLE IF NOT EXISTS move_out_requests (
        id SERIAL PRIMARY KEY,
        student_id INT NOT NULL,
        reason TEXT NOT NULL,
        requested_move_out_date DATE NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        submitted_at TIMESTAMPTZ DEFAULT NOW(),
        reviewed_by INT,
        reviewed_at TIMESTAMPTZ,
        is_deleted BOOLEAN DEFAULT FALSE,
        deleted_at TIMESTAMPTZ
      );
      
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        recipient_id INT NOT NULL,
        type VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        read_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        related_id INT,
        related_type VARCHAR(50)
      );
      
      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        performed_by INT NOT NULL,
        action VARCHAR(255) NOT NULL,
        target_type VARCHAR(50) NOT NULL,
        target_id INT NOT NULL,
        detail TEXT NOT NULL,
        performed_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Ensure columns for facebook and telegram exist
    await client.query(`
      ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS facebook TEXT;
      ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS telegram TEXT;
    `);
    
    // Check if initial superadmin exists, else seed
    const resAdmin = await client.query("SELECT * FROM users WHERE username = 'superadmin'");
    if (resAdmin.rowCount === 0) {
      await client.query("INSERT INTO users (username, password, role) VALUES ('superadmin', 'admin123', 'superadmin')");
      await client.query("INSERT INTO users (username, password, role) VALUES ('admin1', 'admin123', 'admin')");
      
      // Seed initial rooms
      await client.query("INSERT INTO rooms (room_label, gender) VALUES ('Room 1', 'male'), ('Room 2', 'male'), ('Room 3', 'female'), ('Room 4', 'female')");
      
      // Seed default students
      const resStudF = await client.query("INSERT INTO users (username, password, role) VALUES ('GF001', 'student123', 'student') RETURNING id");
      const resStudM = await client.query("INSERT INTO users (username, password, role) VALUES ('BF001', 'student123', 'student') RETURNING id");
      
      await client.query(`INSERT INTO student_profiles (user_id, first_name, last_name, university_name, sex, phone_number) VALUES 
        (${resStudF.rows[0].id}, 'Sokha', 'Meas', 'RUPP University', 'female', '012345678'),
        (${resStudM.rows[0].id}, 'Dara', 'Sok', 'ITC University', 'male', '098765432')
      `);
      
      // Auto-assign to rooms
      const resRoom3 = await client.query("SELECT id FROM rooms WHERE room_label = 'Room 3'");
      const resRoom1 = await client.query("SELECT id FROM rooms WHERE room_label = 'Room 1'");
      if (resRoom3.rowCount && resRoom1.rowCount) {
        await client.query(`INSERT INTO room_members (student_id, room_id, assigned_by) VALUES 
          (${resStudF.rows[0].id}, ${resRoom3.rows[0].id}, 1),
          (${resStudM.rows[0].id}, ${resRoom1.rows[0].id}, 1)
        `);
      }
      
      console.log("Database seeded successfully with default accounts!");
    }
    
    client.release();
    
  } catch (err: any) {
    console.error("PostgreSQL connection error:", err.message);
    console.log("Switching to LOCAL JSON FALLBACK file engine...");
    useLocalFallback = true;
    loadLocalData();
  }
}

// LOCAL DATA ASSISTANCE
function loadLocalData() {
  if (fs.existsSync(FALLBACK_FILE)) {
    try {
      const data = fs.readFileSync(FALLBACK_FILE, "utf-8");
      localData = JSON.parse(data);
    } catch (e) {
      console.error("Error reading local DB fallback, resetting.", e);
      resetLocalData();
    }
  } else {
    resetLocalData();
  }
}

function saveLocalData() {
  try {
    fs.writeFileSync(FALLBACK_FILE, JSON.stringify(localData, null, 2), "utf-8");
  } catch (e) {
    console.error("Error saving local DB", e);
  }
}

function resetLocalData() {
  localData = {
    users: [
      { id: 1, username: "superadmin", password: "admin123", role: "superadmin", is_active: true, created_at: new Date().toISOString() },
      { id: 2, username: "admin1", password: "admin123", role: "admin", is_active: true, created_at: new Date().toISOString() },
      { id: 3, username: "GF001", password: "student123", role: "student", is_active: true, created_at: new Date().toISOString() },
      { id: 4, username: "BF001", password: "student123", role: "student", is_active: true, created_at: new Date().toISOString() }
    ],
    student_profiles: [
      { id: 1, user_id: 3, first_name: "Sokha", last_name: "Meas", date_of_birth: "2004-05-12", place_of_birth: "Phnom Penh", university_name: "RUPP University", email: "sokha@gmail.com", phone_number: "012345678", facebook: "https://facebook.com/sokha", telegram: "https://t.me/sokha", sex: "female", profile_photo: null, move_in_date: new Date().toISOString(), is_archived: false, archived_at: null },
      { id: 2, user_id: 4, first_name: "Dara", last_name: "Sok", date_of_birth: "2003-08-22", place_of_birth: "Kandal", university_name: "ITC University", email: "dara@gmail.com", phone_number: "098765432", facebook: "https://facebook.com/dara", telegram: "https://t.me/dara", sex: "male", profile_photo: null, move_in_date: new Date().toISOString(), is_archived: false, archived_at: null }
    ],
    rooms: [
      { id: 1, room_label: "Room 1", gender: "male", created_at: new Date().toISOString() },
      { id: 2, room_label: "Room 2", gender: "male", created_at: new Date().toISOString() },
      { id: 3, room_label: "Room 3", gender: "female", created_at: new Date().toISOString() },
      { id: 4, room_label: "Room 4", gender: "female", created_at: new Date().toISOString() }
    ],
    room_members: [
      { id: 1, student_id: 3, room_id: 3, assigned_at: new Date().toISOString(), assigned_by: 1 },
      { id: 2, student_id: 4, room_id: 1, assigned_at: new Date().toISOString(), assigned_by: 1 }
    ],
    meeting_sessions: [],
    attendance: [],
    late_absent_requests: [],
    move_out_requests: [],
    notifications: [],
    audit_logs: [
      { id: 1, performed_by: 1, action: "SEED_DATA", target_type: "system", target_id: 0, detail: "Seeded system with default data structures", performed_at: new Date().toISOString() }
    ]
  };
  saveLocalData();
}

// GENERAL QUERY ABSTRACTION
async function execQuery(sql: string, params: any[] = []): Promise<any> {
  if (!useLocalFallback && pgPool) {
    try {
      const res = await pgPool.query(sql, params);
      return { rows: res.rows, rowCount: res.rowCount };
    } catch (err: any) {
      console.error("Local PG Query Failed, dynamically falling back", err.message);
      useLocalFallback = true;
      loadLocalData();
    }
  }
  
  // IMPLEMENT LOCAL QUERY ABSTRACTS (MOCKED SUB-FUNCTIONS FOR SYSTEM FLOWS)
  // These mimics behave perfectly when PostgreSQL fails to connect due to GCP Sandboxes restrictions!
  return runMockQuery(sql, params);
}

// Mock query engine mappings to keep everything incredibly reactive!
function runMockQuery(sql: string, params: any[]): any {
  // Simple token matching
  const query = sql.toLowerCase().trim();
  
  if (query.startsWith("select * from users") || query.includes("from users")) {
    const userMatch = query.includes("username =");
    if (userMatch) {
      const uVal = params[0];
      const match = localData.users.find(u => u.username.toLowerCase() === uVal.toLowerCase());
      return { rows: match ? [match] : [], rowCount: match ? 1 : 0 };
    }
    return { rows: localData.users, rowCount: localData.users.length };
  }
  
  if (query.startsWith("insert into users")) {
    const newId = localData.users.length > 0 ? Math.max(...localData.users.map(u => u.id)) + 1 : 1;
    const user = {
      id: newId,
      username: params[0],
      password: params[1],
      role: params[2],
      is_active: true,
      created_at: new Date().toISOString()
    };
    localData.users.push(user);
    saveLocalData();
    return { rows: [user], rowCount: 1 };
  }
  
  return { rows: [], rowCount: 0 };
}


// --- API MIDDLEWARES AND ACTIONS ROUTING ---

// Helper for Audit Logging helper
async function writeAuditLog(performed_by: number, action: string, target_type: string, target_id: number, detail: string) {
  if (!useLocalFallback && pgPool) {
    try {
      await pgPool.query(
        "INSERT INTO audit_logs (performed_by, action, target_type, target_id, detail) VALUES ($1, $2, $3, $4, $5)",
        [performed_by, action, target_type, target_id, detail]
      );
      return;
    } catch (e) {}
  }
  
  const actor = localData.users.find(u => u.id === performed_by);
  const log = {
    id: localData.audit_logs.length + 1,
    performed_by,
    performed_by_name: actor ? actor.username : "Unknown",
    action,
    target_type,
    target_id,
    detail,
    performed_at: new Date().toISOString()
  };
  localData.audit_logs.unshift(log);
  saveLocalData();
}

// Helper to push Notifications
async function makeNotification(recipient_id: number, type: string, message: string, related_id: number | null = null, related_type: string | null = null) {
  if (!useLocalFallback && pgPool) {
    try {
      await pgPool.query(
        "INSERT INTO notifications (recipient_id, type, message, related_id, related_type) VALUES ($1, $2, $3, $4, $5)",
        [recipient_id, type, message, related_id, related_type]
      );
      return;
    } catch (e) {}
  }
  
  const notif = {
    id: localData.notifications.length + 1,
    recipient_id,
    type,
    message,
    is_read: false,
    read_at: null,
    created_at: new Date().toISOString(),
    related_id,
    related_type
  };
  localData.notifications.unshift(notif);
  saveLocalData();
}

// Standard Login Route
app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Missing username or password" });
  }

  if (!useLocalFallback && pgPool) {
    try {
      const dbResult = await pgPool.query("SELECT * FROM users WHERE username = $1", [username]);
      if (dbResult.rowCount === 0) {
        return res.status(401).json({ error: "Invalid username or password" });
      }
      const user = dbResult.rows[0];
      if (user.password !== password) { // Using simple raw passwords as specified in manual login widget flow
        return res.status(401).json({ error: "Invalid username or password" });
      }
      if (!user.is_active) {
        return res.status(403).json({ error: "Your account is deactivated" });
      }
      return res.json({ id: user.id, username: user.username, role: user.role });
    } catch (e) {}
  }

  // Fallback match
  const user = localData.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user || user.password !== password) {
    return res.status(401).json({ error: "Invalid username or password" });
  }
  if (!user.is_active) {
    return res.status(403).json({ error: "Your account is deactivated" });
  }
  return res.json({ id: user.id, username: user.username, role: user.role });
});

// Retrieve custom details for current checking user
app.get("/api/auth/current/:id", async (req, res) => {
  const userId = parseInt(req.params.id);
  if (!useLocalFallback && pgPool) {
    try {
      const userRes = await pgPool.query("SELECT id, username, role, is_active FROM users WHERE id = $1", [userId]);
      if (userRes.rowCount === 0) return res.status(404).json({ error: "User not found" });
      const user = userRes.rows[0];
      
      let profile = null;
      if (user.role === 'student') {
        const profRes = await pgPool.query("SELECT * FROM student_profiles WHERE user_id = $1", [userId]);
        if (profRes.rowCount) profile = profRes.rows[0];
      }
      return res.json({ user, profile });
    } catch (e) {}
  }

  const user = localData.users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: "User not found" });
  
  let profile = null;
  if (user.role === 'student') {
    profile = localData.student_profiles.find(p => p.user_id === userId);
  }
  return res.json({ user: { id: user.id, username: user.username, role: user.role, is_active: user.is_active }, profile });
});

// Check system database mode (To help students/admins observe fallback)
app.get("/api/system/db-status", (req, res) => {
  res.json({
    mode: useLocalFallback ? "Local SQLite-like File Fallback" : "Supabase Cloud PostgreSQL Connection Active",
    filePath: useLocalFallback ? FALLBACK_FILE : null
  });
});

// --- ULTRA FAST CONSOLIDATED SUMMARY APIs ---
app.get("/api/admins/dashboard-summary/:userId", async (req, res) => {
  const userId = parseInt(req.params.userId) || 0;
  const dbMode = {
    mode: useLocalFallback ? "Local SQLite-like File Fallback" : "Supabase Cloud PostgreSQL Connection Active",
    filePath: useLocalFallback ? FALLBACK_FILE : null
  };

  if (!useLocalFallback && pgPool) {
    try {
      const [
        studentsRes,
        roomsRes,
        activeRes,
        excusesRes,
        moveOutsRes,
        historyRes,
        notifRes,
        absenceRes
      ] = await Promise.all([
        pgPool.query(`
          SELECT u.id, u.username, u.is_active, u.created_at,
                 p.first_name, p.last_name, p.date_of_birth, p.place_of_birth,
                 p.university_name, p.email, p.phone_number, p.sex, p.profile_photo, p.move_in_date,
                 p.facebook, p.telegram,
                 p.is_archived, p.archived_at,
                 rm.room_id, r.room_label
          FROM users u
          LEFT JOIN student_profiles p ON u.id = p.user_id
          LEFT JOIN room_members rm ON u.id = rm.student_id
          LEFT JOIN rooms r ON rm.room_id = r.id
          WHERE u.role = 'student'
          ORDER BY u.id DESC
        `),
        pgPool.query(`
          SELECT r.id, r.room_label, r.gender, r.created_at,
                 COUNT(rm.id) as current_member_count
          FROM rooms r
          LEFT JOIN room_members rm ON r.id = rm.room_id
          GROUP BY r.id, r.room_label, r.gender, r.created_at
          ORDER BY r.room_label ASC
        `),
        pgPool.query("SELECT * FROM meeting_sessions WHERE is_active = TRUE"),
        pgPool.query(`
          SELECT la.*, u.username as student_username, p.first_name, p.last_name, s.title as session_title
          FROM late_absent_requests la
          INNER JOIN users u ON la.student_id = u.id
          INNER JOIN student_profiles p ON u.id = p.user_id
          INNER JOIN attendance a ON la.attendance_id = a.id
          INNER JOIN meeting_sessions s ON a.session_id = s.id
          ORDER BY la.submitted_at DESC
        `),
        pgPool.query(`
          SELECT mo.*, u.username as student_username, p.first_name, p.last_name
          FROM move_out_requests mo
          INNER JOIN users u ON mo.student_id = u.id
          INNER JOIN student_profiles p ON u.id = p.user_id
          WHERE mo.is_deleted = FALSE
          ORDER BY mo.submitted_at DESC
        `),
        pgPool.query(`
          SELECT s.id, s.title, s.started_at, s.ended_at, s.year, s.month,
                 COUNT(CASE WHEN a.status = 'on_time' THEN 1 END) as count_on_time,
                 COUNT(CASE WHEN a.status = 'late' THEN 1 END) as count_late,
                 COUNT(CASE WHEN a.status = 'absent' THEN 1 END) as count_absent
          FROM meeting_sessions s
          LEFT JOIN attendance a ON s.id = a.session_id
          GROUP BY s.id, s.title, s.started_at, s.ended_at, s.year, s.month
          ORDER BY s.started_at DESC
        `),
        pgPool.query("SELECT * FROM notifications WHERE recipient_id = $1 ORDER BY created_at DESC", [userId]),
        pgPool.query(`
          SELECT a.student_id, COUNT(a.id) as count
          FROM attendance a
          INNER JOIN meeting_sessions s ON a.session_id = s.id
          WHERE a.status = 'absent' AND EXTRACT(YEAR FROM s.started_at) = EXTRACT(YEAR FROM NOW())
          GROUP BY a.student_id
        `)
      ]);

      let activeSession = null;
      if (activeRes.rowCount && activeRes.rowCount > 0) {
        const session = activeRes.rows[0];
        const rosterRes = await pgPool.query(`
          SELECT a.id as attendance_id, a.status, a.marked_at,
                 u.id as student_id, u.username as student_username, p.sex,
                 p.first_name, p.last_name, r.id as room_id, COALESCE(r.room_label, 'Unassigned 🏠') as room_label
          FROM attendance a
          INNER JOIN users u ON a.student_id = u.id
          INNER JOIN student_profiles p ON u.id = p.user_id
          LEFT JOIN rooms r ON a.room_id = r.id
          WHERE a.session_id = $1
        `, [session.id]);
        activeSession = { session, roster: rosterRes.rows };
      }

      const studentsAbsenceHistory: Record<number, number> = {};
      absenceRes.rows.forEach(row => {
        studentsAbsenceHistory[row.student_id] = parseInt(row.count) || 0;
      });

      return res.json({
        dbMode,
        students: studentsRes.rows,
        rooms: roomsRes.rows,
        activeSession,
        excuses: excusesRes.rows,
        moveOuts: moveOutsRes.rows,
        historySessions: historyRes.rows,
        notifications: notifRes.rows,
        studentsAbsenceHistory
      });

    } catch (e: any) {
      console.error("Error in PG summary query:", e);
      return res.status(500).json({ error: e.message });
    }
  }

  // FALLBACK
  try {
    const students = localData.users.filter(u => u.role === "student").map(u => {
      const p = localData.student_profiles.find(sp => sp.user_id === u.id) || {};
      const rm = localData.room_members.find(m => m.student_id === u.id);
      const r = rm ? localData.rooms.find(ro => ro.id === rm.room_id) : null;
      return {
        ...u,
        ...p,
        id: u.id,
        room_id: rm ? rm.room_id : null,
        room_label: r ? r.room_label : null
      };
    });

    const rooms = localData.rooms.map(r => {
      const count = localData.room_members.filter(rm => rm.room_id === r.id).length;
      return { ...r, current_member_count: count };
    });

    let activeSession = null;
    const activeSess = localData.meeting_sessions.find(s => s.is_active);
    if (activeSess) {
      const roster = localData.attendance.filter(a => a.session_id === activeSess.id).map(a => {
        const u = localData.users.find(us => us.id === a.student_id);
        const p = localData.student_profiles.find(pr => pr.user_id === a.student_id);
        const r = localData.rooms.find(ro => ro.id === a.room_id);
        return {
          attendance_id: a.id,
          status: a.status,
          marked_at: a.marked_at,
          student_id: a.student_id,
          student_username: u ? u.username : "ST",
          first_name: p ? p.first_name : "",
          last_name: p ? p.last_name : "",
          sex: p ? p.sex : "male",
          room_id: a.room_id,
          room_label: r ? r.room_label : "Unassigned 🏠"
        };
      });
      activeSession = { session: activeSess, roster };
    }

    const excuses = localData.late_absent_requests.map(la => {
      const u = localData.users.find(us => us.id === la.student_id);
      const p = localData.student_profiles.find(pr => pr.user_id === la.student_id);
      const att = localData.attendance.find(a => a.id === la.attendance_id);
      const sess = att ? localData.meeting_sessions.find(s => s.id === att.session_id) : null;
      return {
        ...la,
        student_username: u ? u.username : "ST",
        first_name: p ? p.first_name : "",
        last_name: p ? p.last_name : "",
        session_title: sess ? sess.title : "Monthly meeting"
      };
    }).sort((a,b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime());

    const moveOuts = localData.move_out_requests.filter(mo => !mo.is_deleted).map(mo => {
      const u = localData.users.find(us => us.id === mo.student_id);
      const p = localData.student_profiles.find(pr => pr.user_id === mo.student_id);
      return {
        ...mo,
        student_username: u ? u.username : "ST",
        first_name: p ? p.first_name : "",
        last_name: p ? p.last_name : ""
      };
    }).sort((a,b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime());

    const historySessions = localData.meeting_sessions.map(s => {
      const atts = localData.attendance.filter(a => a.session_id === s.id);
      return {
        id: s.id,
        title: s.title,
        started_at: s.started_at,
        ended_at: s.ended_at,
        year: s.year,
        month: s.month,
        count_on_time: atts.filter(a => a.status === 'on_time').length,
        count_late: atts.filter(a => a.status === 'late').length,
        count_absent: atts.filter(a => a.status === 'absent').length,
      };
    }).sort((a,b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());

    const notifications = localData.notifications.filter(n => n.recipient_id === userId);

    const studentsAbsenceHistory: Record<number, number> = {};
    const currentYear = new Date().getFullYear();
    localData.attendance.forEach(a => {
      if (a.status !== 'absent') return;
      const s = localData.meeting_sessions.find(ms => ms.id === a.session_id);
      if (s && s.started_at) {
        const d = new Date(s.started_at);
        if (d.getFullYear() === currentYear) {
          studentsAbsenceHistory[a.student_id] = (studentsAbsenceHistory[a.student_id] || 0) + 1;
        }
      }
    });

    return res.json({
      dbMode,
      students,
      rooms,
      activeSession,
      excuses,
      moveOuts,
      historySessions,
      notifications,
      studentsAbsenceHistory
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/students/dashboard-summary/:userId", async (req, res) => {
  const userId = parseInt(req.params.userId) || 0;
  const dbMode = {
    mode: useLocalFallback ? "Local SQLite-like File Fallback" : "Supabase Cloud PostgreSQL Connection Active",
    filePath: useLocalFallback ? FALLBACK_FILE : null
  };

  if (!useLocalFallback && pgPool) {
    try {
      const [profRes, listRes, moRes, notRes] = await Promise.all([
        pgPool.query(`
          SELECT p.*, r.room_label
          FROM student_profiles p
          LEFT JOIN room_members rm ON p.user_id = rm.student_id
          LEFT JOIN rooms r ON rm.room_id = r.id
          WHERE p.user_id = $1
        `, [userId]),
        pgPool.query(`
          SELECT a.id, a.status, a.marked_at, s.title as session_title, s.started_at
          FROM attendance a
          INNER JOIN meeting_sessions s ON a.session_id = s.id
          WHERE a.student_id = $1
          ORDER BY s.started_at DESC
        `, [userId]),
        pgPool.query("SELECT * FROM move_out_requests WHERE student_id = $1 AND is_deleted = FALSE ORDER BY submitted_at DESC", [userId]),
        pgPool.query("SELECT * FROM notifications WHERE recipient_id = $1 ORDER BY created_at DESC", [userId])
      ]);

      const profile = profRes.rows[0] || { error: "Profile not found" };
      return res.json({
        dbMode,
        profile,
        attendanceList: listRes.rows,
        moveOuts: moRes.rows,
        notifications: notRes.rows
      });
    } catch (e: any) {
      console.error("Error in student summary query:", e);
      return res.status(500).json({ error: e.message });
    }
  }

  // FALLBACK
  try {
    const p = localData.student_profiles.find(pr => pr.user_id === userId);
    let profile = null;
    if (p) {
      const rm = localData.room_members.find(m => m.student_id === userId);
      const r = rm ? localData.rooms.find(ro => ro.id === rm.room_id) : null;
      profile = {
        ...p,
        room_label: r ? r.room_label : null
      };
    } else {
      profile = { error: "Profile not found" };
    }

    const attendanceList = localData.attendance.filter(a => a.student_id === userId).map(a => {
      const s = localData.meeting_sessions.find(ms => ms.id === a.session_id);
      return {
        id: a.id,
        status: a.status,
        marked_at: a.marked_at,
        session_title: s ? s.title : "Meeting Session",
        started_at: s ? s.started_at : new Date().toISOString()
      };
    }).sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());

    const moveOuts = localData.move_out_requests.filter(mo => mo.student_id === userId && !mo.is_deleted)
      .sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime());

    const notifications = localData.notifications.filter(n => n.recipient_id === userId);

    return res.json({
      dbMode,
      profile,
      attendanceList,
      moveOuts,
      notifications
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

app.get("/api/superadmin/dashboard-summary", async (req, res) => {
  const dbMode = {
    mode: useLocalFallback ? "Local SQLite-like File Fallback" : "Supabase Cloud PostgreSQL Connection Active",
    filePath: useLocalFallback ? FALLBACK_FILE : null
  };

  if (!useLocalFallback && pgPool) {
    try {
      const [adminRes, logsRes] = await Promise.all([
        pgPool.query("SELECT id, username, role, is_active, created_at FROM users WHERE role = 'admin' ORDER BY id DESC"),
        pgPool.query(`
          SELECT al.*, u.username as performed_by_name
          FROM audit_logs al
          INNER JOIN users u ON al.performed_by = u.id
          ORDER BY al.performed_at DESC
        `)
      ]);
      return res.json({
        dbMode,
        admins: adminRes.rows,
        auditLogs: logsRes.rows
      });
    } catch (e: any) {
      console.error("Error in superadmin PG summary:", e);
      return res.status(500).json({ error: e.message });
    }
  }

  // FALLBACK
  try {
    const admins = localData.users.filter(u => u.role === "admin");
    const auditLogs = localData.audit_logs.map(log => {
      const u = localData.users.find(us => us.id === log.performed_by);
      return {
        ...log,
        performed_by_name: u ? u.username : `ID: ${log.performed_by}`
      };
    }).sort((a,b) => new Date(b.performed_at).getTime() - new Date(a.performed_at).getTime());

    return res.json({
      dbMode,
      admins,
      auditLogs
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// --- SUPERADMIN ENDPOINTS (CRUD ADMIN ACCOUNTS) ---
app.get("/api/superadmin/admins", (req, res) => {
  if (!useLocalFallback && pgPool) {
    pgPool.query("SELECT id, username, role, is_active, created_at FROM users WHERE role = 'admin' ORDER BY id DESC")
      .then(r => res.json(r.rows))
      .catch(e => res.status(500).json({ error: e.message }));
    return;
  }
  const admins = localData.users.filter(u => u.role === "admin");
  res.json(admins);
});

app.post("/api/superadmin/admins", async (req, res) => {
  const { username, password, superadmin_id } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Missing required fields" });

  if (!useLocalFallback && pgPool) {
    try {
      const exist = await pgPool.query("SELECT id FROM users WHERE username = $1", [username]);
      if (exist.rowCount && exist.rowCount > 0) return res.status(400).json({ error: "Username already exists" });
      const nAdmin = await pgPool.query(
        "INSERT INTO users (username, password, role) VALUES ($1, $2, 'admin') RETURNING id, username, role, is_active, created_at",
        [username, password]
      );
      await writeAuditLog(superadmin_id, "CREATE_ADMIN", "users", nAdmin.rows[0].id, `Created admin account '${username}'`);
      return res.json(nAdmin.rows[0]);
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  const exist = localData.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (exist) return res.status(400).json({ error: "Username already exists" });

  const nid = localData.users.length ? Math.max(...localData.users.map(u => u.id)) + 1 : 1;
  const admin = {
    id: nid,
    username,
    password,
    role: "admin",
    is_active: true,
    created_at: new Date().toISOString()
  };
  localData.users.push(admin);
  saveLocalData();
  await writeAuditLog(superadmin_id, "CREATE_ADMIN", "users", nid, `Created admin account '${username}' in fallback`);
  res.json(admin);
});

app.put("/api/superadmin/admins/:id", async (req, res) => {
  const adminId = parseInt(req.params.id);
  const { password, is_active, superadmin_id } = req.body;

  if (!useLocalFallback && pgPool) {
    try {
      await pgPool.query(
        "UPDATE users SET password = COALESCE($1, password), is_active = COALESCE($2, is_active) WHERE id = $3",
        [password, is_active, adminId]
      );
      await writeAuditLog(superadmin_id, is_active === false ? "DEACTIVATE_ADMIN" : "UPDATE_ADMIN", "users", adminId, `Updated details for admin ID: ${adminId}`);
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  const admin = localData.users.find(u => u.id === adminId && u.role === "admin");
  if (!admin) return res.status(404).json({ error: "Admin account not found" });

  if (password !== undefined) admin.password = password;
  if (is_active !== undefined) admin.is_active = is_active;
  saveLocalData();

  await writeAuditLog(superadmin_id, is_active === false ? "DEACTIVATE_ADMIN" : "UPDATE_ADMIN", "users", adminId, `Updated admin parameters in fallback DB (id: ${adminId})`);
  res.json({ success: true, admin });
});

app.delete("/api/superadmin/admins/:id", async (req, res) => {
  const adminId = parseInt(req.params.id);
  const { superadmin_id } = req.body;

  if (!useLocalFallback && pgPool) {
    try {
      await pgPool.query("DELETE FROM users WHERE id = $1 AND role = 'admin'", [adminId]);
      await writeAuditLog(superadmin_id, "DELETE_ADMIN", "users", adminId, `Deleted admin account database record with ID: ${adminId}`);
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  const idx = localData.users.findIndex(u => u.id === adminId && u.role === "admin");
  if (idx === -1) return res.status(404).json({ error: "Admin not found" });
  localData.users.splice(idx, 1);
  saveLocalData();

  await writeAuditLog(superadmin_id, "DELETE_ADMIN", "users", adminId, `Deleted admin account database record with ID: ${adminId} in fallback`);
  res.json({ success: true });
});


// --- ADMIN ENDPOINTS FOR STUDENTS CRUD ---
app.get("/api/admins/students/absences", async (req, res) => {
  if (!useLocalFallback && pgPool) {
    try {
      const q = `
        SELECT a.student_id, COUNT(a.id) as count
        FROM attendance a
        INNER JOIN meeting_sessions s ON a.session_id = s.id
        WHERE a.status = 'absent' AND EXTRACT(YEAR FROM s.started_at) = EXTRACT(YEAR FROM NOW())
        GROUP BY a.student_id
      `;
      const result = await pgPool.query(q);
      const output: Record<number, number> = {};
      result.rows.forEach(row => {
        output[row.student_id] = parseInt(row.count) || 0;
      });
      return res.json(output);
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Fallback map
  const output: Record<number, number> = {};
  const currentYear = new Date().getFullYear();
  localData.attendance.forEach(a => {
    if (a.status !== 'absent') return;
    const s = localData.meeting_sessions.find(ms => ms.id === a.session_id);
    if (s && s.started_at) {
      const d = new Date(s.started_at);
      if (d.getFullYear() === currentYear) {
        output[a.student_id] = (output[a.student_id] || 0) + 1;
      }
    }
  });
  
  res.json(output);
});

app.get("/api/admins/attendance/monthly-report", async (req, res) => {
  const year = parseInt(req.query.year as string) || new Date().getFullYear();
  const month = parseInt(req.query.month as string) || (new Date().getMonth() + 1);

  if (!useLocalFallback && pgPool) {
    try {
      const q = `
        SELECT u.id as student_id, u.username as student_username, p.first_name, p.last_name, p.sex, COALESCE(r.room_label, 'Unassigned 🏠') as room_label,
               COUNT(CASE WHEN a.status = 'on_time' OR a.status = 'on-time' OR a.status = 'present' THEN 1 END) as on_time_count,
               COUNT(CASE WHEN a.status = 'late' THEN 1 END) as late_count,
               COUNT(CASE WHEN a.status = 'absent' THEN 1 END) as absent_count,
               COUNT(s.id) as total_meetings
        FROM users u
        INNER JOIN student_profiles p ON u.id = p.user_id
        LEFT JOIN room_members rm ON u.id = rm.student_id
        LEFT JOIN rooms r ON rm.room_id = r.id
        LEFT JOIN attendance a ON u.id = a.student_id
        LEFT JOIN meeting_sessions s ON a.session_id = s.id AND s.year = $1 AND s.month = $2
        WHERE u.role = 'student'
        GROUP BY u.id, u.username, p.first_name, p.last_name, p.sex, r.room_label
        ORDER BY r.room_label ASC, u.username ASC
      `;
      const result = await pgPool.query(q, [year, month]);
      return res.json(result.rows);
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Fallback locally
  try {
    const monthSessions = localData.meeting_sessions.filter(s => s.year === year && s.month === month);
    const sessionIds = monthSessions.map(s => s.id);

    const report = localData.users.filter(u => u.role === "student").map(u => {
      const p = localData.student_profiles.find(pr => pr.user_id === u.id) || {};
      const rm = localData.room_members.find(m => m.student_id === u.id);
      const r = rm ? localData.rooms.find(ro => ro.id === rm.room_id) : null;
      
      const studentAtts = localData.attendance.filter(a => a.student_id === u.id && sessionIds.includes(a.session_id));
      const on_time = studentAtts.filter(a => ['on_time', 'on-time', 'present'].includes(a.status)).length;
      const late = studentAtts.filter(a => a.status === 'late').length;
      const absent = studentAtts.filter(a => a.status === 'absent').length;

      return {
        student_id: u.id,
        student_username: u.username,
        first_name: p.first_name || "",
        last_name: p.last_name || "",
        sex: p.sex || "male",
        room_label: r ? r.room_label : "Unassigned 🏠",
        on_time_count: on_time,
        late_count: late,
        absent_count: absent,
        total_meetings: studentAtts.length
      };
    }).sort((a, b) => a.room_label.localeCompare(b.room_label) || a.student_username.localeCompare(b.student_username));

    return res.json(report);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/admins/students", async (req, res) => {
  if (!useLocalFallback && pgPool) {
    try {
      const q = `
        SELECT u.id, u.username, u.is_active, u.created_at,
               p.first_name, p.last_name, p.date_of_birth, p.place_of_birth,
               p.university_name, p.email, p.phone_number, p.sex, p.profile_photo, p.move_in_date,
               p.facebook, p.telegram,
               p.is_archived, p.archived_at,
               rm.room_id, r.room_label
        FROM users u
        LEFT JOIN student_profiles p ON u.id = p.user_id
        LEFT JOIN room_members rm ON u.id = rm.student_id
        LEFT JOIN rooms r ON rm.room_id = r.id
        WHERE u.role = 'student'
        ORDER BY u.id DESC
      `;
      const result = await pgPool.query(q);
      return res.json(result.rows);
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Fallback combined list
  const students = localData.users.filter(u => u.role === "student").map(u => {
    const p = localData.student_profiles.find(p => p.user_id === u.id) || {};
    const rm = localData.room_members.find(m => m.student_id === u.id);
    const r = rm ? localData.rooms.find(ro => ro.id === rm.room_id) : null;
    return {
      ...u,
      ...p,
      id: u.id, // Ensure id is always user.id and not overwritten by student_profiles.id
      room_id: rm ? rm.room_id : null,
      room_label: r ? r.room_label : null
    };
  });
  res.json(students);
});

// Create new student
app.post("/api/admins/students", async (req, res) => {
  const { sex, password, admin_id, admin_name } = req.body;
  if (!sex || !password) return res.status(400).json({ error: "Sex and Password are required to construct account" });

  const isF = sex.toLowerCase() === "female";
  const prefix = isF ? "GF" : "BF";

  let nextNo = 1;

  if (!useLocalFallback && pgPool) {
    try {
      // Find highest GFxxx or BFxxx
      const resCount = await pgPool.query("SELECT username FROM users WHERE username LIKE $1 ORDER BY username DESC LIMIT 1", [`${prefix}%`]);
      if (resCount.rowCount && resCount.rowCount > 0) {
        const lastNoStr = resCount.rows[0].username.substring(2);
        const parsed = parseInt(lastNoStr);
        if (!isNaN(parsed)) nextNo = parsed + 1;
      }
      const newUsername = `${prefix}${String(nextNo).padStart(3, '0')}`;

      // Insert User
      const uRes = await pgPool.query(
        "INSERT INTO users (username, password, role) VALUES ($1, $2, 'student') RETURNING id, username",
        [newUsername, password]
      );
      const newUserId = uRes.rows[0].id;

      // Insert blank profile
      await pgPool.query(
        "INSERT INTO student_profiles (user_id, sex, first_name, last_name) VALUES ($1, $2, $3, $4)",
        [newUserId, sex.toLowerCase(), "", ""]
      );

      await writeAuditLog(admin_id, "CREATE_STUDENT", "student", newUserId, `Admin ${admin_name} created student account '${newUsername}'`);
      return res.json({ id: newUserId, username: newUsername, sex: sex.toLowerCase() });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Fallback
  const studs = localData.users.filter(u => u.username.startsWith(prefix));
  if (studs.length) {
    const maxNum = Math.max(...studs.map(s => {
      const num = parseInt(s.username.substring(2));
      return isNaN(num) ? 0 : num;
    }));
    nextNo = maxNum + 1;
  }
  const newUsername = `${prefix}${String(nextNo).padStart(3, '0')}`;
  const nUserId = localData.users.length ? Math.max(...localData.users.map(u => u.id)) + 1 : 1;

  // Save
  localData.users.push({
    id: nUserId, username: newUsername, password, role: "student", is_active: true, created_at: new Date().toISOString()
  });

  const nProfileId = localData.student_profiles.length ? Math.max(...localData.student_profiles.map(p => p.id)) + 1 : 1;
  localData.student_profiles.push({
    id: nProfileId,
    user_id: nUserId,
    first_name: "",
    last_name: "",
    date_of_birth: null,
    place_of_birth: "",
    university_name: "",
    email: "",
    phone_number: "",
    facebook: "",
    telegram: "",
    sex: sex.toLowerCase(),
    profile_photo: null,
    move_in_date: new Date().toISOString(),
    is_archived: false,
    archived_at: null
  });

  saveLocalData();
  await writeAuditLog(admin_id, "CREATE_STUDENT", "student", nUserId, `Admin ${admin_name} created student account '${newUsername}' in fallback`);
  res.json({ id: nUserId, username: newUsername, sex: sex.toLowerCase() });
});

// Update Student Profile Details or active state (Admin editing)
app.put("/api/admins/students/:id", async (req, res) => {
  const studentUserId = parseInt(req.params.id);
  const {
    first_name, last_name, date_of_birth, place_of_birth,
    university_name, email, phone_number, is_active, admin_id, admin_name
  } = req.body;

  if (!useLocalFallback && pgPool) {
    try {
      if (is_active !== undefined) {
        await pgPool.query("UPDATE users SET is_active = $1 WHERE id = $2", [is_active, studentUserId]);
      }
      await pgPool.query(`
        UPDATE student_profiles SET
          first_name = COALESCE($1, first_name),
          last_name = COALESCE($2, last_name),
          date_of_birth = COALESCE($3, date_of_birth),
          place_of_birth = COALESCE($4, place_of_birth),
          university_name = COALESCE($5, university_name),
          email = COALESCE($6, email),
          phone_number = COALESCE($7, phone_number)
        WHERE user_id = $8
      `, [first_name, last_name, date_of_birth || null, place_of_birth, university_name, email, phone_number, studentUserId]);

      await writeAuditLog(admin_id, "UPDATE_STUDENT", "student", studentUserId, `Admin ${admin_name} modified info for Student User ID: ${studentUserId}`);
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Fallback Update
  const user = localData.users.find(u => u.id === studentUserId && u.role === "student");
  if (!user) return res.status(404).json({ error: "Student not found" });

  if (is_active !== undefined) user.is_active = is_active;
  
  const p = localData.student_profiles.find(p => p.user_id === studentUserId);
  if (p) {
    if (first_name !== undefined) p.first_name = first_name;
    if (last_name !== undefined) p.last_name = last_name;
    if (date_of_birth !== undefined) p.date_of_birth = date_of_birth;
    if (place_of_birth !== undefined) p.place_of_birth = place_of_birth;
    if (university_name !== undefined) p.university_name = university_name;
    if (email !== undefined) p.email = email;
    if (phone_number !== undefined) p.phone_number = phone_number;
  }
  saveLocalData();

  await writeAuditLog(admin_id, "UPDATE_STUDENT", "student", studentUserId, `Admin ${admin_name} modified info for Student User ID: ${studentUserId} in fallback`);
  res.json({ success: true });
});

// Reset Student Password (Admin action)
app.post("/api/admins/students/:id/reset-password", async (req, res) => {
  const studentUserId = parseInt(req.params.id);
  const { password, admin_id, admin_name } = req.body;

  if (!password) {
    return res.status(400).json({ error: "Password is required" });
  }

  if (!useLocalFallback && pgPool) {
    try {
      const result = await pgPool.query("UPDATE users SET password = $1 WHERE id = $2 AND role = 'student' RETURNING id", [password, studentUserId]);
      if (result.rowCount === 0) {
        return res.status(404).json({ error: "Student not found" });
      }
      await writeAuditLog(admin_id, "RESET_STUDENT_PASSWORD", "student", studentUserId, `Admin ${admin_name} reset password for Student User ID: ${studentUserId}`);
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Fallback Update
  const user = localData.users.find(u => u.id === studentUserId && u.role === "student");
  if (!user) return res.status(404).json({ error: "Student not found" });

  user.password = password;
  saveLocalData();

  await writeAuditLog(admin_id, "RESET_STUDENT_PASSWORD", "student", studentUserId, `Admin ${admin_name} reset password for Student User ID: ${studentUserId} in fallback`);
  res.json({ success: true });
});

// Delete Student
app.delete("/api/admins/students/:id", async (req, res) => {
  const studentId = parseInt(req.params.id);
  const { admin_id, admin_name } = req.body;

  if (!useLocalFallback && pgPool) {
    try {
      // Keep attendance permanently but remove profile assignment
      await pgPool.query("DELETE FROM room_members WHERE student_id = $1", [studentId]);
      await pgPool.query("DELETE FROM student_profiles WHERE user_id = $1", [studentId]);
      await pgPool.query("DELETE FROM users WHERE id = $1 AND role = 'student'", [studentId]);
      
      await writeAuditLog(admin_id, "DELETE_STUDENT", "student", studentId, `Admin ${admin_name} deleted student account ${studentId}`);
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Fallback
  const uIdx = localData.users.findIndex(u => u.id === studentId && u.role === "student");
  if (uIdx !== -1) localData.users.splice(uIdx, 1);

  const pIdx = localData.student_profiles.findIndex(p => p.user_id === studentId);
  if (pIdx !== -1) localData.student_profiles.splice(pIdx, 1);

  const rmIdx = localData.room_members.findIndex(m => m.student_id === studentId);
  if (rmIdx !== -1) localData.room_members.splice(rmIdx, 1);

  saveLocalData();
  await writeAuditLog(admin_id, "DELETE_STUDENT", "student", studentId, `Admin ${admin_name} deleted student ${studentId} in fallback`);
  res.json({ success: true });
});


// --- ADMIN ROOMS ENDPOINTS ---
app.get("/api/admins/rooms", async (req, res) => {
  if (!useLocalFallback && pgPool) {
    try {
      const q = `
        SELECT r.id, r.room_label, r.gender, r.created_at,
               COUNT(rm.id) as current_member_count
        FROM rooms r
        LEFT JOIN room_members rm ON r.id = rm.room_id
        GROUP BY r.id, r.room_label, r.gender, r.created_at
        ORDER BY r.room_label ASC
      `;
      const result = await pgPool.query(q);
      return res.json(result.rows);
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Fallback mapping
  const parsed = localData.rooms.map(r => {
    const count = localData.room_members.filter(rm => rm.room_id === r.id).length;
    return { ...r, current_member_count: count };
  });
  res.json(parsed);
});

app.post("/api/admins/rooms", async (req, res) => {
  const { room_label, gender, admin_id, admin_name } = req.body;
  if (!room_label || !gender) return res.status(400).json({ error: "Label and Gender are required" });

  if (!useLocalFallback && pgPool) {
    try {
      const exist = await pgPool.query("SELECT id FROM rooms WHERE room_label = $1", [room_label]);
      if (exist.rowCount && exist.rowCount > 0) return res.status(400).json({ error: "Room label already exists" });

      const nRoom = await pgPool.query(
        "INSERT INTO rooms (room_label, gender) VALUES ($1, $2) RETURNING *",
        [room_label, gender.toLowerCase()]
      );
      await writeAuditLog(admin_id, "CREATE_ROOM", "room", nRoom.rows[0].id, `Admin ${admin_name} created room ${room_label} (${gender})`);
      return res.json(nRoom.rows[0]);
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  const exist = localData.rooms.find(r => r.room_label.toLowerCase() === room_label.toLowerCase());
  if (exist) return res.status(400).json({ error: "Room label already exists" });

  const rId = localData.rooms.length ? Math.max(...localData.rooms.map(r => r.id)) + 1 : 1;
  const room = {
    id: rId,
    room_label,
    gender: gender.toLowerCase(),
    created_at: new Date().toISOString()
  };
  localData.rooms.push(room);
  saveLocalData();

  await writeAuditLog(admin_id, "CREATE_ROOM", "room", rId, `Admin ${admin_name} created room ${room_label} (${gender}) in fallback`);
  res.json(room);
});

app.delete("/api/admins/rooms/:id", async (req, res) => {
  const roomId = parseInt(req.params.id);
  const { admin_id, admin_name } = req.body;

  if (!useLocalFallback && pgPool) {
    try {
      await pgPool.query("DELETE FROM room_members WHERE room_id = $1", [roomId]);
      await pgPool.query("DELETE FROM rooms WHERE id = $1", [roomId]);
      await writeAuditLog(admin_id, "DELETE_ROOM", "room", roomId, `Admin ${admin_name} deleted room ID: ${roomId}`);
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  const idx = localData.rooms.findIndex(r => r.id === roomId);
  if (idx === -1) return res.status(404).json({ error: "Room not found" });

  localData.rooms.splice(idx, 1);
  // Evict members
  localData.room_members = localData.room_members.filter(rm => rm.room_id !== roomId);
  saveLocalData();

  await writeAuditLog(admin_id, "DELETE_ROOM", "room", roomId, `Admin ${admin_name} deleted room ID: ${roomId} in fallback`);
  res.json({ success: true });
});

// Allocate Student to Room
app.post("/api/admins/room-members/assign", async (req, res) => {
  const { student_id, room_id, admin_id, admin_name } = req.body;

  if (!useLocalFallback && pgPool) {
    try {
      // Strict Sex Verification Checks
      const studRes = await pgPool.query("SELECT sex FROM student_profiles WHERE user_id = $1", [student_id]);
      const roomRes = await pgPool.query("SELECT gender FROM rooms WHERE id = $1", [room_id]);

      if (studRes.rowCount === 0 || roomRes.rowCount === 0) {
        return res.status(404).json({ error: "Student profile or Room not found" });
      }

      if (studRes.rows[0].sex !== roomRes.rows[0].gender) {
        return res.status(400).json({ error: `Gender mismatch: Cannot assign ${studRes.rows[0].sex} student to a ${roomRes.rows[0].gender} designated room!` });
      }

      // Remove existing assignment first
      await pgPool.query("DELETE FROM room_members WHERE student_id = $1", [student_id]);

      // Assign room
      await pgPool.query(
        "INSERT INTO room_members (student_id, room_id, assigned_by) VALUES ($1, $2, $3)",
        [student_id, room_id, admin_id]
      );

      await writeAuditLog(admin_id, "ASSIGN_ROOM", "student", student_id, `Admin ${admin_name} assigned student ID ${student_id} to room ID ${room_id}`);
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Fallback Checks
  const prof = localData.student_profiles.find(p => p.user_id === student_id);
  const room = localData.rooms.find(r => r.id === room_id);
  if (!prof || !room) return res.status(404).json({ error: "Student or Room not exists" });

  if (prof.sex !== room.gender) {
    return res.status(400).json({ error: `Gender mismatch! Student is ${prof.sex}, Room is only for ${room.gender}s.` });
  }

  // Remove ancient
  localData.room_members = localData.room_members.filter(rm => rm.student_id !== student_id);
  localData.room_members.push({
    id: localData.room_members.length + 1,
    student_id,
    room_id,
    assigned_at: new Date().toISOString(),
    assigned_by: admin_id
  });
  saveLocalData();

  await writeAuditLog(admin_id, "ASSIGN_ROOM", "room", room_id, `Admin ${admin_name} assigned student ID ${student_id} to room ID ${room_id} in fallback`);
  res.json({ success: true });
});

// Remove student from room (Make room empty or student unassigned)
app.post("/api/admins/room-members/unassign", async (req, res) => {
  const { student_id, admin_id, admin_name } = req.body;

  if (!useLocalFallback && pgPool) {
    try {
      await pgPool.query("DELETE FROM room_members WHERE student_id = $1", [student_id]);
      await writeAuditLog(admin_id, "UNASSIGN_ROOM", "student", student_id, `Admin ${admin_name} unassigned student ID ${student_id} from their room`);
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  localData.room_members = localData.room_members.filter(rm => rm.student_id !== student_id);
  saveLocalData();
  await writeAuditLog(admin_id, "UNASSIGN_ROOM", "student", student_id, `Admin ${admin_name} unassigned student ID ${student_id} in fallback`);
  res.json({ success: true });
});


// --- ATTENDANCE & MEETING SESSIONS MAIN ENDPOINTS ---
app.post("/api/admins/sessions/create", async (req, res) => {
  const { title, admin_id, admin_name } = req.body;
  if (!title) return res.status(400).json({ error: "Session Title is required" });

  const activeDate = new Date();
  const year = activeDate.getFullYear();
  const month = activeDate.getMonth() + 1; // 1-12 range

  if (!useLocalFallback && pgPool) {
    try {
      // Verify no other active session
      const activeRes = await pgPool.query("SELECT id FROM meeting_sessions WHERE is_active = TRUE");
      if (activeRes.rowCount && activeRes.rowCount > 0) {
        return res.status(400).json({ error: "There is already an active meeting session running! Please hand terminate that session first." });
      }

      // Create new session
      const nSess = await pgPool.query(
        "INSERT INTO meeting_sessions (title, created_by, year, month) VALUES ($1, $2, $3, $4) RETURNING *",
        [title, admin_id, year, month]
      );
      const sessionId = nSess.rows[0].id;

       // Automatically register all non-archived students as initially "absent" snapshots
      // Capture their current room designation at this instant
      const stQuery = `
        SELECT u.id as student_id, COALESCE(rm.room_id, 0) as room_id 
        FROM users u
        INNER JOIN student_profiles p ON u.id = p.user_id
        LEFT JOIN room_members rm ON u.id = rm.student_id
        WHERE u.role = 'student' AND p.is_archived = FALSE AND u.is_active = TRUE
      `;
      const students = await pgPool.query(stQuery);
      
      for (const st of students.rows) {
        await pgPool.query(
          "INSERT INTO attendance (session_id, student_id, room_id, status) VALUES ($1, $2, $3, 'absent')",
          [sessionId, st.student_id, st.room_id]
        );
      }

      await writeAuditLog(admin_id, "START_SESSION", "meeting_session", sessionId, `Admin ${admin_name} started meeting session '${title}'`);
      return res.json(nSess.rows[0]);
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Fallback checks
  const runs = localData.meeting_sessions.find(s => s.is_active);
  if (runs) return res.status(400).json({ error: "Another session is already active!" });

  const sId = localData.meeting_sessions.length ? Math.max(...localData.meeting_sessions.map(s => s.id)) + 1 : 1;
  const session = {
    id: sId,
    title,
    created_by: admin_id,
    started_at: new Date().toISOString(),
    ended_at: null,
    is_active: true,
    year,
    month
  };
  localData.meeting_sessions.push(session);

  // Take Snapshots for active room students
  const activeStudents = localData.users.filter(u => u.role === "student" && u.is_active).map(u => {
    const prof = localData.student_profiles.find(p => p.user_id === u.id);
    const rm = localData.room_members.find(m => m.student_id === u.id);
    if (prof && !prof.is_archived) {
      return { student_id: u.id, room_id: rm ? rm.room_id : 0 };
    }
    return null;
  }).filter(Boolean);

  activeStudents.forEach((st: any) => {
    const attId = localData.attendance.length ? Math.max(...localData.attendance.map(a => a.id)) + 1 : 1;
    localData.attendance.push({
      id: attId,
      session_id: sId,
      student_id: st.student_id,
      room_id: st.room_id,
      status: "absent",
      marked_at: null,
      marked_by: null,
      last_edited_by: null,
      last_edited_at: null
    });
  });

  saveLocalData();
  await writeAuditLog(admin_id, "START_SESSION", "meeting_session", sId, `Admin ${admin_name} started meeting session '${title}' in fallback`);
  res.json(session);
});

// Retrieve active session details including complete dynamic roster
app.get("/api/admins/sessions/active", async (req, res) => {
  if (!useLocalFallback && pgPool) {
    try {
      const activeRes = await pgPool.query("SELECT * FROM meeting_sessions WHERE is_active = TRUE");
      if (activeRes.rowCount === 0) return res.json(null);
      const session = activeRes.rows[0];

      const rosterQ = `
        SELECT a.id as attendance_id, a.status, a.marked_at,
               u.id as student_id, u.username as student_username, p.sex,
               p.first_name, p.last_name, r.id as room_id, COALESCE(r.room_label, 'Unassigned 🏠') as room_label
        FROM attendance a
        INNER JOIN users u ON a.student_id = u.id
        INNER JOIN student_profiles p ON u.id = p.user_id
        LEFT JOIN rooms r ON a.room_id = r.id
        WHERE a.session_id = $1
      `;
      const roster = await pgPool.query(rosterQ, [session.id]);
      return res.json({ session, roster: roster.rows });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Fallback
  const activeSess = localData.meeting_sessions.find(s => s.is_active);
  if (!activeSess) return res.json(null);

  const roster = localData.attendance.filter(a => a.session_id === activeSess.id).map(a => {
    const u = localData.users.find(us => us.id === a.student_id);
    const p = localData.student_profiles.find(pr => pr.user_id === a.student_id);
    const r = localData.rooms.find(ro => ro.id === a.room_id);
    return {
      attendance_id: a.id,
      status: a.status,
      marked_at: a.marked_at,
      student_id: a.student_id,
      student_username: u ? u.username : "ST",
      first_name: p ? p.first_name : "",
      last_name: p ? p.last_name : "",
      sex: p ? p.sex : "male",
      room_id: a.room_id,
      room_label: r ? r.room_label : "Unassigned 🏠"
    };
  });

  res.json({ session: activeSess, roster });
});

// Click and record presence [Present]
app.post("/api/admins/attendance/mark-present", async (req, res) => {
  const { attendance_id, admin_id, admin_name } = req.body;
  if (!attendance_id) return res.status(400).json({ error: "Missing attendance indicator" });

  const recordTime = new Date();

  if (!useLocalFallback && pgPool) {
    try {
      // Find session and check threshold limit
      const attRes = await pgPool.query(`
        SELECT a.id, a.session_id, s.started_at 
        FROM attendance a
        INNER JOIN meeting_sessions s ON a.session_id = s.id
        WHERE a.id = $1
      `, [attendance_id]);

      if (attRes.rowCount === 0) return res.status(404).json({ error: "Attendance line item not found" });
      
      const startedAt = new Date(attRes.rows[0].started_at);
      const diffMs = recordTime.getTime() - startedAt.getTime();
      const diffMins = diffMs / (1000 * 60);

      // Threshold cut-off of 15 minutes defines "on_time" vs "late"
      const resultingStatus = diffMins <= 15 ? 'on_time' : 'late';

      await pgPool.query(`
        UPDATE attendance SET
          status = $1,
          marked_at = $2,
          marked_by = $3
        WHERE id = $4
      `, [resultingStatus, recordTime, admin_id, attendance_id]);

      return res.json({ success: true, status: resultingStatus, marked_at: recordTime });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Fallback mark
  const att = localData.attendance.find(a => a.id === attendance_id);
  if (!att) return res.status(404).json({ error: "Attendance not found" });

  const session = localData.meeting_sessions.find(s => s.id === att.session_id);
  if (!session) return res.status(404).json({ error: "Session context missing" });

  const startedAt = new Date(session.started_at);
  const diffMs = recordTime.getTime() - startedAt.getTime();
  const diffMins = diffMs / (1000 * 60);
  const resultingStatus = diffMins <= 15 ? 'on_time' : 'late';

  att.status = resultingStatus;
  att.marked_at = recordTime.toISOString();
  att.marked_by = admin_id;
  saveLocalData();

  res.json({ success: true, status: resultingStatus, marked_at: recordTime });
});

// Edit/Undo attendance marked status (With manual change logged)
app.post("/api/admins/attendance/override", async (req, res) => {
  const { attendance_id, target_status, admin_id, admin_name } = req.body;
  if (!attendance_id || !target_status) return res.status(400).json({ error: "Missing required inputs" });

  const editTime = new Date();

  if (!useLocalFallback && pgPool) {
    try {
      const original = await pgPool.query(`
        SELECT a.status, u.username 
        FROM attendance a
        INNER JOIN users u ON a.student_id = u.id
        WHERE a.id = $1
      `, [attendance_id]);

      await pgPool.query(`
        UPDATE attendance SET
          status = $1,
          marked_at = $2,
          last_edited_by = $3,
          last_edited_at = $2
        WHERE id = $4
      `, [target_status.toLowerCase(), editTime, admin_id, attendance_id]);

      if (original.rowCount) {
        await writeAuditLog(
          admin_id,
          "OVERRIDE_ATTENDANCE",
          "attendance",
          attendance_id,
          `Admin ${admin_name} changed attendance mark for ${original.rows[0].username} from '${original.rows[0].status}' to '${target_status}'`
        );
      }

      return res.json({ success: true, status: target_status.toLowerCase() });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Fallback override
  const att = localData.attendance.find(a => a.id === attendance_id);
  if (!att) return res.status(404).json({ error: "Roster row not found" });

  const prevStatus = att.status;
  att.status = target_status.toLowerCase();
  att.last_edited_by = admin_id;
  att.last_edited_at = editTime.toISOString();

  const stud = localData.users.find(u => u.id === att.student_id);
  saveLocalData();

  await writeAuditLog(
    admin_id,
    "OVERRIDE_ATTENDANCE",
    "attendance",
    attendance_id,
    `Admin ${admin_name} changed attendance mark for '${stud ? stud.username : 'ST'}' from '${prevStatus}' to '${target_status}'`
  );

  res.json({ success: true, status: target_status.toLowerCase() });
});

// End Active session manually
app.post("/api/admins/sessions/end", async (req, res) => {
  const { session_id, admin_id, admin_name } = req.body;
  if (!session_id) return res.status(400).json({ error: "Missing Session Identifier" });

  const recordTime = new Date();

  if (!useLocalFallback && pgPool) {
    try {
      await pgPool.query(`
        UPDATE meeting_sessions SET
          is_active = FALSE,
          ended_at = $1
        WHERE id = $2
      `, [recordTime, session_id]);

      // Find all students marked 'absent' in this session and dispatch an internal in-system notification
      const absents = await pgPool.query("SELECT student_id FROM attendance WHERE session_id = $1 AND status = 'absent'", [session_id]);
      for (const row of absents.rows) {
        await makeNotification(
          row.student_id,
          "absent",
          `Alert: You were marked absent in the monthly meeting session. Please submit an excuse request within 1 day if you have a valid reason.`,
          session_id,
          "meeting_session"
        );
      }

      await writeAuditLog(admin_id, "END_SESSION", "meeting_session", session_id, `Admin ${admin_name} ended meeting session manually`);
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Fallback end
  const s = localData.meeting_sessions.find(ms => ms.id === session_id);
  if (!s) return res.status(404).json({ error: "Not found" });

  s.is_active = false;
  s.ended_at = recordTime.toISOString();

  // Create Notifications
  const absents = localData.attendance.filter(a => a.session_id === session_id && a.status === "absent");
  absents.forEach(a => {
    makeNotification(
      a.student_id,
      "absent",
      "Alert: You were marked absent in the monthly meeting session. Please submit an excuse request within 1 day if you have a valid reason.",
      session_id,
      "meeting_session"
    );
  });

  saveLocalData();
  await writeAuditLog(admin_id, "END_SESSION", "meeting_session", session_id, `Admin ${admin_name} ended meeting session manually in fallback`);
  res.json({ success: true });
});

// Retrieve full year archival logs filtered
app.get("/api/admins/sessions/history", async (req, res) => {
  if (!useLocalFallback && pgPool) {
    try {
      const q = `
        SELECT s.id, s.title, s.started_at, s.ended_at, s.year, s.month,
               COUNT(CASE WHEN a.status = 'on_time' THEN 1 END) as count_on_time,
               COUNT(CASE WHEN a.status = 'late' THEN 1 END) as count_late,
               COUNT(CASE WHEN a.status = 'absent' THEN 1 END) as count_absent
        FROM meeting_sessions s
        LEFT JOIN attendance a ON s.id = a.session_id
        GROUP BY s.id, s.title, s.started_at, s.ended_at, s.year, s.month
        ORDER BY s.started_at DESC
      `;
      const result = await pgPool.query(q);
      return res.json(result.rows);
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Fallback history mapping
  const results = localData.meeting_sessions.map(s => {
    const atts = localData.attendance.filter(a => a.session_id === s.id);
    return {
      id: s.id,
      title: s.title,
      started_at: s.started_at,
      ended_at: s.ended_at,
      year: s.year,
      month: s.month,
      count_on_time: atts.filter(a => a.status === 'on_time').length,
      count_late: atts.filter(a => a.status === 'late').length,
      count_absent: atts.filter(a => a.status === 'absent').length,
    };
  }).sort((a,b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());

  res.json(results);
});


// 1. GET Roster of a specific session (Active or Historical)
app.get("/api/admins/sessions/:id/roster", async (req, res) => {
  const sessionId = parseInt(req.params.id);
  if (!sessionId) return res.status(400).json({ error: "Invalid session ID" });

  if (!useLocalFallback && pgPool) {
    try {
      const rosterQ = `
        SELECT a.id as attendance_id, a.status, a.marked_at,
               u.id as student_id, u.username as student_username, p.sex,
               p.first_name, p.last_name, r.id as room_id, COALESCE(r.room_label, 'Unassigned 🏠') as room_label
        FROM attendance a
        INNER JOIN users u ON a.student_id = u.id
        INNER JOIN student_profiles p ON u.id = p.user_id
        LEFT JOIN rooms r ON a.room_id = r.id
        WHERE a.session_id = $1
      `;
      const roster = await pgPool.query(rosterQ, [sessionId]);
      return res.json(roster.rows);
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Fallback
  const roster = localData.attendance.filter(a => a.session_id === sessionId).map(a => {
    const u = localData.users.find(usr => usr.id === a.student_id);
    const p = u ? localData.student_profiles.find(prof => prof.user_id === u.id) : null;
    const r = localData.rooms.find(rm => rm.id === a.room_id);
    return {
      attendance_id: a.id,
      student_id: a.student_id,
      student_username: u ? u.username : "unknown",
      first_name: p ? p.first_name : "",
      last_name: p ? p.last_name : "",
      sex: p ? p.sex : "male",
      room_id: a.room_id,
      room_label: r ? r.room_label : "Unassigned 🏠",
      status: a.status,
      marked_at: a.marked_at
    };
  });
  res.json(roster);
});

// 2. PUT Update session metadata
app.put("/api/admins/sessions/:id", async (req, res) => {
  const sessionId = parseInt(req.params.id);
  const { title, started_at } = req.body;
  if (!sessionId) return res.status(400).json({ error: "Invalid session ID" });
  if (!title) return res.status(400).json({ error: "Session title is required" });

  const dateObj = started_at ? new Date(started_at) : new Date();
  const year = dateObj.getFullYear();
  const month = dateObj.getMonth() + 1;

  if (!useLocalFallback && pgPool) {
    try {
      await pgPool.query(`
        UPDATE meeting_sessions 
        SET title = $1, started_at = $2, year = $3, month = $4 
        WHERE id = $5
      `, [title, dateObj, year, month, sessionId]);
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Fallback
  const idx = localData.meeting_sessions.findIndex(s => s.id === sessionId);
  if (idx !== -1) {
    localData.meeting_sessions[idx].title = title;
    localData.meeting_sessions[idx].started_at = dateObj.toISOString();
    localData.meeting_sessions[idx].year = year;
    localData.meeting_sessions[idx].month = month;
    saveLocalData();
  }
  res.json({ success: true });
});

// 3. DELETE a session and its attendance logs
app.delete("/api/admins/sessions/:id", async (req, res) => {
  const sessionId = parseInt(req.params.id);
  if (!sessionId) return res.status(400).json({ error: "Invalid session ID" });

  if (!useLocalFallback && pgPool) {
    try {
      // Delete associated excuses requests (if any)
      await pgPool.query(`
        DELETE FROM late_absent_requests 
        WHERE attendance_id IN (SELECT id FROM attendance WHERE session_id = $1)
      `, [sessionId]);

      // Delete associated attendance logs
      await pgPool.query("DELETE FROM attendance WHERE session_id = $1", [sessionId]);
      
      // Delete meeting session
      await pgPool.query("DELETE FROM meeting_sessions WHERE id = $1", [sessionId]);
      
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Fallback
  // Remove related excuses
  const relatedAttendanceIds = localData.attendance.filter(a => a.session_id === sessionId).map(a => a.id);
  localData.late_absent_requests = localData.late_absent_requests.filter(la => !relatedAttendanceIds.includes(la.attendance_id));
  
  // Remove attendance logs
  localData.attendance = localData.attendance.filter(a => a.session_id !== sessionId);

  // Remove session
  localData.meeting_sessions = localData.meeting_sessions.filter(s => s.id !== sessionId);
  saveLocalData();

  res.json({ success: true });
});

// 4. POST Create a historical session record directly
app.post("/api/admins/sessions/historical", async (req, res) => {
  const { title, date } = req.body;
  if (!title) return res.status(400).json({ error: "Session title is required" });

  const dateObj = date ? new Date(date) : new Date();
  const year = dateObj.getFullYear();
  const month = dateObj.getMonth() + 1;

  if (!useLocalFallback && pgPool) {
    try {
      const nSess = await pgPool.query(
        "INSERT INTO meeting_sessions (title, created_by, year, month, started_at, ended_at, is_active) VALUES ($1, 0, $2, $3, $4, $4, FALSE) RETURNING *",
        [title, year, month, dateObj]
      );
      const sessionId = nSess.rows[0].id;

      // Automatically register all active non-archived students as initially "absent" snapshots
      const stQuery = `
        SELECT u.id as student_id, COALESCE(rm.room_id, 0) as room_id 
        FROM users u
        INNER JOIN student_profiles p ON u.id = p.user_id
        LEFT JOIN room_members rm ON u.id = rm.student_id
        WHERE u.role = 'student' AND p.is_archived = FALSE AND u.is_active = TRUE
      `;
      const students = await pgPool.query(stQuery);
      
      for (const st of students.rows) {
        await pgPool.query(
          "INSERT INTO attendance (session_id, student_id, room_id, status, marked_at) VALUES ($1, $2, $3, 'absent', $4)",
          [sessionId, st.student_id, st.room_id, dateObj]
        );
      }

      return res.json({ success: true, session: nSess.rows[0] });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Fallback
  const sId = localData.meeting_sessions.length ? Math.max(...localData.meeting_sessions.map(s => s.id)) + 1 : 1;
  const newSession = {
    id: sId,
    title,
    created_by: 0,
    started_at: dateObj.toISOString(),
    ended_at: dateObj.toISOString(),
    is_active: false,
    year,
    month
  };
  localData.meeting_sessions.push(newSession);

  const activeStudents = localData.users.filter(u => u.role === "student" && u.is_active).map(u => {
    const prof = localData.student_profiles.find(p => p.user_id === u.id);
    const rm = localData.room_members.find(m => m.student_id === u.id);
    if (prof && !prof.is_archived) {
      return { student_id: u.id, room_id: rm ? rm.room_id : 0 };
    }
    return null;
  }).filter(Boolean);

  let attId = localData.attendance.length ? Math.max(...localData.attendance.map(a => a.id)) + 1 : 1;
  for (const st of activeStudents) {
    if (st) {
      localData.attendance.push({
        id: attId++,
        session_id: sId,
        student_id: st.student_id,
        room_id: st.room_id,
        status: "absent",
        marked_at: dateObj.toISOString(),
        marked_by: 0,
        last_edited_by: null,
        last_edited_at: null
      });
    }
  }
  saveLocalData();

  res.json({ success: true, session: newSession });
});


// --- LATE ABSENT EXCUSE REQUESTS AND MOVEOUT REQUESTS ---
app.get("/api/requests/all", async (req, res) => {
  if (!useLocalFallback && pgPool) {
    try {
      // Fetch both excuses and moveOuts
      const excuses = await pgPool.query(`
        SELECT la.*, u.username as student_username, p.first_name, p.last_name, s.title as session_title
        FROM late_absent_requests la
        INNER JOIN users u ON la.student_id = u.id
        INNER JOIN student_profiles p ON u.id = p.user_id
        INNER JOIN attendance a ON la.attendance_id = a.id
        INNER JOIN meeting_sessions s ON a.session_id = s.id
        ORDER BY la.submitted_at DESC
      `);
      
      const moveOuts = await pgPool.query(`
        SELECT mo.*, u.username as student_username, p.first_name, p.last_name
        FROM move_out_requests mo
        INNER JOIN users u ON mo.student_id = u.id
        INNER JOIN student_profiles p ON u.id = p.user_id
        WHERE mo.is_deleted = FALSE
        ORDER BY mo.submitted_at DESC
      `);

      return res.json({ excuses: excuses.rows, moveOuts: moveOuts.rows });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Fallback
  const excuses = localData.late_absent_requests.map(la => {
    const u = localData.users.find(us => us.id === la.student_id);
    const p = localData.student_profiles.find(pr => pr.user_id === la.student_id);
    const att = localData.attendance.find(a => a.id === la.attendance_id);
    const sess = att ? localData.meeting_sessions.find(s => s.id === att.session_id) : null;
    return {
      ...la,
      student_username: u ? u.username : "ST",
      first_name: p ? p.first_name : "",
      last_name: p ? p.last_name : "",
      session_title: sess ? sess.title : "Monthly meeting"
    };
  }).sort((a,b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime());

  const moveOuts = localData.move_out_requests.filter(mo => !mo.is_deleted).map(mo => {
    const u = localData.users.find(us => us.id === mo.student_id);
    const p = localData.student_profiles.find(pr => pr.user_id === mo.student_id);
    return {
      ...mo,
      student_username: u ? u.username : "ST",
      first_name: p ? p.first_name : "",
      last_name: p ? p.last_name : ""
    };
  }).sort((a,b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime());

  res.json({ excuses, moveOuts });
});

app.post("/api/requests/excuse/review", async (req, res) => {
  const { request_id, status, admin_id, admin_name } = req.body;
  if (!request_id || !status) return res.status(400).json({ error: "Missing fields" });

  const recordTime = new Date();

  if (!useLocalFallback && pgPool) {
    try {
      await pgPool.query(`
        UPDATE late_absent_requests SET
          status = $1,
          reviewed_by = $2,
          reviewed_at = $3
        WHERE id = $4
      `, [status, admin_id, recordTime, request_id]);

      // If approved, retro-actively update student attendance to 'on_time' as a concession
      if (status.toLowerCase() === 'approved') {
        const attRes = await pgPool.query("SELECT attendance_id, student_id FROM late_absent_requests WHERE id = $1", [request_id]);
        if (attRes.rowCount) {
          await pgPool.query("UPDATE attendance SET status = 'on_time' WHERE id = $1", [attRes.rows[0].attendance_id]);
          await makeNotification(
            attRes.rows[0].student_id,
            "request_reviewed",
            `Your late/absent excuse request was approved! Your attendance was restored to On-Time.`
          );
        }
      } else {
        const attRes = await pgPool.query("SELECT student_id FROM late_absent_requests WHERE id = $1", [request_id]);
        if (attRes.rowCount) {
          await makeNotification(
            attRes.rows[0].student_id,
            "request_reviewed",
            `Your late/absent excuse request was denied.`
          );
        }
      }

      await writeAuditLog(admin_id, `REVIEW_EXCUSE_${status.toUpperCase()}`, "late_absent_requests", request_id, `Admin ${admin_name} marked excuse ID: ${request_id} as ${status}`);
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Fallback excuse review
  const reqObj = localData.late_absent_requests.find(la => la.id === request_id);
  if (!reqObj) return res.status(404).json({ error: "Request not found" });

  reqObj.status = status.toLowerCase();
  reqObj.reviewed_by = admin_id;
  reqObj.reviewed_at = recordTime.toISOString();

  if (status.toLowerCase() === "approved") {
    const att = localData.attendance.find(a => a.id === reqObj.attendance_id);
    if (att) att.status = "on_time";
    makeNotification(
      reqObj.student_id,
      "request_reviewed",
      `Your late/absent excuse request was approved! Your attendance was restored to On-Time.`
    );
  } else {
    makeNotification(
      reqObj.student_id,
      "request_reviewed",
      `Your late/absent excuse request was denied.`
    );
  }
  saveLocalData();

  await writeAuditLog(admin_id, `REVIEW_EXCUSE_${status.toUpperCase()}`, "late_absent_requests", request_id, `Admin ${admin_name} reviewed excuse ID: ${request_id} as ${status}`);
  res.json({ success: true });
});

app.post("/api/requests/moveout/review", async (req, res) => {
  const { request_id, status, admin_id, admin_name } = req.body;
  if (!request_id || !status) return res.status(400).json({ error: "Missing fields" });

  const recordTime = new Date();

  if (!useLocalFallback && pgPool) {
    try {
      await pgPool.query(`
        UPDATE move_out_requests SET
          status = $1,
          reviewed_by = $2,
          reviewed_at = $3
        WHERE id = $4
      `, [status, admin_id, recordTime, request_id]);

      // If approved, archive student profile
      const moRes = await pgPool.query("SELECT student_id FROM move_out_requests WHERE id = $1", [request_id]);
      if (moRes.rowCount) {
        const studentId = moRes.rows[0].student_id;
        
        if (status.toLowerCase() === 'approved') {
          await pgPool.query("UPDATE student_profiles SET is_archived = TRUE, archived_at = $1 WHERE user_id = $2", [recordTime, studentId]);
          await pgPool.query("DELETE FROM room_members WHERE student_id = $1", [studentId]); // Evict immediately
        }

        await makeNotification(
          studentId,
          "move_out_reviewed",
          `Your move-out request was reviewed: status is ${status}.`
        );
      }

      await writeAuditLog(admin_id, `REVIEW_MOVEOUT_${status.toUpperCase()}`, "move_out_requests", request_id, `Admin ${admin_name} set move-out ID ${request_id} status to ${status}`);
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Fallback
  const moObj = localData.move_out_requests.find(mo => mo.id === request_id);
  if (!moObj) return res.status(404).json({ error: "Request not found" });

  moObj.status = status.toLowerCase();
  moObj.reviewed_by = admin_id;
  moObj.reviewed_at = recordTime.toISOString();

  if (status.toLowerCase() === 'approved') {
    const prof = localData.student_profiles.find(p => p.user_id === moObj.student_id);
    if (prof) {
      prof.is_archived = true;
      prof.archived_at = recordTime.toISOString();
    }
    // Evict from room
    localData.room_members = localData.room_members.filter(rm => rm.student_id !== moObj.student_id);
  }

  makeNotification(
    moObj.student_id,
    "move_out_reviewed",
    `Your move-out request was reviewed: status is ${status}.`
  );
  saveLocalData();

  await writeAuditLog(admin_id, `REVIEW_MOVEOUT_${status.toUpperCase()}`, "move_out_requests", request_id, `Admin ${admin_name} set move-out ID ${request_id} status to ${status} in fallback`);
  res.json({ success: true });
});


// --- STUDENT PORTAL SPECIFIC ENDPOINTS ---
app.get("/api/students/profile/:id", async (req, res) => {
  const userId = parseInt(req.params.id);
  if (!useLocalFallback && pgPool) {
    try {
      const q = `
        SELECT u.username, p.*, rm.room_id, r.room_label
        FROM users u
        INNER JOIN student_profiles p ON u.id = p.user_id
        LEFT JOIN room_members rm ON u.id = rm.student_id
        LEFT JOIN rooms r ON rm.room_id = r.id
        WHERE u.id = $1
      `;
      const resVal = await pgPool.query(q, [userId]);
      if (resVal.rowCount === 0) return res.status(404).json({ error: "Student not found" });
      return res.json(resVal.rows[0]);
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  const user = localData.users.find(u => u.id === userId);
  const p = localData.student_profiles.find(pr => pr.user_id === userId);
  if (!user || !p) return res.status(404).json({ error: "Student not found" });

  const rm = localData.room_members.find(m => m.student_id === userId);
  const r = rm ? localData.rooms.find(ro => ro.id === rm.room_id) : null;

  res.json({
    ...p,
    username: user.username,
    room_id: rm ? rm.room_id : null,
    room_label: r ? r.room_label : null
  });
});

app.put("/api/students/profile/:id", async (req, res) => {
  const userId = parseInt(req.params.id);
  const { first_name, last_name, date_of_birth, place_of_birth, university_name, email, phone_number, profile_photo, facebook, telegram } = req.body;

  if (!useLocalFallback && pgPool) {
    try {
      await pgPool.query(`
        UPDATE student_profiles SET
          first_name = $1,
          last_name = $2,
          date_of_birth = $3,
          place_of_birth = $4,
          university_name = $5,
          email = $6,
          phone_number = $7,
          profile_photo = COALESCE($8, profile_photo),
          facebook = $9,
          telegram = $10
        WHERE user_id = $11
      `, [first_name, last_name, date_of_birth || null, place_of_birth, university_name, email, phone_number, profile_photo, facebook || "", telegram || "", userId]);
      
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Fallback student self-fill
  const p = localData.student_profiles.find(pr => pr.user_id === userId);
  if (!p) return res.status(404).json({ error: "Profile not found" });

  p.first_name = first_name;
  p.last_name = last_name;
  p.date_of_birth = date_of_birth;
  p.place_of_birth = place_of_birth;
  p.university_name = university_name;
  p.email = email;
  p.phone_number = phone_number;
  p.facebook = facebook || "";
  p.telegram = telegram || "";
  if (profile_photo) p.profile_photo = profile_photo;

  saveLocalData();
  res.json({ success: true, profile: p });
});

// Student attendance logs and stats
app.get("/api/students/attendance/:id", async (req, res) => {
  const userId = parseInt(req.params.id);

  if (!useLocalFallback && pgPool) {
    try {
      const pRes = await pgPool.query("SELECT id FROM student_profiles WHERE user_id = $1", [userId]);
      if (pRes.rowCount === 0) return res.json([]);
      
      const q = `
        SELECT a.id, a.status, a.marked_at, s.title as session_title, s.started_at, s.ended_at
        FROM attendance a
        INNER JOIN meeting_sessions s ON a.session_id = s.id
        WHERE a.student_id = $1
        ORDER BY s.started_at DESC
      `;
      const finalRes = await pgPool.query(q, [userId]);
      return res.json(finalRes.rows);
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Fallback attendance lists retrieve
  const list = localData.attendance.filter(a => a.student_id === userId).map(a => {
    const s = localData.meeting_sessions.find(ms => ms.id === a.session_id);
    return {
      id: a.id,
      status: a.status,
      marked_at: a.marked_at,
      session_title: s ? s.title : "Monthly meeting",
      started_at: s ? s.started_at : null,
      ended_at: s ? s.ended_at : null
    };
  });
  res.json(list);
});

// Submit excuse request (Late excuse)
app.post("/api/students/requests/excuse", async (req, res) => {
  const { student_id, attendance_id, reason } = req.body;
  if (!student_id || !attendance_id || !reason) return res.status(400).json({ error: "Missing required inputs" });

  const recordTime = new Date();

  if (!useLocalFallback && pgPool) {
    try {
      // Validate deadline threshold constraint: only valid within 1 day after the session start date
      const attRes = await pgPool.query(`
        SELECT s.started_at 
        FROM attendance a
        INNER JOIN meeting_sessions s ON a.session_id = s.id
        WHERE a.id = $1
      `, [attendance_id]);

      if (attRes.rowCount === 0) return res.status(404).json({ error: "Associated session attendance details not found" });

      const sessionDate = new Date(attRes.rows[0].started_at);
      const timeDiff = recordTime.getTime() - sessionDate.getTime();
      const dayDiff = timeDiff / (1000 * 60 * 60 * 24);

      const isVoid = dayDiff > 1; // Deadline becomes void after 1 day count

      const nReq = await pgPool.query(`
        INSERT INTO late_absent_requests (student_id, attendance_id, reason, is_void)
        VALUES ($1, $2, $3, $4) RETURNING *
      `, [student_id, attendance_id, reason, isVoid]);

      // Trigger standard internal notification to all admins
      const admins = await pgPool.query("SELECT id FROM users WHERE role = 'admin' OR role = 'superadmin'");
      const studUser = await pgPool.query("SELECT username FROM users WHERE id = $1", [student_id]);
      const activeName = studUser.rowCount ? studUser.rows[0].username : "ST";
      
      for (const adm of admins.rows) {
        await makeNotification(
          adm.id,
          "request_submitted",
          `Excuse received: Student ${activeName} submitted a late/absent request.`,
          nReq.rows[0].id,
          "late_absent_requests"
        );
      }

      return res.json(nReq.rows[0]);
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Fallback excuse submission
  const att = localData.attendance.find(a => a.id === attendance_id);
  if (!att) return res.status(404).json({ error: "Associated attendance snapshot missing" });

  const s = localData.meeting_sessions.find(ms => ms.id === att.session_id);
  const startedAt = s ? new Date(s.started_at) : new Date();
  const dayDiff = (recordTime.getTime() - startedAt.getTime()) / (1000 * 60 * 60 * 24);
  const isVoid = dayDiff > 1;

  const reqId = localData.late_absent_requests.length ? Math.max(...localData.late_absent_requests.map(r => r.id)) + 1 : 1;
  const request = {
    id: reqId,
    student_id,
    attendance_id,
    reason,
    status: "pending",
    submitted_at: recordTime.toISOString(),
    reviewed_by: null,
    reviewed_at: null,
    is_void: isVoid
  };
  localData.late_absent_requests.push(request);

  // Notify admins
  const stud = localData.users.find(u => u.id === student_id);
  const admins = localData.users.filter(u => u.role === "admin" || u.role === "superadmin");
  admins.forEach(adm => {
    makeNotification(
      adm.id,
      "request_submitted",
      `Excuse received: Student ${stud ? stud.username : "ST"} submitted a late/absent request.`,
      reqId,
      "late_absent_requests"
    );
  });

  saveLocalData();
  res.json(request);
});

// Submit / edit / delete Move Out applications
app.get("/api/students/requests/moveout/:id", async (req, res) => {
  const userId = parseInt(req.params.id);
  if (!useLocalFallback && pgPool) {
    try {
      const q = "SELECT * FROM move_out_requests WHERE student_id = $1 AND is_deleted = FALSE ORDER BY submitted_at DESC";
      const result = await pgPool.query(q, [userId]);
      return res.json(result.rows);
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }
  const list = localData.move_out_requests.filter(m => m.student_id === userId && !m.is_deleted);
  res.json(list);
});

app.post("/api/students/requests/moveout", async (req, res) => {
  const { student_id, reason, requested_move_out_date } = req.body;
  if (!student_id || !reason || !requested_move_out_date) return res.status(400).json({ error: "Required fields missing" });

  if (!useLocalFallback && pgPool) {
    try {
      const nMo = await pgPool.query(`
        INSERT INTO move_out_requests (student_id, reason, requested_move_out_date)
        VALUES ($1, $2, $3) RETURNING *
      `, [student_id, reason, requested_move_out_date]);

      const studUser = await pgPool.query("SELECT username FROM users WHERE id = $1", [student_id]);
      const name = studUser.rowCount ? studUser.rows[0].username : "ST";

      const admins = await pgPool.query("SELECT id FROM users WHERE role = 'admin' OR role = 'superadmin'");
      for (const adm of admins.rows) {
        await makeNotification(
          adm.id,
          "move_out_submitted",
          `Move-out notice: Student ${name} has submitted a move-out application.`,
          nMo.rows[0].id,
          "move_out_requests"
        );
      }

      return res.json(nMo.rows[0]);
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Fallback
  const moId = localData.move_out_requests.length ? Math.max(...localData.move_out_requests.map(m => m.id)) + 1 : 1;
  const moveOut = {
    id: moId,
    student_id,
    reason,
    requested_move_out_date,
    status: "pending",
    submitted_at: new Date().toISOString(),
    reviewed_by: null,
    reviewed_at: null,
    is_deleted: false,
    deleted_at: null
  };
  localData.move_out_requests.push(moveOut);

  // Notify
  const stud = localData.users.find(u => u.id === student_id);
  const name = stud ? stud.username : "ST";
  const admins = localData.users.filter(u => u.role === "admin" || u.role === "superadmin");
  admins.forEach(adm => {
    makeNotification(
      adm.id,
      "move_out_submitted",
      `Move-out notice: Student ${name} has submitted a move-out application.`,
      moId,
      "move_out_requests"
    );
  });

  saveLocalData();
  res.json(moveOut);
});

// Update/Edit their own move-out application while still pending
app.put("/api/students/requests/moveout/:id", async (req, res) => {
  const movId = parseInt(req.params.id);
  const { reason, requested_move_out_date } = req.body;

  if (!useLocalFallback && pgPool) {
    try {
      await pgPool.query(`
        UPDATE move_out_requests SET
          reason = $1,
          requested_move_out_date = $2
        WHERE id = $3 AND status = 'pending'
      `, [reason, requested_move_out_date, movId]);
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  const mo = localData.move_out_requests.find(m => m.id === movId && m.status === 'pending');
  if (!mo) return res.status(404).json({ error: "Pending request not found" });

  mo.reason = reason;
  mo.requested_move_out_date = requested_move_out_date;
  saveLocalData();
  res.json({ success: true });
});

// Delete their own move-out application
app.delete("/api/students/requests/moveout/:id", async (req, res) => {
  const movId = parseInt(req.params.id);

  if (!useLocalFallback && pgPool) {
    try {
      await pgPool.query("UPDATE move_out_requests SET is_deleted = TRUE, deleted_at = NOW() WHERE id = $1", [movId]);
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  const mo = localData.move_out_requests.find(m => m.id === movId);
  if (!mo) return res.status(404).json({ error: "Request not found" });

  mo.is_deleted = true;
  mo.deleted_at = new Date().toISOString();
  saveLocalData();
  res.json({ success: true });
});


// --- NOTIFICATIONS MANAGEMENT ENDPOINTS ---
app.get("/api/notifications/:userId", async (req, res) => {
  const uId = parseInt(req.params.userId);
  if (!useLocalFallback && pgPool) {
    try {
      const q = "SELECT * FROM notifications WHERE recipient_id = $1 ORDER BY created_at DESC";
      const result = await pgPool.query(q, [uId]);
      return res.json(result.rows);
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }
  const filtered = localData.notifications.filter(n => n.recipient_id === uId);
  res.json(filtered);
});

app.post("/api/notifications/clear-dot", async (req, res) => {
  const { notification_id } = req.body;
  if (!notification_id) return res.status(400).json({ error: "Required fields missing" });

  if (!useLocalFallback && pgPool) {
    try {
      await pgPool.query("UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE id = $1", [notification_id]);
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  const notif = localData.notifications.find(n => n.id === notification_id);
  if (notif) {
    notif.is_read = true;
    notif.read_at = new Date().toISOString();
    saveLocalData();
  }
  res.json({ success: true });
});

app.post("/api/notifications/read-all", async (req, res) => {
  const { recipient_id } = req.body;
  if (!recipient_id) return res.status(400).json({ error: "Required fields missing" });

  if (!useLocalFallback && pgPool) {
    try {
      await pgPool.query("UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE recipient_id = $1", [recipient_id]);
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  localData.notifications.forEach(n => {
    if (n.recipient_id === recipient_id) {
      n.is_read = true;
      n.read_at = new Date().toISOString();
    }
  });
  saveLocalData();
  res.json({ success: true });
});


// --- ADMIN AUDIT TRAIL LOGS RETRIEVE ---
app.get("/api/audit-logs", async (req, res) => {
  if (!useLocalFallback && pgPool) {
    try {
      const q = `
        SELECT a.*, u.username as performed_by_name
        FROM audit_logs a
        INNER JOIN users u ON a.performed_by = u.id
        ORDER BY a.performed_at DESC
      `;
      const result = await pgPool.query(q);
      return res.json(result.rows);
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  res.json(localData.audit_logs);
});

// Admin command: auto prune move-out messages older than 1 month
app.post("/api/admins/requests/prune-moveouts", async (req, res) => {
  const { admin_id, admin_name } = req.body;
  const thresholdDate = new Date();
  thresholdDate.setMonth(thresholdDate.getMonth() - 1);

  if (!useLocalFallback && pgPool) {
    try {
      const q = "DELETE FROM move_out_requests WHERE status IN ('approved', 'denied') AND submitted_at < $1";
      const result = await pgPool.query(q, [thresholdDate]);
      await writeAuditLog(admin_id, "PRUNE_MOVEOUTS", "move_out_requests", 0, `Admin ${admin_name} requested pruning of moveout records older than 1 month`);
      return res.json({ success: true, count: result.rowCount });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  const initialLen = localData.move_out_requests.length;
  localData.move_out_requests = localData.move_out_requests.filter(mo => {
    if (mo.status !== 'pending' && new Date(mo.submitted_at).getTime() < thresholdDate.getTime()) {
      return false; // delete
    }
    return true; // keep
  });
  
  const prunedCount = initialLen - localData.move_out_requests.length;
  saveLocalData();

  await writeAuditLog(admin_id, "PRUNE_MOVEOUTS", "move_out_requests", 0, `Admin ${admin_name} pruned ${prunedCount} old moveout applications in fallback`);
  res.json({ success: true, count: prunedCount });
});

// Clear all late/absent excuse request logs
app.post("/api/admins/requests/clear-late-absent", async (req, res) => {
  const { admin_id, admin_name } = req.body;
  if (!useLocalFallback && pgPool) {
    try {
      await pgPool.query("DELETE FROM late_absent_requests");
      await writeAuditLog(admin_id, "CLEAR_ALL_LATE_ABSENT", "late_absent_requests", 0, `Admin ${admin_name} purged all late/absent excuse requests`);
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  localData.late_absent_requests = [];
  saveLocalData();
  await writeAuditLog(admin_id, "CLEAR_ALL_LATE_ABSENT", "late_absent_requests", 0, `Admin ${admin_name} purged all late/absent excuse requests in fallback`);
  res.json({ success: true });
});

// Clear all student move-out applications
app.post("/api/admins/requests/clear-moveouts", async (req, res) => {
  const { admin_id, admin_name } = req.body;
  if (!useLocalFallback && pgPool) {
    try {
      await pgPool.query("DELETE FROM move_out_requests");
      await writeAuditLog(admin_id, "CLEAR_ALL_MOVEOUT_REQUESTS", "move_out_requests", 0, `Admin ${admin_name} purged all move-out requests`);
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  localData.move_out_requests = [];
  saveLocalData();
  await writeAuditLog(admin_id, "CLEAR_ALL_MOVEOUT_REQUESTS", "move_out_requests", 0, `Admin ${admin_name} purged all move-out requests in fallback`);
  res.json({ success: true });
});

// Clear recipient's individual notifications (For both Admins and Students to clear their own messages)
app.post("/api/notifications/clear-user-notifications", async (req, res) => {
  const { recipient_id } = req.body;
  if (!recipient_id) return res.status(400).json({ error: "Required fields missing" });

  if (!useLocalFallback && pgPool) {
    try {
      await pgPool.query("DELETE FROM notifications WHERE recipient_id = $1", [recipient_id]);
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  localData.notifications = localData.notifications.filter(n => n.recipient_id !== recipient_id);
  saveLocalData();
  res.json({ success: true });
});

// Clear all system audit log events (Superadmin action)
app.post("/api/superadmin/clear-audit-logs", async (req, res) => {
  const { superadmin_id, superadmin_name } = req.body;
  if (!superadmin_id) return res.status(400).json({ error: "Required fields missing" });

  if (!useLocalFallback && pgPool) {
    try {
      await pgPool.query("DELETE FROM audit_logs");
      await writeAuditLog(superadmin_id, "CLEAR_ALL_AUDIT_LOGS", "audit_logs", 0, `Superadmin ${superadmin_name} cleared all event audit trail records`);
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  localData.audit_logs = [];
  saveLocalData();
  await writeAuditLog(superadmin_id, "CLEAR_ALL_AUDIT_LOGS", "audit_logs", 0, `Superadmin ${superadmin_name} cleared all event audit trail records in fallback`);
  res.json({ success: true });
});


// --- BOOTSTRAP ENVIRONMENT WEB & VITE CONFIGS ---

async function startServer() {
  // Try initializing standard database engines
  await initDB();

  // Vite development integration
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Dorm Attendance Tracking System running in port ${PORT}`);
    console.log(`Environment matches: NODE_ENV=${process.env.NODE_ENV || 'development'}`);
  });
}

startServer();
