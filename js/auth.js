// js/auth.js
// Google Auth wiring shared by index.html (dashboard) and board.html (canvas).
// Open access: any signed-in Google account can use the app. Privacy between
// accounts is enforced by Firestore rules (each uid only sees its own data),
// not by an email allowlist here.

import { auth } from './firebase.js';
import {
    GoogleAuthProvider,
    signInWithPopup,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

const provider = new GoogleAuthProvider();

/**
 * Wires sign-in/out buttons (if present on the page) and starts the auth
 * listener. `onReady(user)` fires for any signed-in user.
 * `onSignedOut()` fires when there's no user.
 */
export function initAuth({ onReady, onSignedOut, userInfoEl, signInBtn, signOutBtn }) {
    onAuthStateChanged(auth, user => {
        if (user) {
            const displayName = user.displayName || user.email || user.uid;
            if (userInfoEl) userInfoEl.innerHTML = `<strong>Editor:</strong><br>${displayName}`;
            if (signInBtn) signInBtn.classList.add('hidden');
            if (signOutBtn) signOutBtn.classList.remove('hidden');
            onReady(user);
        } else {
            if (userInfoEl) userInfoEl.textContent = 'Please sign in to continue.';
            if (signInBtn) signInBtn.classList.remove('hidden');
            if (signOutBtn) signOutBtn.classList.add('hidden');
            if (onSignedOut) onSignedOut();
        }
    });

    if (signInBtn) {
        signInBtn.addEventListener('click', async () => {
            try {
                await signInWithPopup(auth, provider);
            } catch (error) {
                console.error("Authentication failed:", error);
                if (userInfoEl) userInfoEl.textContent = 'Authentication Failed.';
            }
        });
    }

    if (signOutBtn) {
        signOutBtn.addEventListener('click', async () => {
            try {
                await signOut(auth);
            } catch (error) {
                console.error("Sign out failed:", error);
            }
        });
    }
}
