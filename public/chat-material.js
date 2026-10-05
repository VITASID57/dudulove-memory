export const CHAT_TEXT_LIMIT = 48000;
export const CHAT_FILE_LIMIT = 2 * 1024 * 1024;
const object = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const unsupported = () => new Error('无法完整识别这个 JSON 的文字记录，请改用 TXT 或粘贴文字。原有输入未替换。');
function body(value) {
    if (typeof value === 'string')
        return value;
    if (Array.isArray(value))
        return value.map(body).join('\n');
    if (object(value)) {
        if (value.type && !['text', 'input_text', 'output_text'].includes(String(value.type)))
            throw unsupported();
        if (typeof value.text === 'string')
            return value.text;
        if (Array.isArray(value.parts))
            return body(value.parts);
    }
    throw unsupported();
}
function time(value) {
    if (value === undefined || value === null || value === '')
        return '';
    if (typeof value === 'number') {
        const date = new Date(value < 1e12 ? value * 1000 : value);
        if (!Number.isFinite(date.getTime()))
            throw unsupported();
        return date.toISOString();
    }
    if (typeof value !== 'string')
        throw unsupported();
    return value;
}
function message(value) {
    if (!object(value))
        throw unsupported();
    const author = object(value.author) ? value.author : {};
    const role = value.speaker ?? value.sender ?? value.role ?? author.name ?? author.role ?? '说话者未注明';
    if (typeof role !== 'string')
        throw unsupported();
    const aliases = { user: '用户', human: '用户', assistant: '助手', system: '系统', tool: '工具' };
    const text = body(value.content ?? value.text ?? value.parts).trim();
    if (!text)
        return '';
    const when = time(value.time ?? value.timestamp ?? value.create_time ?? value.created_at);
    return `${when ? `[${when}] ` : ''}${aliases[role] || role}：${text}`;
}
function activeBranch(row) {
    if (!object(row.mapping) || typeof row.current_node !== 'string')
        throw unsupported();
    const nodes = row.mapping, seen = new Set(), messages = [];
    let id = row.current_node;
    while (id) {
        if (seen.has(id) || !object(nodes[id]))
            throw unsupported();
        seen.add(id);
        const node = nodes[id];
        if (node.message != null)
            messages.unshift(node.message);
        if (node.parent != null && typeof node.parent !== 'string')
            throw unsupported();
        id = node.parent;
    }
    return messages;
}
function conversation(value) {
    if (!object(value))
        throw unsupported();
    let text;
    if (typeof value.raw_content === 'string' && value.raw_content.trim())
        text = value.raw_content;
    else {
        const messages = value.mapping ? activeBranch(value) : value.messages ?? value.chat_messages;
        if (!Array.isArray(messages) || !messages.length)
            throw unsupported();
        text = messages.map(message).filter(Boolean).join('\n\n');
        if (!text)
            throw unsupported();
    }
    const title = typeof value.title === 'string' ? value.title : typeof value.name === 'string' ? value.name : '';
    const date = time(value.date);
    return [title ? `聊天：${title}` : '', date ? `日期：${date}` : '', text].filter(Boolean).join('\n');
}
export function parseChatMaterial(raw, filename) {
    let text = raw.replace(/^\uFEFF/, '').trim();
    if (/\.json$/i.test(filename)) {
        let data;
        try {
            data = JSON.parse(text);
        }
        catch {
            throw new Error('JSON 格式不完整，请检查文件，或改用 TXT／粘贴文字。');
        }
        if (object(data) && Array.isArray(data.conversations))
            data = data.conversations;
        if (Array.isArray(data)) {
            if (!data.length)
                throw unsupported();
            const isConversation = (row) => object(row) && ['messages', 'chat_messages', 'raw_content', 'mapping'].some(key => key in row);
            text = data.every(isConversation) ? data.map(conversation).join('\n\n—— 下一段聊天 ——\n\n') : data.map(message).join('\n\n');
        }
        else
            text = conversation(data);
    }
    else if (!/\.txt$/i.test(filename))
        throw new Error('请选择 TXT 或 JSON 文件。');
    if (!text)
        throw new Error('文件里没有可整理的文字。');
    if (text.length > CHAT_TEXT_LIMIT)
        throw new Error('文字超过一次可整理的 48000 字，请拆成几份上传；没有截掉原文。');
    return text;
}
export function decodeChatFile(buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes[0] === 0xff && bytes[1] === 0xfe)
        return new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
    if (bytes[0] === 0xfe && bytes[1] === 0xff)
        return new TextDecoder('utf-16be', { fatal: true }).decode(bytes);
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }
    catch {
        return new TextDecoder('gb18030', { fatal: true }).decode(bytes);
    }
}
