// js/board.js
// This is the original single-file canvas script, split into functions and
// pointed at users/{uid}/boards/{boardId}/notes + connections instead of the
// old hardcoded /boards/main-detective-board path.
//
// Every behavior from the original file is preserved 1:1:
// drag, resize, rotate, double-click edit, connect mode, delete mode,
// delete-connection mode, panning, theme toggle, confirmation modals,
// realtime sync. Nothing here is new except:
//   - boardId comes from ?board=<id> in the URL
//   - getBoardMeta() loads the board's title for the header
//   - updateNoteCount() keeps the dashboard's note count in sync

import { db, auth } from './firebase.js';
import { initAuth } from './auth.js';
import { initThemeToggle } from './ui.js';
import {
    initConfirmationModal,
    initMessageBox,
    makeWriteErrorHandler,
    randomRotation,
    getQueryParam
} from './utils.js';
import {
    doc,
    collection,
    onSnapshot,
    addDoc,
    updateDoc,
    deleteDoc,
    writeBatch,
    getDocs,
    getDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// ---------------------------------------------------------------------------
// DOM references (same elements as the original file)
// ---------------------------------------------------------------------------
const board = document.getElementById('board');
const panContainer = document.getElementById('pan-container');
const connectionsSvg = document.getElementById('connections-svg');
panContainer.appendChild(connectionsSvg);

const addNoteBtn = document.getElementById('addNoteBtn');
const connectModeBtn = document.getElementById('connectModeBtn');
const deleteConnectionBtn = document.getElementById('deleteConnectionBtn');
const deleteModeBtn = document.getElementById('deleteModeBtn');
const toggleThemeBtn = document.getElementById('toggleThemeBtn');
const clearBoardBtn = document.getElementById('clearBoardBtn');
const backToDashboardBtn = document.getElementById('backToDashboardBtn');
const boardTitleEl = document.getElementById('boardTitleDisplay');
const userInfoDiv = document.getElementById('userInfo');
const googleSignInBtn = document.getElementById('googleSignInBtn');
const signOutBtn = document.getElementById('signOutBtn');

const { showMessage, hideMessage, flashError } = initMessageBox();
const showConfirmationModal = initConfirmationModal();
const handleWriteError = makeWriteErrorHandler(flashError);

initThemeToggle(toggleThemeBtn);

// ---------------------------------------------------------------------------
// State (same variable set as the original script)
// ---------------------------------------------------------------------------
const boardId = getQueryParam('board');

let notesCollection;
let connectionsCollection;
let boardDocRef;
let unsubscribeNotes = null;
let unsubscribeConnections = null;

let localNotes = new Map();
let localConnections = new Map();
let activeNote = null;
let ghostNote = null;

let isDragging = false, isRotating = false, isResizing = false, isPanning = false;
let dragStartX, dragStartY;
let panX = 0, panY = 0, panStartX, panStartY;

let isConnectMode = false;
let isDeleteMode = false;
let isDeleteConnectionMode = false;
let firstConnectionPoint = null;

const MIN_NOTE_WIDTH = 120;
const MIN_NOTE_HEIGHT = 100;

// ---------------------------------------------------------------------------
// Bootstrapping: redirect home if no board id, otherwise wait for auth
// ---------------------------------------------------------------------------
if (!boardId) {
    window.location.href = 'index.html';
}

function setupBoardPaths(uid) {
    const boardPath = `users/${uid}/boards/${boardId}`;
    boardDocRef = doc(db, boardPath);
    notesCollection = collection(db, `${boardPath}/notes`);
    connectionsCollection = collection(db, `${boardPath}/connections`);
}

async function loadBoardMeta() {
    try {
        const snap = await getDoc(boardDocRef);
        if (!snap.exists()) {
            flashError('Board not found.');
            setTimeout(() => { window.location.href = 'index.html'; }, 1500);
            return;
        }
        if (boardTitleEl) boardTitleEl.textContent = snap.data().title || 'Untitled board';
    } catch (err) {
        console.error('Failed to load board metadata:', err);
        flashError("Couldn't load board. Check Firestore rules / permissions.");
    }
}

/** Keeps the denormalized noteCount on the board doc in sync for the dashboard. */
function updateNoteCount() {
    if (!boardDocRef) return;
    updateDoc(boardDocRef, {
        noteCount: localNotes.size,
        updatedAt: serverTimestamp()
    }).catch(() => { /* non-critical, ignore */ });
}

function touchBoardUpdatedAt() {
    if (!boardDocRef) return;
    updateDoc(boardDocRef, { updatedAt: serverTimestamp() }).catch(() => { /* non-critical */ });
}

// ---------------------------------------------------------------------------
// Realtime listeners (identical logic to the original setupRealtimeListeners)
// ---------------------------------------------------------------------------
function setupRealtimeListeners() {
    unsubscribeNotes = onSnapshot(notesCollection, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            const noteData = { id: change.doc.id, ...change.doc.data() };
            if (change.type === "added" || change.type === "modified") {
                localNotes.set(noteData.id, noteData);
                createOrUpdateNoteElement(noteData);
            }
            if (change.type === "removed") {
                const element = document.getElementById(noteData.id);
                if (element) element.remove();
                localNotes.delete(noteData.id);
            }
        });
        renderConnections();
        updateNoteCount();
    }, (err) => {
        console.error('Notes listener failed:', err);
        flashError("Couldn't load notes. Check Firestore rules / permissions.");
    });

    unsubscribeConnections = onSnapshot(connectionsCollection, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            const connData = { id: change.doc.id, ...change.doc.data() };
            if (change.type === "added" || change.type === "modified") {
                localConnections.set(connData.id, connData);
            }
            if (change.type === "removed") {
                localConnections.delete(connData.id);
            }
        });
        renderConnections();
    }, (err) => {
        console.error('Connections listener failed:', err);
        flashError("Couldn't load connections. Check Firestore rules / permissions.");
    });
}

