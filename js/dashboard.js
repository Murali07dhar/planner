// js/dashboard.js
// Powers index.html. Lists the signed-in user's boards, creates new ones,
// and navigates into board.html?board=<id>.
//
// Firestore shape: users/{uid}/boards/{boardId}
//   { title, description, createdAt, updatedAt, theme, noteCount }
//
// noteCount is a denormalized counter we keep on the board doc itself so the
// dashboard can show "N notes" without reading the notes subcollection.
// board.js is responsible for keeping it in sync (see updateNoteCount there).

import { db, auth } from './firebase.js';
import { initAuth } from './auth.js';
import {
    collection,
    doc,
    addDoc,
    deleteDoc,
    onSnapshot,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { formatTimestamp } from './utils.js';

const userInfoDiv = document.getElementById('userInfo');
const googleSignInBtn = document.getElementById('googleSignInBtn');
const signOutBtn = document.getElementById('signOutBtn');
const createBoardBtn = document.getElementById('createBoardBtn');
const boardsGrid = document.getElementById('boardsGrid');
const emptyState = document.getElementById('emptyState');

let boardsCollectionRef = null;
let unsubscribeBoards = null;

function boardsCollection(uid) {
    return collection(db, 'users', uid, 'boards');
}

function renderBoardCard(boardId, data) {
    const card = document.createElement('div');
    card.className = 'board-card';
    card.dataset.id = boardId;

    const title = document.createElement('h3');
    title.className = 'board-card-title';
    title.textContent = data.title || 'Untitled board';

    const meta = document.createElement('p');
    meta.className = 'board-card-meta';
    const updated = formatTimestamp(data.updatedAt || data.createdAt);
    const noteCount = typeof data.noteCount === 'number' ? data.noteCount : null;
    meta.textContent = noteCount !== null
        ? `Updated ${updated} · ${noteCount} note${noteCount === 1 ? '' : 's'}`
        : `Updated ${updated}`;

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'board-card-delete';
    deleteBtn.title = 'Delete board';
    deleteBtn.textContent = '✕';
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleDeleteBoard(boardId, data.title);
    });

    card.appendChild(deleteBtn);
    card.appendChild(title);
    card.appendChild(meta);

    card.addEventListener('click', () => {
        window.location.href = `board.html?board=${encodeURIComponent(boardId)}`;
    });

    return card;
}

function handleDeleteBoard(boardId, title) {
    // Lightweight confirm for now; swap for the shared modal if desired later.
    const ok = window.confirm(`Delete "${title || 'this board'}"? This cannot be undone.`);
    if (!ok) return;
    deleteDoc(doc(boardsCollectionRef, boardId)).catch(err => {
        console.error('Failed to delete board:', err);
        alert("Couldn't delete board. Check Firestore rules / permissions.");
    });
}

function toMillis(ts) {
    if (!ts) return 0;
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    if (typeof ts.toDate === 'function') return ts.toDate().getTime();
    return 0;
}

function renderBoards(snapshot) {
    boardsGrid.innerHTML = '';
    if (snapshot.empty) {
        emptyState.classList.remove('hidden');
        return;
    }
    emptyState.classList.add('hidden');

    const docs = snapshot.docs.slice().sort((a, b) => {
        const aData = a.data();
        const bData = b.data();
        const aTime = toMillis(aData.updatedAt) || toMillis(aData.createdAt);
        const bTime = toMillis(bData.updatedAt) || toMillis(bData.createdAt);
        return bTime - aTime;
    });

    docs.forEach(docSnap => {
        boardsGrid.appendChild(renderBoardCard(docSnap.id, docSnap.data()));
    });
}

function listenToBoards(uid) {
    boardsCollectionRef = boardsCollection(uid);
    if (unsubscribeBoards) unsubscribeBoards();
    // No orderBy here on purpose: a board doc briefly has no updatedAt
    // between creation and its first server round-trip, which can make an
    // orderBy('updatedAt') query throw or drop it. Sort client-side instead.
    unsubscribeBoards = onSnapshot(boardsCollectionRef, renderBoards, err => {
        console.error('Failed to load boards:', err);
        emptyState.classList.remove('hidden');
        const p = emptyState.querySelector('p');
        if (p) p.textContent = "Couldn't load boards. Check Firestore rules / permissions.";
    });
}

async function createBoard(uid) {
    const title = window.prompt('Board name:');
    if (!title || !title.trim()) return;

    try {
        const docRef = await addDoc(boardsCollection(uid), {
            title: title.trim(),
            description: '',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            theme: 'light',
            noteCount: 0
        });
        window.location.href = `board.html?board=${encodeURIComponent(docRef.id)}`;
    } catch (err) {
        console.error('Failed to create board:', err);
        alert("Couldn't create board. Check Firestore rules / permissions.");
    }
}

function teardown() {
    if (unsubscribeBoards) {
        unsubscribeBoards();
        unsubscribeBoards = null;
    }
    boardsGrid.innerHTML = '';
    emptyState.classList.add('hidden');
}

initAuth({
    userInfoEl: userInfoDiv,
    signInBtn: googleSignInBtn,
    signOutBtn: signOutBtn,
    onReady: (user) => {
        createBoardBtn.disabled = false;
        listenToBoards(user.uid);
    },
    onSignedOut: () => {
        createBoardBtn.disabled = true;
        teardown();
    }
});

createBoardBtn.addEventListener('click', () => {
    const user = auth.currentUser;
    if (!user) return;
    createBoard(user.uid);
});
