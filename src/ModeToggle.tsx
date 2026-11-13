/** The switch between the two halves of the jukebox: HTML demos and music. */
export function ModeToggle({ mode }: { mode: 'html' | 'music' }) {
  return <nav className="mode-toggle" aria-label="Jukebox mode">
    <a href="#" aria-current={mode === 'html' ? 'page' : undefined}>HTML</a>
    <a href="#music" aria-current={mode === 'music' ? 'page' : undefined}>Music</a>
  </nav>;
}
