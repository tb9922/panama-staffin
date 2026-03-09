import { useState, useEffect } from 'react';
import { getCurrentHome, getTrainingData, getLoggedInUser } from '../lib/api.js';
import { PAGE } from '../lib/design.js';
import TabBar from '../components/TabBar.jsx';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import TrainingGrid from '../components/training/TrainingGrid.jsx';
import SupervisionPanel from '../components/training/SupervisionPanel.jsx';
import AppraisalPanel from '../components/training/AppraisalPanel.jsx';
import FireDrillPanel from '../components/training/FireDrillPanel.jsx';

const TABS = [
  { id: 'training', label: 'Training' },
  { id: 'supervisions', label: 'Supervisions' },
  { id: 'appraisals', label: 'Appraisals' },
  { id: 'fire_drills', label: 'Fire Drills' },
];

export default function TrainingMatrix() {
  const homeSlug = getCurrentHome();
  const isAdmin = getLoggedInUser()?.role === 'admin';
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

  if (loading) return <div className={PAGE.container} role="status"><p className="text-gray-500 mt-8">Loading...</p></div>;
  if (error) return <div className={PAGE.container}><p className="text-red-600 mt-8">{error}</p></div>;
  if (!state) return null;

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Print header */}
      <div className="hidden print:block print-header">
        <h1 className="text-xl font-bold">Training Matrix</h1>
        <p className="text-xs text-gray-500">Printed: {new Date().toLocaleDateString('en-GB')}</p>
      </div>

      <div className="flex items-center justify-between mb-5 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Training Matrix</h1>
          <p className="text-xs text-gray-500 mt-1">CQC Regulation 18 — Training, supervision & development</p>
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
          onReload={() => setRefreshKey(k => k + 1)}
          readOnly={!isAdmin}
        />
      )}
      {tab === 'supervisions' && (
        <SupervisionPanel
          supervisions={state.supervisions}
          staff={state.staff}
          homeSlug={homeSlug}
          config={state.config || {}}
          onReload={() => setRefreshKey(k => k + 1)}
          readOnly={!isAdmin}
        />
      )}
      {tab === 'appraisals' && (
        <AppraisalPanel
          appraisals={state.appraisals}
          staff={state.staff}
          homeSlug={homeSlug}
          onReload={() => setRefreshKey(k => k + 1)}
          readOnly={!isAdmin}
        />
      )}
      {tab === 'fire_drills' && (
        <FireDrillPanel
          fireDrills={state.fireDrills}
          staff={state.staff}
          homeSlug={homeSlug}
          onReload={() => setRefreshKey(k => k + 1)}
          readOnly={!isAdmin}
        />
      )}
    </div>
  );
}
