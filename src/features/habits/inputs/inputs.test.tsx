// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { HabitInput } from './HabitInput';
import { parseNumber } from './NumberInput';
import type { ValueInputProps } from './types';
import type { HabitType, RatingScale } from '@/domain/types';

const habit = (type: HabitType, extra: { unit?: string; ratingScale?: RatingScale } = {}) => ({
  name: 'Test',
  type,
  ...extra,
});

/** Holds the value like a real parent would and records every commit. */
function setup(h: ValueInputProps['habit'], initial?: number) {
  const commits: (number | undefined)[] = [];
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <>
        <HabitInput
          habit={h}
          value={value}
          label="Test, August 14"
          onChange={(v) => {
            commits.push(v);
            setValue(v);
          }}
        />
        <button type="button">elsewhere</button>
      </>
    );
  }
  render(<Harness />);
  return { user: userEvent.setup(), commits };
}

describe('BooleanToggle', () => {
  it('toggles done ↔ not logged', async () => {
    const { user, commits } = setup(habit('boolean'));
    const box = screen.getByRole('checkbox', { name: 'Test, August 14' });
    expect(box).not.toBeChecked();
    await user.click(box);
    expect(box).toBeChecked();
    await user.click(box);
    expect(commits).toEqual([1, undefined]);
  });

  it('shows an explicit "not done" and turns it into done on click', async () => {
    const { user, commits } = setup(habit('boolean'), 0);
    const box = screen.getByRole('checkbox', { name: 'Test, August 14 (marked not done)' });
    expect(box).toHaveTextContent('✗');
    await user.click(box);
    expect(commits).toEqual([1]);
  });

  it('works with the keyboard', async () => {
    const { user, commits } = setup(habit('boolean'));
    await user.tab();
    await user.keyboard(' ');
    expect(commits).toEqual([1]);
  });
});

describe('NumberInput', () => {
  it('commits on Enter and on blur, not per keystroke; accepts comma decimals', async () => {
    const { user, commits } = setup(habit('number', { unit: 'L' }));
    const input = screen.getByRole('textbox', { name: 'Test, August 14' });
    expect(screen.getByText('L')).toBeInTheDocument();
    await user.type(input, '2,5{Enter}');
    expect(commits).toEqual([2.5]);
    await user.clear(input);
    await user.type(input, '3');
    expect(commits).toEqual([2.5]);
    await user.click(screen.getByText('elsewhere'));
    expect(commits).toEqual([2.5, 3]);
    expect(input).toHaveValue('3');
  });

  it('stepper adds and subtracts one, never below zero', async () => {
    const { user, commits } = setup(habit('number'));
    expect(screen.getByRole('button', { name: 'Decrease Test, August 14' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Increase Test, August 14' }));
    await user.click(screen.getByRole('button', { name: 'Increase Test, August 14' }));
    await user.click(screen.getByRole('button', { name: 'Decrease Test, August 14' }));
    expect(commits).toEqual([1, 2, 1]);
  });

  it('emptying the field clears the entry; unchanged text commits nothing', async () => {
    const { user, commits } = setup(habit('number'), 4);
    const input = screen.getByRole('textbox');
    await user.click(input);
    await user.click(screen.getByText('elsewhere'));
    expect(commits).toEqual([]);
    await user.clear(input);
    await user.keyboard('{Enter}');
    expect(commits).toEqual([undefined]);
  });

  it('rejects invalid input (ENT-4), Escape reverts, blur keeps the last good value', async () => {
    const { user, commits } = setup(habit('number'), 4);
    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, '-2{Enter}');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a number ≥ 0');
    await user.keyboard('{Escape}');
    expect(input).toHaveValue('4');
    await user.clear(input);
    await user.type(input, 'abc');
    await user.click(screen.getByText('elsewhere'));
    expect(input).toHaveValue('4');
    expect(commits).toEqual([]);
  });

  it('parseNumber', () => {
    expect(parseNumber('1.25')).toBe(1.25);
    expect(parseNumber(' 7 ')).toBe(7);
    expect(parseNumber('.5')).toBe(0.5);
    expect(parseNumber('3.')).toBe(3);
    expect(parseNumber('')).toBeUndefined();
    for (const bad of ['-1', '1e3', '1.2.3', 'x', '1,2,3']) expect(parseNumber(bad)).toBeNull();
  });
});

describe('DurationInput', () => {
  it.each([
    ['45', 45],
    ['0:45', 45],
    ['1h30', 90],
    ['1.5h', 90],
  ])('"%s" → %i minutes', async (text, minutes) => {
    const { user, commits } = setup(habit('duration'));
    await user.type(screen.getByRole('textbox'), `${text}{Enter}`);
    expect(commits).toEqual([minutes]);
  });

  it('displays the value as text and flags invalid input', async () => {
    const { user, commits } = setup(habit('duration'), 90);
    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('1h 30m');
    await user.clear(input);
    await user.type(input, '1:75{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Try 45, 0:45 or 1h30');
    expect(commits).toEqual([]);
    // Re-committing the displayed text is a no-op.
    await user.keyboard('{Escape}{Enter}');
    expect(commits).toEqual([]);
  });
});

describe('RatingPicker', () => {
  it('renders the scale as a radio group; click picks, clicking again clears', async () => {
    const { user, commits } = setup(habit('rating', { ratingScale: { min: 1, max: 5 } }));
    const group = screen.getByRole('radiogroup', { name: 'Test, August 14' });
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    expect(group).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: '4' }));
    expect(screen.getByRole('radio', { name: '4' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: '4' }));
    expect(commits).toEqual([4, undefined]);
  });

  it('keyboard: one tab stop, arrows move, digits pick, 0 = 10, Delete clears', async () => {
    const { user, commits } = setup(habit('rating'), 7);
    await user.tab();
    expect(screen.getByRole('radio', { name: '7' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: '8' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}{ArrowLeft}3');
    await user.keyboard('0{End}{Home}{Delete}');
    expect(commits).toEqual([8, 7, 6, 3, 10, 10, 1, undefined]);
    await user.tab();
    expect(screen.getByText('elsewhere')).toHaveFocus();
  });

  it('ignores digits outside the scale', async () => {
    const { user, commits } = setup(habit('rating', { ratingScale: { min: 1, max: 5 } }), 2);
    await user.tab();
    await user.keyboard('9');
    expect(commits).toEqual([]);
  });

  it('wide scales fall back to a whole-number field clamped to the scale', async () => {
    const { user, commits } = setup(habit('rating', { ratingScale: { min: 0, max: 100 } }));
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(screen.getByText('/ 100')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox'), '150{Enter}');
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), '42.6{Enter}');
    expect(commits).toEqual([100, 43]);
  });
});
