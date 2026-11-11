import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * The app is offline and its window must stay on the app (NFR, privacy): links render as
 * text with the address in a tooltip instead of navigating the window away, and images
 * are never fetched, only named. Raw HTML in the text is shown as text, never run.
 */
const components: Components = {
  a: ({ children, href }) => (
    <span className="md-link" title={href}>
      {children}
    </span>
  ),
  img: ({ alt }) => <span className="md-image">[image{alt ? `: ${alt}` : ''}]</span>,
};

/** A journal body rendered from Markdown (GitHub flavour: lists, checkboxes, tables). */
export function MarkdownView({ text, label }: { text: string; label?: string }) {
  return (
    <div className="markdown" aria-label={label} role={label ? 'region' : undefined}>
      {text.trim() ? (
        <Markdown remarkPlugins={[remarkGfm]} components={components}>
          {text}
        </Markdown>
      ) : (
        <p className="muted">Nothing to preview yet.</p>
      )}
    </div>
  );
}
