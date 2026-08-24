# ShasheCoders Regional Summer Camp & Admissions Portal

Official admissions screening engine and administrative portal for the ShasheCoders 2026 Regional Summer Camp.

---

## 📌 Overview

ShasheCoders is an intensive 12-week algorithm and software development initiative designed to screen regional applicants and select a fully sponsored 80-seat residential cohort (housing & meals provided).

This platform handles:
- Multi-step candidate registration (identity, academics, algorithmic assessments, and logistics).
- Automated merit scoring engine based on GPA, national examination results, and data structure/algorithm logic responses.
- Government-sponsored dormitory tracking (80-seat capacity limit enforcement).
- Real-time instructor dashboard for candidate shortlisting, review, and status updates.
- One-click CSV export for municipal stakeholders and camp coordinators.

---

## 🛠️ Tech Stack

- **Backend:** Node.js, Express.js
- **Database:** SQLite via `better-sqlite3` (zero configuration, persistent on-disk storage)
- **Frontend:** Vanilla HTML5, JavaScript (Fetch API), Tailwind CSS (CDN)
- **Deployment:** Render / Railway / Localhost

---

## 📂 Repository Structure

```text
.
├── package.json        # Dependencies and startup scripts
├── server.js           # Express API, merit calculator, SQLite database logic
├── public/
│   └── index.html      # Integrated applicant form and admin dashboard
└── README.md           # Documentation
