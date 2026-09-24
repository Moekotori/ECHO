import { useMemo } from 'react';
import type { ReactNode } from 'react';

const isSafeMarkdownHref = (href: string): boolean => {
  const trimmed = href.trim();
  return /^(https?:\/\/|mailto:|#|\/(?!\/))/iu.test(trimmed);
};

const looksLikeReleaseNotesHtml = (value: string): boolean => /<\/?[a-z][\s\S]*>/iu.test(value);

const parseMarkdownInline = (text: string, keyPrefix: string): ReactNode[] => {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let textBuffer = '';

  const flushText = (): void => {
    if (textBuffer) {
      nodes.push(textBuffer);
      textBuffer = '';
    }
  };

  while (cursor < text.length) {
    if (text.startsWith('`', cursor)) {
      const end = text.indexOf('`', cursor + 1);
      if (end > cursor + 1) {
        flushText();
        nodes.push(<code key={`${keyPrefix}-code-${cursor}`}>{text.slice(cursor + 1, end)}</code>);
        cursor = end + 1;
        continue;
      }
    }

    if (text.startsWith('**', cursor)) {
      const end = text.indexOf('**', cursor + 2);
      if (end > cursor + 2) {
        flushText();
        nodes.push(<strong key={`${keyPrefix}-strong-${cursor}`}>{parseMarkdownInline(text.slice(cursor + 2, end), `${keyPrefix}-strong-${cursor}`)}</strong>);
        cursor = end + 2;
        continue;
      }
    }

    if (text[cursor] === '[') {
      const labelEnd = text.indexOf(']', cursor + 1);
      const hrefStart = labelEnd >= 0 && text[labelEnd + 1] === '(' ? labelEnd + 2 : -1;
      const hrefEnd = hrefStart >= 0 ? text.indexOf(')', hrefStart) : -1;

      if (labelEnd > cursor + 1 && hrefStart >= 0 && hrefEnd > hrefStart) {
        const label = text.slice(cursor + 1, labelEnd);
        const href = text.slice(hrefStart, hrefEnd).trim();
        flushText();
        nodes.push(
          isSafeMarkdownHref(href) ? (
            <a key={`${keyPrefix}-link-${cursor}`} href={href} target="_blank" rel="noreferrer">
              {parseMarkdownInline(label, `${keyPrefix}-link-${cursor}`)}
            </a>
          ) : (
            <span key={`${keyPrefix}-link-${cursor}`}>{parseMarkdownInline(label, `${keyPrefix}-link-${cursor}`)}</span>
          ),
        );
        cursor = hrefEnd + 1;
        continue;
      }
    }

    textBuffer += text[cursor];
    cursor += 1;
  }

  flushText();
  return nodes;
};

const renderReleaseNotesHtmlInline = (node: ChildNode, keyPrefix: string): ReactNode => {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? '';
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const element = node as HTMLElement;
  const tagName = element.tagName.toLowerCase();
  const children = Array.from(element.childNodes).map((child, childIndex) =>
    renderReleaseNotesHtmlInline(child, `${keyPrefix}-${childIndex}`),
  );

  if (tagName === 'br') {
    return <br key={keyPrefix} />;
  }

  if (tagName === 'strong' || tagName === 'b') {
    return <strong key={keyPrefix}>{children}</strong>;
  }

  if (tagName === 'em' || tagName === 'i') {
    return <em key={keyPrefix}>{children}</em>;
  }

  if (tagName === 'code') {
    return <code key={keyPrefix}>{element.textContent ?? ''}</code>;
  }

  if (tagName === 'a') {
    const href = element.getAttribute('href') ?? '';
    if (!isSafeMarkdownHref(href)) {
      return <span key={keyPrefix}>{children}</span>;
    }
    return (
      <a key={keyPrefix} href={href} target="_blank" rel="noreferrer">
        {children.length ? children : href}
      </a>
    );
  }

  if (tagName === 'img') {
    const src = element.getAttribute('src') ?? '';
    if (!isSafeMarkdownHref(src)) {
      return null;
    }
    return <img key={keyPrefix} src={src} alt={element.getAttribute('alt') ?? ''} loading="lazy" />;
  }

  return <span key={keyPrefix}>{children}</span>;
};

const renderReleaseNotesHtmlBlock = (node: ChildNode, keyPrefix: string): ReactNode => {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent?.trim();
    return text ? <p key={keyPrefix}>{text}</p> : null;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const element = node as HTMLElement;
  const tagName = element.tagName.toLowerCase();
  const children = Array.from(element.childNodes).map((child, childIndex) =>
    renderReleaseNotesHtmlInline(child, `${keyPrefix}-inline-${childIndex}`),
  );

  if (tagName === 'h1' || tagName === 'h2') {
    return <h3 key={keyPrefix}>{children}</h3>;
  }

  if (tagName === 'h3') {
    return <h4 key={keyPrefix}>{children}</h4>;
  }

  if (tagName === 'h4' || tagName === 'h5' || tagName === 'h6') {
    return <h5 key={keyPrefix}>{children}</h5>;
  }

  if (tagName === 'p') {
    return <p key={keyPrefix}>{children}</p>;
  }

  if (tagName === 'ul' || tagName === 'ol') {
    const items = Array.from(element.children)
      .filter((child) => child.tagName.toLowerCase() === 'li')
      .map((child, childIndex) => (
        <li key={`${keyPrefix}-item-${childIndex}`}>
          {Array.from(child.childNodes).map((grandChild, grandChildIndex) =>
            renderReleaseNotesHtmlInline(grandChild, `${keyPrefix}-item-${childIndex}-${grandChildIndex}`),
          )}
        </li>
      ));
    return tagName === 'ol' ? <ol key={keyPrefix}>{items}</ol> : <ul key={keyPrefix}>{items}</ul>;
  }

  if (tagName === 'blockquote') {
    return <blockquote key={keyPrefix}>{children}</blockquote>;
  }

  if (tagName === 'pre') {
    return (
      <pre key={keyPrefix}>
        <code>{element.textContent ?? ''}</code>
      </pre>
    );
  }

  if (tagName === 'hr') {
    return <hr key={keyPrefix} />;
  }

  if (tagName === 'img' || tagName === 'a') {
    return <p key={keyPrefix}>{renderReleaseNotesHtmlInline(element, `${keyPrefix}-inline`)}</p>;
  }

  return (
    <div key={keyPrefix}>
      {Array.from(element.childNodes).map((child, childIndex) => renderReleaseNotesHtmlBlock(child, `${keyPrefix}-${childIndex}`))}
    </div>
  );
};

export const ReleaseNotesMarkdown = ({ markdown }: { markdown: string }): JSX.Element => {
  const rendered = useMemo(() => {
    if (looksLikeReleaseNotesHtml(markdown) && typeof DOMParser !== 'undefined') {
      const document = new DOMParser().parseFromString(markdown, 'text/html');
      const blocks = Array.from(document.body.childNodes)
        .map((child, childIndex) => renderReleaseNotesHtmlBlock(child, `html-${childIndex}`))
        .filter(Boolean);

      return { blocks, isHtml: true };
    }

    const lines = markdown.replace(/\r\n?/gu, '\n').split('\n');
    const blocks: ReactNode[] = [];
    let index = 0;

    const pushParagraph = (paragraphLines: string[], key: string): void => {
      const paragraph = paragraphLines.join(' ').trim();
      if (paragraph) {
        blocks.push(<p key={key}>{parseMarkdownInline(paragraph, key)}</p>);
      }
    };

    while (index < lines.length) {
      const line = lines[index];
      const trimmed = line.trim();

      if (!trimmed) {
        index += 1;
        continue;
      }

      if (trimmed.startsWith('```')) {
        const codeLines: string[] = [];
        const blockKey = `code-${index}`;
        index += 1;
        while (index < lines.length && !lines[index].trim().startsWith('```')) {
          codeLines.push(lines[index]);
          index += 1;
        }
        if (index < lines.length) {
          index += 1;
        }
        blocks.push(
          <pre key={blockKey}>
            <code>{codeLines.join('\n')}</code>
          </pre>,
        );
        continue;
      }

      const headingMatch = /^(#{1,3})\s+(.+)$/u.exec(trimmed);
      if (headingMatch) {
        const headingLevel = headingMatch[1].length;
        const headingText = headingMatch[2].trim();
        const headingKey = `heading-${index}`;
        blocks.push(
          headingLevel === 1 ? (
            <h3 key={headingKey}>{parseMarkdownInline(headingText, headingKey)}</h3>
          ) : headingLevel === 2 ? (
            <h4 key={headingKey}>{parseMarkdownInline(headingText, headingKey)}</h4>
          ) : (
            <h5 key={headingKey}>{parseMarkdownInline(headingText, headingKey)}</h5>
          ),
        );
        index += 1;
        continue;
      }

      const listMatch = /^(\s*)([-*+]|\d+\.)\s+(.+)$/u.exec(line);
      if (listMatch) {
        const ordered = /\d+\./u.test(listMatch[2]);
        const items: ReactNode[] = [];
        const listKey = `list-${index}`;
        while (index < lines.length) {
          const itemMatch = /^(\s*)([-*+]|\d+\.)\s+(.+)$/u.exec(lines[index]);
          if (!itemMatch || /\d+\./u.test(itemMatch[2]) !== ordered) {
            break;
          }
          items.push(<li key={`${listKey}-item-${index}`}>{parseMarkdownInline(itemMatch[3].trim(), `${listKey}-item-${index}`)}</li>);
          index += 1;
        }
        blocks.push(ordered ? <ol key={listKey}>{items}</ol> : <ul key={listKey}>{items}</ul>);
        continue;
      }

      if (trimmed.startsWith('>')) {
        const quoteLines: string[] = [];
        const quoteKey = `quote-${index}`;
        while (index < lines.length && lines[index].trim().startsWith('>')) {
          quoteLines.push(lines[index].trim().replace(/^>\s?/u, ''));
          index += 1;
        }
        blocks.push(<blockquote key={quoteKey}>{parseMarkdownInline(quoteLines.join(' '), quoteKey)}</blockquote>);
        continue;
      }

      const paragraphLines = [line.trim()];
      const paragraphKey = `paragraph-${index}`;
      index += 1;
      while (
        index < lines.length &&
        lines[index].trim() &&
        !lines[index].trim().startsWith('```') &&
        !/^(#{1,3})\s+(.+)$/u.test(lines[index].trim()) &&
        !/^(\s*)([-*+]|\d+\.)\s+(.+)$/u.test(lines[index]) &&
        !lines[index].trim().startsWith('>')
      ) {
        paragraphLines.push(lines[index].trim());
        index += 1;
      }
      pushParagraph(paragraphLines, paragraphKey);
    }

    return { blocks, isHtml: false };
  }, [markdown]);

  return <div className={`settings-update-markdown${rendered.isHtml ? ' settings-update-markdown--html' : ''}`}>{rendered.blocks}</div>;
};
