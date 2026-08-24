const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve static assets from public if available
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(__dirname));

// Initialize SQLite Database
const db = new sqlite3.Database("shashecoders.db");

db.serialize(() => {
  db.run(`
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
    )
  `);
});

// Merit Calculation
function calculateMerit(data) {
  let score = 0;
  const gpa = parseFloat(data.gpa) || 0;
  score += Math.min(Math.max((gpa / 100) * 25, 0), 25);

  const national = parseFloat(data.national_score) || 0;
  if (national > 0) {
    const maxExam = national > 600 ? 700 : 600;
    score += Math.min((national / maxExam) * 15, 15);
  } else {
    score += Math.min((gpa / 100) * 15, 15);
  }

  const exp = data.experience_level || "";
  if (exp.includes("Advanced")) score += 20;
  else if (exp.includes("Intermediate")) score += 15;
  else if (exp.includes("Beginner")) score += 10;
  else score += 5;

  const logicText = ((data.algo_response1 || "") + " " + (data.algo_response2 || "")).toLowerCase();
  const keywords = ["hash", "map", "dict", "o(n)", "two pointer", "binary", "recur", "loop", "pointer", "array", "tree"];
  let matched = 0;
  keywords.forEach((kw) => {
    if (logicText.includes(kw)) matched += 1;
  });
  score += Math.min(matched * 3.5, 20);
  if (logicText.length > 100) score += 5;

  const essayLen = (data.statement_purpose || "").length + (data.project_idea || "").length;
  if (essayLen > 300) score += 10;
  else if (essayLen > 100) score += 5;

  if (data.portfolio_url && data.portfolio_url.trim().length > 5) score += 5;

  return Math.round(score * 100) / 100;
}

// Fallback route to directly serve index.html
app.get("/", (req, res) => {
  const publicPath = path.join(__dirname, "public", "index.html");
  const rootPath = path.join(__dirname, "index.html");

  if (fs.existsSync(publicPath)) {
    return res.sendFile(publicPath);
  } else if (fs.existsSync(rootPath)) {
    return res.sendFile(rootPath);
  } else {
    return res.status(404).send("index.html file not found in public/ or root directory.");
  }
});

// POST: Candidate Submission Endpoint
app.post("/api/register", (req, res) => {
  const body = req.body;

  if (!body.full_name || !body.email || !body.phone || !body.telegram || !body.school_name || !body.gpa) {
    return res.status(400).json({ error: "Please fill out all required admission fields." });
  }

  db.get("SELECT id FROM applicants WHERE email = ? OR phone = ?", [body.email.trim(), body.phone.trim()], (err, existing) => {
    if (err) return res.status(500).json({ error: "Database lookup error." });
    if (existing) {
      return res.status(409).json({ error: "An application with this email or phone number is already registered." });
    }

    db.get("SELECT COUNT(*) AS count FROM applicants", [], (err, countRow) => {
      if (err) return res.status(500).json({ error: "Database counter error." });
      const total = countRow ? countRow.count : 0;
      const appRef = `SC-2026-${String(total + 1).padStart(4, "0")}`;
      const meritScore = calculateMerit(body);
      const initialStatus = meritScore >= 65 ? "SCREENING_PASSED" : "PENDING";

      const insertQuery = `
        INSERT INTO applicants (
          app_ref, full_name, gender, email, phone, telegram, guardian_phone,
          zone, school_name, grade_level, gpa, national_score, experience_level,
          programming_langs, portfolio_url, algo_response1, algo_response2,
          statement_purpose, project_idea, needs_dorm, merit_score, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const params = [
        appRef,
        body.full_name.trim(),
        body.gender || "MALE",
        body.email.trim().toLowerCase(),
        body.phone.trim(),
        body.telegram.startsWith("@") ? body.telegram.trim() : `@${body.telegram.trim()}`,
        body.guardian_phone || "",
        body.zone || "West Arsi",
        body.school_name.trim(),
        parseInt(body.grade_level, 10) || 11,
        parseFloat(body.gpa) || 0,
        body.national_score ? parseFloat(body.national_score) : null,
        body.experience_level || "Beginner",
        body.programming_langs || "None",
        body.portfolio_url || null,
        body.algo_response1 || "",
        body.algo_response2 || "",
        body.statement_purpose || "",
        body.project_idea || "",
        body.needs_dorm ? 1 : 0,
        meritScore,
        initialStatus
      ];

      db.run(insertQuery, params, function (err) {
        if (err) return res.status(500).json({ error: "Failed to store record." });
        return res.status(201).json({
          success: true,
          app_ref: appRef,
          merit_score: meritScore,
          candidate_name: body.full_name
        });
      });
    });
  });
});

// GET: Candidates & Metrics
app.get("/api/admin/candidates", (req, res) => {
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

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: "Failed to fetch candidates." });

    db.get("SELECT COUNT(*) AS total FROM applicants", [], (err, totalRow) => {
      db.get("SELECT COUNT(*) AS dorms FROM applicants WHERE housing_status = 'DORM_ALLOCATED'", [], (err, dormRow) => {
        db.get("SELECT COUNT(*) AS accepted FROM applicants WHERE status = 'ACCEPTED'", [], (err, acceptedRow) => {
          return res.json({
            metrics: {
              total_registered: totalRow ? totalRow.total : 0,
              dorm_allocated: dormRow ? dormRow.dorms : 0,
              dorm_capacity: 80,
              accepted_cohort: acceptedRow ? acceptedRow.accepted : 0
            },
            candidates: rows || []
          });
        });
      });
    });
  });
});

// PATCH: Status Decisions
app.patch("/api/admin/decision", (req, res) => {
  const { id, status, housing_status } = req.body;
  if (!id) return res.status(400).json({ error: "Missing ID" });

  db.run(
    `UPDATE applicants SET status = COALESCE(?, status), housing_status = COALESCE(?, housing_status) WHERE id = ?`,
    [status, housing_status, id],
    function (err) {
      if (err) return res.status(500).json({ error: "Update failed" });
      return res.json({ success: true });
    }
  );
});

// GET: CSV Export
app.get("/api/admin/export", (req, res) => {
  db.all("SELECT * FROM applicants ORDER BY merit_score DESC", [], (err, rows) => {
    if (err) return res.status(500).send("Export failed");
    let csv = "Ref,Name,Gender,Phone,Telegram,School,Grade,GPA,NationalExam,Score,Status,Housing\n";
    (rows || []).forEach((r) => {
      csv += `"${r.app_ref}","${r.full_name}","${r.gender}","${r.phone}","${r.telegram}","${r.school_name}",${r.grade_level},${r.gpa},${r.national_score || 0},${r.merit_score},"${r.status}","${r.housing_status}"\n`;
    });
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=ShasheCoders_Applicants_2026.csv");
    res.send(csv);
  });
});

app.listen(PORT, () => {
  console.log(`SHASHECODERS PORTAL RUNNING ON PORT ${PORT}`);
});
