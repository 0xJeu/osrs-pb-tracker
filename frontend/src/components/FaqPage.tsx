export function FaqPage() {
  return (
    <section className="faq-page">
      <h2 className="result-title">FAQ</h2>

      <article className="faq-entry">
        <h3>Why is my PB missing or slower than I expect?</h3>
        <p>
          We only show what RuneLite has already recorded for your account under its own Personal
          Best tracking - we don't calculate times ourselves. A few common reasons a number might
          look off:
        </p>
        <ul>
          <li>
            <strong>You've never opened your Adventure Log &rarr; Counters page.</strong> For team
            bosses and a few others (Inferno, Fight Caves, Colosseum, Gauntlet, Nightmare, raids),
            that's what tells RuneLite your real record.
          </li>
          <li>
            <strong>Your "new personal best" chat message might be turned off</strong> in your OSRS
            settings. If RuneLite never sees that message, it can't update your PB - no matter how
            many times you've beaten it in-game.
          </li>
          <li>
            <strong>Some bosses don't have a PB at all.</strong> Group bosses like the Godwars
            generals (Bandos, Zilyana, Kree'arra, K'ril) only track kill count in OSRS, not a
            fastest-kill time - so there's nothing for us (or RuneLite) to show.
          </li>
        </ul>
      </article>

      <article className="faq-entry">
        <h3>How do I fix it?</h3>
        <p>
          Open Adventure Log &rarr; Counters in-game once, then click <strong>"Sync all PBs
          now"</strong> in the plugin's Configuration panel. That refreshes RuneLite's cached times
          from the game's own record and pushes the update to the site.
        </p>
      </article>
    </section>
  );
}
