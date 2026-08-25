const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database Abstraction: Supports Managed PostgreSQL on Render or Local SQLite fallback
const isPostgres = Boolean(process.env.DATABASE_URL);
let pgPool = null;
let sqliteDb = null;

if (isPostgres) {
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  console.log('Connected to Render Managed PostgreSQL database.');
} else {
  sqliteDb = new sqlite3.Database('./admissions.db', (err) => {
    if (err) console.error('SQLite connection error:', err.message);
    else console.log('Connected to local SQLite database.');
  });
}

// Universal Query Helper
async function runQuery(text, params = []) {
  if (isPostgres) {
    let paramIndex = 1;
    const pgText = text.replace(/\?/g, () => `$${paramIndex++}`);
    const res = await pgPool.query(pgText, params);
    return { rows: res.rows, rowCount: res.rowCount };
  } else {
    return new Promise((resolve, reject) => {
      const isSelect = text.trim().toUpperCase().startsWith('SELECT');
      if (isSelect) {
        sqliteDb.all(text, params, (err, rows) => {
          if (err) reject(err);
          else resolve({ rows, rowCount: rows.length });
        });
      } else {
        sqliteDb.run(text, params, function(err) {
          if (err) reject(err);
          else resolve({ rows: [], rowCount: this.changes, lastID: this.lastID });
        });
      }
    });
  }
}

