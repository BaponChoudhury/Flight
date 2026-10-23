"use client";

import { useEffect, useRef, useState } from "react";
import type { AirportRecord } from "@/lib/airports-index";

const field = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base dark:border-slate-600 dark:bg-slate-800";

export const airportLabel = (a: Pick<AirportRecord, "city" | "code">) => `${a.city} (${a.code})`;

/**
 * Type-ahead airport search backed by /api/airports (free OurAirports index).
 * `value` is the chosen IATA code, or null while nothing valid is chosen.
 * Typing a bare 3-letter code also works if the lookup is unavailable.
 */
export function AirportPicker({
  id,
  country,
  initial,
  onChange,
  onPick,
  placeholder,
}: {
  id: string;
  country?: string;
  initial?: AirportRecord | null;
  onChange?: (code: string | null) => void;
  /** Multi-select mode: called with each chosen airport, and the box clears for the next one. */
  onPick?: (airport: AirportRecord) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState(initial ? airportLabel(initial) : "");
  const [results, setResults] = useState<AirportRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [error, setError] = useState("");
  const seq = useRef(0);

  useEffect(() => {
    const q = text.trim();
    if (q.length < 2 || /\([A-Z]{3}\)$/.test(q)) {
      setResults([]);
      return;
    }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/airports?q=${encodeURIComponent(q)}${country ? `&country=${country}` : ""}`);
        const data = await res.json();
        if (mine !== seq.current) return;
        if (!res.ok) {
          setError("Airport search unavailable — type the 3-letter airport code instead.");
          setResults([]);
          return;
        }
        setError("");
        setResults(data.airports);
        setActive(0);
      } catch {
        if (mine === seq.current) setError("Airport search unavailable — type the 3-letter airport code instead.");
      }
    }, 200);
    return () => clearTimeout(t);
  }, [text, country]);

  function choose(a: AirportRecord) {
    setResults([]);
    setOpen(false);
    if (onPick) {
      onPick(a);
      setText("");
      return;
    }
    setText(airportLabel(a));
    onChange?.(a.code);
  }

  function edit(v: string) {
    setText(v);
    setOpen(true);
    const code = /^\s*([A-Za-z]{3})\s*$/.exec(v)?.[1] ?? /\(([A-Z]{3})\)\s*$/.exec(v)?.[1];
    onChange?.(code ? code.toUpperCase() : null);
  }

  /** In multi-select mode, Enter on a bare 3-letter code (e.g. PAR, a city code) adds it as typed. */
  function addTypedCode(): boolean {
    const code = /^\s*([A-Za-z]{3})\s*$/.exec(text)?.[1]?.toUpperCase();
    if (!onPick || !code || results.some((r) => r.code === code)) return false;
    onPick({ code, city: "All airports", name: "Typed airport or city code", country: "", lat: 0, lon: 0 });
    setText("");
    return true;
  }

  return (
    <div className="relative">
      <input
        id={id}
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        autoComplete="off"
        className={field}
        placeholder={placeholder}
        value={text}
        onChange={(e) => edit(e.target.value)}
        onFocus={(e) => {
          e.target.select();
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && addTypedCode()) {
            e.preventDefault();
            return;
          }
          if (!results.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && open) {
            e.preventDefault();
            choose(results[active]);
          }
        }}
      />
      {open && results.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-slate-300 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-800">
          {results.map((a, i) => (
            <li
              key={a.code}
              role="option"
              aria-selected={i === active}
              className={`cursor-pointer px-3 py-2 ${i === active ? "bg-sky-100 dark:bg-sky-900/50" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(a);
              }}
            >
              <span className="font-medium">{a.city}</span> <span className="text-slate-500">({a.code})</span>
              <span className="block text-xs text-slate-500">{a.name}</span>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">{error}</p>}
    </div>
  );
}
