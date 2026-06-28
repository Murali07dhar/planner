// js/ui.js
// Tiny shared UI bits used on both pages (theme toggle today, more later).

export function initThemeToggle(buttonEl) {
    if (!buttonEl) return;
    buttonEl.addEventListener('click', () => {
        document.documentElement.classList.toggle('dark');
    });
}
