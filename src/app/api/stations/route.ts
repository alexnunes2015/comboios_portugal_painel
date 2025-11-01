import { NextRequest, NextResponse } from "next/server";

const STATION_SEARCH_URL = "https://www.infraestruturasdeportugal.pt/negocios-e-servicos/estacao-nome";
const STATION_FETCH_HEADERS = {
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
  referer: "https://www.infraestruturasdeportugal.pt/negocios-e-servicos/horarios",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.5993.90 Safari/537.36",
};

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q")?.trim() || "";

  if (query.length < 2) {
    return NextResponse.json(
      { error: "Parâmetro 'q' deve conter pelo menos 2 caracteres." },
      { status: 400 }
    );
  }

  try {
    const externalResponse = await fetch(`${STATION_SEARCH_URL}/${encodeURIComponent(query)}`, {
      headers: STATION_FETCH_HEADERS,
    });

    if (!externalResponse.ok) {
      const errorText = await externalResponse.text();
      console.error("Falha na pesquisa de estações:", externalResponse.status, errorText);
      return NextResponse.json(
        { error: "Não foi possível obter as estações." },
        { status: 502 }
      );
    }

    const payload = await externalResponse.json();
    const stations = Array.isArray(payload.response)
      ? payload.response.map((station: any) => ({
          id: station.NodeID ?? null,
          name: station.Nome ?? "",
          distance: station.Distancia ?? null,
          raw: station,
        }))
      : [];

    return NextResponse.json({ stations });
  } catch (error: any) {
    if (error.name === "AbortError") {
      return NextResponse.json(
        { error: "Pedido cancelado." },
        { status: 499 }
      );
    }

    console.error("Erro inesperado na pesquisa de estações:", error);
    return NextResponse.json(
      { error: "Erro interno ao procurar estações." },
      { status: 500 }
    );
  }
}
