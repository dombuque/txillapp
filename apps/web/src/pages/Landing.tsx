import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon';
import { Wordmark } from '../components/ui';

const FEATURES = [
  { icon: 'image', title: 'Feed da malta', text: 'Fotos e vídeos de quem segues e do que está a bombar. Sem algoritmo a enganar-te: tu mandas no que vês.' },
  { icon: 'camera', title: 'Stories', text: 'Mostra o teu dia em 24 horas. Partilha para os amigos chegados ou para toda a gente.' },
  { icon: 'film', title: 'Reels', text: 'Vídeos curtos a rolar, um a seguir ao outro. Bora criar o teu.' },
  { icon: 'comment', title: 'Chat em tempo real', text: 'Conversa com quem segues, manda fotos e vídeos. Só entra quem tu deixares.' },
  { icon: 'gift', title: 'Txills', text: 'Oferece presentes à malta que segues e mostra quem está com tudo.' },
  { icon: 'shield', title: 'Privacidade a sério', text: 'Contas privadas, bloquear, silenciar, escolher quem te vê. Tu decides.' },
] as const;

/** Página de apresentação (txillapp.com para quem ainda não entrou). */
export default function Landing() {
  useEffect(() => {
    const prev = document.title;
    document.title = 'Txillapp — a rede da malta';
    return () => {
      document.title = prev;
    };
  }, []);

  return (
    <div className="min-h-dvh bg-white text-zinc-900">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <Wordmark className="h-8" />
        <nav aria-label="Entrar" className="flex items-center gap-2">
          <Link to="/login" className="rounded-full px-5 py-2.5 font-semibold transition hover:bg-zinc-100">Entrar</Link>
          <Link to="/register" className="hidden rounded-full bg-brand px-5 py-2.5 font-bold text-white transition hover:brightness-110 sm:block">Criar conta</Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-16 pt-8 lg:grid-cols-2 lg:pt-16">
          <div>
            <p className="inline-block rounded-full bg-rose-50 px-4 py-1.5 text-sm font-bold text-brand">Rede social made in Moçambique</p>
            <h1 className="mt-5 text-5xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
              Posta. Mostra. <span className="text-brand">Txilla.</span>
            </h1>
            <p className="mt-5 max-w-lg text-xl leading-relaxed text-zinc-600">
              A tua vibe, a tua malta e o teu espaço. Fotos, vídeos, stories, reels e chat numa só app, feita para quem não tem tempo a perder.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/register" className="rounded-full bg-brand px-8 py-4 text-lg font-bold text-white shadow-lg shadow-rose-200 transition hover:brightness-110 active:scale-95">
                Criar conta grátis
              </Link>
              <Link to="/login" className="rounded-full border-2 border-zinc-200 px-8 py-4 text-lg font-bold transition hover:bg-zinc-50 active:scale-95">
                Já tenho conta
              </Link>
            </div>
            <p className="mt-4 text-sm text-zinc-500">Para maiores de 13 anos. Funciona no navegador e podes instalar no telemóvel.</p>
          </div>

          {/* Maqueta do telemóvel, só desenho (sem dados de ninguém). */}
          <div aria-hidden className="mx-auto w-full max-w-[300px]">
            <div className="rounded-[2.5rem] border-[10px] border-zinc-900 bg-zinc-100 p-3 shadow-2xl">
              <div className="flex items-center justify-between px-1 pb-3 pt-1">
                <Wordmark className="h-5" />
                <span className="h-2.5 w-2.5 rounded-full bg-brand" />
              </div>
              <div className="flex gap-2 pb-3">
                {['bg-brand', 'bg-amber-400', 'bg-emerald-500', 'bg-sky-500'].map((c) => (
                  <span key={c} className={`h-12 w-12 shrink-0 rounded-full ${c} ring-2 ring-white`} />
                ))}
              </div>
              <div className="rounded-3xl bg-white p-3">
                <div className="flex items-center gap-2">
                  <span className="h-8 w-8 rounded-full bg-zinc-300" />
                  <span className="h-2.5 w-24 rounded-full bg-zinc-200" />
                </div>
                <div className="mt-3 aspect-[4/5] rounded-2xl bg-gradient-to-br from-rose-300 via-brand to-amber-300" />
                <div className="mt-3 flex gap-3 text-brand">
                  <Icon name="heart" size={22} />
                  <Icon name="comment" size={22} />
                  <Icon name="gift" size={22} />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-zinc-50 py-16" aria-labelledby="porque">
          <div className="mx-auto max-w-6xl px-5">
            <h2 id="porque" className="text-3xl font-extrabold">Tudo o que a malta precisa</h2>
            <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <li key={f.title} className="rounded-3xl bg-white p-6 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-brand">
                    <Icon name={f.icon} size={26} />
                  </span>
                  <h3 className="mt-4 text-xl font-bold">{f.title}</h3>
                  <p className="mt-1.5 leading-relaxed text-zinc-600">{f.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-5 py-16 text-center">
          <h2 className="text-3xl font-extrabold">Bora entrar na festa?</h2>
          <p className="mt-3 text-lg text-zinc-600">É grátis e demora menos de um minuto.</p>
          <Link to="/register" className="mt-6 inline-block rounded-full bg-brand px-10 py-4 text-lg font-bold text-white transition hover:brightness-110 active:scale-95">
            Criar a minha conta
          </Link>
        </section>
      </main>

      <footer className="border-t border-zinc-100 py-8 text-center text-sm text-zinc-500">
        <p>
          <Link to="/terms" className="hover:underline">Termos de Uso</Link> · <Link to="/privacy" className="hover:underline">Política de Privacidade</Link> ·{' '}
          <a href="mailto:suporte@txillapp.com" className="hover:underline">suporte@txillapp.com</a>
        </p>
        <p className="mt-2">© {new Date().getFullYear()} Txillapp</p>
      </footer>
    </div>
  );
}
