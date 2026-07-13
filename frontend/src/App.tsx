import { PhaseTwoOsrsPreview } from './components/PhaseTwoOsrsPreview';

// This branch exists solely to preview the OSRS "Quattro" theme redesign
// (see PhaseTwoOsrsPreview), so it takes over the whole app at the root
// instead of living under a /phase-two-osrs-preview sub-path - a bare
// deployment link should land straight on it with no extra path to
// remember or type.
export default function App() {
  return <PhaseTwoOsrsPreview />;
}
