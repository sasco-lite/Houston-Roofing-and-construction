// Firebase Web SDK Modular setup using CDNs
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut,
  onAuthStateChanged,
  RecaptchaVerifier,
  signInWithPhoneNumber
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";

// Client configuration placeholders (must be replaced with target project keys)
export const firebaseConfig = {
  apiKey: "AIzaSyDummyKey_HoustonRoofingClientKey",
  authDomain: "houston-roofing-redesign.firebaseapp.com",
  projectId: "houston-roofing-redesign",
  storageBucket: "houston-roofing-redesign.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef123456"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export { 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  RecaptchaVerifier, 
  signInWithPhoneNumber 
};