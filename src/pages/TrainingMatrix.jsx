import { useState, useEffect } from 'react';
import { getCurrentHome, getTrainingData } from '../lib/api.js';
import { PAGE } from '../lib/design.js';
import TabBar from '../components/TabBar.jsx';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import TrainingGrid from '../components/training/TrainingGrid.jsx';
import SupervisionPanel from '../components/training/SupervisionPanel.jsx';
import AppraisalPanel from '../components/training/AppraisalPanel.jsx';
import FireDrillPanel from '../components/training/FireDrillPanel.jsx';
import { useData } from '../contexts/DataContext.jsx';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';

const TABS = [
  { id: 'training', label: 'Training' },
  { id: 'supervisions', label: 'Supervisions' },
  { id: 'appraisals', label: 'Appraisals' },
  { id: 'fire_drills', label: 'Fire Drills' },
];

export default function TrainingMatrix() {
  const homeSlug = getCurrentHome();
  const { canWrite } = useData();
  const canEdit = canWrite('compliance');
  const [tab, setTab] = useState('training');
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  useDirtyGuard(false); // Child components manage their own modals

  useEffect(() => {
    let stale = false;
    (async () => {
      try {
        setLoading(true);
        const data = await getTrainingData(homeSlug);
        if (!stale) { setState(data); setError(null); }
      } catch (e) { if (!stale) setError(e.message); }
      finally { if (!stale) setLoading(false); }
    })();
    return () => { stale = true; };
  }, [homeSlug, refreshKey]);

  if (loading) return <div className={PAGE.container}><LoadingState message="Loading training data..." card /></div>;
  if (error) return <div className={PAGE.container}><ErrorState title="Unable to load training data" message={error} onRetry={() => setRefreshKey(k => k + 1)} /></div>;
  if (!state) return null;

  return (
    <div className="mx-auto max-w-[1400px] overflow-x-hidden p-6">
      {/* Print header */}
      <div className="hidden print:block print-header">
        <h1 className="text-xl font-bold">Training Matrix</h1>
        <p className="text-xs text-[var(--ink-3)]">Printed: {new Date().toLocaleDateString('en-GB')}</p>
      </div>

      <div className={`${PAGE.header} print:hidden`}>
        <div>
          <h1 className={PAGE.title}>Training Matrix</h1>
          <p className={PAGE.subtitle}>CQC Regulation 18 — training, supervision and development</p>
        </div>
      </div>

      {/* Tabs */}
      <TabBar tabs={TABS} activeTab={tab} onTabChange={setTab} className="mb-5 print:hidden" />

      {tab === 'training' && (
        <TrainingGrid
          training={state.training}
          trainingTypes={state.trainingTypes}
          staff={state.staff}
          homeSlug={homeSlug}
          config={{ training_types: state.trainingTypes }}
          configUpdatedAt={state.configUpdatedAt}
          onReload={() => setRefreshKey(k => k + 1)}
          readOnly={!canEdit}
        />
      )}
      {tab === 'supervisions' && (
        <SupervisionPanel
          supervisions={state.supervisions}
          staff={state.staff}
          homeSlug={homeSlug}
          config={state.config || {}}
          onReload={() => setRefreshKey(k => k + 1)}
          readOnly={!canEdit}
        />
      )}
      {tab === 'appraisals' && (
        <AppraisalPanel
          appraisals={state.appraisals}
          staff={state.staff}
          homeSlug={homeSlug}
          onReload={() => setRefreshKey(k => k + 1)}
          readOnly={!canEdit}
        />
      )}
      {tab === 'fire_drills' && (
        <FireDrillPanel
          fireDrills={state.fireDrills}
          staff={state.staff}
          homeSlug={homeSlug}
          onReload={() => setRefreshKey(k => k + 1)}
          readOnly={!canEdit}
        />
      )}
    </div>
  );
}
