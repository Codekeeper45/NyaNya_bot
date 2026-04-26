import { parseDocument } from './parse.js';

let destroyed = false;

vi.mock('pdf-parse', () => ({
  PDFParse: class {
    constructor(private readonly params: { data: Uint8Array }) {}

    async getText() {
      expect(this.params.data).toBeInstanceOf(Uint8Array);
      return { text: 'Extracted PDF text', total: 3 };
    }

    async destroy() {
      destroyed = true;
    }
  },
}));

describe('parseDocument', () => {
  beforeEach(() => {
    destroyed = false;
  });

  it('parses PDFs using the pdf-parse v2 class API', async () => {
    const parsed = await parseDocument(Buffer.from('%PDF-1.7'), 'sample.pdf', 'application/pdf');

    expect(parsed).toEqual({
      text: 'Extracted PDF text',
      filename: 'sample.pdf',
      mimeType: 'application/pdf',
      pages: 3,
    });
    expect(destroyed).toBe(true);
  });
});
