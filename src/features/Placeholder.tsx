export function Placeholder({ title, phase }: { title: string; phase: string }) {
  return (
    <section>
      <h1 className="page-title">{title}</h1>
      <p className="muted">Coming in {phase}.</p>
    </section>
  );
}
