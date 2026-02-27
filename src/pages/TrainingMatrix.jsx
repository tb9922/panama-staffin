import { useState, useEffect, useCallback } from 'react';
import { getCurrentHome, getTrainingData } from '../lib/api.js';
import { PAGE } from '../lib/design.js';
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
  const [tab, setTab] = useState('training');
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getTrainingData(homeSlug);
      setState(data);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [homeSlug]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className={PAGE.container}><p className="text-gray-500 mt-8">Loading...</p></div>;
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
      <div className="flex gap-1 mb-5 border-b border-gray-200 print:hidden">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'training' && (
        <TrainingGrid
          training={state.training}
          trainingTypes={state.trainingTypes}
          staff={state.staff}
          homeSlug={homeSlug}
          config={{ training_types: state.trainingTypes }}
          onReload={load}
        />
      )}
      {tab === 'supervisions' && (
        <SupervisionPanel
          supervisions={state.supervisions}
          staff={state.staff}
          homeSlug={homeSlug}
          config={state.config || {}}
          onReload={load}
        />
      )}
      {tab === 'appraisals' && (
        <AppraisalPanel
          appraisals={state.appraisals}
          staff={state.staff}
          homeSlug={homeSlug}
          onReload={load}
        />
      )}
      {tab === 'fire_drills' && (
        <FireDrillPanel
          fireDrills={state.fireDrills}
          staff={state.staff}
          homeSlug={homeSlug}
          onReload={load}
        />
      )}
    </div>
  );
}
