// Перетаскивание телефона и плавающей кнопки

/** На узких экранах телефон раскрыт почти на весь экран и не таскается */
export const isNarrow = () => window.innerWidth <= 500;

/** Держим элемент целиком в окне */
function clampPos(size, left, top) {
    return {
        left: Math.max(0, Math.min(left, window.innerWidth - size.width)),
        top: Math.max(0, Math.min(top, window.innerHeight - size.height)),
    };
}

export function placeAt(target, left, top) {
    target.style.left = `${left}px`;
    target.style.top = `${top}px`;
    target.style.right = 'auto';
    target.style.bottom = 'auto';
}

export function clampIntoView(target) {
    if (isNarrow() || !target.offsetWidth) return;
    // offset* не учитывают transform анимации появления, в отличие от getBoundingClientRect
    const size = { width: target.offsetWidth, height: target.offsetHeight };
    const { left, top } = clampPos(size, target.offsetLeft, target.offsetTop);
    if (left !== target.offsetLeft || top !== target.offsetTop) placeAt(target, left, top);
}

/**
 * Делает target перетаскиваемым за handle.
 * Возвращает функцию «был ли последний жест перетаскиванием», чтобы отличать клик от переноса.
 * @param {HTMLElement} handle
 * @param {HTMLElement} target
 * @param {(pos: {left: number, top: number}) => void} onDrop
 * @param {{ disableWhenNarrow?: boolean }} [options]
 */
export function makeDraggable(handle, target, onDrop, { disableWhenNarrow = false } = {}) {
    let start = null;
    let moved = false;

    handle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || (disableWhenNarrow && isNarrow())) return;
        if (/** @type {HTMLElement} */ (e.target).closest('[data-wv-action]')) return;
        const rect = target.getBoundingClientRect();
        start = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
        moved = false;
        handle.setPointerCapture(e.pointerId);
    });

    handle.addEventListener('pointermove', (e) => {
        if (!start) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (!moved && Math.hypot(dx, dy) < 5) return;
        moved = true;
        const { left, top } = clampPos(target.getBoundingClientRect(), start.left + dx, start.top + dy);
        placeAt(target, left, top);
    });

    const end = () => {
        if (start && moved) {
            const rect = target.getBoundingClientRect();
            onDrop({ left: rect.left, top: rect.top });
        }
        start = null;
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);

    return () => moved;
}
