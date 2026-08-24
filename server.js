const express = require("express");
const Database = require("better-sqlite3");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Initialize SQLite Database with immediate disk persistence
const db = new Database("shashecoders.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS applicants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_ref TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    gender TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    telegram TEXT NOT NULL,
    guardian_phone TEXT NOT NULL,
    zone TEXT NOT NULL,
    school_name TEXT NOT NULL,
    grade_level INTEGER NOT NULL,
    gpa REAL NOT NULL,
    national_score REAL,
    experience_level TEXT NOT NULL,
    programming_langs TEXT,
    portfolio_url TEXT,
    algo_response1 TEXT NOT NULL,
    algo_response2 TEXT NOT NULL,
    statement_purpose TEXT NOT NULL,
    project_idea TEXT NOT NULL,
    needs_dorm INTEGER DEFAULT 1,
    merit_score REAL NOT NULL,
    status TEXT DEFAULT 'PENDING',
    housing_status TEXT DEFAULT 'PENDING',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Merit Scoring Algorithm
function calculateMerit(data) {
  let score = 0;

  // 1. GPA Weight (Max 25 pts)
  const gpa = parseFloat(data.gpa) || 0;
  score += Math.min(Math.max((gpa / 100) * 25, 0), 25);

  // 2. National Exam Scaling (Max 15 pts)
  const national = parseFloat(data.national_score) || 0;
  if (national > 0) {
    const maxExam = national > 600 ? 700 : 600;
    score += Math.min((national / maxExam) * 15, 15);
  } else {
    score += Math.min((gpa / 100) * 15, 15);
  }

  // 3. Technical Experience Tier (Max 20 pts)
  const exp = data.experience_level || "";
  if (exp.includes("Advanced")) score += 20;
  else if (exp.includes("Intermediate")) score += 15;
  else if (exp.includes("Beginner")) score += 10;
  else score += 5;

  // 4. Algorithmic Response Logic Analysis (Max 25 pts)
  const logicText = ((data.algo_response1 || "") + " " + (data.algo_response2 || "")).toLowerCase();
  const keywords = ["hash", "map", "dict", "o(n)", "two pointer", "binary", "recur", "loop", "pointer", "array", "tree"];
  let matched = 0;
  keywords.forEach((kw) => {
    if (logicText.includes(kw)) matched += 1;
  });
  score += Math.min(matched * 3.5, 20);
  if (logicText.length > 100) score += 5;

  // 5. Impact Essay & Portfolio (Max 15 pts)
  const essayLen = (data.statement_purpose || "").length + (data.project_idea || "").length;
  if (essayLen > 300) score += 10;
  else if (essayLen > 100) score += 5;

  if (data.portfolio_url && data.portfolio_url.trim().length > 5) score += 5;

  return Math.round(score * 100) / 100;
}

// POST: Candidate Submission Endpoint
app.post("/api/register", (req, res) => {
  try {
    const body = req.body;

    // Strict validation
    if (!body.full_name || !body.email || !body.phone || !body.telegram || !body.school_name || !body.gpa) {
      return res.status(400).json({ error: "Please fill out all required admission fields." });
    }

    const checkStmt = db.prepare("SELECT id FROM applicants WHERE email = ? OR phone = ?");
    const existing = checkStmt.get(body.email.trim(), body.phone.trim());
    if (existing) {
      return res.status(409).json({ error: "An application with this email or phone number is already registered." });
    }

    const countStmt = db.prepare("SELECT COUNT(*) AS count FROM applicants");
    const total = countStmt.get().count;
    const appRef = `SC-2026-${String(total + 1).padStart(4, "0")}`;

    const meritScore = calculateMerit(body);
    const initialStatus = meritScore >= 65 ? "SCREENING_PASSED" : "PENDING";

    const insertStmt = db.prepare(`
      INSERT INTO applicants (
        app_ref, full_name, gender, email, phone, telegram, guardian_phone,
        zone, school_name, grade_level, gpa, national_score, experience_level,
        programming_langs, portfolio_url, algo_response1, algo_response2,
        statement_purpose, project_idea, needs_dorm, merit_score, status
      ) VALUES (
        @app_ref, @full_name, @gender, @email, @phone, @telegram, @guardian_phone,
        @zone, @school_name, @grade_level, @gpa, @national_score, @experience_level,
        @programming_langs, @portfolio_url, @algo_response1, @algo_response2,
        @statement_purpose, @project_idea, @needs_dorm, @merit_score, @status
      )
    `);

    insertStmt.run({
      app_ref: appRef,
      full_name: body.full_name.trim(),
      gender: body.gender || "MALE",
      email: body.email.trim().toLowerCase(),
      phone: body.phone.trim(),
      telegram: body.telegram.startsWith("@") ? body.telegram.trim() : `@${body.telegram.trim()}`,
      guardian_phone: body.guardian_phone || "",
      zone: body.zone || "West Arsi",
      school_name: body.school_name.trim(),
      grade_level: parseInt(body.grade_level, 10) || 11,
      gpa: parseFloat(body.gpa) || 0,
      national_score: body.national_score ? parseFloat(body.national_score) : null,
      experience_level: body.experience_level || "Beginner",
      programming_langs: body.programming_langs || "None",
      portfolio_url: body.portfolio_url || null,
      algo_response1: body.algo_response1 || "",
      algo_response2: body.algo_response2 || "",
      statement_purpose: body.statement_purpose || "",
      project_idea: body.project_idea || "",
      needs_dorm: body.needs_dorm ? 1 : 0,
      merit_score: meritScore,
      status: initialStatus
    });

    return res.status(201).json({
      success: true,
      app_ref: appRef,
      merit_score: meritScore,
      candidate_name: body.full_name
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server failed to process submission." });
  }
});

// GET: Applicants List & Operational Metrics
app.get("/api/admin/candidates", (req, res) => {
  try {
    const search = req.query.search ? `%${req.query.search}%` : "%";
    const status = req.query.status;

    let query = `
      SELECT * FROM applicants 
      WHERE (full_name LIKE ? OR school_name LIKE ? OR telegram LIKE ? OR app_ref LIKE ?)
    `;
    const params = [search, search, search, search];

    if (status && status !== "ALL") {
      query += " AND status = ?";
      params.push(status);
    }

    query += " ORDER BY merit_score DESC LIMIT 300";

    const rows = db.prepare(query).all(...params);

    const total = db.prepare("SELECT COUNT(*) AS c FROM applicants").get().c;
    const dormCount = db.prepare("SELECT COUNT(*) AS c FROM applicants WHERE housing_status = 'DORM_ALLOCATED'").get().c;
    const acceptedCount = db.prepare("SELECT COUNT(*) AS c FROM applicants WHERE status = 'ACCEPTED'").get().c;

    return res.json({
      metrics: {
        total_registered: total,
        dorm_allocated: dormCount,
        dorm_capacity: 80,
        accepted_cohort: acceptedCount
      },
      candidates: rows
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load candidates." });
  }
});

// PATCH: Cohort Status & Dormitory Allocation
app.patch("/api/admin/decision", (req, res) => {
  try {
    const { id, status, housing_status } = req.body;
    if (!id) return res.status(400).json({ error: "Missing candidate ID" });

    // Check 80 dorm room threshold
    if (housing_status === "DORM_ALLOCATED") {
      const allocated = db.prepare("SELECT COUNT(*) AS c FROM applicants WHERE housing_status = 'DORM_ALLOCATED' AND id != ?").get(id).c;
      if (allocated >= 80) {
        return res.status(400).json({ error: "Municipal sponsorship limit reached (80/80 Dorm Beds Occupied)." });
      }
    }

    db.prepare(`
      UPDATE applicants 
      SET status = COALESCE(?, status), 
          housing_status = COALESCE(?, housing_status) 
      WHERE id = ?
    `).run(status, housing_status, id);

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "Update failed." });
  }
});

// GET: Export CSV for Municipality & Logistics
app.get("/api/admin/export", (req, res) => {
  try {
    const rows = db.prepare("SELECT * FROM applicants ORDER BY merit_score DESC").all();
    let csv = "Ref,Name,Gender,Phone,Telegram,School,Grade,GPA,NationalExam,Score,Status,Housing\n";
    rows.forEach((r) => {
      csv += `"${r.app_ref}","${r.full_name}","${r.gender}","${r.phone}","${r.telegram}","${r.school_name}",${r.grade_level},${r.gpa},${r.national_score || 0},${r.merit_score},"${r.status}","${r.housing_status}"\n`;
    });
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=ShasheCoders_Applicants_2026.csv");
    res.send(csv);
  } catch (err) {
    res.status(500).send("CSV Generation Failed");
  }
});

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(` SHASHECODERS ADMISSION & SCREENING PORTAL IS RUNNING`);
  console.log(` Active at: http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});
