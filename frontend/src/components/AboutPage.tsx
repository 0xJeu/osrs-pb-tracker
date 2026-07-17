export function AboutPage() {
  return (
    <section className="faq-page pbt-about">
      <h2 className="result-title">About PB Tracker</h2>
      <article className="faq-entry">
        <h3>Built for the PB chase</h3>
        <p>
          PB Tracker gives Old School RuneScape players one place to sync, compare, and share the
          personal-best times RuneLite records for bosses, raids, and timed challenges.
        </p>
      </article>
      <article className="faq-entry">
        <h3>How it works</h3>
        <p>
          The Zenyte Labs PB Tracker Sync plugin reads personal-best data already stored by
          RuneLite and sends it to this leaderboard. It does not play the game, submit times you
          have not earned, or ask for your RuneScape password.
        </p>
      </article>
      <article className="faq-entry">
        <h3>Community-first development</h3>
        <p>
          The project is actively refined from player feedback. If a time, boss variant, or page
          looks wrong, use the feedback control and include the player or leaderboard you were viewing.
        </p>
      </article>
    </section>
  );
}
