// Генерация «наполнения телефона» через экстра-API за один вызов:
// контакты юзера, логичные группы и переписки, которые уже идут.
// История чата в промпт не идёт — только карточки и сеттинг, чтобы не есть контекст.
// Mnema (если есть) — подсказка, не требование.

import { getLanguage } from '../../i18n.js';
import { ctx } from '../../core/context.js';
import { generate } from '../../core/api.js';
import { getApi } from '../../core/settings.js';
import { getMnemaPeople } from '../../core/mnema.js';
import { getStoryClock, getStoryNow } from '../../core/story-clock.js';
import {
    findContactByName, findGroupByName, getChat, getGroupChat, getStoryCharacters,
    makeContact, makeGroup, resolveContact, sanitizeCount, uniqueHandle,
} from '../../core/contacts.js';

const NEW_CONTACTS = 6;
const MAX_AGO_MINUTES = 60 * 24 * 14;

// Тексты не обрезаем: семья и друзья часто описаны в самом конце карточки,
// а за размер контекста отвечает юзер, выбирая модель.
const clean = (text) => String(text ?? '').replace(/\s+\n/g, '\n').trim();

const SYSTEM_PROMPT = `You fill USER's smartphone for an ongoing roleplay story: contacts, group chats and conversations that are already going on.
Reply with ONLY a JSON object, no commentary, no code fences:
{"main": [Person...], "contacts": [Person...], "groups": [Group...], "chats": [Chat...], "labels": {"existing contact name": "saved_as"}}

Person = {
  "name": string,       // their real full name
  "saved_as": string,   // how USER saved them in their phone, the way a real person does: "Mom", "Мама 💕", "Dad 🐻", "Mina 🏠", "Coach Voss", "Jihoon work", a pet name for a partner. Short, personal, in USER's voice.
  "aliases": string,    // other names the story may call them, comma-separated: nicknames, short forms, other spellings/scripts ("Ally, Al, Элли"). Empty if none.
  "relation": string,   // who they are TO USER, short and specific ("older sister", "barista who flirts with USER")
  "style": string,      // how they TEXT: tone, length, punctuation, caps, emoji, slang, typos. 1-2 sentences. Every person must text differently.
  "handle": string,     // realistic social-media username: lowercase latin letters, digits, underscore; max 15 chars; not just their plain name
  "twitter": boolean,   // do they use Twitter at all? Many people don't.
  "followers": integer, // realistic for who they are (a quiet aunt ~40, a local celebrity ~80000)
  "following": integer
}

Group = {
  "name": string,       // how the chat is titled in USER's phone, may contain an emoji ("Fletcher fam 🏒", "ballet girls")
  "members": [string],  // names of people from "main"/"contacts"/EXISTING CONTACTS, at least 2; USER is always a member, don't list USER
  "messages": [Message] // the latest 3-8 messages of this chat
}

Chat = {
  "with": string,       // one person from "main"/"contacts"/EXISTING CONTACTS
  "messages": [Message],// the latest 3-8 messages of this 1:1 conversation
  "unread": boolean     // true if the last incoming messages are still unread by USER
}

Message = {
  "from": string,       // "USER" or the sender's exact name
  "text": string,       // written in that sender's texting style
  "ago": integer        // minutes before the current story moment (bigger = older)
}

"main": exactly one Person per name listed in STORY CHARACTERS (keep the names), describing how they relate to and text USER.

"contacts", in this order:
1. CANON FIRST. Every person explicitly named in USER DESCRIPTION, STORY CHARACTERS, SCENARIO or KNOWN PEOPLE who would have USER's number (family, friends, coaches, coworkers, exes...). Use their exact names as written there: never rename them and never invent a substitute for someone who is already defined (if USER's mother is named in the description, use that exact mother). Their relation and style must follow what the descriptions say about them. Skip only the dead/unreachable and names already in EXISTING CONTACTS.
2. Then add {{count}} more INVENTED people who would realistically be in USER's phone given the setting, era and USER's life. Invented names must fit the setting's culture and must not duplicate a role already filled by a canon person (no second mother, no second coach for the same thing).
Never repeat a story character.

"labels": a saved_as for every EXISTING CONTACT marked "(no saved name)".
"groups": 1-3 group chats that would logically exist in USER's phone (family, team, close friends, work). Skip names listed in EXISTING GROUPS.
"chats": 2-4 people USER realistically texts often right now — story characters included when it makes sense.
Messages must fit the story's present moment and relationships, never contradict the descriptions, and never reveal future plot.

Write "relation" and "style" in {{language}}. Write message "text" and "saved_as" in {{storyLanguage}} (unless USER would naturally save someone in another language). Keep names in their original spelling.`;

