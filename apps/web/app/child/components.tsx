export function ChildNav({ active }: { active: 'today' | 'review' | 'practice' | 'challenge' }) {
  const items = [
    { key: 'today', label: 'Hôm nay', glyph: '◉', href: '/child' },
    { key: 'review', label: 'Ôn tập', glyph: '◍', href: '/child' },
    { key: 'practice', label: 'Bài tập', glyph: '✎', href: '/child/do' },
    { key: 'challenge', label: 'Thử thách', glyph: '◆', href: '/child/challenge' },
  ] as const;
  return (
    <nav className="bottomnav" style={{ paddingBottom: 22 }}>
      {items.map((it) => (
        <a key={it.key} href={it.href} className="bottomnav__item" data-active={it.key === active}>
          <span style={{ fontSize: 20 }}>{it.glyph}</span>
          {it.label}
        </a>
      ))}
    </nav>
  );
}

export function ChildScreen({ children, nav }: { children: React.ReactNode; nav: React.ReactNode }) {
  return (
    <div className="screen">
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>{children}</div>
      {nav}
    </div>
  );
}
