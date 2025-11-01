import { NextRequest, NextResponse } from "next/server";

const SCHEDULE_BASE_URL = "https://www.infraestruturasdeportugal.pt/negocios-e-servicos/partidas-chegadas";
const SCHEDULE_DEFAULT_SERVICES = ["INTERNACIONAL", "ALFA", "IC", "IR", "REGIONAL", "URB|SUBUR", "ESPECIAL"];
const SCHEDULE_FETCH_HEADERS = {
  accept: "application/json, text/plain, */*",
  "accept-language": "pt-PT,pt;q=0.9,en;q=0.8",
  priority: "u=1, i",
  "sec-ch-ua": '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Linux"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "x-dtpc": "10$229230789_45h8vCNPSKQRUSGKQURFUIRUTSUKCEDKUAMHU-0e0",
  referer: "https://www.infraestruturasdeportugal.pt/negocios-e-servicos/partidas-chegadas",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.5993.90 Safari/537.36",
};
const SCHEDULE_LOOKBEHIND_MINUTES = 60;
const SCHEDULE_LOOKAHEAD_MINUTES = 12 * 60;

function formatDateTimeForSchedule(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

function buildScheduleUrl(stationId: string, now = new Date()) {
  const start = new Date(now.getTime() - SCHEDULE_LOOKBEHIND_MINUTES * 60 * 1000);
  const end = new Date(now.getTime() + SCHEDULE_LOOKAHEAD_MINUTES * 60 * 1000);
  const startSegment = encodeURIComponent(formatDateTimeForSchedule(start));
  const endSegment = encodeURIComponent(formatDateTimeForSchedule(end));
  const servicesSegment = encodeURIComponent(SCHEDULE_DEFAULT_SERVICES.join(", "));

  return `${SCHEDULE_BASE_URL}/${encodeURIComponent(stationId)}/${startSegment}/${endSegment}/${servicesSegment}`;
}

function inferStatusFromRemarks(remarks: string | undefined) {
  if (typeof remarks !== "string") {
    return "pontual";
  }

  const normalized = remarks.toLowerCase();
  if (normalized.includes("suprim")) {
    return "suprimido";
  }
  if (normalized.includes("atras")) {
    return "atrasado";
  }

  return "pontual";
}

function formatServiceLabel(entry: any) {
  const type = typeof entry.TipoServico === "string" ? entry.TipoServico.trim() : "";
  const code = entry.NComboio1 ?? entry.NComboio2 ?? "";

  if (type && code) {
    return `${type} ${code}`;
  }

  if (code) {
    return String(code);
  }

  return type;
}

function mapScheduleRows(rows: any[], type: string) {
  return rows.map((entry, index) => {
    const remarks = typeof entry.Observacoes === "string" ? entry.Observacoes.trim() : "";
    const id =
      typeof entry.DataHoraPartidaChegada_ToOrderByi === "string" || typeof entry.DataHoraPartidaChegada_ToOrderByi === "number"
        ? String(entry.DataHoraPartidaChegada_ToOrderByi)
        : `${type}-${index}`;

    const mapped: any = {
      id,
      time: entry.DataHoraPartidaChegada ?? "",
      line: typeof entry.Linha === "string" ? entry.Linha.trim() : "",
      service: formatServiceLabel(entry),
      status: inferStatusFromRemarks(remarks),
      remarks,
      passed: Boolean(entry.ComboioPassou),
    };

    if (type === "departures") {
      mapped.destination = typeof entry.NomeEstacaoDestino === "string" ? entry.NomeEstacaoDestino : "";
    } else {
      mapped.origin = typeof entry.NomeEstacaoOrigem === "string" ? entry.NomeEstacaoOrigem : "";
    }

    return mapped;
  });
}

async function fetchStationBoard(stationId: string) {
  const url = buildScheduleUrl(stationId);
  const response = await fetch(url, {
    headers: SCHEDULE_FETCH_HEADERS,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Falha ao obter painel (${response.status}): ${text}`);
  }

  const payload = await response.json();
  const sections = Array.isArray(payload.response) ? payload.response : [];
  const departuresSection = sections.find((section: any) => section.TipoPedido === 1);
  const arrivalsSection = sections.find((section: any) => section.TipoPedido === 2);

  return {
    lastUpdated: new Date().toISOString(),
    message: "",
    departures: mapScheduleRows(
      Array.isArray(departuresSection?.NodesComboioTabelsPartidasChegadas)
        ? departuresSection.NodesComboioTabelsPartidasChegadas
        : [],
      "departures",
    ),
    arrivals: mapScheduleRows(
      Array.isArray(arrivalsSection?.NodesComboioTabelsPartidasChegadas)
        ? arrivalsSection.NodesComboioTabelsPartidasChegadas
        : [],
      "arrivals",
    ),
  };
}

// Mock data for when no station is selected
const stationState = {
  lastUpdated: new Date().toISOString(),
  message: "Operação normal",
  departures: [
    {
      id: "dep-1",
      time: "07:38",
      destination: "SINTRA",
      line: "2",
      service: "SUBU 18220",
      status: "suprimido",
      remarks: "Greve CP - Perturbações",
    },
    {
      id: "dep-2",
      time: "07:45",
      destination: "SINTRA",
      line: "4",
      service: "SUBU 16004",
      status: "suprimido",
      remarks: "Greve CP - Perturbações",
    },
    {
      id: "dep-3",
      time: "07:53",
      destination: "TOMAR",
      line: "5",
      service: "REGI 4407",
      status: "suprimido",
      remarks: "Greve CP - Perturbações",
    },
  ],
  arrivals: [
    {
      id: "arr-1",
      time: "07:32",
      origin: "SINTRA",
      line: "2",
      service: "SUBU 18219",
      status: "atrasado",
      remarks: "Prevista chegada às 07:40",
    },
    {
      id: "arr-2",
      time: "07:50",
      origin: "CASTANHEIRA",
      line: "3",
      service: "SUBU 18223",
      status: "pontual",
      remarks: "",
    },
  ],
};

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const stationIdParam = searchParams.get("stationId")?.trim() || "";

  if (!stationIdParam) {
    return NextResponse.json(stationState);
  }

  try {
    const board = await fetchStationBoard(stationIdParam);
    return NextResponse.json(board);
  } catch (error: any) {
    if (error.name === "AbortError") {
      return NextResponse.json(
        { error: "Pedido cancelado." },
        { status: 499 }
      );
    }

    console.error(`Erro ao obter painel para a estação ${stationIdParam}:`, error);
    return NextResponse.json(
      { error: "Não foi possível obter o painel da estação selecionada." },
      { status: 502 }
    );
  }
}
