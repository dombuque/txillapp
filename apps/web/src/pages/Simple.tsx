export function ComingSoon({ emoji, title, text }: { emoji: string; title: string; text: string }) {
  return (
    <div className="mx-6 mt-20 text-center">
      <p className="text-6xl" aria-hidden>{emoji}</p>
      <h1 className="mt-4 text-2xl font-extrabold">{title}</h1>
      <p className="mt-2 text-lg font-light text-zinc-600">{text}</p>
    </div>
  );
}
