// js/utils.js
// Pure-ish DOM helpers shared by dashboard.js and board.js.
// No Firebase imports here on purpose, keeps this module dependency-free.

/**
 * Wires up the confirmation modal that already existed in the canvas.
 * Returns a `showConfirmationModal(message, onConfirm)` function.
 * Call this once per page that has the modal markup.
 */
export function initConfirmationModal() {
    const confirmationModal = document.getElementById('confirmation-modal');
    const modalText = document.getElementById('modal-text');
    const modalConfirmBtn = document.getElementById('modal-confirm-btn');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');

    let confirmAction = null;

    function showConfirmationModal(message, onConfirm) {
        modalText.textContent = message;
        confirmAction = onConfirm;
        confirmationModal.classList.remove('hidden');
    }

    function hideConfirmationModal() {
        confirmationModal.classList.add('hidden');
        confirmAction = null;
    }

    modalConfirmBtn.addEventListener('click', () => {
        if (confirmAction) confirmAction();
        hideConfirmationModal();
    });
    modalCancelBtn.addEventListener('click', hideConfirmationModal);

    return showConfirmationModal;
}

/**
 * Wires up the small message box used for connect-mode hints and write errors.
 * Returns { showMessage, hideMessage, flashError }.
 */
export function initMessageBox() {
    const messageBox = document.getElementById('message-box');
    const messageP = messageBox.querySelector('p');

    function showMessage(text) {
        messageP.textContent = text;
        messageBox.classList.remove('hidden');
    }

    function hideMessage() {
        messageBox.classList.add('hidden');
    }

    function flashError(text, ms = 4000) {
        messageP.textContent = text;
        messageBox.classList.remove('hidden');
        setTimeout(() => messageBox.classList.add('hidden'), ms);
    }

    return { showMessage, hideMessage, flashError };
}

/** Same handler as the original inline script, now reusable. */
export function makeWriteErrorHandler(flashError) {
    return function handleWriteError(error) {
        console.error("Firestore write failed:", error);
        flashError("Couldn't save change. Check Firestore rules / permissions.");
    };
}

export function randomRotation() {
    return Math.random() * 8 - 4;
}

/** Tiny query-param reader, used by board.html to get ?board=<id> */
export function getQueryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
}

/** Formats a Firestore Timestamp (or millis) into a short readable string. */
export function formatTimestamp(ts) {
    if (!ts) return '—';
    const date = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
