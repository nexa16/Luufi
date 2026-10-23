import { PrimaryNavigation } from '@/components/primary-navigation';
import Link from 'next/link';

export default function ProjectsPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-lg px-5 pb-28 pt-7">
      <header className="mb-10">
        <p className="mb-2 text-sm font-bold text-lime-300">Luufi</p>
        <h1 className="text-3xl font-bold tracking-tight text-white">
          Projekte
        </h1>
      </header>
      <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-6">
        <h2 className="text-lg font-bold text-white">
          Hier entsteht deine Projektübersicht
        </h2>
        <p className="mt-3 text-base leading-7 text-slate-400">
          Die neue Projektverwaltung wird vorbereitet. Du kannst bereits eigene
          Projektideen sammeln und bearbeiten.
        </p>
        <Link
          href="/ideas"
          className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-lime-300 px-4 font-bold text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-lime-300"
        >
          Projektideen öffnen
        </Link>
      </section>
      <PrimaryNavigation active="projects" />
    </main>
  );
}
