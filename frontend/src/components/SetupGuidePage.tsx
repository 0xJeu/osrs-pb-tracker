export function SetupGuidePage() {
  return (
    <section className="faq-page setup-guide">
      <h2 className="result-title">How to set up PB Tracker Sync</h2>
      <p className="setup-guide-intro">
        The plugin doesn't calculate or guess anything - it just reads the personal best data
        RuneLite already tracks for your account (the same data behind the <code>!pb</code> command
        and the collection log plugin), and pushes it to this site.
      </p>

      <article className="faq-entry">
        <h3>1. Install the plugin</h3>
        <p>
          Open the Plugin Hub in RuneLite (wrench icon &rarr; Plugin Hub), search{' '}
          <strong>"PB Tracker Sync"</strong>, and install it.
        </p>
      </article>

      <article className="faq-entry">
        <h3>2. Open your Adventure Log's Counters page once</h3>
        <p>
          If you've got PBs for raids, Inferno, Fight Caves, the Gauntlet, Colosseum, or Nightmare,
          right-click your Adventure Log and choose <strong>Read</strong>.
        </p>
        <img
          src="/setup-guide/step1-open-adventure-log.jpg"
          alt="Right-clicking the Adventure Log and choosing Read"
          className="setup-guide-screenshot"
        />
        <p>Then pick <strong>"5: Counters"</strong> from the log menu.</p>
        <img
          src="/setup-guide/step2-open-counters.jpg"
          alt="Selecting the Counters page from the Adventure Log menu"
          className="setup-guide-screenshot"
        />
        <p>That unlocks your real PB records for those activities - RuneLite (and this site) can't see them until you do this at least once.</p>
        <img
          src="/setup-guide/step2b-counters-result.jpg"
          alt="The Adventure Log Counters page showing recorded personal best times"
          className="setup-guide-screenshot"
        />
      </article>

      <article className="faq-entry">
        <h3>3. Optionally, sync everything at once</h3>
        <p>
          Hit <strong>"Sync all PBs now"</strong> in the plugin's side panel to push everything
          RuneLite already has on record, instead of waiting to re-kill things.
        </p>
        <img
          src="/setup-guide/step3-sync-all-pbs.png"
          alt="The plugin configuration panel with Sync all PBs now highlighted"
          className="setup-guide-screenshot setup-guide-screenshot-narrow"
        />
      </article>

      <article className="faq-entry">
        <h3>That's it</h3>
        <p>
          From here on, every new PB syncs automatically the moment you get it. If something looks
          missing or wrong, see the <a href="/faq">FAQ</a> - and there's a Feedback button on every
          page if you spot a bug.
        </p>
      </article>
    </section>
  );
}