function teardownRealtimeListeners() {
    if (unsubscribeNotes) { unsubscribeNotes(); unsubscribeNotes = null; }
    if (unsubscribeConnections) { unsubscribeConnections(); unsubscribeConnections = null; }
}

// ---------------------------------------------------------------------------
// Note rendering (identical to original createOrUpdateNoteElement)
// ---------------------------------------------------------------------------
function createOrUpdateNoteElement(noteData) {
    let noteEl = document.getElementById(noteData.id);
    if (!noteEl) {
        noteEl = document.createElement('div');
        noteEl.id = noteData.id;
        noteEl.className = 'note';
        noteEl.innerHTML = `<div class="note-pin"></div><div class="note-content"></div><div class="resize-handle"></div>`;
        panContainer.appendChild(noteEl);
        if (noteData.rotation === undefined) {
            const rotation = randomRotation();
            updateDoc(doc(notesCollection, noteData.id), { rotation }).catch(handleWriteError);
            noteData.rotation = rotation;
        }
        noteEl.addEventListener('mousedown', handleNoteMouseDown);
        noteEl.addEventListener('dblclick', startEditing);
        noteEl.addEventListener('click', handleNoteSingleClick);
    }
    noteEl.style.left = `${noteData.x || 50}px`;
    noteEl.style.top = `${noteData.y || 50}px`;
    noteEl.style.width = `${noteData.width || 200}px`;
    noteEl.style.height = `${noteData.height || 150}px`;
    noteEl.style.transform = `rotate(${noteData.rotation || 0}deg)`;
    const contentDiv = noteEl.querySelector('.note-content');
    contentDiv.textContent = noteData.text || 'Double-click to edit...';
    noteEl.classList.toggle('is-deletable', isDeleteMode);
}

