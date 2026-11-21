const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

/** A die; `value` 0 shows a blank face (before anyone has rolled). */
export function Die({ value, rolling }: { value: number; rolling?: boolean }) {
  const pips = PIPS[value] ?? [];
  return (
    <div className={`die ${rolling ? "die-rolling" : ""}`} aria-label={value ? `Die showing ${value}` : "Die"}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={pips.includes(i) ? "pip" : ""} />
      ))}
    </div>
  );
}
