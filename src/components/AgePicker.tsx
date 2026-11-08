import { AGE_GROUPS, ageLabel, type AgeGroup } from '../types';

interface Props {
  value: AgeGroup | null;
  onChange: (age: AgeGroup) => void;
}

export function AgePicker({ value, onChange }: Props) {
  return (
    <div className="age-grid">
      {AGE_GROUPS.map((age) => (
        <button
          key={age}
          type="button"
          className="age-option"
          aria-pressed={value === age}
          onClick={() => onChange(age)}
        >
          {ageLabel(age)}
        </button>
      ))}
    </div>
  );
}
