"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import "./page.css";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "";
const REFRESH_INTERVAL = 30000;
const SEARCH_DEBOUNCE_MS = 300;
const STATION_QUERY_MIN_LENGTH = 2;
const MAX_VISIBLE_DEPARTURE_ROWS = 5;
const PAST_DEPARTURE_GRACE_PERIOD_MS = 2 * 60 * 1000;
const TIME_IN_REMARKS_REGEX = /(\d{1,2}:\d{2})/;
const BOARD_BASE_WIDTH = 1280;
const BOARD_BASE_HEIGHT = 720;
const MIN_BOARD_SCALE = 0.1;
const MAX_BOARD_SCALE = 10;
const BOARD_VIEWPORT_MARGIN = 0;

const STATUS_LABELS = {
  pontual: "Pontual",
  suprimido: "Suprimido",
  atrasado: "Atrasado",
};

function parseTimeToDate(timeValue: string | undefined, now: Date) {
  if (typeof timeValue !== "string") return null;
  const match = timeValue.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;

  const target = new Date(now);
  target.setSeconds(0, 0);
  target.setHours(hours, minutes, 0, 0);

  let diffMs = target.getTime() - now.getTime();
  if (diffMs < -12 * 60 * 60 * 1000) {
    diffMs += 24 * 60 * 60 * 1000;
  }

  return { target, diffMs };
}

function parseTimeFromRemarks(remarks: string | undefined, now: Date) {
  if (typeof remarks !== "string" || !remarks) return null;
  const match = remarks.match(TIME_IN_REMARKS_REGEX);
  if (!match) return null;
  return parseTimeToDate(match[1], now);
}

function parseDelayMinutesFromRemarks(remarks: string | undefined) {
  if (typeof remarks !== "string" || !remarks) return null;
  const text = remarks.toLowerCase();
  const patterns = [
    /(\d{1,3})\s*(?:minutos?|mins?|m)\b/,
    /\+\s*(\d{1,3})\b/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const minutes = Number(m[1]);
      if (Number.isFinite(minutes)) return minutes;
    }
  }
  return null;
}

function getEffectiveDeparture(row: any, now: Date) {
  const remarksTime = parseTimeFromRemarks(row?.remarks, now);
  if (remarksTime) return remarksTime;

  const primary = parseTimeToDate(row?.time, now);
  if (!primary) return null;

  const delayMin = parseDelayMinutesFromRemarks(row?.remarks);
  const isDelayed = typeof row?.status === "string" && row.status.toLowerCase() === "atrasado";
  if (Number.isFinite(delayMin) || isDelayed) {
    const minutes = Number.isFinite(delayMin) ? (delayMin ?? 0) : 0;
    const target = new Date(primary.target.getTime() + minutes * 60 * 1000);
    return {
      target,
      diffMs: target.getTime() - now.getTime(),
    };
  }

  return primary;
}

function clampBoardScale(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  if (value < MIN_BOARD_SCALE) return MIN_BOARD_SCALE;
  if (value > MAX_BOARD_SCALE) return MAX_BOARD_SCALE;
  return value;
}

function computeBoardScaleXY(windowWidth: number, windowHeight: number, baseWidth: number, baseHeight: number) {
  if (!Number.isFinite(windowWidth) || !Number.isFinite(windowHeight)) {
    return { x: 1, y: 1 };
  }

  const safeWidth = Math.max(windowWidth - BOARD_VIEWPORT_MARGIN, 1);
  const safeHeight = Math.max(windowHeight - BOARD_VIEWPORT_MARGIN, 1);
  const x = clampBoardScale(safeWidth / baseWidth);
  const y = clampBoardScale(safeHeight / baseHeight);
  return { x, y };
}

function shouldBlinkRow(row: any, now: Date) {
  if (row.passed) return false;
  const effective = getEffectiveDeparture(row, now);
  if (!effective) return false;
  const lowerBound = -PAST_DEPARTURE_GRACE_PERIOD_MS;
  const upperBound = 5 * 60 * 1000;
  return effective.diffMs >= lowerBound && effective.diffMs <= upperBound;
}

interface BoardTableProps {
  title: string | null;
  subtitle: string | null;
  columns: Array<{ key: string; label: string }>;
  rows: any[];
  type: string;
  now: Date | null;
}

