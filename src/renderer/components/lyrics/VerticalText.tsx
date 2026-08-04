type VerticalTextProps = {
  className: string;
  text: string;
};

export type VerticalTextToken = {
  key: string;
  sideways: boolean;
  text: string;
};

const verticalSidewaysPattern = /[A-Za-z0-9]+(?:[.'’-][A-Za-z0-9]+)*/uy;

export const tokenizeVerticalText = (text: string): VerticalTextToken[] => {
  const tokens: VerticalTextToken[] = [];
  let index = 0;

  while (index < text.length) {
    verticalSidewaysPattern.lastIndex = index;
    const sidewaysMatch = verticalSidewaysPattern.exec(text);
    if (sidewaysMatch?.index === index) {
      const [token] = sidewaysMatch;
      tokens.push({
        key: `${index}-${token}`,
        sideways: true,
        text: token,
      });
      index += token.length;
      continue;
    }

    const [char] = Array.from(text.slice(index));
    if (/\s/u.test(char)) {
      index += char.length;
      continue;
    }

    tokens.push({
      key: `${index}-${char}`,
      sideways: false,
      text: char,
    });
    index += char.length;
  }

  return tokens;
};

export const VerticalText = ({ className, text }: VerticalTextProps): JSX.Element => (
  <>
    {tokenizeVerticalText(text).map((token) => (
      <span
        aria-hidden="true"
        className={className}
        data-sideways={token.sideways || undefined}
        key={token.key}
      >
        {token.text}
      </span>
    ))}
  </>
);
