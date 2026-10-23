type PrimaryDestination = 'projects' | 'ideas';

const destinationClass = {
  active: 'text-sm font-bold text-white',
  inactive:
    'text-sm font-medium text-slate-500 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300',
};

export function PrimaryNavigation({ active }: { active: PrimaryDestination }) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-lg items-center justify-between border-t border-white/10 bg-[#070b12]/95 px-8 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 backdrop-blur-xl"
      aria-label="Hauptnavigation"
    >
      <Link
        href="/"
        aria-current={active === 'projects' ? 'page' : undefined}
        className={
          active === 'projects'
            ? destinationClass.active
            : destinationClass.inactive
        }
      >
        Projekte
      </Link>
      <Link
        href="/ideas"
        aria-current={active === 'ideas' ? 'page' : undefined}
        className={
          active === 'ideas'
            ? destinationClass.active
            : `${destinationClass.inactive} hover:text-fuchsia-200 focus-visible:ring-fuchsia-300`
        }
      >
        Projektideen
      </Link>
    </nav>
  );
}
import Link from 'next/link';
