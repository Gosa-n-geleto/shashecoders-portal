const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database setup
const db = new sqlite3.Database('./admissions.db', (err) => {
  if (err) console.error('DB Error:', err.message);
  else console.log('Connected to admissions SQLite database.');
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_ref TEXT UNIQUE,
      full_name TEXT NOT NULL,
      gender TEXT,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      telegram TEXT NOT NULL,
      guardian_phone TEXT,
      zone TEXT,
      school_name TEXT NOT NULL,
      grade_level INTEGER,
      gpa REAL,
      national_score REAL,
      transcript_url TEXT,
      algo_response1 TEXT,
      algo_response2 TEXT,
      statement_purpose TEXT,
      project_idea TEXT,
      needs_dorm INTEGER,
      merit_score INTEGER,
      status TEXT DEFAULT 'PENDING',
      housing_status TEXT DEFAULT 'PENDING',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// Rebalanced Merit Score Calculation (Without Experience Barrier)
function calculateMeritScore(data) {
  let score = 0;

  // 1. High School GPA (Max 40 pts)
  const gpa = parseFloat(data.gpa) || 0;
  score += Math.min(40, (gpa / 100) * 40);

  // 2. National Examination Score (Max 20 pts)
  const nat = parseFloat(data.national_score);
  if (!isNaN(nat) && nat > 0) {
    score += Math.min(20, (nat / 600) * 20);
  } else {
    // Extrapolate fairly from GPA if applicant hasn't taken national exam yet
    score += Math.min(20, (gpa / 100) * 20);
  }

  // 3. Algorithmic & Logical Problem-Solving Screening (Max 25 pts)
  const a1 = (data.algo_response1 || '').toLowerCase();
  const a2 = (data.algo_response2 || '').toLowerCase();

  // Challenge 1: Two-sum logic (12.5 pts)
  if (a1.includes('hash') || a1.includes('map') || a1.includes('dict') || a1.includes('o(n)') || a1.includes('pointer') || a1.includes('lookup')) {
    score += 12.5;
  } else if (a1.length > 20) {
    score += 6;
  }

  // Challenge 2: Recursive logic (12.5 pts)
  if (a2.includes('base case') || a2.includes('recursive') || a2.includes('stack') || a2.includes('subproblem') || a2.includes('tree') || a2.includes('return')) {
    score += 12.5;
  } else if (a2.length > 20) {
    score += 6;
  }

  // 4. Statement of Purpose & Regional Vision (Max 15 pts)
  const sopLen = (data.statement_purpose || '').trim().length;
  const projLen = (data.project_idea || '').trim().length;
  if (sopLen > 40) score += 7.5;
  else if (sopLen > 10) score += 4;
  if (projLen > 40) score += 7.5;
  else if (projLen > 10) score += 4;

  return Math.min(100, Math.round(score));
}

// Register Candidate
app.post('/api/register', (req, res) => {
  const data = req.body;
  if (!data.full_name || !data.email || !data.phone || !data.telegram || !data.school_name) {
    return res.status(400).json({ error: 'Missing required admission fields.' });
  }

  const merit_score = calculateMeritScore(data);
  const status = merit_score >= 65 ? 'SCREENING_PASSED' : 'PENDING';
  const app_ref = `SC-2026-${Math.floor(1000 + Math.random() * 9000)}`;
  const needs_dorm = data.needs_dorm ? 1 : 0;

  const sql = `
    INSERT INTO candidates (
      app_ref, full_name, gender, email, phone, telegram, guardian_phone,
      zone, school_name, grade_level, gpa, national_score, transcript_url,
      algo_response1, algo_response2, statement_purpose, project_idea,
      needs_dorm, merit_score, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const params = [
    app_ref, data.full_name, data.gender, data.email, data.phone, data.telegram,
    data.guardian_phone || '', data.zone || '', data.school_name,
    parseInt(data.grade_level) || 11, parseFloat(data.gpa) || 0,
    parseFloat(data.national_score) || null, data.transcript_url || '',
    data.algo_response1 || '', data.algo_response2 || '',
    data.statement_purpose || '', data.project_idea || '',
    needs_dorm, merit_score, status
  ];

  db.run(sql, params, function(err) {
    if (err) return res.status(500).json({ error: 'Failed to record candidate.' });
    res.json({
      success: true,
      app_ref,
      candidate_name: data.full_name,
      merit_score,
      status
    });
  });
});

// Admin Passcode Auth
app.post('/api/auth/login', (req, res) => {
  const { role, passcode } = req.body;
  if (role === 'BOARD_LEADER' && passcode === 'shashe2026leader') {
    return res.json({ success: true, role: 'BOARD_LEADER' });
  }
  if (role === 'FACULTY' && passcode === 'shasheinstructor') {
    return res.json({ success: true, role: 'FACULTY' });
  }
  res.status(401).json({ error: 'Invalid credentials for the specified role.' });
});

// Candidate Registry & Analytics
app.get('/api/admin/candidates', (req, res) => {
  const { search = '', status = 'ALL' } = req.query;

  let query = `SELECT * FROM candidates WHERE 1=1`;
  const params = [];

  if (status !== 'ALL') {
    query += ` AND status = ?`;
    params.push(status);
  }

  if (search.trim()) {
    query += ` AND (full_name LIKE ? OR school_name LIKE ? OR telegram LIKE ? OR app_ref LIKE ?)`;
    const s = `%${search.trim()}%`;
    params.push(s, s, s, s);
  }

  query += ` ORDER BY merit_score DESC, id ASC`;

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database read error' });

    db.get(`
      SELECT 
        COUNT(*) as total_registered,
        SUM(CASE WHEN housing_status = 'DORM_ALLOCATED' THEN 1 ELSE 0 END) as dorm_allocated,
        SUM(CASE WHEN status = 'ACCEPTED' THEN 1 ELSE 0 END) as accepted_cohort,
        SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) as rejected_cohort
      FROM candidates
    `, [], (err, metrics) => {
      
      db.all(`
        SELECT school_name, COUNT(*) as count, ROUND(AVG(gpa), 1) as avg_gpa
        FROM candidates
        GROUP BY school_name
        ORDER BY count DESC
        LIMIT 6
      `, [], (err, schoolAnalytics) => {
        res.json({
          candidates: rows,
          metrics: metrics || { total_registered: 0, dorm_allocated: 0, accepted_cohort: 0, rejected_cohort: 0 },
          school_analytics: schoolAnalytics || []
        });
      });
    });
  });
});

// Admit / Reject Decision Endpoint with Automated Notification Handler
app.patch('/api/admin/decision', (req, res) => {
  const { id, status, housing_status } = req.body;
  if (!id || !status) return res.status(400).json({ error: 'Missing decision parameters.' });

  db.get(`SELECT * FROM candidates WHERE id = ?`, [id], (err, candidate) => {
    if (err || !candidate) return res.status(404).json({ error: 'Candidate not found.' });

    db.run(
      `UPDATE candidates SET status = ?, housing_status = ? WHERE id = ?`,
      [status, housing_status || 'PENDING', id],
      function(err) {
        if (err) return res.status(500).json({ error: 'Decision update failed.' });

        // Dispatch decision log & build notification payload
        const notification = {
          candidate_name: candidate.full_name,
          telegram: candidate.telegram,
          email: candidate.email,
          status,
          housing_status: housing_status || 'PENDING',
          app_ref: candidate.app_ref
        };

        console.log(`[DECISION NOTIFICATION DISPATCHED] To: ${candidate.email} & ${candidate.telegram} | Status: ${status}`);

        res.json({ 
          success: true, 
          message: `Decision updated to ${status}. Notification dispatched.`,
          notification
        });
      }
    );
  });
});

// CSV Export
app.get('/api/admin/export', (req, res) => {
  db.all(`SELECT app_ref, full_name, gender, email, phone, telegram, school_name, grade_level, gpa, national_score, merit_score, status, housing_status FROM candidates ORDER BY merit_score DESC`, [], (err, rows) => {
    if (err) return res.status(500).send('Export failed');

    const headers = ['Ref Code', 'Full Name', 'Gender', 'Email', 'Phone', 'Telegram', 'School', 'Grade', 'GPA', 'National Exam', 'Merit Score', 'Status', 'Housing'];
    const csvRows = [headers.join(',')];

    rows.forEach(r => {
      csvRows.push([
        `"${r.app_ref}"`,
        `"${r.full_name}"`,
        `"${r.gender}"`,
        `"${r.email}"`,
        `"${r.phone}"`,
        `"${r.telegram}"`,
        `"${r.school_name}"`,
        r.grade_level,
        r.gpa,
        r.national_score || '',
        r.merit_score,
        `"${r.status}"`,
        `"${r.housing_status}"`
      ].join(','));
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="shashecoders_candidates_2026.csv"');
    res.send(csvRows.join('\n'));
  });
});

// Mock classes and quizzes
app.get('/api/academy/classes', (req, res) => {
  res.json({
    classes: [
      { week_number: 1, topic_category: 'Web Foundations', title: 'HTML5, Semantic UI & Responsive Design', instructor: 'Founding Faculty' },
      { week_number: 2, topic_category: 'Programming Logic', title: 'Computational Logic, Variables & Control Flow', instructor: 'Muhafiz Ahmed & Gosa Negeso' },
      { week_number: 3, topic_category: 'Linear Structures', title: 'Array Invariants, Two-Pointer & Sliding Window', instructor: 'Gosa Negeso & Kalid Beshir' },
      { week_number: 4, topic_category: 'Hash Tables', title: 'Hash Maps, Frequency Tables & Big-O Asymptotics', instructor: 'Gosa Negeso & Dr. Dida Midekso' },
      { week_number: 5, topic_category: 'Recursion & Trees', title: 'Recursive Call Stacks & Binary Search Trees', instructor: 'Kalid Beshir & Gosa Negeso' },
      { week_number: 6, topic_category: 'Full-Stack Systems', title: 'RESTful APIs, SQLite Databases & Cloud Deployments', instructor: 'Muhafiz Ahmed & Dr. Dida Midekso' },
      { week_number: 7, topic_category: 'Capstone & Honors', title: 'Municipal Software Showcase & Official Graduation', instructor: 'Founding Faculty Board' }
    ]
  });
});

app.get('/api/academy/quizzes', (req, res) => {
  res.json({
    quizzes: [
      {
        id: 1,
        week_number: 3,
        challenge_title: 'Two Sum Pointer Verification',
        difficulty: 'Core Algorithmic',
        prompt: 'Given a sorted array of integers nums and a target integer target, return true if two numbers add up to target, otherwise false in O(N) time.',
        starter_code: 'function solution(nums, target) {\n  let left = 0, right = nums.length - 1;\n  while (left < right) {\n    let sum = nums[left] + nums[right];\n    if (sum === target) return true;\n    else if (sum < target) left++;\n    else right--;\n  }\n  return false;\n}',
        test_arg: JSON.stringify([[2, 7, 11, 15], 9]),
        expected_output: 'true'
      },
      {
        id: 2,
        week_number: 5,
        challenge_title: 'Recursive Factorial Base Invariant',
        difficulty: 'Recursion',
        prompt: 'Compute n! recursively ensuring base condition terminates cleanly at n <= 1.',
        starter_code: 'function solution(n) {\n  if (n <= 1) return 1;\n  return n * solution(n - 1);\n}',
        test_arg: JSON.stringify([5]),
        expected_output: '120'
      }
    ]
  });
});

app.listen(PORT, () => {
  console.log(`ShasheCoders Academy Portal live on port ${PORT}`);
});
