import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import TrainingRecordModal from '../training/TrainingRecordModal.jsx';

describe('TrainingRecordModal', () => {
  it('wires the record fields to accessible labels', () => {
    render(
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
  });
});