function renderConnections() {
    connectionsSvg.innerHTML = '';

    // Arrowhead marker, defined once per render.
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', 'connection-arrow');
    marker.setAttribute('viewBox', '0 0 10 10');
    marker.setAttribute('refX', '8');
    marker.setAttribute('refY', '5');
    marker.setAttribute('markerWidth', '7');
    marker.setAttribute('markerHeight', '7');
    marker.setAttribute('orient', 'auto-start-reverse');
    const arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    arrowPath.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
    arrowPath.setAttribute('fill', '#6D5EF8');
    marker.appendChild(arrowPath);
    defs.appendChild(marker);
    connectionsSvg.appendChild(defs);

    localConnections.forEach(conn => {
        if (conn.path && conn.path.length >= 2) {
            const noteAData = localNotes.get(conn.path[0]);
            const noteBData = localNotes.get(conn.path[1]);
            if (noteAData && noteBData) {
                const noteAWidth = noteAData.width || 200;
                const noteAHeight = noteAData.height || 150;
                const noteBWidth = noteBData.width || 200;
                const noteBHeight = noteBData.height || 150;
                const x1 = noteAData.x + noteAWidth / 2;
                const y1 = noteAData.y + noteAHeight / 2;
                const x2 = noteBData.x + noteBWidth / 2;
                const y2 = noteBData.y + noteBHeight / 2;
                // Gentle curve through the midpoint, offset perpendicular to
                // the line so parallel connections don't overlap exactly.
                const mx = (x1 + x2) / 2;
                const my = (y1 + y2) / 2;
                const dx = x2 - x1;
                const dy = y2 - y1;
                const len = Math.hypot(dx, dy) || 1;
                const curveAmount = Math.min(len * 0.12, 40);
                const cx = mx - (dy / len) * curveAmount;
                const cy = my + (dx / len) * curveAmount;

                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.dataset.id = conn.id;
                path.classList.add('connection-line');
                path.classList.toggle('is-deletable', isDeleteConnectionMode);
                path.setAttribute('d', `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`);
                path.setAttribute('fill', 'none');
                path.setAttribute('stroke', '#6D5EF8');
                path.setAttribute('stroke-width', '2.5');
                path.setAttribute('stroke-linecap', 'round');
                path.setAttribute('marker-end', 'url(#connection-arrow)');
                path.addEventListener('click', handleDeleteConnectionClick);
                connectionsSvg.appendChild(path);
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Toolbar event wiring (identical to original)
// ---------------------------------------------------------------------------
addNoteBtn.addEventListener('mousedown', startAddNoteDrag);
board.addEventListener('mousedown', startPan);

if (backToDashboardBtn) {
    backToDashboardBtn.addEventListener('click', () => {
        window.location.href = 'index.html';
    });
}

clearBoardBtn.addEventListener('click', () => {
    showConfirmationModal('Clear the entire board? This cannot be undone.', async () => {
        const batch = writeBatch(db);
        const notesSnapshot = await getDocs(notesCollection);
        notesSnapshot.forEach(d => batch.delete(d.ref));
        const connectionsSnapshot = await getDocs(connectionsCollection);
        connectionsSnapshot.forEach(d => batch.delete(d.ref));
        await batch.commit();
        touchBoardUpdatedAt();
    });
});

connectModeBtn.addEventListener('click', () => {
    const wasActive = isConnectMode;
    deactivateAllModes();
    if (!wasActive) {
        isConnectMode = true;
        connectModeBtn.textContent = 'Cancel Connect';
        connectModeBtn.classList.replace('bg-red-500', 'bg-gray-500');
        showMessage('Click two notes to connect them.');
    }
});

deleteConnectionBtn.addEventListener('click', () => {
    const wasActive = isDeleteConnectionMode;
    deactivateAllModes();
    if (!wasActive) {
        isDeleteConnectionMode = true;
        deleteConnectionBtn.textContent = 'Cancel Delete';
        deleteConnectionBtn.classList.replace('bg-purple-500', 'bg-red-600');
        connectionsSvg.classList.add('is-active');
        document.querySelectorAll('.connection-line').forEach(line => line.classList.add('is-deletable'));
    }
});

deleteModeBtn.addEventListener('click', () => {
    const wasActive = isDeleteMode;
    deactivateAllModes();
    if (!wasActive) {
        isDeleteMode = true;
        deleteModeBtn.textContent = 'Cancel Delete';
        deleteModeBtn.classList.replace('bg-gray-600', 'bg-red-600');
        document.querySelectorAll('.note').forEach(n => n.classList.add('is-deletable'));
    }
});

// ---------------------------------------------------------------------------
// Note interaction handlers (identical to original)
// ---------------------------------------------------------------------------
function handleNoteSingleClick(e) {
    const noteEl = e.currentTarget;
    if (isDeleteMode) {
        deleteNoteById(noteEl.id);
        return;
    }
    if (isConnectMode) {
        handleConnectionClick(noteEl);
    }
}

function handleConnectionClick(noteEl) {
    if (!firstConnectionPoint) {
        firstConnectionPoint = noteEl.id;
        noteEl.style.outline = '3px solid #6D5EF8';
        showMessage("Selected first note. Click another to connect.");
    } else {
        if (firstConnectionPoint === noteEl.id) return;
        addDoc(connectionsCollection, { path: [firstConnectionPoint, noteEl.id] })
            .then(touchBoardUpdatedAt)
            .catch(handleWriteError);
        document.getElementById(firstConnectionPoint).style.outline = 'none';
        connectModeBtn.click();
    }
}

function handleDeleteConnectionClick(e) {
    if (!isDeleteConnectionMode) return;
    const connectionId = e.currentTarget.dataset.id;
    if (!connectionId) return;
    showConfirmationModal('Delete this connection?', async () => {
        await deleteDoc(doc(connectionsCollection, connectionId));
        touchBoardUpdatedAt();
        deleteConnectionBtn.click();
    });
}

function startEditing(e) {
    e.stopPropagation();
    deactivateAllModes();
    const noteEl = e.currentTarget;
    const contentDiv = noteEl.querySelector('.note-content');
    const noteData = localNotes.get(noteEl.id);
    const currentText = noteData ? noteData.text : '';
    const textarea = document.createElement('textarea');
    textarea.className = 'note-textarea';
    textarea.value = currentText === 'Double-click to edit...' ? '' : currentText;
    contentDiv.replaceWith(textarea);
    textarea.focus();
    textarea.select();
    const finishEditing = () => {
        const newText = textarea.value.trim();
        textarea.replaceWith(contentDiv);
        if (newText && newText !== currentText) {
            updateDoc(doc(notesCollection, noteEl.id), { text: newText })
                .then(touchBoardUpdatedAt)
                .catch(handleWriteError);
        } else if (!newText) {
            updateDoc(doc(notesCollection, noteEl.id), { text: 'Double-click to edit...' })
                .then(touchBoardUpdatedAt)
                .catch(handleWriteError);
        }
        noteEl.addEventListener('mousedown', handleNoteMouseDown);
    };
    noteEl.removeEventListener('mousedown', handleNoteMouseDown);
    textarea.addEventListener('blur', finishEditing);
    textarea.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') {
            textarea.value = currentText;
            textarea.blur();
        }
    });
}

async function deleteNoteById(noteId) {
    if (!noteId) return;
    showConfirmationModal('Delete this notebox and all its connections?', async () => {
        const batch = writeBatch(db);
        const connectionsToDelete = [];
        localConnections.forEach(conn => {
            if (conn.path && conn.path.includes(noteId)) {
                connectionsToDelete.push(conn.id);
            }
        });
        connectionsToDelete.forEach(connId => batch.delete(doc(connectionsCollection, connId)));
        batch.delete(doc(notesCollection, noteId));
        await batch.commit();
        touchBoardUpdatedAt();
        if (isDeleteMode) deleteModeBtn.click();
    });
}

function deactivateAllModes() {
    if (isConnectMode) {
        isConnectMode = false;
        connectModeBtn.textContent = 'Connect Note';
        connectModeBtn.classList.replace('bg-gray-500', 'bg-red-500');
        if (firstConnectionPoint) {
            const el = document.getElementById(firstConnectionPoint);
            if (el) el.style.outline = 'none';
        }
        firstConnectionPoint = null;
        hideMessage();
    }
    if (isDeleteConnectionMode) {
        isDeleteConnectionMode = false;
        deleteConnectionBtn.textContent = 'Delete Connection';
        deleteConnectionBtn.classList.replace('bg-red-600', 'bg-purple-500');
        connectionsSvg.classList.remove('is-active');
        document.querySelectorAll('.connection-line').forEach(line => line.classList.remove('is-deletable'));
    }
    if (isDeleteMode) {
        isDeleteMode = false;
        deleteModeBtn.textContent = 'Delete Note';
        deleteModeBtn.classList.replace('bg-red-600', 'bg-gray-600');
        document.querySelectorAll('.note').forEach(n => n.classList.remove('is-deletable'));
    }
}

// ---------------------------------------------------------------------------
// Drag / resize / rotate / pan (identical to original)
// ---------------------------------------------------------------------------
function handleNoteMouseDown(e) {
    if (e.target.tagName === 'TEXTAREA' || isConnectMode || isDeleteMode || isDeleteConnectionMode) return;
    activeNote = e.currentTarget;
    e.preventDefault();
    e.stopPropagation();
    if (e.target.classList.contains('resize-handle')) {
        isResizing = true;
        activeNote.classList.add('is-resizing');
    } else if (e.target.classList.contains('note-pin')) {
        isRotating = true;
        activeNote.classList.add('is-rotating');
    } else {
        isDragging = true;
        activeNote.classList.add('is-dragging');
        const noteData = localNotes.get(activeNote.id);
        activeNote.dataset.startX = noteData.x;
        activeNote.dataset.startY = noteData.y;
    }
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp, { once: true });
}

function onMouseMove(e) {
    if (isPanning) onPan(e);
    if (isDragging) onDrag(e);
    if (isResizing) onResize(e);
    if (isRotating) onRotate(e);
}

function onMouseUp(e) {
    if (isPanning) endPan(e);
    if (isDragging || isResizing || isRotating) endNoteInteraction(e);
}

function onDrag(e) {
    if (!activeNote) return;
    const startX = parseFloat(activeNote.dataset.startX);
    const startY = parseFloat(activeNote.dataset.startY);
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    const newX = startX + dx;
    const newY = startY + dy;
    activeNote.style.left = `${newX}px`;
    activeNote.style.top = `${newY}px`;
    const noteData = localNotes.get(activeNote.id);
    if (noteData) {
        noteData.x = newX;
        noteData.y = newY;
        renderConnections();
    }
}

function onResize(e) {
    if (!activeNote) return;
    const noteRect = activeNote.getBoundingClientRect();
    let newWidth = e.clientX - noteRect.left;
    let newHeight = e.clientY - noteRect.top;
    newWidth = Math.max(MIN_NOTE_WIDTH, newWidth);
    newHeight = Math.max(MIN_NOTE_HEIGHT, newHeight);
    activeNote.style.width = `${newWidth}px`;
    activeNote.style.height = `${newHeight}px`;
    const noteData = localNotes.get(activeNote.id);
    if (noteData) {
        noteData.width = newWidth;
        noteData.height = newHeight;
        renderConnections();
    }
}

function onRotate(e) {
    if (!activeNote) return;
    const noteRect = activeNote.getBoundingClientRect();
    const noteCenterX = noteRect.left + noteRect.width / 2;
    const noteCenterY = noteRect.top + noteRect.height / 2;
    const angleRad = Math.atan2(e.clientY - noteCenterY, e.clientX - noteCenterX);
    const angleDeg = angleRad * (180 / Math.PI) + 90;
    activeNote.style.transform = `rotate(${angleDeg}deg)`;
    const noteData = localNotes.get(activeNote.id);
    if (noteData) noteData.rotation = angleDeg;
}

function endNoteInteraction() {
    if (activeNote) {
        const noteId = activeNote.id;
        const noteData = localNotes.get(noteId);
        const updates = {};
        if (isDragging) {
            updates.x = noteData.x;
            updates.y = noteData.y;
        }
        if (isResizing) {
            updates.width = noteData.width;
            updates.height = noteData.height;
        }
        if (isRotating) {
            updates.rotation = noteData.rotation;
        }
        if (Object.keys(updates).length > 0) {
            updateDoc(doc(notesCollection, noteId), updates)
                .then(touchBoardUpdatedAt)
                .catch(handleWriteError);
        }
        activeNote.classList.remove('is-dragging', 'is-rotating', 'is-resizing');
    }
    isDragging = isRotating = isResizing = false;
    activeNote = null;
}

function startPan(e) {
    if (e.target !== board && e.target !== panContainer) return;
    e.preventDefault();
    isPanning = true;
    panStartX = e.clientX - panX;
    panStartY = e.clientY - panY;
    board.classList.add('is-panning');
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp, { once: true });
}

