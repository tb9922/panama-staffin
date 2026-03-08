import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Modal from '../Modal.jsx';

vi.mock('../../lib/design.js', () => ({
  MODAL: {
    overlay: 'overlay',
    panel: 'panel',
    panelSm: 'panelSm',
    panelLg: 'panelLg',
    panelXl: 'panelXl',
    panelWide: 'panelWide',
    title: 'title',
  },
}));

describe('Modal', () => {
  it('returns null when isOpen is false', () => {
    const { container } = render(
      <Modal isOpen={false} onClose={vi.fn()} title="Test">
        <p>Content</p>
      </Modal>
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders dialog when isOpen is true', () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()} title="Test Modal">
        <p>Content</p>
      </Modal>
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('has role="dialog" and aria-modal="true"', () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()} title="Test Modal">
        <p>Content</p>
      </Modal>
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('renders the title with correct text', () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()} title="My Modal Title">
        <p>Content</p>
      </Modal>
    );
    expect(screen.getByText('My Modal Title')).toBeInTheDocument();
  });

  it('aria-labelledby links to the title element id', () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()} title="Labelled Modal">
        <p>Content</p>
      </Modal>
    );
    const dialog = screen.getByRole('dialog');
    const labelledById = dialog.getAttribute('aria-labelledby');
    expect(labelledById).toBeTruthy();
    const titleEl = document.getElementById(labelledById);
    expect(titleEl).toBeInTheDocument();
    expect(titleEl.textContent).toBe('Labelled Modal');
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={onClose} title="Escape Test">
        <p>Content</p>
      </Modal>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the backdrop overlay is clicked', () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={onClose} title="Backdrop Test">
        <p>Content</p>
      </Modal>
    );
    const overlay = screen.getByRole('dialog');
    // Click the overlay element itself (target === currentTarget)
    fireEvent.click(overlay, { target: overlay });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onClose when panel content is clicked', () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={onClose} title="Panel Click Test">
        <button>Inner Button</button>
      </Modal>
    );
    // The overlay's onClick only fires if target === currentTarget.
    // Clicking a child element sets target to the child, not the overlay.
    fireEvent.click(screen.getByText('Inner Button'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders children inside the dialog', () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()} title="Children Test">
        <p>Child paragraph</p>
        <button>Child button</button>
      </Modal>
    );
    expect(screen.getByText('Child paragraph')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Child button' })).toBeInTheDocument();
  });

  it('applies the sm panel class when size="sm"', () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()} title="Small Modal" size="sm">
        <p>Content</p>
      </Modal>
    );
    // The inner panel div gets panelSm class from the mock
    const panel = screen.getByRole('dialog').firstChild;
    expect(panel).toHaveClass('panelSm');
  });

  it('applies the lg panel class when size="lg"', () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()} title="Large Modal" size="lg">
        <p>Content</p>
      </Modal>
    );
    const panel = screen.getByRole('dialog').firstChild;
    expect(panel).toHaveClass('panelLg');
  });

  it('applies the default md panel class when no size is specified', () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()} title="Default Modal">
        <p>Content</p>
      </Modal>
    );
    const panel = screen.getByRole('dialog').firstChild;
    expect(panel).toHaveClass('panel');
  });
});
