import { MARK_END, MARK_START, snippetParts, toFtsQuery } from './searchQuery';

describe('toFtsQuery (SRCH-3)', () => {
  it('quotes each word as a required prefix', () => {
    expect(toFtsQuery('fren')).toBe('"fren"*');
    expect(toFtsQuery('  Learn   French ')).toBe('"Learn"* "French"*');
    expect(toFtsQuery('café 2026')).toBe('"café"* "2026"*');
  });

  it('drops FTS syntax and punctuation, so input can never inject operators', () => {
    expect(toFtsQuery('"a" OR b*')).toBe('"a"* "OR"* "b"*');
    expect(toFtsQuery('title:secret NEAR(x y)')).toBe('"title"* "secret"* "NEAR"* "x"* "y"*');
    expect(toFtsQuery("don't-stop")).toBe('"don"* "t"* "stop"*');
    expect(toFtsQuery('" * ( ) : ^ -')).toBeNull();
    expect(toFtsQuery('')).toBeNull();
  });

  it('caps the number of words', () => {
    expect(toFtsQuery('a b c d e f g h i j k l')!.split(' ')).toHaveLength(10);
  });
});

describe('snippetParts', () => {
  it('splits highlighted matches from plain text', () => {
    expect(
      snippetParts(`…went to ${MARK_START}French${MARK_END} class, ${MARK_START}fren${MARK_END}`),
    ).toEqual([
      { text: '…went to ', match: false },
      { text: 'French', match: true },
      { text: ' class, ', match: false },
      { text: 'fren', match: true },
    ]);
    expect(snippetParts('<b>plain</b>')).toEqual([{ text: '<b>plain</b>', match: false }]);
  });
});
