import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import TrainingRecordModal from '../training/TrainingRecordModal.jsx';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    upsertTrainingRecord: vi.fn(),
    deleteTrainingRecord: vi.fn(),
    getTrainingRecordFiles: vi.fn().mockResolvedValue([]),
    uploadTrainingRecordFile: vi.fn(),
    deleteTrainingRecordFile: vi.fn(),
    downloadTrainingRecordFile: vi.fn(),
  };
});

describe('TrainingRecordModal', () => {
  it('wires the record fields to accessible labels', () => {
    renderWithProviders(
      <TrainingRecordModal
        isOpen
        onClose={() => {}}
        staffId="S001"
        staffName="Alice Smith"
        typeId="fire_safety"
        typeName="Fire Safety"
        type={{ refresher_months: 12 }}
        existing={null}
        homeSlug="test-home"
        staff={[{ id: 'S001', role: 'Carer' }]}
        onSaved={() => {}}
      />
    );

    expect(screen.getByLabelText('Certificate Reference')).toBeInTheDocument();
    expect(screen.getByLabelText('Evidence File Reference')).toBeInTheDocument();
    expect(screen.getByLabelText('Notes')).toBeInTheDocument();
    expect(screen.getByText(/save this training record first/i)).toBeInTheDocument();
  });

  it('shows certificate evidence controls for existing records', async () => {
    renderWithProviders(
      <TrainingRecordModal
        isOpen
        onClose={() => {}}
        staffId="S001"
        staffName="Alice Smith"
        typeId="fire_safety"
        typeName="Fire Safety"
        type={{ refresher_months: 12 }}
        existing={{ completed: '2026-01-01', expiry: '2027-01-01' }}
        homeSlug="test-home"
        staff={[{ id: 'S001', role: 'Carer' }]}
        onSaved={() => {}}
      />
    );

    expect(screen.getByText('Training Certificate Evidence')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('No training evidence uploaded yet.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Choose file' })).toBeInTheDocument();
  });
});
