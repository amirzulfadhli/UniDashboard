import { resourceUrl } from "./validation";
export function NoteContent({ content }: { content: string }) { return <pre className="whitespace-pre-wrap break-words font-sans">{content}</pre>; }
export function ResourceLink({ url, title }: { url: string; title: string }) {
  let safe: string;
  try { safe = resourceUrl(url); } catch { return <p>Invalid resource link: {url}</p>; }
  return <a href={safe} target="_blank" rel="noopener noreferrer">{title}</a>;
}
