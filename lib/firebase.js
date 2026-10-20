import admin from 'firebase-admin';

let app;

export function getAdminApp() {
  if (admin.apps.length > 0) {
    return admin.app();
  }

  const b64Key = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64Key) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_B64 environment variable is missing.');
  }

  const serviceAccount = JSON.parse(Buffer.from(b64Key, 'base64').toString('utf-8'));

  app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });

  return app;
}

export function getDb() {
  getAdminApp();
  return admin.firestore();
}

export function getAuth() {
  getAdminApp();
  return admin.auth();
}

export async function verifyUserSession(req) {
  const sessionCookie = req.cookies?.__session || req.headers.authorization?.replace('Bearer ', '');
  if (!sessionCookie) return null;

  try {
    const auth = getAuth();
    const decodedClaims = await auth.verifySessionCookie(sessionCookie, true).catch(async () => {
      return await auth.verifyIdToken(sessionCookie);
    });
    return decodedClaims;
  } catch {
    return null;
  }
}