function BoardTable({ title, subtitle, columns, rows, type, now }: BoardTableProps) {
  const safeRows = Array.isArray(rows) ? rows.slice(0, MAX_VISIBLE_DEPARTURE_ROWS) : [];
  const shouldShowHeader = Boolean(title) || Boolean(subtitle);
  const safeNow = now || new Date();

  return (
    <section className={`board board--${type}`}>
      {shouldShowHeader ? (
        <header className="board__header">
          <h2>{title}</h2>
          {subtitle ? <span className="board__subtitle">{subtitle}</span> : null}
        </header>
      ) : null}
      <table className="board__table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={`col-${column.key}`}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {safeRows.length === 0 ? (
            <tr className="board__empty">
              <td colSpan={columns.length}>Sem registos disponíveis</td>
            </tr>
          ) : (
            safeRows.map((row, index) => {
              const blink = shouldBlinkRow(row, safeNow);
              const isDelayed = (() => {
                const rmk = typeof row.remarks === "string" ? row.remarks.toLowerCase() : "";
                const st = typeof row.status === "string" ? row.status.toLowerCase() : "";
                return rmk.includes("circula com atraso") || st === "atrasado";
              })();
              const isSuppressed = (() => {
                const rmk = typeof row.remarks === "string" ? row.remarks.toLowerCase() : "";
                const st = typeof row.status === "string" ? row.status.toLowerCase() : "";
                return rmk.includes("suprimido") || st === "suprimido";
              })();
              return (
                <tr
                  key={row.id}
                  className={`board__row${index === 0 ? " board__row--highlight" : ""}${blink ? " board__row--blink" : ""}${isDelayed ? " board__row--delayed" : ""}${isSuppressed ? " board__row--suppressed" : ""}`}
                >
                  {columns.map((column) => {
                    const rawValue = row[column.key];

                    if (column.key === "remarks") {
                      const remarksText = typeof rawValue === "string" ? rawValue.trim() : "";
                      const normalizedStatus = typeof row.status === "string" ? row.status.toLowerCase() : "";
                      const statusLabel = STATUS_LABELS[normalizedStatus as keyof typeof STATUS_LABELS] ?? "";
                      const text = remarksText || statusLabel;
                      return (
                        <td key={column.key} className="col-remarks col-remarks--cell">
                          <span className="remarks">
                            <span className="remarks__logo" aria-hidden="true">CP</span>
                            {text ? <span className="remarks__text">{text}</span> : null}
                          </span>
                        </td>
                      );
                    }

                    let displayValue;
                    if (column.key === "time") {
                      const primary = parseTimeToDate(row?.time, safeNow);
                      const effective = getEffectiveDeparture(row, safeNow);
                      const fmt = (d: Date | null) => d?.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
                      const primaryHM = primary?.target instanceof Date ? fmt(primary.target) : null;
                      const effectiveHM = effective?.target instanceof Date ? fmt(effective.target) : null;

                      if (effectiveHM && primaryHM && effectiveHM !== primaryHM) {
                        displayValue = (
                          <span className="time time--delayed">
                            <span className="time__original" aria-hidden="true">{primaryHM}</span>
                            <span className="time__arrow" aria-hidden="true">→</span>
                            <span className="time__effective">{effectiveHM}</span>
                          </span>
                        );
                      } else if (effectiveHM) {
                        displayValue = effectiveHM;
                      } else {
                        displayValue = typeof rawValue === "string" && rawValue.trim() ? rawValue : "—";
                      }
                    } else {
                      displayValue =
                        typeof rawValue === "string"
                          ? rawValue.trim() === ""
                            ? "—"
                            : rawValue
                          : rawValue ?? "—";
                    }
                    const cellClass = `col-${column.key}`;

                    return (
                      <td key={column.key} className={cellClass}>
                        {displayValue}
                      </td>
                    );
                  })}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </section>
  );
}

function formatClock(date: Date | null) {
  if (!date) return "--:--:--";
  
  return date.toLocaleTimeString("pt-PT", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function Home() {
  const [board, setBoard] = useState({
    departures: [],
    message: "",
    lastUpdated: "",
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [now, setNow] = useState<Date | null>(null);
  const [stationQuery, setStationQuery] = useState("");
  const [stationResults, setStationResults] = useState<any[]>([]);
  const [isSearchingStations, setIsSearchingStations] = useState(false);
  const [stationError, setStationError] = useState("");
  const [selectedStation, setSelectedStation] = useState<any>(null);
  const [isStationModalOpen, setIsStationModalOpen] = useState(true);
  const [boardScale, setBoardScale] = useState({ x: 1, y: 1 });
  const [boardDimensions, setBoardDimensions] = useState({
    width: BOARD_BASE_WIDTH,
    height: BOARD_BASE_HEIGHT,
  });
  const [isMounted, setIsMounted] = useState(false);
  const stationInputRef = useRef<HTMLInputElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Initialize client-side only values after mount
  useEffect(() => {
    setIsMounted(true);
    setNow(new Date());
    
    if (typeof window !== "undefined") {
      setBoardScale(computeBoardScaleXY(window.innerWidth, window.innerHeight, BOARD_BASE_WIDTH, BOARD_BASE_HEIGHT));
    }
  }, []);

  useEffect(() => {
    if (!isMounted) return;
    
    const tick = () => setNow(new Date());
    const clock = setInterval(tick, 1000);
    return () => clearInterval(clock);
  }, [isMounted]);

  useEffect(() => {
    if (!isStationModalOpen) {
      setStationResults([]);
      setStationError("");
      setIsSearchingStations(false);
      return;
    }

    const trimmed = stationQuery.trim();

    if (trimmed.length < STATION_QUERY_MIN_LENGTH) {
      setStationResults([]);
      setStationError("");
      setIsSearchingStations(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setStationError("");
    setStationResults([]);
    setIsSearchingStations(true);

    const timeoutId = setTimeout(async () => {
      try {
        const url = API_BASE_URL
          ? `${API_BASE_URL}/api/stations?q=${encodeURIComponent(trimmed)}`
          : `/api/stations?q=${encodeURIComponent(trimmed)}`;
          
        const response = await fetch(url, {
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Erro ao pesquisar estações (${response.status})`);
        }

        const payload = await response.json();
        const stations = Array.isArray(payload.stations) ? payload.stations : [];

        if (!cancelled) {
          setStationResults(stations);
          setStationError(stations.length === 0 ? "Nenhuma estação encontrada." : "");
        }
      } catch (fetchError: any) {
        if (cancelled || fetchError.name === "AbortError") {
          return;
        }

        console.error(fetchError);
        setStationResults([]);
        setStationError("Não foi possível obter estações.");
      } finally {
        if (!cancelled) {
          setIsSearchingStations(false);
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [stationQuery, isStationModalOpen]);

  useEffect(() => {
    if (!selectedStation) {
      setIsStationModalOpen(true);
    }
  }, [selectedStation]);

  useEffect(() => {
    if (!isStationModalOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && selectedStation) {
        setIsStationModalOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isStationModalOpen, selectedStation]);

  useEffect(() => {
    if (isStationModalOpen && stationInputRef.current) {
      stationInputRef.current.focus();
    }
  }, [isStationModalOpen]);

  useEffect(() => {
    if (!isMounted) return;
    
    let ignore = false;

    const fetchBoard = async () => {
      try {
        const url = API_BASE_URL 
          ? new URL(`${API_BASE_URL}/api/board`)
          : new URL('/api/board', window.location.origin);
          
        if (selectedStation?.id) {
          url.searchParams.set("stationId", String(selectedStation.id));
        }

        const response = await fetch(url.toString(), {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`Erro ao carregar dados (${response.status})`);
        }

        const payload = await response.json();

        if (!ignore) {
          setBoard({
            departures: Array.isArray(payload.departures) ? payload.departures : [],
            message: payload.message ?? "",
            lastUpdated: payload.lastUpdated ?? "",
          });
          setError("");
          setIsLoading(false);
        }
      } catch (err) {
        if (!ignore) {
          setError("Não foi possível obter os dados. A tentar novamente...");
          setIsLoading(false);
        }
      }
    };

    setIsLoading(true);
    setError("");
    fetchBoard();
    const interval = setInterval(fetchBoard, REFRESH_INTERVAL);

    return () => {
      ignore = true;
      clearInterval(interval);
    };
  }, [selectedStation?.id, isMounted]);

  const handleStationInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setStationQuery(event.target.value);
  };

  const handleSelectStation = (station: any) => {
    setSelectedStation(station);
    setStationQuery(station.name ?? "");
    setStationResults([]);
    setStationError("");
    setIsStationModalOpen(false);
  };

  const handleOpenStationModal = () => {
    setStationResults([]);
    setStationError("");
    setStationQuery("");
    setIsStationModalOpen(true);
  };

  const handleCloseStationModal = () => {
    if (selectedStation) {
      setIsStationModalOpen(false);
    }
  };

  const stationQueryReady = stationQuery.trim().length >= STATION_QUERY_MIN_LENGTH;

  const lastUpdatedLabel = useMemo(() => {
    if (!board.lastUpdated) return "";
    const parsed = new Date(board.lastUpdated);
    if (Number.isNaN(parsed.getTime())) {
      return board.lastUpdated;
    }

    return parsed.toLocaleTimeString("pt-PT", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }, [board.lastUpdated]);

  const departureColumns = [
    { key: "time", label: "Hora" },
    { key: "destination", label: "Destino" },
    { key: "line", label: "LN" },
    { key: "service", label: "Comboio" },
    { key: "remarks", label: "Observações" },
  ];

  const stationName = selectedStation?.name ?? "";

  const visibleDepartures = useMemo(() => {
    if (!now) return [];
    
    const filtered = board.departures.filter((row: any) => {
      if (row?.passed) {
        return false;
      }

      const primaryTime = parseTimeToDate(row?.time, now);
      const remarksTime = parseTimeFromRemarks(row?.remarks, now);
      const referenceDiff = remarksTime?.diffMs ?? primaryTime?.diffMs;

      if (typeof referenceDiff !== "number") {
        return true;
      }

      return referenceDiff >= -PAST_DEPARTURE_GRACE_PERIOD_MS;
    });

    return filtered.slice(0, MAX_VISIBLE_DEPARTURE_ROWS);
  }, [board.departures, now]);

  const boardWidth = BOARD_BASE_WIDTH;
  const boardHeight = Math.max(BOARD_BASE_HEIGHT, boardDimensions.height || BOARD_BASE_HEIGHT);

  useLayoutEffect(() => {
    if (!boardRef.current || !isMounted) {
      return;
    }

    const el = boardRef.current;
    const naturalWidth = el.scrollWidth;
    const naturalHeight = el.scrollHeight;

    if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight)) {
      return;
    }

    setBoardDimensions((prev) => {
      if (Math.abs(prev.width - naturalWidth) > 0.5 || Math.abs(prev.height - naturalHeight) > 0.5) {
        return { width: naturalWidth, height: naturalHeight };
      }

      return prev;
    });
  }, [visibleDepartures.length, board.message, stationName, isLoading, error, isMounted]);

  useEffect(() => {
    if (typeof window === "undefined" || !isMounted) {
      return;
    }

    const updateScale = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;

      setBoardScale((currentScale) => {
        const next = computeBoardScaleXY(width, height, boardWidth, boardHeight);
        const dx = Math.abs((currentScale?.x ?? 1) - next.x);
        const dy = Math.abs((currentScale?.y ?? 1) - next.y);
        return dx > 0.01 || dy > 0.01 ? next : currentScale;
      });
    };

    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, [boardWidth, boardHeight, isMounted]);

  // Don't render time-dependent content until client is mounted
  if (!isMounted || !now) {
    return (
      <div className="app" ref={wrapperRef}>
        <div
          ref={boardRef}
          className="app__board"
          style={{
            width: `${boardWidth}px`,
            height: `${boardHeight}px`,
            transform: `translate(-50%, -50%) scale(1, 1)`,
            transformOrigin: 'center',
            ["--board-max-width" as any]: `${boardWidth}px`,
          }}
        >
          <header className="app__header">
            <button
              type="button"
              className="app__header-branding"
              onClick={handleOpenStationModal}
              title="Alterar estação"
              aria-label="Alterar estação"
            >
              <span className="app__logo app__logo--ip">
                <span className="app__logo-line app__logo-line--primary">Infraestruturas</span>
                <span className="app__logo-line">de Portugal</span>
              </span>
            </button>
            <div className="app__header-title">
              <h1 className="app__title">PARTIDAS / DEPARTURES</h1>
              {stationName ? <span className="app__subtitle">{stationName}</span> : null}
            </div>
            <div className="app__clock" aria-live="polite">
              --:--:--
            </div>
          </header>
          <main className="app__content">
            <div className="app__banner">A carregar informação…</div>
          </main>
          <footer className="app__footer">
            <div className="app__footer-logo" aria-hidden="true">
              <span>CP</span>
            </div>
            <div className="app__ticker">A carregar…</div>
          </footer>
        </div>
      </div>
    );
  }

  return (
    <div className="app" ref={wrapperRef}>
      <div
        ref={boardRef}
        className="app__board"
        style={{
          width: `${boardWidth}px`,
          height: `${boardHeight}px`,
          transform: `translate(-50%, -50%) scale(${boardScale?.x ?? 1}, ${boardScale?.y ?? 1})`,
          transformOrigin: 'center',
          ["--board-max-width" as any]: `${boardWidth}px`,
        }}
      >
        <header className="app__header">
          <button
            type="button"
            className="app__header-branding"
            onClick={handleOpenStationModal}
            title="Alterar estação"
            aria-label="Alterar estação"
          >
            <span className="app__logo app__logo--ip">
              <span className="app__logo-line app__logo-line--primary">Infraestruturas</span>
              <span className="app__logo-line">de Portugal</span>
            </span>
          </button>
          <div className="app__header-title">
            <h1 className="app__title">PARTIDAS / DEPARTURES</h1>
            {stationName ? <span className="app__subtitle">{stationName}</span> : null}
          </div>
          <div className="app__clock" aria-live="polite">
            {formatClock(now)}
          </div>
        </header>

        <main className="app__content">
          {error ? <div className="app__banner app__banner--error">{error}</div> : null}
          {isLoading ? (
            <div className="app__banner">A carregar informação…</div>
          ) : (
            <BoardTable
              title={null}
              subtitle={null}
              columns={departureColumns}
              rows={visibleDepartures}
              type="departures"
              now={now}
            />
          )}
        </main>

        <footer className="app__footer">
          <div className="app__footer-logo" aria-hidden="true">
            <span>CP</span>
          </div>
          <div className="app__ticker">{board.message || "Serviço normal"}</div>
          {lastUpdatedLabel ? (
            <div className="app__updated" aria-label={`Atualizado às ${lastUpdatedLabel}`}>{lastUpdatedLabel}</div>
          ) : null}
        </footer>
      </div>

      {isStationModalOpen ? (
        <div className="station-modal" role="dialog" aria-modal="true" aria-labelledby="station-modal-title">
          <div className="station-modal__backdrop" onClick={handleCloseStationModal}>
            <div className="station-modal__dialog" onClick={(event) => event.stopPropagation()}>
              <section className="search-card" aria-label="Pesquisa de estações ferroviárias">
                <div className="search-card__header">
                  <h2 id="station-modal-title">Escolhe a estação</h2>
                  {selectedStation ? (
                    <span className="search-card__selected">
                      Atual: <strong>{selectedStation.name}</strong>
                    </span>
                  ) : null}
                </div>
                <label className="search-card__label" htmlFor="station-search-input">
                  Procurar estação
                </label>
                <div className="search-card__input-wrapper">
                  <input
                    id="station-search-input"
                    ref={stationInputRef}
                    type="text"
                    className="search-card__input"
                    placeholder="Ex.: Lisboa, Aveiro, Porto…"
                    value={stationQuery}
                    onChange={handleStationInputChange}
                    autoComplete="off"
                    spellCheck={false}
                    aria-autocomplete="list"
                    aria-expanded={stationQueryReady && stationResults.length > 0}
                  />
                  {isSearchingStations ? <span className="search-card__status">A procurar…</span> : null}
                </div>
                {stationError && stationQueryReady ? <div className="search-card__feedback">{stationError}</div> : null}
                {stationQueryReady && stationResults.length > 0 ? (
                  <ul className="search-card__results" role="listbox">
                    {stationResults.map((station, index) => (
                      <li key={station.id ?? station.name ?? `station-${index}`}>
                        <button type="button" className="search-card__result" onClick={() => handleSelectStation(station)}>
                          <span className="search-card__result-name">{station.name}</span>
                          {station.id ? <span className="search-card__result-id">#{station.id}</span> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="station-modal__actions">
                  {selectedStation ? (
                    <button type="button" className="station-modal__close" onClick={handleCloseStationModal}>
                      Cancelar
                    </button>
                  ) : null}
                </div>
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
