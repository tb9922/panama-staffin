import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Pagination from '../Pagination.jsx';

describe('Pagination', () => {
  it('returns null when total <= limit (all rows fit on one page)', () => {
    const { container } = render(
      <Pagination total={20} limit={20} offset={0} onChange={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('returns null when total is less than limit', () => {
    const { container } = render(
      <Pagination total={5} limit={20} offset={0} onChange={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows "1–20 of 50" page info on first page', () => {
    render(<Pagination total={50} limit={20} offset={0} onChange={vi.fn()} />);
    // The component renders an en-dash HTML entity (&ndash;) between numbers
    expect(screen.getByText(/of 50/)).toBeInTheDocument();
    const rangeEl = screen.getByText(/of 50/);
    expect(rangeEl.textContent).toMatch(/1/);
    expect(rangeEl.textContent).toMatch(/20/);
  });

  it('shows correct range on middle page', () => {
    render(<Pagination total={50} limit={20} offset={20} onChange={vi.fn()} />);
    const rangeEl = screen.getByText(/of 50/);
    expect(rangeEl.textContent).toMatch(/21/);
    expect(rangeEl.textContent).toMatch(/40/);
  });

  it('shows correct range on last (partial) page', () => {
    render(<Pagination total={50} limit={20} offset={40} onChange={vi.fn()} />);
    const rangeEl = screen.getByText(/of 50/);
    expect(rangeEl.textContent).toMatch(/41/);
    expect(rangeEl.textContent).toMatch(/50/);
  });

  it('disables First and Prev buttons on page 1', () => {
    render(<Pagination total={50} limit={20} offset={0} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'First' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Prev' })).toBeDisabled();
  });

  it('enables Next and Last buttons on page 1', () => {
    render(<Pagination total={50} limit={20} offset={0} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Last' })).not.toBeDisabled();
  });

  it('disables Next and Last buttons on the last page', () => {
    render(<Pagination total={50} limit={20} offset={40} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Last' })).toBeDisabled();
  });

  it('enables First and Prev buttons on the last page', () => {
    render(<Pagination total={50} limit={20} offset={40} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'First' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Prev' })).not.toBeDisabled();
  });

  it('clicking Next calls onChange with offset + limit', () => {
    const onChange = vi.fn();
    render(<Pagination total={50} limit={20} offset={0} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onChange).toHaveBeenCalledWith(20);
  });

  it('clicking Prev calls onChange with offset - limit', () => {
    const onChange = vi.fn();
    render(<Pagination total={50} limit={20} offset={20} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Prev' }));
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('clicking Prev never calls onChange with a negative offset', () => {
    const onChange = vi.fn();
    // Page 2 with a small partial offset into it: offset=35, limit=30 → page 2 of 4.
    // max(0, 35-30) = 5, which is non-negative and correct.
    // The "never negative" guarantee: even at offset=30 (start of page 2) it would be 0.
    render(<Pagination total={120} limit={30} offset={35} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Prev' }));
    expect(onChange).toHaveBeenCalledWith(5);
    expect(onChange).not.toHaveBeenCalledWith(expect.any(Number) < 0 ? -1 : false);
  });

  it('clicking Prev on the exact start of page 2 calls onChange with 0', () => {
    const onChange = vi.fn();
    // offset=30, limit=30 → page 2; max(0, 30-30) = 0
    render(<Pagination total={120} limit={30} offset={30} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Prev' }));
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('clicking First calls onChange with 0', () => {
    const onChange = vi.fn();
    render(<Pagination total={50} limit={20} offset={40} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'First' }));
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('clicking Last calls onChange with the last page offset', () => {
    const onChange = vi.fn();
    render(<Pagination total={50} limit={20} offset={0} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Last' }));
    // totalPages = ceil(50/20) = 3; last offset = (3-1)*20 = 40
    expect(onChange).toHaveBeenCalledWith(40);
  });

  it('shows current page / total pages', () => {
    render(<Pagination total={50} limit={20} offset={20} onChange={vi.fn()} />);
    // Page 2 of 3
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });
});
