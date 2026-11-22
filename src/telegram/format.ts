function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Converts common LLM Markdown into Telegram-safe HTML.
 * Supports code blocks, inline code, headings, bullet lists,
 * bold, italic, strikethrough, blockquotes, and links.
 */
export function markdownToTelegramHtml(markdown: string): string {
  const placeholders: string[] = [];
  const hold = (html: string): string => {
    const idx = placeholders.length;
    placeholders.push(html);
    return `\u0000PH${idx}\u0000`;
  };

  let text = markdown.replace(/\r\n/g, '\n');

  // 1. Fenced code blocks ```lang\n...\n```
  text = text.replace(/```(?:[\w+-]+)?\n?([\s\S]*?)```/g, (_m, code: string) => {
    const clean = code.replace(/\n$/, '');
    return hold(`<pre><code>${escapeHtml(clean)}</code></pre>`);
  });

  // 2. Inline code `...`
  text = text.replace(/`([^`\n]+)`/g, (_m, code: string) => {
    return hold(`<code>${escapeHtml(code)}</code>`);
  });

  // 3. Escape remaining HTML characters
  text = escapeHtml(text);

  // 4. Markdown links [label](https://...)
  text = text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, label: string, url: string) => `<a href="${url}">${label}</a>`,
  );

  // 5. Headings (# Title -> bold)
  text = text.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');

  // 6. Blockquotes (&gt; quote)
  text = text.replace(/^&gt;\s?(.+)$/gm, '<blockquote>$1</blockquote>');

  // 7. Unordered list bullets (* item or - item -> • item)
  text = text.replace(/^(\s*)[*-]\s+/gm, '$1• ');

  // 8. Bold (**text** or __text__)
  text = text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  text = text.replace(/__(.+?)__/g, '<b>$1</b>');

  // 9. Strikethrough (~~text~~)
  text = text.replace(/~~(.+?)~~/g, '<s>$1</s>');

  // 10. Italic (*text*)
  text = text.replace(/(^|[^\w*])\*([^\s*](?:[^*\n]*?[^\s*])?)\*(?=[^\w*]|$)/g, '$1<i>$2</i>');

  // 11. Restore code placeholders
  text = text.replace(/\u0000PH(\d+)\u0000/g, (_m, idxStr: string) => {
    return placeholders[Number(idxStr)] ?? '';
  });

  return text;
}
