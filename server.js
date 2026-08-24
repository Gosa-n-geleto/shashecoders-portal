const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(__dirname));

const db = new sqlite3.Database("shashecoders.db");

// Database Initialization
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
      transcript_url TEXT,
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

  db.run(`
    CREATE TABLE IF NOT EXISTS classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      instructor TEXT NOT NULL,
      topic_category TEXT NOT NULL,
      materials_url TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS quizzes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_number INTEGER NOT NULL,
      challenge_title TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      prompt TEXT NOT NULL,
      starter_code TEXT NOT NULL,
      function_name TEXT NOT NULL,
      test_arg TEXT NOT NULL,
      expected_output TEXT NOT NULL
    )
  `);

  // Clear and Re-seed 7-Week 5-Day Curriculum
  db.run("DELETE FROM classes", () => {
    const stmt = db.prepare("INSERT INTO classes (week_number, title, instructor, topic_category, materials_url) VALUES (?, ?, ?, ?, ?)");
    stmt.run(1, "Week 1: Web Fundamentals & Structural Design (HTML5, Semantic UI, CSS3)", "Feyisa Balcha & Faculty", "Web Fundamentals", "#week1");
    stmt.run(2, "Week 2: Programming Fundamentals & Computational Logic (JavaScript / Python)", "Muhafiz Ahmed & Faculty", "Programming Core", "#week2");
    stmt.run(3, "Week 3: Linear Data Structures & Array Algorithms (Two-Pointer & Sliding Window)", "Gosa Negeso & Kalid Beshir", "Data Structures", "#week3");
    stmt.run(4, "Week 4: Hash Tables, String Invariants & Asymptotic Complexity Analysis", "Gosa Negeso (590/600 Scorer)", "Algorithms", "#week4");
    stmt.run(5, "Week 5: Recursion, Divide-and-Conquer & Non-Linear Trees (BST & Inversions)", "Kalid Beshir & Gosa Negeso", "Trees & Recursion", "#week5");
    stmt.run(6, "Week 6: Full-Stack Engineering, REST APIs & SQLite Database Persistence", "Feyisa Balcha & Muhafiz Ahmed", "Systems & Databases", "#week6");
    stmt.run(7, "Week 7: Regional Capstone Development, Algorithm Showcase & Honors Graduation", "Executive Board & Municipal Sponsors", "Capstone & Graduation", "#week7");
    stmt.finalize();
  });

  // Seed default quizzes
  db.get("SELECT COUNT(*) as count FROM quizzes", (err, row) => {
    if (row && row.count === 0) {
      const qStmt = db.prepare("INSERT INTO quizzes (week_number, challenge_title, difficulty, prompt, starter_code, function_name, test_arg, expected_output) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      qStmt.run(
        1,
        "Two-Pointer Target Search (Sorted Array)",
        "Easy",
        "Implement twoSum(numbers, target) that returns 1-based indices in O(N) time and O(1) space.",
        "function solution(numbers, target) {\n  let left = 0, right = numbers.length - 1;\n  while (left < right) {\n    const sum = numbers[left] + numbers[right];\n    if (sum === target) return [left + 1, right + 1];\n    if (sum < target) left++;\n    else right--;\n  }\n  return [];\n}",
        "solution",
        "[[2, 7, 11, 15], 9]",
        "[1,2]"
      );
      qStmt.run(
        2,
        "Array Palindrome Recursive Check",
        "Medium",
        "Implement isPalindrome(str) to check if a sequence reads the same backwards and forwards recursively.",
        "function solution(str) {\n  if (str.length <= 1) return true;\n  if (str[0] !== str[str.length - 1]) return false;\n  return solution(str.slice(1, -1));\n}",
        "solution",
        "['racecar']",
        "true"
      );
      qStmt.run(
        3,
        "Kadane's Linear Maximum Subarray",
        "Hard",
        "Implement maxSubArray(nums) to return maximum contiguous subarray sum in O(N) time.",
        "function solution(nums) {\n  let maxSoFar = nums[0];\n  let currMax = nums[0];\n  for (let i = 1; i < nums.length; i++) {\n    currMax = Math.max(nums[i], currMax + nums[i]);\n    maxSoFar = Math.max(maxSoFar, currMax);\n  }\n  return maxSoFar;\n}",
        "solution",
        "[[-2, 1, -3, 4, -1, 2, 1, -5, 4]]",
        "6"
      );
      qStmt.finalize();
    }
  });
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

  if (data.portfolio_url && data.portfolio_url.trim().length > 5) score += 3;
  if (data.transcript_url && data.transcript_url.trim().length > 2) score += 2;

  return Math.round(score * 100) / 100;
}

// Fallback Route
app.get("/", (req, res) => {
  const publicPath = path.join(__dirname, "public", "index.html");
  const rootPath = path.join(__dirname, "index.html");
  if (fs.existsSync(publicPath)) return res.sendFile(publicPath);
  if (fs.existsSync(rootPath)) return res.sendFile(rootPath);
  return res.status(404).send("index.html not found");
});

// Authentication Endpoint
app.post("/api/auth/login", (req, res) => {
  const { passcode, role } = req.body;
  const KEYS = {
    BOARD_LEADER: "shashe2026leader",
    FACULTY: "shasheinstructor"
  };

  if (role === "BOARD_LEADER" && passcode === KEYS.BOARD_LEADER) {
    return res.json({ success: true, role: "BOARD_LEADER", token: "AUTH_BOARD_ROOT" });
  } else if (role === "FACULTY" && passcode === KEYS.FACULTY) {
    return res.json({ success: true, role: "FACULTY", token: "AUTH_FACULTY_ROOT" });
  }
  return res.status(401).json({ error: "Invalid credentials for the specified role." });
});