/** Язык самой истории — по буквам последних сообщений, сами сообщения в промпт не идут */
function storyLanguage() {
    const sample = (ctx().chat ?? []).slice(-6).map(m => m?.mes || '').join(' ');
    const cyrillic = (sample.match(/[а-яё]/gi) ?? []).length;
    const latin = (sample.match(/[a-z]/gi) ?? []).length;
    if (cyrillic + latin === 0) return getLanguage() === 'ru' ? 'Russian' : 'English';
    return cyrillic > latin ? 'Russian' : 'English';
}

function storyBlock() {
    const { substituteParams, powerUserSettings } = ctx();
    const chars = getStoryCharacters();

    const characters = chars.map(c => {
        const description = clean(substituteParams(c.description || ''));
        const personality = clean(substituteParams(c.personality || ''));
        return `### ${c.name}\n${description}${personality ? `\n\nPersonality: ${personality}` : ''}`;
    }).join('\n\n');
    const scenario = clean(substituteParams(chars[0]?.scenario || ''));
    const persona = clean(substituteParams(powerUserSettings?.persona_description || ''));

    const clock = getStoryClock();
    const moment = clock.dateSource === 'real' && clock.timeSource === 'real' ? '' : `${clock.date.toDateString()}, ${clock.time}`;

    return { characters, scenario, persona, moment, names: chars.map(c => c.name) };
}

function buildMessages(data) {
    const { name1 } = ctx();
    const story = storyBlock();
    const existing = data.contacts.filter(c => !c.main)
        .map(c => `- ${c.name}${c.relation ? ` (${c.relation})` : ''}${c.label ? ` — saved as "${c.label}"` : ' (no saved name)'}`);
    const groups = data.groups.map(g => `- ${g.name}`);
    const known = getMnemaPeople()
        .filter(p => !story.names.some(n => n.toLowerCase() === p.name.toLowerCase()))
        .map(p => `- ${p.name}${p.relation ? ` (${p.relation})` : ''}`);

    const sections = [
        `USER: ${name1}`,
        story.persona && `USER DESCRIPTION (canon: the people named here exist in this story):\n${story.persona}`,
        `STORY CHARACTERS:\n${story.characters || '(none)'}`,
        story.scenario && `SCENARIO:\n${story.scenario}`,
        story.moment && `CURRENT STORY MOMENT: ${story.moment}`,
        existing.length && `EXISTING CONTACTS (already in the phone, do not repeat these names):\n${existing.join('\n')}`,
        groups.length && `EXISTING GROUPS:\n${groups.join('\n')}`,
        known.length && `KNOWN PEOPLE:\n${known.join('\n')}`,
    ].filter(Boolean);

    const system = SYSTEM_PROMPT
        .replace('{{count}}', String(NEW_CONTACTS))
        .replace('{{language}}', getLanguage() === 'ru' ? 'Russian' : 'English')
        .replace('{{storyLanguage}}', storyLanguage());

    return [
        { role: 'system', content: system },
        { role: 'user', content: sections.join('\n\n') },
    ];
}

/** Достаём JSON из ответа, даже если модель обернула его в текст или ```json */
function parseReply(text) {
    const raw = String(text ?? '');
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('bad-json');
    const parsed = JSON.parse(raw.slice(start, end + 1));
    const list = (value) => (Array.isArray(value) ? value : []);
    const labels = parsed.labels && typeof parsed.labels === 'object' && !Array.isArray(parsed.labels) ? parsed.labels : {};
    return { main: list(parsed.main), contacts: list(parsed.contacts), groups: list(parsed.groups), chats: list(parsed.chats), labels };
}

