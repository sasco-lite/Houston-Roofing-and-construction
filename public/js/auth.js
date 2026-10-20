import { 
  auth, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged 
} from './firebase-config.js';

export async function loginWithGoogle() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const idToken = await result.user.getIdToken();
    
    // Exchange with Backend for Session Cookie
    const res = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken })
    });
    
    if (!res.ok) throw new Error('Session establishment failed');
    return await res.json();
  } catch (err) {
    console.error('Login error:', err);
    throw err;
  }
}

export async function logoutUser() {
  await signOut(auth);
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login.html';
}

export function observeAuth(callback) {
  onAuthStateChanged(auth, async (user) => {
    callback(user);
  });
}