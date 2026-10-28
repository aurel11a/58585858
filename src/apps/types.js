// Контракт приложения телефона (только для подсказок типов)

/**
 * @typedef {object} PhoneApp
 * @property {string} id                      ключ панели (data-wv-panel)
 * @property {string} icon                    SVG иконки в боковой панели
 * @property {() => string} title             подпись иконки
 * @property {boolean} [hasDot]               есть ли точка-уведомление на иконке
 * @property {boolean} [pinBottom]            иконка внизу боковой панели
 * @property {() => string} html              разметка внутри панели
 * @property {() => string} [overlayHtml]     разметка поверх всего экрана (ветки, подэкраны)
 * @property {() => void} [bind]              навесить слушатели на поля ввода
 * @property {(data: object|null) => void} render  перерисовать по данным чата
 * @property {(target: HTMLElement) => boolean} [onClick]  делегированный клик; true — обработано
 * @property {() => boolean} [onEscape]       Esc; true — обработано внутри приложения
 * @property {() => void} [onShow]            панель стала видимой
 * @property {() => void} [onChatChanged]     сменился чат таверны
 * @property {(clock: import('../core/story-clock.js').StoryClock) => void} [onClock]  обновились сюжетные дата/время
 */

export {};