const personFields = (p) => ({
    label: String(p.saved_as || p.savedAs || '').trim(),
    aliases: String(Array.isArray(p.aliases) ? p.aliases.join(', ') : p.aliases || '').trim(),
    relation: String(p.relation || '').trim(),
    style: String(p.style || '').trim(),
    twitter: { enabled: Boolean(p.twitter), followers: sanitizeCount(p.followers), following: sanitizeCount(p.following) },
});

const isUser = (name) => {
    const key = String(name ?? '').trim().toLowerCase();
    return key === 'user' || key === '{{user}}' || key === String(ctx().name1 ?? '').trim().toLowerCase();
};

/**
 * Превращает сообщения модели в сообщения телефона с сюжетным временем.
 * @param {(name: string) => string|null} senderOf  имя → contactId (null — пропустить)
 */
function seedMessages(chat, messages, senderOf, unread) {
    const now = getStoryNow().getTime();
    const seeded = (Array.isArray(messages) ? messages : [])
        .map((m, i) => {
            const text = String(m?.text ?? '').trim();
            const from = isUser(m?.from) ? 'user' : senderOf(m?.from);
            if (!text || !from) return null;
            const ago = Math.max(0, Math.min(MAX_AGO_MINUTES, Number(m.ago) || 0));
            return { id: `msg_${Date.now()}_${i}`, from, text, ts: now - ago * 60_000, seed: true };
        })
        .filter(Boolean)
        .sort((a, b) => a.ts - b.ts);

    chat.messages = seeded;
    // непрочитанные — входящие после последнего сообщения юзера
    if (unread) {
        let count = 0;
        for (let i = seeded.length - 1; i >= 0 && seeded[i].from !== 'user'; i--) count++;
        chat.unread = count;
    }
    return seeded.length > 0;
}

/**
 * Генерирует контакты, группы и активные переписки и дописывает их в data.
 * Ручные правки не трогает; уже существующие переписки и группы не перезаписывает.
 * @returns {Promise<{ contacts: number, groups: number, chats: number }>}
 */
export async function generateContacts(data) {
    const reply = await generate(getApi(), buildMessages(data));
    const parsed = parseReply(reply);
    const result = { contacts: 0, groups: 0, chats: 0 };

    // персонажей истории дополняем, только пока юзер не правил их карточку сам
    for (const person of parsed.main) {
        const contact = findContactByName(data, person.name);
        if (!contact?.main || contact.edited) continue;
        Object.assign(contact, personFields(person));
        contact.handle = uniqueHandle(data, person.handle, contact.name, contact.id);
    }

    // подписи для старых контактов, у которых их ещё нет (ручные правки не трогаем)
    for (const [name, label] of Object.entries(parsed.labels)) {
        const contact = findContactByName(data, name);
        if (contact && !contact.label && !contact.edited && String(label).trim()) contact.label = String(label).trim();
    }

    for (const person of parsed.contacts) {
        const name = String(person?.name || '').trim();
        if (!name || findContactByName(data, name)) continue;
        data.contacts.push(makeContact(data, { name, handle: person.handle, source: 'ai', ...personFields(person) }));
        result.contacts++;
    }

    for (const group of parsed.groups) {
        const name = String(group?.name || '').trim();
        if (!name || findGroupByName(data, name)) continue;
        const memberIds = (Array.isArray(group.members) ? group.members : [])
            .filter(member => !isUser(member))
            .map(member => resolveContact(data, member)?.id)
            .filter(Boolean);
        if (new Set(memberIds).size < 2) continue;

        const created = makeGroup(name, memberIds);
        data.groups.push(created);
        seedMessages(getGroupChat(data, created.id, true), group.messages, (sender) => {
            const id = resolveContact(data, sender)?.id;
            return id && created.memberIds.includes(id) ? id : null;
        }, false);
        result.groups++;
    }

    for (const chat of parsed.chats) {
        const contact = resolveContact(data, chat?.with);
        if (!contact) continue;
        const existing = getChat(data, contact.id);
        if (existing?.messages.length) continue; // идущую переписку не переписываем
        // в личке любое не-USER сообщение — от собеседника
        if (seedMessages(getChat(data, contact.id, true), chat.messages, () => contact.id, Boolean(chat.unread))) result.chats++;
    }

    data.chats = data.chats.filter(c => c.messages.length);
    return result;
}
