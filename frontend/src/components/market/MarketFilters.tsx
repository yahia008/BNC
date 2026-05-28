'use client';

interface MarketFiltersProps {
  weightClass: string;
  status: string;
  sort: string;
  onWeightClassChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onSortChange: (value: string) => void;
}

const WEIGHT_CLASSES = [
  'All Weight Classes',
  'Heavyweight',
  'Light Heavyweight',
  'Super Middleweight',
  'Middleweight',
  'Super Welterweight',
  'Welterweight',
  'Super Lightweight',
  'Lightweight',
  'Super Featherweight',
  'Featherweight',
  'Super Bantamweight',
  'Bantamweight',
  'Super Flyweight',
  'Flyweight',
  'Minimumweight',
];

const STATUSES = ['All', 'Open', 'Resolved'];

const SORT_OPTIONS = [
  { value: 'date_asc', label: 'Date ↑' },
  { value: 'date_desc', label: 'Date ↓' },
  { value: 'pool_desc', label: 'Pool ↓' },
];

export function MarketFilters({
  weightClass,
  status,
  sort,
  onWeightClassChange,
  onStatusChange,
  onSortChange,
}: MarketFiltersProps): JSX.Element {
  return (
    <div className="flex flex-wrap gap-3 items-center">
      {/* Weight class dropdown */}
      <select
        value={weightClass}
        onChange={(e) => onWeightClassChange(e.target.value)}
        className="min-h-[44px] bg-gray-800 text-white text-sm rounded-lg px-3 focus:outline-none focus:ring-2 focus:ring-amber-500"
      >
        {WEIGHT_CLASSES.map((w) => (
          <option key={w}>{w}</option>
        ))}
      </select>

      {/* Status tabs */}
      <div className="flex rounded-lg overflow-hidden border border-gray-700">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => onStatusChange(s)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              status === s
                ? 'bg-amber-500 text-black'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Sort control */}
      <select
        value={sort}
        onChange={(e) => onSortChange(e.target.value)}
        className="min-h-[44px] bg-gray-800 text-white text-sm rounded-lg px-3 focus:outline-none focus:ring-2 focus:ring-amber-500 ml-auto"
      >
        {SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
