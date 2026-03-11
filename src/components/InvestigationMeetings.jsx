import { useState, useEffect, useCallback } from 'react';
import { getHrMeetings, createHrMeeting } from '../lib/api.js';
import { MEETING_TYPES, MEETING_ATTENDEE_ROLES } from '../lib/hr.js';
import { BTN, INPUT, CARD, BADGE } from '../lib/design.js';
import StaffPicker from './StaffPicker.jsx';

const TYPE_BADGE = {
  interview: BADGE.blue,
  hearing: BADGE.amber,
  review: BADGE.green,
  informal: BADGE.gray,
};

function typeName(id) {
  return MEETING_TYPES.find(t => t.id === id)?.name || id;
}

function roleName(id) {
  return MEETING_ATTENDEE_ROLES.find(r => r.id === id)?.name || id;
}

function initialForm() {
  return {
    meeting_date: new Date().toISOString().slice(0, 10),
    meeting_time: '',
    meeting_type: 'interview',
    location: '',
    attendees: [],
    summary: '',
    key_points: '',
    outcome: '',
  };
}

function blankAttendee() {
  return { staff_id: '', name: '', role_in_meeting: 'witness' };
}

export default function InvestigationMeetings({ caseType, caseId, readOnly = false }) {
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [form, setForm] = useState(initialForm);

  const loadMeetings = useCallback(async () => {
    if (!caseId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getHrMeetings(caseType, caseId);
      setMeetings(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [caseType, caseId]);

  useEffect(() => {
    if (caseId) loadMeetings();
  }, [caseId, loadMeetings]);

  function updateForm(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  function addAttendee() {
    setForm(prev => ({ ...prev, attendees: [...prev.attendees, blankAttendee()] }));
  }

  function updateAttendee(index, field, value) {
    setForm(prev => {
      const next = prev.attendees.map((a, i) => i === index ? { ...a, [field]: value } : a);
      return { ...prev, attendees: next };
    });
  }

  function removeAttendee(index) {
    setForm(prev => ({ ...prev, attendees: prev.attendees.filter((_, i) => i !== index) }));
  }

  async function handleSave() {
    setError(null);
    if (!form.meeting_date) { setError('Meeting date is required'); return; }
    if (form.attendees.length === 0) { setError('At least one attendee is required'); return; }
    if (form.attendees.some(a => !a.name.trim())) { setError('All attendees must have a name'); return; }
    try {
      await createHrMeeting(caseType, caseId, form);
      setShowForm(false);
      setForm(initialForm());
      await loadMeetings();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!caseId) {
    return <p className="text-sm text-gray-400 italic">Save the case first to record meetings.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-700">Investigation Meetings</h4>
        {!readOnly && !showForm && (
          <button onClick={() => { setShowForm(true); setForm(initialForm()); }} className={BTN.primary + ' ' + BTN.xs}>
            Record Meeting
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {showForm && (
        <div className={CARD.padded + ' space-y-4'}>
          {/* Row 1: Date, Time, Type, Location */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className={INPUT.label}>Date</label>
              <input type="date" className={INPUT.sm} value={form.meeting_date} onChange={e => updateForm('meeting_date', e.target.value)} />
            </div>
            <div>
              <label className={INPUT.label}>Time</label>
              <input type="text" className={INPUT.sm} placeholder="14:00" value={form.meeting_time} onChange={e => updateForm('meeting_time', e.target.value)} />
            </div>
            <div>
              <label className={INPUT.label}>Type</label>
              <select className={INPUT.select} value={form.meeting_type} onChange={e => updateForm('meeting_type', e.target.value)}>
                {MEETING_TYPES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className={INPUT.label}>Location</label>
              <input type="text" className={INPUT.sm} placeholder="Office / Room" value={form.location} onChange={e => updateForm('location', e.target.value)} />
            </div>
          </div>

          {/* Attendees */}
          <div>
            <label className={INPUT.label}>Attendees</label>
            {form.attendees.length === 0 && (
              <p className="text-xs text-gray-400 mb-2">No attendees added yet.</p>
            )}
            <div className="space-y-2">
              {form.attendees.map((att, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-44">
                    <StaffPicker
                      value={att.staff_id}
                      onChange={val => updateAttendee(i, 'staff_id', val)}
                      small
                      showInactive
                      showAll
                    />
                  </div>
                  <input
                    type="text"
                    className={INPUT.sm + ' flex-1'}
                    placeholder="Name (or external attendee)"
                    value={att.name}
                    onChange={e => updateAttendee(i, 'name', e.target.value)}
                  />
                  <select
                    className={INPUT.select + ' w-48 text-xs py-1.5'}
                    value={att.role_in_meeting}
                    onChange={e => updateAttendee(i, 'role_in_meeting', e.target.value)}
                  >
                    {MEETING_ATTENDEE_ROLES.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                  <button onClick={() => removeAttendee(i)} className={BTN.ghost + ' ' + BTN.xs + ' text-red-500'} title="Remove attendee">
                    &times;
                  </button>
                </div>
              ))}
            </div>
            <button onClick={addAttendee} className={BTN.ghost + ' ' + BTN.xs + ' mt-2'}>+ Add Attendee</button>
          </div>

          {/* Summary */}
          <div>
            <label className={INPUT.label}>Summary</label>
            <textarea
              className={INPUT.base}
              rows={6}
              placeholder="Record what was discussed, questions asked, responses given..."
              value={form.summary}
              onChange={e => updateForm('summary', e.target.value)}
            />
          </div>

          {/* Key Points */}
          <div>
            <label className={INPUT.label}>Key Points</label>
            <textarea
              className={INPUT.base}
              rows={3}
              placeholder="Bullet point the key findings or admissions..."
              value={form.key_points}
              onChange={e => updateForm('key_points', e.target.value)}
            />
          </div>

          {/* Outcome/Actions */}
          <div>
            <label className={INPUT.label}>Outcome / Actions</label>
            <textarea
              className={INPUT.base}
              rows={3}
              placeholder="Next steps, actions agreed, follow-up required..."
              value={form.outcome}
              onChange={e => updateForm('outcome', e.target.value)}
            />
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
            <button onClick={() => setShowForm(false)} className={BTN.secondary + ' ' + BTN.sm}>Cancel</button>
            <button onClick={handleSave} className={BTN.primary + ' ' + BTN.sm}>Save Meeting</button>
          </div>
        </div>
      )}

      {/* Meeting Cards */}
      {meetings.length === 0 && !loading && !showForm && (
        <p className="text-sm text-gray-400">No meetings recorded.</p>
      )}

      {meetings.map(m => {
        const expanded = expandedId === m.id;
        const badge = TYPE_BADGE[m.meeting_type] || BADGE.gray;
        const attendees = Array.isArray(m.attendees) ? m.attendees : [];
        const attendeeSummary = attendees.map(a => `${a.name} (${roleName(a.role_in_meeting)})`).join(', ');
        const previewLen = 150;
        const summaryPreview = (m.summary || '').length > previewLen
          ? m.summary.slice(0, previewLen) + '...'
          : m.summary || '';

        return (
          <div
            key={m.id}
            className={CARD.base + ' p-4 cursor-pointer transition-colors hover:border-gray-300'}
            onClick={() => setExpandedId(expanded ? null : m.id)}
          >
            {/* Header */}
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-medium text-gray-900">{m.meeting_date}</span>
              {m.meeting_time && <span className="text-xs text-gray-500">{m.meeting_time}</span>}
              <span className={badge}>{typeName(m.meeting_type)}</span>
              {m.location && <span className="text-xs text-gray-400">{m.location}</span>}
            </div>

            {/* Attendees */}
            {attendeeSummary && (
              <p className="text-xs text-gray-500 mt-1">{attendeeSummary}</p>
            )}

            {/* Summary preview or full */}
            {!expanded && summaryPreview && (
              <p className="text-sm text-gray-600 mt-2">{summaryPreview}</p>
            )}

            {expanded && (
              <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
                {m.summary && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Summary</p>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{m.summary}</p>
                  </div>
                )}
                {m.key_points && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Key Points</p>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{m.key_points}</p>
                  </div>
                )}
                {m.outcome && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Outcome / Actions</p>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{m.outcome}</p>
                  </div>
                )}
              </div>
            )}

            {/* Footer */}
            <p className="text-xs text-gray-400 mt-2">
              Recorded by {m.recorded_by || 'unknown'}{m.created_at ? ` \u2014 ${new Date(m.created_at).toLocaleDateString('en-GB')}` : ''}
            </p>
          </div>
        );
      })}
    </div>
  );
}
