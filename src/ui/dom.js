// Доступ к элементам телефона. Корень регистрируется один раз при создании.

/** @type {HTMLElement} */
let root;

export function setRoot(element) {
    root = element;
}

export function getRoot() {
    return root;
}

/** @returns {HTMLElement} */
export const $q = (sel) => root.querySelector(sel);
export const $qa = (sel) => /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll(sel));

/** Элемент по data-wv="name" */
export const el = (name) => $q(`[data-wv="${name}"]`);