// Candidate Registration
app.post("/api/register", (req, res) => {
  const body = req.body;
  if (!body.full_name || !body.email || !body.phone || !body.telegram || !body.school_name || !body.gpa) {
    return res.status(400).json({ error: "All required academic fields must be completed." });
  }

  db.get("SELECT id FROM applicants WHERE email = ? OR phone = ?", [body.email.trim(), body.phone.trim()], (err, existing) => {
    if (err) return res.status(500).json({ error: "Database lookup error." });
    if (existing) return res.status(409).json({ error: "Applicant already registered with this email or phone." });

    db.get("SELECT COUNT(*) AS count FROM applicants", [], (err, countRow) => {
      const total = countRow ? countRow.count : 0;
      const appRef = `SC-2026-${String(total + 1).padStart(4, "0")}`;
      const meritScore = calculateMerit(body);
      const initialStatus = meritScore >= 65 ? "SCREENING_PASSED" : "PENDING";

      const insertQuery = `
        INSERT INTO applicants (
          app_ref, full_name, gender, email, phone, telegram, guardian_phone,
          zone, school_name, grade_level, gpa, national_score, experience_level,
          programming_langs, portfolio_url, transcript_url, algo_response1, algo_response2,
          statement_purpose, project_idea, needs_dorm, merit_score, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const params = [
        appRef, body.full_name.trim(), body.gender || "MALE", body.email.trim().toLowerCase(),
        body.phone.trim(), body.telegram.startsWith("@") ? body.telegram.trim() : `@${body.telegram.trim()}`,
        body.guardian_phone || "", body.zone || "West Arsi", body.school_name.trim(),
        parseInt(body.grade_level, 10) || 11, parseFloat(body.gpa) || 0,
        body.national_score ? parseFloat(body.national_score) : null,
        body.experience_level || "Beginner", body.programming_langs || "None",
        body.portfolio_url || null, body.transcript_url || null,
        body.algo_response1 || "", body.algo_response2 || "",
        body.statement_purpose || "", body.project_idea || "", body.needs_dorm ? 1 : 0,
        meritScore, initialStatus
      ];

      db.run(insertQuery, params, function (err) {
        if (err) return res.status(500).json({ error: "Storage error." });
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

// Candidates Listing & Analytics
app.get("/api/admin/candidates", (req, res) => {
  const search = req.query.search ? `%${req.query.search}%` : "%";
  const status = req.query.status;

  let query = `SELECT * FROM applicants WHERE (full_name LIKE ? OR school_name LIKE ? OR telegram LIKE ? OR app_ref LIKE ?)`;
  const params = [search, search, search, search];

  if (status && status !== "ALL") {
    query += " AND status = ?";
    params.push(status);
  }
  query += " ORDER BY merit_score DESC LIMIT 400";

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: "Data fetch failed." });

    db.get("SELECT COUNT(*) AS total FROM applicants", [], (err, totalRow) => {
      db.get("SELECT COUNT(*) AS dorms FROM applicants WHERE housing_status = 'DORM_ALLOCATED'", [], (err, dormRow) => {
        db.get("SELECT COUNT(*) AS accepted FROM applicants WHERE status = 'ACCEPTED'", [], (err, acceptedRow) => {
          db.all("SELECT school_name, COUNT(*) as count, ROUND(AVG(gpa), 1) as avg_gpa FROM applicants GROUP BY school_name ORDER BY count DESC LIMIT 6", [], (err, schoolStats) => {
            return res.json({
              metrics: {
                total_registered: totalRow ? totalRow.total : 0,
                dorm_allocated: dormRow ? dormRow.dorms : 0,
                dorm_capacity: 80,
                accepted_cohort: acceptedRow ? acceptedRow.accepted : 0
              },
              school_analytics: schoolStats || [],
              candidates: rows || []
            });
          });
        });
      });
    });
  });
});

// Admin Decision Update
app.patch("/api/admin/decision", (req, res) => {
  const { id, status, housing_status } = req.body;
  if (!id) return res.status(400).json({ error: "Missing candidate ID" });

  db.run(
    `UPDATE applicants SET status = COALESCE(?, status), housing_status = COALESCE(?, housing_status) WHERE id = ?`,
    [status, housing_status, id],
    function (err) {
      if (err) return res.status(500).json({ error: "Update failed" });
      return res.json({ success: true });
    }
  );
});

// Classes & Quizzes API
app.get("/api/academy/classes", (req, res) => {
  db.all("SELECT * FROM classes ORDER BY week_number ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: "Failed to fetch classes" });
    return res.json({ classes: rows || [] });
  });
});

app.get("/api/academy/quizzes", (req, res) => {
  db.all("SELECT * FROM quizzes ORDER BY week_number ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: "Failed to fetch quizzes" });
    return res.json({ quizzes: rows || [] });
  });
});

// CSV Export
app.get("/api/admin/export", (req, res) => {
  db.all("SELECT * FROM applicants ORDER BY merit_score DESC", [], (err, rows) => {
    if (err) return res.status(500).send("Export failed");
    let csv = "Ref,Name,Gender,Phone,Telegram,School,Grade,GPA,NationalExam,Score,TranscriptURL,Status,Housing\n";
    (rows || []).forEach((r) => {
      csv += `"${r.app_ref}","${r.full_name}","${r.gender}","${r.phone}","${r.telegram}","${r.school_name}",${r.grade_level},${r.gpa},${r.national_score || 0},${r.merit_score},"${r.transcript_url || ''}","${r.status}","${r.housing_status}"\n`;
    });
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=ShasheCoders_Cohort_2026.csv");
    res.send(csv);
  });
});

app.listen(PORT, () => {
  console.log(`SHASHECODERS ACADEMY 7-WEEK 5-DAY CURRICULUM RUNNING ON PORT ${PORT}`);
});
