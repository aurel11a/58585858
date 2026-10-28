// Общие константы и доступ к контексту таверны

export const MODULE = 'wavey';
export const LOG = '[Wavey]';
export const VERSION = '0.1.0';
export const TWEET_LIMIT = 280;

export const ctx = () => SillyTavern.getContext();