function onPan(e) {
    if (!isPanning) return;
    panX = e.clientX - panStartX;
    panY = e.clientY - panStartY;
    panContainer.style.transform = `translate(${panX}px, ${panY}px)`;
}

function endPan() {
    isPanning = false;
    board.classList.remove('is-panning');
}

// ---------------------------------------------------------------------------
// Add-note drag-to-place (identical to original)
// ---------------------------------------------------------------------------
function startAddNoteDrag(e) {
    e.preventDefault();
    ghostNote = document.createElement('div');
    ghostNote.className = 'note';
    ghostNote.style.position = 'absolute';
    ghostNote.style.zIndex = '1000';
    ghostNote.style.pointerEvents = 'none';
    ghostNote.style.opacity = '0.7';
    ghostNote.innerHTML = `<div class="note-pin"></div><div class="note-content">New note...</div>`;
    document.body.appendChild(ghostNote);
    moveGhostNote(e);
    window.addEventListener('mousemove', onAddNoteDrag);
    window.addEventListener('mouseup', endAddNoteDrag, { once: true });
}

function onAddNoteDrag(e) {
    moveGhostNote(e);
}

function moveGhostNote(e) {
    if (!ghostNote) return;
    ghostNote.style.left = `${e.clientX - 100}px`;
    ghostNote.style.top = `${e.clientY - 75}px`;
}

