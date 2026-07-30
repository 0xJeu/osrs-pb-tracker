import { isLoaded, type LoadState } from '../lib/loadState';
import { bossMonogram } from '../lib/bossPetIcons';
import { useBossIconUrl } from '../lib/bossIcons';
import { basesFromGroups, getRaidModes, groupBosses } from '../lib/bossGroups';
import type { Route } from '../hooks/useRoute';

// Each boss's own wiki portrait (or its final boss, for raids) - not the
// plugin's hiscore-sprite icons, since those come from RuneLite's game-cache
// SpriteManager and have no public URL a website can hotlink. See
// bossIcons.ts for how each entry was verified to actually exist.
function BossIcon({ boss }: { boss: string }) {
  const url = useBossIconUrl(boss, 64);
  return (
    <span className="pbt-pet lg">
      {url ? <img src={url} alt="" loading="lazy" /> : bossMonogram(boss)}
    </span>
  );
}

type CardRow =
  | { type: 'raid-base'; base: string; label: string }
  | { type: 'option'; key: string; label: string };

function buildCardRows(bosses: string[], group: ReturnType<typeof groupBosses>[number]): CardRow[] {
  const baseRows: CardRow[] = basesFromGroups(group.raidGroups ?? []).map((b) => ({
    type: 'raid-base',
    base: b.base,
    label: b.label,
  }));
  const itemRows: CardRow[] = (group.items ?? []).map((item) => ({
    type: 'option',
    key: item.key,
    label: item.label,
  }));
  return [...baseRows, ...itemRows].sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * A dedicated "browse every boss" page, distinct from the boss leaderboard
 * page itself - previously the only way in was the top nav's "Leaderboards"
 * button, which just reopened whatever boss you'd last looked at (or a
 * default), with no way to see the full list and pick a different one.
 */
export function AllBossesView({
  bosses,
  goToBoss,
  navigate,
}: {
  bosses: LoadState<string[]>;
  goToBoss: (boss: string) => void;
  navigate: (route: Route) => void;
}) {
  return (
    <div className="pbt-section" style={{ paddingTop: 40 }}>
      <div className="pbt-crumbs">
        <button type="button" onClick={() => navigate({ name: 'home' })}>Home</button> / Leaderboards
      </div>
      <h2 className="pbt-display pbt-h2">Leaderboards</h2>
      <p className="meta" style={{ marginTop: 8, marginBottom: 8 }}>
        Pick a boss to see its personal-best leaderboard.
      </p>

      {bosses.s === 'loading' && <div className="pbt-panel-state">Loading bosses...</div>}
      {bosses.s === 'error' && <div className="pbt-panel-state">Boss list unavailable.</div>}
      {isLoaded(bosses) &&
        groupBosses(bosses.data).map((group) => (
          <div className="pbt-section" key={group.category} style={{ paddingTop: 40 }}>
            <div className="pbt-sec-head">
              <h2 className="pbt-display pbt-h2">{group.category}</h2>
              <div className="rule" />
            </div>
            <div className="pbt-cards">
              {buildCardRows(bosses.data, group).map((row) => (
                <button
                  type="button"
                  className="pbt-card"
                  key={row.type === 'raid-base' ? `base:${row.base}` : row.key}
                  onClick={() => {
                    if (row.type === 'raid-base') {
                      const firstVariant = getRaidModes(bosses.data, row.base)[0]?.variants[0]?.key;
                      if (firstVariant) goToBoss(firstVariant);
                    } else {
                      goToBoss(row.key);
                    }
                  }}
                >
                  <BossIcon boss={row.type === 'raid-base' ? row.base : row.key} />
                  <div className="bname">{row.label}</div>
                </button>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}
