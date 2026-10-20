import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { getDb, getAuth, verifyUserSession } from './lib/firebase.js';
import adminRouter from './admin.js';

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Role verification middleware
export async function requireAuth(req, res, next) {
  const user = await verifyUserSession(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized. Please sign in.' });
  }
  req.user = user;
  next();
}

// Session Creation
app.post('/api/session', async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) return res.status(400).json({ error: 'Missing ID token' });

  const expiresIn = 60 * 60 * 24 * 5 * 1000; // 5 days
  try {
    const auth = getAuth();
    const decodedToken = await auth.verifyIdToken(idToken);
    const sessionCookie = await auth.createSessionCookie(idToken, { expiresIn });

    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase());
    let role = 'customer';
    if (decodedToken.email && adminEmails.includes(decodedToken.email.toLowerCase())) {
      role = 'admin';
      await auth.setCustomUserClaims(decodedToken.uid, { role: 'admin' });
    }

    const db = getDb();
    const userRef = db.collection('users').doc(decodedToken.uid);
    await userRef.set({
      uid: decodedToken.uid,
      email: decodedToken.email || '',
      displayName: decodedToken.name || '',
      phone: decodedToken.phone_number || '',
      role: role,
      updatedAt: new Date().toISOString()
    }, { merge: true });

    res.cookie('__session', sessionCookie, {
      maxAge: expiresIn,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/'
    });

    return res.json({ status: 'success', role, uid: decodedToken.uid });
  } catch (err) {
    return res.status(401).json({ error: 'Failed to create session: ' + err.message });
  }
});

// Session Revocation
app.post('/api/logout', (req, res) => {
  res.clearCookie('__session', { path: '/' });
  res.json({ status: 'signed_out' });
});

// Open Slots Engine
app.get('/api/slots', async (req, res) => {
  try {
    const { date, serviceKey } = req.query; // date: YYYY-MM-DD
    if (!date) return res.status(400).json({ error: 'Date is required (YYYY-MM-DD)' });

    const db = getDb();
    const dayOfWeek = new Date(`${date}T00:00:00-06:00`).getDay(); // 0 is Sunday
    
    // Default business hours
    let startHour = 8;
    let endHour = 18;
    if (dayOfWeek === 6) { endHour = 16; } // Saturday
    if (dayOfWeek === 0) { startHour = 10; endHour = 16; } // Sunday

    const slots = [];
    for (let h = startHour; h < endHour; h++) {
      for (let m = 0; m < 60; m += 60) {
        const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        const slotKey = `${date}_${timeStr}`;
        slots.push({ key: slotKey, time: timeStr, available: true });
      }
    }

    // Check locked slots in Firestore
    const slotsSnapshot = await db.collection('slots')
      .where('date', '==', date)
      .get();

    const lockedKeys = new Set();
    slotsSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.capacity <= (data.bookedCount || 0)) {
        lockedKeys.add(doc.id);
      }
    });

    const result = slots.map(s => ({
      ...s,
      available: !lockedKeys.has(s.key)
    }));

    res.json({ date, slots: result });
  } catch (err) {
    res.status(500).json({ error: 'Slot calculation failed: ' + err.message });
  }
});

// Transactional Booking Creator
app.post('/api/bookings', requireAuth, async (req, res) => {
  const { slotKey, date, time, serviceType, address, notes, propertyType } = req.body;
  if (!slotKey || !date || !time || !serviceType || !address?.street || !address?.zip) {
    return res.status(400).json({ error: 'Missing required booking attributes.' });
  }

  const db = getDb();
  const slotRef = db.collection('slots').doc(slotKey);
  const appointmentRef = db.collection('appointments').doc();

  try {
    await db.runTransaction(async (t) => {
      const slotDoc = await t.get(slotRef);
      const bookedCount = slotDoc.exists ? (slotDoc.data().bookedCount || 0) : 0;
      const capacity = slotDoc.exists ? (slotDoc.data().capacity || 2) : 2;

      if (bookedCount >= capacity) {
        throw new Error('This timeslot is fully booked. Please choose another.');
      }

      t.set(slotRef, {
        date,
        time,
        bookedCount: bookedCount + 1,
        capacity
      }, { merge: true });

      t.set(appointmentRef, {
        id: appointmentRef.id,
        uid: req.user.uid,
        slotKey,
        serviceType,
        propertyType: propertyType || 'Single-family home',
        address,
        notes: notes || '',
        startAt: `${date}T${time}:00-06:00`,
        status: 'confirmed',
        createdAt: new Date().toISOString()
      });
    });

    res.json({ status: 'confirmed', appointmentId: appointmentRef.id });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

// User Appointments & Project Tracker
app.get('/api/my-dashboard', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const apptsSnap = await db.collection('appointments')
      .where('uid', '==', req.user.uid)
      .orderBy('startAt', 'asc')
      .get();

    const appointments = [];
    apptsSnap.forEach(d => appointments.push(d.data()));

    const projectsSnap = await db.collection('projects')
      .where('uid', '==', req.user.uid)
      .get();

    const projects = [];
    for (const pDoc of projectsSnap.docs) {
      const pData = pDoc.data();
      const eventsSnap = await pDoc.ref.collection('events')
        .where('visibleToCustomer', '==', true)
        .orderBy('timestamp', 'asc')
        .get();
      pData.events = eventsSnap.docs.map(e => e.data());
      projects.push(pData);
    }

    res.json({ appointments, projects });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch dashboard: ' + err.message });
  }
});

// Reschedule or Cancel Booking (24h cutoff check)
app.patch('/api/appointments/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { action, newSlotKey, newDate, newTime } = req.body;
  const db = getDb();
  const apptRef = db.collection('appointments').doc(id);

  try {
    const apptDoc = await apptRef.get();
    if (!apptDoc.exists) return res.status(404).json({ error: 'Appointment not found.' });
    const appt = apptDoc.data();

    if (appt.uid !== req.user.uid && req.user.role !== 'admin' && req.user.role !== 'staff') {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const apptTime = new Date(appt.startAt).getTime();
    const now = Date.now();
    const diffHours = (apptTime - now) / (1000 * 60 * 60);

    if (diffHours < 24 && req.user.role !== 'admin') {
      return res.status(400).json({ error: 'Changes within 24 hours of scheduled appointment require phone contact.' });
    }

    if (action === 'cancel') {
      await db.runTransaction(async (t) => {
        const slotRef = db.collection('slots').doc(appt.slotKey);
        const slotDoc = await t.get(slotRef);
        if (slotDoc.exists && slotDoc.data().bookedCount > 0) {
          t.update(slotRef, { bookedCount: slotDoc.data().bookedCount - 1 });
        }
        t.update(apptRef, { status: 'cancelled', updatedAt: new Date().toISOString() });
      });
      return res.json({ status: 'cancelled' });
    }

    res.status(400).json({ error: 'Invalid action' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public Active Announcements
app.get('/api/announcements', async (req, res) => {
  try {
    const db = getDb();
    const snap = await db.collection('announcements')
      .where('active', '==', true)
      .limit(3)
      .get();
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Route Mount
app.use('/api/admin', adminRouter);

if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
}

export default app;