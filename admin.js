import { Router } from 'express';
import { getDb, verifyUserSession } from './lib/firebase.js';

const router = Router();

// Staff and Admin Guard
async function requireStaffOrAdmin(req, res, next) {
  const user = await verifyUserSession(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const db = getDb();
  const userDoc = await db.collection('users').doc(user.uid).get();
  const role = userDoc.data()?.role;

  if (role !== 'admin' && role !== 'staff') {
    return res.status(403).json({ error: 'Restricted to administrative personnel.' });
  }

  req.user = { ...user, role };
  next();
}

router.use(requireStaffOrAdmin);

// Get All Appointments & Projects
router.get('/overview', async (req, res) => {
  try {
    const db = getDb();
    const apptsSnap = await db.collection('appointments').orderBy('startAt', 'desc').limit(50).get();
    const projectsSnap = await db.collection('projects').orderBy('startedAt', 'desc').limit(50).get();

    const appointments = apptsSnap.docs.map(d => d.data());
    const projects = projectsSnap.docs.map(d => d.data());

    res.json({ appointments, projects });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Promote Appointment into Active Project
router.post('/projects', async (req, res) => {
  const { appointmentId, uid, title, serviceType } = req.body;
  if (!uid || !title) return res.status(400).json({ error: 'UID and Title are required' });

  try {
    const db = getDb();
    const projRef = db.collection('projects').doc();
    const newProject = {
      id: projRef.id,
      uid,
      appointmentId: appointmentId || null,
      title,
      serviceType: serviceType || 'Residential Asphalt Replacement',
      stageKey: 'inspection-complete',
      stageLabel: 'Inspection Complete',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await projRef.set(newProject);

    await projRef.collection('events').add({
      stageKey: 'inspection-complete',
      title: 'Inspection Complete',
      note: 'Roof and attic inspected. Findings recorded and ready for options review.',
      visibleToCustomer: true,
      timestamp: new Date().toISOString()
    });

    res.json({ status: 'created', project: newProject });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Advance Project Stage
router.post('/projects/:id/advance', async (req, res) => {
  const { id } = req.params;
  const { stageKey, stageLabel, note, visibleToCustomer } = req.body;
  const db = getDb();

  try {
    const projRef = db.collection('projects').doc(id);
    await projRef.update({
      stageKey,
      stageLabel,
      updatedAt: new Date().toISOString()
    });

    await projRef.collection('events').add({
      stageKey,
      title: stageLabel,
      note: note || '',
      visibleToCustomer: visibleToCustomer ?? true,
      timestamp: new Date().toISOString()
    });

    res.json({ status: 'advanced', stageKey });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Publish Announcement
router.post('/announcements', async (req, res) => {
  const { title, body, severity } = req.body;
  const db = getDb();
  try {
    const docRef = await db.collection('announcements').add({
      title,
      body,
      severity: severity || 'info',
      active: true,
      createdAt: new Date().toISOString()
    });
    res.json({ status: 'published', id: docRef.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;