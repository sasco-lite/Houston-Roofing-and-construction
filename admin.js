const express = require('express');
const router = express.Router();

module.exports = function(getDb, hashPassword, verifyPassword, generateToken, hashToken) {
    // Admin Auth Middleware
    async function requireAdmin(req, res, next) {
        const token = req.cookies.admin_session;
        if (!token) return res.status(401).send(adminLoginTemplate(''));
        
        const db = await getDb();
        const session = await db.collection('sessions').findOne({ _id: hashToken(token), role: 'admin' });
        if (!session || session.expires < new Date()) {
            res.clearCookie('admin_session');
            return res.status(401).send(adminLoginTemplate('Session expired'));
        }
        next();
    }

    const adminLoginTemplate = (err) => `
        <!DOCTYPE html>
        <html>
        <head><title>Admin Login | Houston Roofing</title>
        <style>
            body { font-family: system-ui, sans-serif; background: #102238; color: white; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
            .login-box { background: white; color: #102238; padding: 40px; border-radius: 12px; width: 100%; max-width: 400px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
            input { width: 100%; padding: 12px; margin: 10px 0; border: 1px solid #ccc; border-radius: 6px; box-sizing: border-box; }
            button { width: 100%; background: #F47738; color: white; border: none; padding: 14px; border-radius: 6px; font-weight: bold; cursor: pointer; }
            .err { color: red; margin-bottom: 10px; font-size: 14px; }
        </style></head>
        <body>
            <div class="login-box">
                <h2 style="margin-top:0; text-align:center;">Admin Access</h2>
                ${err ? \`<div class="err">\${err}</div>\` : ''}
                <form method="POST" action="/admin/login">
                    <input type="text" name="username" placeholder="Username" required>
                    <input type="password" name="password" placeholder="Password" required>
                    <button type="submit">Login</button>
                </form>
            </div>
        </body>
        </html>
    `;

    router.post('/login', async (req, res) => {
        const { username, password } = req.body;
        if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
            const token = generateToken();
            const db = await getDb();
            await db.collection('sessions').insertOne({
                _id: hashToken(token),
                role: 'admin',
                expires: new Date(Date.now() + 12 * 60 * 60 * 1000) // 12 hours
            });
            res.cookie('admin_session', token, { httpOnly: true, secure: process.env.NODE_ENV==='production', sameSite: 'lax' });
            res.redirect('/admin');
        } else {
            res.status(401).send(adminLoginTemplate('Invalid credentials'));
        }
    });

    router.post('/logout', async (req, res) => {
        const token = req.cookies.admin_session;
        if (token) {
            const db = await getDb();
            await db.collection('sessions').deleteOne({ _id: hashToken(token), role: 'admin' });
        }
        res.clearCookie('admin_session');
        res.redirect('/admin');
    });

    // Main Dashboard UI
    router.get('/', requireAdmin, async (req, res) => {
        const db = await getDb();
        const bookingsCount = await db.collection('bookings').countDocuments({ status: 'requested' });
        const activeProjectsCount = await db.collection('projects').countDocuments({ stage: { $lt: 11 } });
        const settings = await db.collection('settings').findOne({ _id: 'global' });
        const pendingVerification = !settings.isApproved;

        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Admin Dashboard | Houston Roofing</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    :root { --bg: #F7F9FC; --nav: #102238; --card: #fff; --text: #273449; --accent: #F47738; --border: #e2e8f0; }
                    body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--text); margin: 0; display: flex; height: 100vh; }
                    aside { width: 250px; background: var(--nav); color: white; display: flex; flex-direction: column; }
                    aside h2 { padding: 20px; margin: 0; font-size: 18px; border-bottom: 1px solid rgba(255,255,255,0.1); }
                    .nav-btn { padding: 15px 20px; cursor: pointer; border: none; background: none; color: #a0b0c6; text-align: left; font-size: 16px; border-bottom: 1px solid rgba(255,255,255,0.05); }
                    .nav-btn:hover, .nav-btn.active { color: white; background: rgba(255,255,255,0.1); border-left: 4px solid var(--accent); }
                    main { flex: 1; padding: 30px; overflow-y: auto; }
                    .card { background: var(--card); padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); margin-bottom: 20px; border: 1px solid var(--border); }
                    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
                    .kpi { padding: 20px; border-radius: 8px; background: white; border: 1px solid var(--border); text-align: center; }
                    .kpi h3 { margin: 0 0 10px; font-size: 14px; color: #65748B; text-transform: uppercase; }
                    .kpi p { margin: 0; font-size: 32px; font-weight: bold; color: var(--nav); }
                    table { width: 100%; border-collapse: collapse; }
                    th, td { padding: 12px; text-align: left; border-bottom: 1px solid var(--border); }
                    th { background: #f8fafc; color: #65748B; font-size: 14px; }
                    .btn { background: var(--nav); color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 14px; }
                    .btn-accent { background: var(--accent); }
                    .alert { background: #F5C36B; color: #102238; padding: 12px 20px; border-radius: 8px; margin-bottom: 20px; font-weight: bold; }
                    .view { display: none; }
                    .view.active { display: block; }
                    input, select, textarea { width: 100%; padding: 10px; margin-top: 5px; margin-bottom: 15px; border: 1px solid var(--border); border-radius: 4px; box-sizing: border-box;}
                </style>
            </head>
            <body>
                <aside>
                    <h2>Houston Roofing</h2>
                    <button class="nav-btn active" onclick="switchTab('overview', this)">Dashboard</button>
                    <button class="nav-btn" onclick="switchTab('bookings', this)">Bookings</button>
                    <button class="nav-btn" onclick="switchTab('projects', this)">Projects</button>
                    <button class="nav-btn" onclick="switchTab('settings', this)">Settings & Claims</button>
                    <form method="POST" action="/admin/logout" style="margin-top: auto;">
                        <button type="submit" class="nav-btn" style="width: 100%; border-top: 1px solid rgba(255,255,255,0.1);">Logout</button>
                    </form>
                </aside>
                <main>
                    ${pendingVerification ? \`<div class="alert">Site is pending client approval. Public indexing is DISABLED. Review 'Settings & Claims' to approve.</div>\` : ''}
                    
                    <div id="overview" class="view active">
                        <h2 style="margin-top:0;">Overview</h2>
                        <div class="grid">
                            <div class="kpi"><h3>Pending Requests</h3><p>${bookingsCount}</p></div>
                            <div class="kpi"><h3>Active Projects</h3><p>${activeProjectsCount}</p></div>
                        </div>
                    </div>

                    <div id="bookings" class="view">
                        <h2 style="margin-top:0; display:flex; justify-content:space-between;">Bookings <button class="btn" onclick="loadBookings()">Refresh</button></h2>
                        <div class="card" style="overflow-x: auto;">
                            <table id="bookingsTable">
                                <thead><tr><th>Ref</th><th>Customer</th><th>Service</th><th>Date/Time</th><th>Status</th><th>Actions</th></tr></thead>
                                <tbody><tr><td colspan="6">Loading...</td></tr></tbody>
                            </table>
                        </div>
                    </div>

                    <div id="projects" class="view">
                        <h2 style="margin-top:0; display:flex; justify-content:space-between;">Projects <button class="btn" onclick="loadProjects()">Refresh</button></h2>
                        <div class="card" style="overflow-x: auto;">
                            <table id="projectsTable">
                                <thead><tr><th>Ref</th><th>Customer</th><th>Stage</th><th>Last Updated</th><th>Actions</th></tr></thead>
                                <tbody><tr><td colspan="5">Loading...</td></tr></tbody>
                            </table>
                        </div>
                    </div>

                    <div id="settings" class="view">
                        <h2 style="margin-top:0;">Verification & Settings</h2>
                        <div class="card">
                            <h3>Client Claims Approval</h3>
                            <p style="font-size:14px; color:#65748B;">Verify these facts before enabling public indexing.</p>
                            <label><input type="checkbox" id="v_name" ${settings.isApproved ? 'checked' : ''}> Business Legal Name Verified</label><br>
                            <label><input type="checkbox" id="v_hours" ${settings.isApproved ? 'checked' : ''}> Business Hours Confirmed</label><br>
                            <label><input type="checkbox" id="v_cert" ${settings.isApproved ? 'checked' : ''}> GAF Master Elite / RCAT Status Verified</label><br>
                            <label><input type="checkbox" id="v_legal" ${settings.isApproved ? 'checked' : ''}> Insurance & Legal Text Approved by Counsel</label><br>
                            <button class="btn btn-accent" style="margin-top: 15px;" onclick="approveSite()">Confirm & Publish Site</button>
                        </div>
                    </div>
                </main>

                <script>
                    function switchTab(id, el) {
                        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
                        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
                        document.getElementById(id).classList.add('active');
                        el.classList.add('active');
                        if (id === 'bookings') loadBookings();
                        if (id === 'projects') loadProjects();
                    }

                    async function loadBookings() {
                        const res = await fetch('/admin/api/bookings');
                        const data = await res.json();
                        const tbody = document.querySelector('#bookingsTable tbody');
                        tbody.innerHTML = data.map(b => \`
                            <tr>
                                <td>\${b.reference}</td>
                                <td>\${b.user ? b.user.name : 'Guest'}</td>
                                <td>\${b.service}</td>
                                <td>\${b.date} \${b.time}</td>
                                <td>\${b.status}</td>
                                <td>
                                    <select onchange="updateBookingStatus('\${b._id}', this.value)" style="margin:0; width:auto; padding:4px;">
                                        <option value="requested" \${b.status==='requested'?'selected':''}>Requested</option>
                                        <option value="confirmed" \${b.status==='confirmed'?'selected':''}>Confirmed</option>
                                        <option value="cancelled" \${b.status==='cancelled'?'selected':''}>Cancelled</option>
                                    </select>
                                </td>
                            </tr>
                        \`).join('') || '<tr><td colspan="6">No bookings found.</td></tr>';
                    }

                    async function loadProjects() {
                        const res = await fetch('/admin/api/projects');
                        const data = await res.json();
                        const tbody = document.querySelector('#projectsTable tbody');
                        tbody.innerHTML = data.map(p => \`
                            <tr>
                                <td>\${p.booking ? p.booking.reference : 'N/A'}</td>
                                <td>\${p.user ? p.user.name : 'Unknown'}</td>
                                <td>
                                    <select onchange="updateProjectStage('\${p._id}', this.value)" style="margin:0; width:auto; padding:4px;">
                                        \${[
                                            'Request received','Inspection scheduled','Inspection complete',
                                            'Estimate delivered','Agreement signed','Materials and permits',
                                            'Installation scheduled','Work in progress','Final inspection',
                                            'Warranty registered','Complete'
                                        ].map((s,i) => \`<option value="\${i+1}" \${p.stage===(i+1)?'selected':''}>\${i+1}. \${s}</option>\`).join('')}
                                    </select>
                                </td>
                                <td>\${new Date(p.updatedAt).toLocaleDateString()}</td>
                                <td><button class="btn" onclick="addNote('\${p._id}')">Add Note</button></td>
                            </tr>
                        \`).join('') || '<tr><td colspan="5">No projects found.</td></tr>';
                    }

                    async function updateBookingStatus(id, status) {
                        await fetch(\`/admin/api/bookings/\${id}\`, {
                            method: 'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({status})
                        });
                        alert('Updated successfully');
                    }

                    async function updateProjectStage(id, stageStr) {
                        const stage = parseInt(stageStr);
                        const names = ['','Request received','Inspection scheduled','Inspection complete','Estimate delivered','Agreement signed','Materials and permits','Installation scheduled','Work in progress','Final inspection','Warranty registered','Complete'];
                        await fetch(\`/admin/api/projects/\${id}\`, {
                            method: 'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({stage, stageName: names[stage]})
                        });
                        alert('Stage updated');
                    }

                    async function addNote(id) {
                        const text = prompt('Enter a customer-visible note:');
                        if (!text) return;
                        await fetch(\`/admin/api/projects/\${id}/notes\`, {
                            method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({text})
                        });
                        alert('Note added');
                    }

                    async function approveSite() {
                        const c1 = document.getElementById('v_name').checked;
                        const c2 = document.getElementById('v_hours').checked;
                        const c3 = document.getElementById('v_cert').checked;
                        const c4 = document.getElementById('v_legal').checked;
                        if (!(c1 && c2 && c3 && c4)) return alert('You must check all verification boxes before publishing.');
                        
                        await fetch('/admin/api/settings/approve', { method: 'POST' });
                        alert('Site Approved. It will now be indexable by search engines.');
                        window.location.reload();
                    }
                </script>
            </body>
            </html>
        `;
        res.send(html);
    });

    // Admin APIs
    const { ObjectId } = require('mongodb');

    router.get('/api/bookings', requireAdmin, async (req, res) => {
        const db = await getDb();
        const bookings = await db.collection('bookings').aggregate([
            { $sort: { date: -1, time: -1 } }, {$lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' } },
            { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } }
        ]).toArray();
        res.json(bookings);
    });

    router.patch('/api/bookings/:id', requireAdmin, async (req, res) => {
        const db = await getDb();
        await db.collection('bookings').updateOne({ _id: new ObjectId(req.params.id) }, { $set: { status: req.body.status } });
        res.json({ success: true });
    });

    router.get('/api/projects', requireAdmin, async (req, res) => {
        const db = await getDb();
        const projects = await db.collection('projects').aggregate([
            { $sort: { updatedAt: -1 } }, {$lookup: { from: 'bookings', localField: 'bookingId', foreignField: '_id', as: 'booking' } },
            { $unwind: { path: '$booking', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' } },
            { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } }
        ]).toArray();
        res.json(projects);
    });

    router.patch('/api/projects/:id', requireAdmin, async (req, res) => {
        const db = await getDb();
        await db.collection('projects').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { stage: req.body.stage, stageName: req.body.stageName, updatedAt: new Date() } }
        );
        res.json({ success: true });
    });

    router.post('/api/projects/:id/notes', requireAdmin, async (req, res) => {
        const db = await getDb();
        const note = { id: new ObjectId(), text: req.body.text, timestamp: new Date() };
        await db.collection('projects').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $push: { notes: note },$set: { updatedAt: new Date() } }
        );
        res.json({ success: true });
    });

    router.post('/api/settings/approve', requireAdmin, async (req, res) => {
        const db = await getDb();
        await db.collection('settings').updateOne({ _id: 'global' }, { $set: { isApproved: true } });
        res.json({ success: true });
    });

    return router;
}