function endAddNoteDrag(e) {
    window.removeEventListener('mousemove', onAddNoteDrag);
    if (ghostNote) {
        ghostNote.remove();
        ghostNote = null;
    }
    const boardRect = board.getBoundingClientRect();
    if (e.clientX >= boardRect.left && e.clientX <= boardRect.right &&
        e.clientY >= boardRect.top && e.clientY <= boardRect.bottom) {
        const dropX = e.clientX - boardRect.left - 100 - panX;
        const dropY = e.clientY - boardRect.top - 75 - panY;
        addDoc(notesCollection, {
            text: 'Double-click to edit...',
            x: dropX,
            y: dropY,
            rotation: randomRotation(),
            width: 200,
            height: 150
        }).then(touchBoardUpdatedAt).catch(handleWriteError);
    }
}

// ---------------------------------------------------------------------------
// Auth wiring — gate the whole canvas same as the original
// ---------------------------------------------------------------------------
initAuth({
    userInfoEl: userInfoDiv,
    signInBtn: googleSignInBtn,
    signOutBtn: signOutBtn,
    onReady: (user) => {
        setupBoardPaths(user.uid);
        loadBoardMeta();
        setupRealtimeListeners();
    },
    onSignedOut: () => {
        teardownRealtimeListeners();
        localNotes.clear();
        localConnections.clear();
        document.querySelectorAll('.note').forEach(n => n.remove());
        connectionsSvg.innerHTML = '';
    }
});
