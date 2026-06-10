# Dormitory Attendance & Space Optimizer System (DASO)

Welcome to the **Dormitory Attendance & Space Optimizer System (DASO)**, a modular and highly secure full-stack administrative control suite designed to streamline residential management, coordinate daily check-ins, automate room assignments, and process student attendance updates safely.

---

## 🚀 Key Features Overview

The system provides three tailored user interface pillars, fully supported by a robust Express backend service:

### 1. Admin Control Tower & Gate Check
*   **Active Meeting & Live Attendance Roster**: Take real-time morning or night gate checks. Select students manually, modify attendance marks easily, and stage modifications dynamically.
*   **Review & Submit Attendance Marks**: Review staged attendance changes inside a centralized, scrollable review panel containing original versus target-state comparison badges.
*   **Batch Database Archiving**: Commit multiple staged student marks simultaneously via a rapid transactional, atomic batch query.
*   **Safety Confirmations Built-in**: Upgraded safety flows with interactive confirmation modals overlayed cleanly over critical interactions (such as discarding drafts or committing batches) to prevent accidental mouse slips.

### 2. Space Optimizer & Room Allocation
*   **Gender-Aware Room Diagnostics**: Automatically detects room capacity limits and designated genders (Male or Female) during assignments.
*   **Allocations Filter & Sorter**: Admins have interactive sorted views (`🌐 All`, `👦 Male`, `👧 Female`) to query available rooms instantly inside the assign dropdown, pre-filled based on the student's record.
*   **Automated Gender Alignment Protection**: Includes guardrails to warn or block admins when allocating mismatched genders into restricted residential rooms.

### 3. Student Hub & Exemption Registry
*   **Self-Service Late / Absence Request Portal**: Seamlessly file digital excuse slips with automated timestamps for missed gate checks.
*   **Live Room Status Board**: View assigned roommates, live occupant headcounts, and registered space details in real time.

---

## 🛠️ Tech Stack & Architecture

*   **Frontend**: React 18, Vite, Type-Safe TypeScript, Tailwind CSS, Lucide Icons, and custom CSS-in-JS configurations.
*   **Backend & APIs**: Full-stack Express.js Proxy Server serving secure endpoints under `/api/admins/*`.
*   **Build Optimization**: Custom `esbuild` configurations bundled cleanly into a single production compilation unit in NodeJS.
*   **Layering**: Built-in, high-level `zIndex` prioritization so helper overlay alerts (confirmations at `1500` and success modals at `1600`) reside consistently above modal triggers.

---

## 📦 Run & Deploy

### Development Workspace
```bash
npm run dev
```

### Production Build & Launch
```bash
npm run build
npm run start
```

---

*Thank you for utilizing the Dormitory Space Optimizer. Designed with user safety, modularity, and pixel-perfect layouts at heart.*
