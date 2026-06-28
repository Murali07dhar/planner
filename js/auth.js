// js/auth.js
// Google Auth wiring shared by index.html (dashboard) and board.html (canvas).
// Same ALLOWED_EMAILS gate as the original single-file version — unchanged logic,
// just lifted out so both pages can use it without duplicating the check.

import { auth } from './firebase.js';
import {
    GoogleAuthProvider,
    signInWithPopup,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

// --- ONLY THESE GOOGLE ACCOUNTS MAY ACCESS THE APP ---
export const ALLOWED_EMAILS = [
    "murali07dhar@gmail.com",
    "funinmotivation16@gmail.com"
];

const provider = new GoogleAuthProvider();

/**
 * Wires sign-in/out buttons (if present on the page) and starts the auth
 * listener. `onReady(user)` fires for an allowed, signed-in user.
 * `onSignedOut()` fires when there's no user, or the user isn't allowed.
 */
export function initAuth({ onReady, onSignedOut, userInfoEl, signInBtn, signOutBtn }) {
    onAuthStateChanged(auth, user => {
        if (user) {
            if (!ALLOWED_EMAILS.includes(user.email)) {
                if (userInfoEl) userInfoEl.textContent = 'Access denied for this account.';
                if (signInBtn) signInBtn.classList.add('hidden');
                if (signOutBtn) signOutBtn.classList.remove('hidden');
                signOut(auth);
                if (onSignedOut) onSignedOut();
                return;
            }
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
