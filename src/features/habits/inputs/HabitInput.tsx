import { BooleanToggle } from './BooleanToggle';
import { DurationInput } from './DurationInput';
import { NumberInput } from './NumberInput';
import { RatingPicker } from './RatingPicker';
import type { ValueInputProps } from './types';

/** Renders the right input for the habit's type (design §6.1). Layout-agnostic: no labels or row chrome. */
export function HabitInput(props: ValueInputProps) {
  switch (props.habit.type) {
    case 'boolean':
      return <BooleanToggle {...props} />;
    case 'number':
      return <NumberInput {...props} />;
    case 'duration':
      return <DurationInput {...props} />;
    case 'rating':
      return <RatingPicker {...props} />;
  }
}