// Database Initialization
async function initDB() {
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS candidates (
      id ${isPostgres ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
      app_ref TEXT UNIQUE NOT NULL,
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
      needs_dorm INTEGER DEFAULT 1,
      merit_score INTEGER DEFAULT 0,
      status TEXT DEFAULT 'PENDING',
      housing_status TEXT DEFAULT 'PENDING',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  try {
    await runQuery(createTableSQL);
    console.log('Candidate table initialized successfully.');
  } catch (err) {
    console.error('Database initialization failed:', err);
  }
}
initDB();

// 100-Point Merit Score Calculation
function calculateMeritScore(data) {
  let score = 0;

  const gpa = parseFloat(data.gpa) || 0;
  score += Math.min(40, (gpa / 100) * 40);

  const nat = parseFloat(data.national_score);
  if (!isNaN(nat) && nat > 0) {
    score += Math.min(20, (nat / 600) * 20);
  } else {
    score += Math.min(20, (gpa / 100) * 20);
  }

  const a1 = (data.algo_response1 || '').toLowerCase();
  const a2 = (data.algo_response2 || '').toLowerCase();

  if (a1.includes('hash') || a1.includes('map') || a1.includes('dict') || a1.includes('o(n)') || a1.includes('pointer') || a1.includes('lookup')) {
    score += 12.5;
  } else if (a1.length > 20) {
    score += 6;
  }

  if (a2.includes('base case') || a2.includes('recursive') || a2.includes('stack') || a2.includes('subproblem') || a2.includes('tree') || a2.includes('return')) {
    score += 12.5;
  } else if (a2.length > 20) {
    score += 6;
  }

  const sopLen = (data.statement_purpose || '').trim().length;
  const projLen = (data.project_idea || '').trim().length;
  if (sopLen > 40) score += 7.5;
  else if (sopLen > 10) score += 4;
  if (projLen > 40) score += 7.5;
  else if (projLen > 10) score += 4;

  return Math.min(100, Math.round(score));
}

// Candidate Registration API
app.post('/api/register', async (req, res) => {
  const data = req.body;
  if (!data.full_name || !data.email || !data.phone || !data.telegram || !data.school_name) {
    return res.status(400).json({ error: 'Missing required admission fields.' });
  }

  const merit_score = calculateMeritScore(data);
  const status = merit_score >= 65 ? 'SCREENING_PASSED' : 'PENDING';
  const app_ref = `SC-2026-${Math.floor(1000 + Math.random() * 9000)}`;
  const needs_dorm = data.needs_dorm ? 1 : 0;

  const insertSQL = `
    INSERT INTO candidates (
      app_ref, full_name, gender, email, phone, telegram, guardian_phone,
      zone, school_name, grade_level, gpa, national_score, transcript_url,
      algo_response1, algo_response2, statement_purpose, project_idea,
      needs_dorm, merit_score, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const params = [
    app_ref, data.full_name, data.gender || 'OTHER', data.email, data.phone, data.telegram,
    data.guardian_phone || '', data.zone || '', data.school_name,
    parseInt(data.grade_level) || 11, parseFloat(data.gpa) || 0,
    parseFloat(data.national_score) || null, data.transcript_url || '',
    data.algo_response1 || '', data.algo_response2 || '',
    data.statement_purpose || '', data.project_idea || '',
    needs_dorm, merit_score, status
  ];

  try {
    await runQuery(insertSQL, params);
    res.json({
      success: true,
      app_ref,
      candidate_name: data.full_name,
      merit_score,
      status
    });
  } catch (err) {
    console.error('Registration query error:', err);
    res.status(500).json({ error: 'Failed to record candidate application.' });
  }
});

// Admin Passcode Authentication
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

// Candidate Registry & Real-Time Analytics
app.get('/api/admin/candidates', async (req, res) => {
  const { search = '', status = 'ALL' } = req.query;

  let query = `SELECT * FROM candidates WHERE 1=1`;
  const params = [];

  if (status !== 'ALL') {
    query += ` AND status = ?`;
    params.push(status);
  }

  if (search.trim()) {
    query += ` AND (full_name ILIKE ? OR school_name ILIKE ? OR telegram ILIKE ? OR app_ref ILIKE ?)`;
    const s = `%${search.trim()}%`;
    params.push(s, s, s, s);
  }

  query += ` ORDER BY merit_score DESC, id ASC`;

  try {
    const candidateResult = await runQuery(query, params);

    const metricsSQL = `
      SELECT 
        COUNT(*)::int as total_registered,
        SUM(CASE WHEN housing_status = 'DORM_ALLOCATED' THEN 1 ELSE 0 END)::int as dorm_allocated,
        SUM(CASE WHEN status = 'ACCEPTED' THEN 1 ELSE 0 END)::int as accepted_cohort,
        SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END)::int as rejected_cohort
      FROM candidates
    `;
    const metricsResult = await runQuery(metricsSQL);

    const schoolSQL = `
      SELECT school_name, COUNT(*)::int as count, ROUND(AVG(gpa)::numeric, 1) as avg_gpa
      FROM candidates
      GROUP BY school_name
      ORDER BY count DESC
      LIMIT 6
    `;
    const schoolResult = await runQuery(schoolSQL);

    res.json({
      candidates: candidateResult.rows,
      metrics: metricsResult.rows[0] || { total_registered: 0, dorm_allocated: 0, accepted_cohort: 0, rejected_cohort: 0 },
      school_analytics: schoolResult.rows || []
    });
  } catch (err) {
    console.error('Fetch error:', err);
    res.status(500).json({ error: 'Database read error' });
  }
});

// Admin Decision Endpoint
app.patch('/api/admin/decision', async (req, res) => {
  const { id, status, housing_status } = req.body;
  if (!id || !status) return res.status(400).json({ error: 'Missing decision parameters.' });

  try {
    const candidateCheck = await runQuery(`SELECT * FROM candidates WHERE id = ?`, [id]);
    const candidate = candidateCheck.rows[0];
    if (!candidate) return res.status(404).json({ error: 'Candidate not found.' });

    await runQuery(
      `UPDATE candidates SET status = ?, housing_status = ? WHERE id = ?`,
      [status, housing_status || 'PENDING', id]
    );

    res.json({ 
      success: true, 
      message: `Decision updated to ${status}.`
    });
  } catch (err) {
    console.error('Decision error:', err);
    res.status(500).json({ error: 'Decision update failed.' });
  }
});

// CSV Export Endpoint
app.get('/api/admin/export', async (req, res) => {
  try {
    const result = await runQuery(
      `SELECT app_ref, full_name, gender, email, phone, telegram, school_name, grade_level, gpa, national_score, merit_score, status, housing_status FROM candidates ORDER BY merit_score DESC`
    );

    const headers = ['Ref Code', 'Full Name', 'Gender', 'Email', 'Phone', 'Telegram', 'School', 'Grade', 'GPA', 'National Exam', 'Merit Score', 'Status', 'Housing'];
    const csvRows = [headers.join(',')];

    result.rows.forEach(r => {
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
  } catch (err) {
    res.status(500).send('Export failed');
  }
});

// Academy Modules
app.get('/api/academy/classes', (req, res) => {
  res.json({
    classes: [
      { week_number: 1, topic_category: 'Web Foundations', title: 'HTML5, Semantic UI & Responsive Design', instructor: 'Founding Faculty' },
      { week_number: 2, topic_category: 'Programming Logic', title: 'Computational Logic, Variables & Control Flow', instructor: 'Muhafiz Ahmed & Gosa Negeso' },
      { week_number: 3, topic_category: 'Linear Structures', title: 'Array Invariants, Two-Pointer & Sliding Window', instructor: 'Gosa Negeso & Kalid Beshir' },
      { week_number: 4, topic_category: 'Hash Tables', title: 'Hash Maps, Frequency Tables & Big-O Asymptotics', instructor: 'Gosa Negeso & Dr. Dida Midekso' },
      { week_number: 5, topic_category: 'Recursion & Trees', title: 'Recursive Call Stacks & Binary Search Trees', instructor: 'Kalid Beshir & Gosa Negeso' },
      { week_number: 6, topic_category: 'Full-Stack Systems', title: 'RESTful APIs, PostgreSQL Databases & Cloud Deployments', instructor: 'Muhafiz Ahmed & Dr. Dida Midekso' },
      { week_number: 7, topic_category: 'Capstone & Honors', title: 'Municipal Software Showcase & Official Graduation', instructor: 'Founding Faculty Board' }
    ]
  });
});

// Code Sandbox Diagnostic Quizzes
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
